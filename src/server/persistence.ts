// =============================================================
// The Living Garden — Server persistence
//
// A thin layer over @dcl/sdk/server's Storage. All I/O goes through the SDK;
// this module never talks to the storage service itself.
//
// The SDK already serializes and coalesces writes per key, shares concurrent
// reads of the same key, caches confirmed values and absences, and skips a
// write whose value is provably already stored. What it leaves to the caller
// is the part the garden depends on:
//
//   • get() returns null BOTH for a key that is not set and for a request that
//     failed, and it rejects outright if the realm lookup fails. Taking a null
//     at face value is what made a storage outage at startup look like an empty
//     world, so that the first save afterwards overwrote the real data. set()
//     reports failure unambiguously, so a probe write settles which one it was.
//   • set() does not retry. A false result is a lost save unless someone acts
//     on it, and nothing did.
// =============================================================

import { Storage } from '@dcl/sdk/server'

export type LoadResult<T> =
  | { ok: true; value: T | null }     // null = the key is genuinely not set
  | { ok: false }                     // storage could not be reached

// ---------------------------------------------------------------
// Host-call budget
// ---------------------------------------------------------------

/** The runtime caps in-flight host calls (shared across storage, signedFetch and
 *  every other runtime API) and rejects rather than queues past the limit. Pace
 *  our own calls well below it so a join burst costs latency instead of errors,
 *  and so other parts of the scene keep their share. */
const MAX_IN_FLIGHT = 8
let   inFlight      = 0
const waiting: Array<() => void> = []

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>(resolve => waiting.push(resolve))
  inFlight++
  try {
    return await fn()
  } finally {
    inFlight--
    waiting.shift()?.()
  }
}

// ---------------------------------------------------------------
// Reachability
// ---------------------------------------------------------------

/** Scene key holding the last time the server confirmed storage was writable.
 *  Written only to settle an ambiguous read; also handy when inspecting state. */
const HEARTBEAT_KEY  = 'serverStorageHeartbeat'
const CONFIRMED_TTL_MS = 10_000   // a recent success vouches for a null read
const FAILED_TTL_MS    =  3_000   // a recent failure suppresses a probe storm

let lastConfirmedAt = 0
let lastFailedAt    = 0
let probe: Promise<boolean> | null = null

/** Any completed operation is evidence about the service, so record both outcomes. */
function markReachable(): void { lastConfirmedAt = Date.now() }
function markUnreachable(): void { lastFailedAt = Date.now() }

/** Is the service reachable? Answers from recent evidence when it can, and
 *  otherwise probes with a write, whose boolean result is unambiguous.
 *  Callers must not hold a host-call slot while awaiting this. */
async function isReachable(): Promise<boolean> {
  const now = Date.now()
  if (now - lastConfirmedAt < CONFIRMED_TTL_MS) return true
  if (now - lastFailedAt    < FAILED_TTL_MS)    return false
  if (!probe) {
    probe = withSlot(() => Storage.set(HEARTBEAT_KEY, Date.now(), { skipIfUnchanged: false }))
      .then(ok => { ok ? markReachable() : markUnreachable(); return ok })
      .catch(() => { markUnreachable(); return false })
    void probe.finally(() => { probe = null })
  }
  return probe
}

// ---------------------------------------------------------------
// Reads
// ---------------------------------------------------------------

async function load<T>(read: () => Promise<T | null>): Promise<LoadResult<T>> {
  let value: T | null
  try {
    value = await withSlot(read)
  } catch {
    markUnreachable()       // get() rejects when the realm lookup fails
    return { ok: false }
  }
  if (value !== null && value !== undefined) {
    markReachable()
    return { ok: true, value }
  }
  // The slot is released by now, so probing here cannot deadlock against it.
  return (await isReachable()) ? { ok: true, value: null } : { ok: false }
}

export function loadScene<T>(key: string): Promise<LoadResult<T>> {
  return load<T>(() => Storage.get<T>(key))
}

export function loadPlayer<T>(address: string, key: string): Promise<LoadResult<T>> {
  return load<T>(() => Storage.player.get<T>(address, key))
}

// ---------------------------------------------------------------
// Writes
// ---------------------------------------------------------------

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS  = 30_000

export interface KeyWriter {
  /** Queue the current state. The SDK coalesces and orders the writes; this adds
   *  retry with backoff so a failed save is not silently lost. */
  save(snapshot: unknown): void
  /** Allow writes. Until the key's load has settled, saves are held, so a
   *  not-yet-loaded blob can never be overwritten by an emptier one. */
  enable(): void
  /** Resolves once nothing is queued, in flight, or awaiting retry. */
  idle(): Promise<void>
}

function createWriter(label: string, write: (value: unknown) => Promise<boolean>): KeyWriter {
  let enabled    = false
  let writing    = false
  let hasPending = false
  let pending: unknown = null
  let failures   = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let idleWaiters: Array<() => void> = []

  function settleIdle(): void {
    if (hasPending || writing || retryTimer !== null) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  async function attempt(value: unknown): Promise<boolean> {
    try {
      return await withSlot(() => write(value))
    } catch {
      return false
    }
  }

  async function flush(): Promise<void> {
    if (writing || !enabled || !hasPending) return
    writing = true
    while (hasPending) {
      const snapshot = pending
      hasPending = false
      if (await attempt(snapshot)) { failures = 0; markReachable(); continue }
      markUnreachable()
      if (hasPending) continue        // a newer snapshot arrived; write that instead
      hasPending = true               // keep this one for the retry
      pending    = snapshot
      failures++
      const delay = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.min(failures - 1, 5))
      console.error(`[Persistence] ${label}: save failed (attempt ${failures}) — retrying in ${delay / 1_000}s`)
      retryTimer = setTimeout(() => { retryTimer = null; void flush() }, delay)
      break
    }
    writing = false
    settleIdle()
  }

  return {
    save(snapshot) {
      pending    = snapshot
      hasPending = true
      if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
      void flush()
    },
    enable() {
      enabled = true
      void flush()
    },
    idle() {
      return new Promise<void>(resolve => { idleWaiters.push(resolve); settleIdle() })
    },
  }
}

export function createSceneWriter(key: string): KeyWriter {
  return createWriter(key, value => Storage.set(key, value))
}

export function createPlayerWriter(address: string, key: string): KeyWriter {
  return createWriter(`${key}@${address.slice(0, 8)}`, value => Storage.player.set(address, key, value))
}
