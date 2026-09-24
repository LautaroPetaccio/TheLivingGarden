// =============================================================
// The Living Garden — Server persistence
//
// A thin layer over @dcl/sdk/server's Storage. All I/O goes through the SDK;
// this module never talks to the storage service itself.
//
// The SDK serializes and coalesces writes per key, shares concurrent reads of
// the same key, caches confirmed values and absences, makes a read wait for the
// writes to its key already pending, and skips a write whose value is provably
// already stored. A read that fails rejects instead of resolving null, so a
// failure is never mistaken for an empty key. What it leaves to the caller is
// retrying a write it reports as failed: set() resolves false and does not retry.
// set() throws a TypeError, before sending anything, for a value it would store
// changed (NaN, a Map, undefined in an array, ...) or an invalid key or address.
// Retrying the same snapshot cannot help: the writer stores a cleaned copy instead
// (see toStorable), logging every path it changed, and drops only what cannot be
// cleaned. A listener can surface either case (see onSaveProblem).
// =============================================================

import { Storage } from '@dcl/sdk/server'

/** Outcome of a read: a value, null when the key holds nothing, or a failure.
 *  `version` is the shape version the value was written with; 0 for a value
 *  stored before versioning, so a caller can migrate on the way in. */
export type LoadResult<T> =
  | { ok: true; value: T | null; version: number }   // null = the key holds nothing
  | { ok: false }                                    // the read threw and returned no answer

// ---------------------------------------------------------------
// Shape versions
// ---------------------------------------------------------------

/** Every value is written as this envelope: `v` is the shape version of `d`.
 *  Values written before versioning are bare payloads and read back as version 0,
 *  so nothing stored has to be rewritten before it can be read. */
interface Envelope { v: number; d: unknown }

/** Version stamped on a value stored before this envelope existed. */
export const LEGACY_VERSION = 0

function isEnvelope(x: unknown): x is Envelope {
  return !!x && typeof x === 'object' && !Array.isArray(x)
    && typeof (x as Envelope).v === 'number' && 'd' in (x as Envelope)
}

function unwrap<T>(stored: unknown): { value: T | null; version: number } {
  if (isEnvelope(stored)) return { value: (stored.d ?? null) as T | null, version: stored.v }
  return { value: (parseLegacy(stored) ?? null) as T | null, version: LEGACY_VERSION }
}

/** Before the envelope, the server stored every value as `JSON.stringify(...)` text, so a
 *  legacy string is JSON to parse, not the payload itself. Text that is not JSON is
 *  returned as it is (an unversioned string value). */
function parseLegacy(stored: unknown): unknown {
  if (typeof stored !== 'string') return stored
  try { return JSON.parse(stored) } catch { return stored }
}

// ---------------------------------------------------------------
// Pacing
// ---------------------------------------------------------------

/** The authoritative-server runtime allows 32 concurrent fetches per scene and
 *  rejects the rest with "fetch: too many concurrent requests" (bevy-explorer
 *  SERVER_MAX_CONCURRENT_FETCHES, enforced in server mode only; hammurabi-headless
 *  mirrors it as maxConcurrentFetches). The cap counts every fetch the scene makes,
 *  and a slow one holds its slot for up to the 15 s fetch timeout. A rejected read
 *  now surfaces as a failed load rather than an empty key, but it still fails:
 *  pacing our own calls well below the cap keeps a join burst from failing a
 *  player's loads at all. Costs nothing when nothing is queued. */
const MAX_IN_FLIGHT = 8
let   inFlight      = 0
const waiting: Array<() => void> = []

/** Runs `fn` once a call slot frees up, keeping the scene under the fetch cap. */
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

/** One write in flight at a time, across every key. It keeps writes to one slot of
 *  the fetch cap, so a burst of saves cannot starve the reads of players joining.
 *  (It was introduced because the 7.26.1 preview storage server lost concurrent
 *  writes to different keys, as a harvest's 'boxes' write did to its 'flowers' write
 *  on 2026-09-17; the preview server in this sdk-commands locks each write.) */
let writeChain: Promise<unknown> = Promise.resolve()

/** Runs `write` after every earlier write has settled. */
function queuedWrite<T>(write: () => Promise<T>): Promise<T> {
  const run = writeChain.then(write, write)
  writeChain = run.catch(() => undefined)
  return run
}

// ---------------------------------------------------------------
// Reads
// ---------------------------------------------------------------

/** Reads through a slot, reporting a rejected read as a failure. */
async function load<T>(read: () => Promise<unknown>): Promise<LoadResult<T>> {
  try {
    return { ok: true, ...unwrap<T>(await withSlot(read)) }
  } catch {
    return { ok: false }   // get() rejects whenever the read fails
  }
}

/** Reads a scene-scoped key, shared by everyone in the world. */
export function loadScene<T>(key: string): Promise<LoadResult<T>> {
  return load<T>(() => Storage.get<unknown>(key))
}

/** Reads a key held against one player's address. */
export function loadPlayer<T>(address: string, key: string): Promise<LoadResult<T>> {
  return load<T>(() => Storage.player.get<unknown>(address, key))
}

// ---------------------------------------------------------------
// Values the SDK refuses
// ---------------------------------------------------------------

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g
const MAX_CLEAN_DEPTH = 1_000

/** Whether an address can key player storage: the SDK and the service accept only a 0x-prefixed 20-byte hex address. */
export function isStorableAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}

/** A copy of `value` the SDK will store, and a description of every change made to get it. Each change is
 *  what JSON.stringify would have done silently under the old SDK, or the closest storable equivalent. */
export function toStorable(value: unknown): { value: unknown; changes: string[] } {
  const changes: string[] = []
  const ancestors = new Set<object>()

  function text(s: string, path: string, what: string): string {
    const clean = s.replace(/\u0000/g, '').replace(LONE_SURROGATE, '\ufffd')
    if (clean !== s) changes.push(`${path || 'the value'}: ${what} with a NUL or an unpaired surrogate, cleaned`)
    return clean
  }

  /** The storable form of `v`, or `undefined` to drop an object property. */
  function walk(v: unknown, path: string, inArray: boolean, depth: number): unknown {
    const at = path || 'the value'
    const gone = inArray ? null : undefined
    switch (typeof v) {
      case 'number':
        if (Number.isFinite(v)) return v
        changes.push(`${at}: ${v} → null`)
        return null
      case 'bigint': {
        const n = Number(v)
        changes.push(`${at}: BigInt → ${Number.isSafeInteger(n) ? 'number' : 'string'}`)
        return Number.isSafeInteger(n) ? n : String(v)
      }
      case 'string':
        return text(v, path, 'text')
      case 'undefined':
        if (inArray) changes.push(`${at}: undefined → null`)
        return gone
      case 'function':
      case 'symbol':
        changes.push(`${at}: ${typeof v} dropped`)
        return gone
      case 'object':
        break
      default:
        return v
    }
    if (v === null) return null
    const o = v as Record<string, unknown>
    if (depth > MAX_CLEAN_DEPTH) { changes.push(`${at}: nested too deeply, dropped`); return gone }
    if (ancestors.has(o)) { changes.push(`${at}: circular reference dropped`); return gone }
    if (typeof o.toJSON === 'function') {
      const json = (o.toJSON as () => unknown)()
      if (json === undefined) { changes.push(`${at}: toJSON() returned undefined, dropped`); return gone }
      if (json !== o) return walk(json, path, inArray, depth + 1)
    }

    let converted: unknown = o
    if (o instanceof Map) converted = Object.fromEntries([...o].map(([k, x]) => [String(k), x]))
    else if (o instanceof Set) converted = [...o]
    else if (ArrayBuffer.isView(o)) converted = Array.from(new Uint8Array(o.buffer, o.byteOffset, o.byteLength))
    else if (o instanceof ArrayBuffer) converted = Array.from(new Uint8Array(o))
    else if (o instanceof RegExp) converted = String(o)
    else if (o instanceof Error) converted = { name: o.name, message: o.message }
    else if (o instanceof Promise || o instanceof WeakMap || o instanceof WeakSet) {
      changes.push(`${at}: ${o.constructor.name} dropped`)
      return gone
    }
    if (converted !== o) {
      changes.push(`${at}: ${o.constructor.name} converted`)
      return walk(converted, path, inArray, depth + 1)
    }

    ancestors.add(o)
    try {
      if (Array.isArray(o)) {
        const out: unknown[] = []
        for (let i = 0; i < o.length; i++) {
          if (!(i in o)) { changes.push(`${path}[${i}]: hole → null`); out.push(null); continue }
          out.push(walk(o[i], `${path}[${i}]`, true, depth + 1))
        }
        return out
      }
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(o)) {
        const cleanKey = text(key, `${path}.${key}`, 'key')
        const item = walk(o[key], `${path}.${cleanKey}`, false, depth + 1)
        if (item !== undefined) out[cleanKey] = item
      }
      return out
    } finally {
      ancestors.delete(o)
    }
  }

  return { value: walk(value, '', false, 0), changes }
}

/** Receives every save the SDK refused: whether a cleaned copy was stored instead, and what was changed or why. */
export type SaveProblemListener = (label: string, cleaned: boolean, detail: string) => void
let saveProblemListener: SaveProblemListener | undefined

/** Registers the one listener told about refused saves, e.g. to notify an admin. */
export function onSaveProblem(listener: SaveProblemListener | undefined): void {
  saveProblemListener = listener
}

// ---------------------------------------------------------------
// Writes
// ---------------------------------------------------------------

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS  = 30_000

/** Write-through for a single storage key: hold, coalesce, retry. */
export interface KeyWriter {
  /** Queue the current state, stamped with the writer's shape version. The SDK
   *  coalesces and orders the writes; this adds retry with backoff so a failed
   *  save is not silently lost. */
  save(snapshot: unknown): void
  /** Allow writes. Saves before this are held, so a blob is never written back
   *  before it has been read. */
  enable(): void
  /** Resolves once nothing is queued, in flight, or awaiting retry. */
  idle(): Promise<void>
}

/** Builds a writer over `write`. `label` names the key in retry logs. */
function createWriter(label: string, version: number, write: (value: unknown) => Promise<boolean>): KeyWriter {
  let enabled    = false
  let writing    = false
  let hasPending = false
  let pending: unknown = null
  let failures   = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let idleWaiters: Array<() => void> = []

  /** Releases idle() waiters once nothing is left to write. */
  function settleIdle(): void {
    if (hasPending || writing || retryTimer !== null) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  /** One write attempt: whether it landed, failed and is worth retrying, or was refused. A value the SDK
   *  refuses is stored as a cleaned copy instead; only a snapshot with nothing to clean is dropped. */
  async function attempt(value: unknown): Promise<'landed' | 'failed' | 'refused'> {
    let refusal: string
    try {
      return (await queuedWrite(() => write(value))) ? 'landed' : 'failed'
    } catch (error) {
      if (!(error instanceof TypeError)) return 'failed'
      refusal = error.message
    }

    const { value: cleaned, changes } = toStorable(value)
    // Paths are relative to the envelope's payload, which is what the rest of the server calls this key.
    const changed = changes.map((c) => c.replace(/^\.d(?=[.[:])/, label))
    if (changed.length === 0) return refuse(refusal)
    console.error(`[Persistence] ${label}: the SDK refused the value, storing a cleaned copy — ${changed.join('; ')}`)
    saveProblemListener?.(label, true, changed.join('; '))
    try {
      return (await queuedWrite(() => write(cleaned))) ? 'landed' : 'failed'
    } catch (error) {
      return error instanceof TypeError ? refuse(error.message) : 'failed'
    }
  }

  function refuse(reason: string): 'refused' {
    console.error(`[Persistence] ${label}: save refused, snapshot dropped — ${reason}`)
    saveProblemListener?.(label, false, reason)
    return 'refused'
  }

  /** Writes the newest snapshot, retrying with backoff until one lands. */
  async function flush(): Promise<void> {
    if (writing || !enabled || !hasPending) return
    writing = true
    while (hasPending) {
      const snapshot = pending
      hasPending = false
      const outcome = await attempt(snapshot)
      if (outcome !== 'failed') { failures = 0; continue }
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
      pending    = { v: version, d: snapshot } satisfies Envelope
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

/** Writer for a scene-scoped key. `version` stamps every value it writes. */
export function createSceneWriter(key: string, version: number): KeyWriter {
  return createWriter(key, version, value => Storage.set(key, value))
}

/** Writer for a key held against one player's address. */
export function createPlayerWriter(address: string, key: string, version: number): KeyWriter {
  return createWriter(`${key}@${address.slice(0, 8)}`, version, value => Storage.player.set(address, key, value))
}
