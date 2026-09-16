// =============================================================
// The Living Garden — Server persistence
//
// A thin client for the Server Side Storage service plus a per-key writer
// that gives the in-memory game state durable, ordered, retried writes.
//
// Why not @dcl/sdk/server's Storage directly? In 7.21.1-22918726402 its
// get() returns null for BOTH "key not set" and "request failed", and its
// set() swallows failures into a bare `false` that nothing checked. A failed
// read at startup therefore looked like an empty world, and the first save
// then overwrote the real data. This module talks to the same endpoints
// (mirrors node_modules/@dcl/sdk/server/storage/*.js and storage-url.js) but
// keeps the two cases apart and never lets a failed write go unnoticed.
// =============================================================

import { signedFetch } from '~system/SignedFetch'
import { getRealm } from '~system/Runtime'

export type ReadResult<T> =
  | { ok: true; value: T | null }     // null = key not set
  | { ok: false; error: string }

// ---------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------

const STORAGE_ORG  = 'https://storage.decentraland.org'
const STORAGE_ZONE = 'https://storage.decentraland.zone'

let baseUrlPromise: Promise<string> | null = null

/** Preview → the local preview server; `.zone` realms → staging; else production. */
function storageBaseUrl(): Promise<string> {
  if (!baseUrlPromise) {
    baseUrlPromise = getRealm({}).then(({ realmInfo }) => {
      if (!realmInfo) throw new Error('Unable to retrieve realm information')
      if (realmInfo.isPreview) return realmInfo.baseUrl
      if (realmInfo.baseUrl.includes('.zone')) return STORAGE_ZONE
      return STORAGE_ORG
    })
    baseUrlPromise.catch(() => { baseUrlPromise = null })   // let the next call retry
  }
  return baseUrlPromise
}

export function scenePath(key: string): string {
  return `/values/${encodeURIComponent(key)}`
}

export function playerPath(address: string, key: string): string {
  return `/players/${encodeURIComponent(address)}/values/${encodeURIComponent(key)}`
}

// ---------------------------------------------------------------
// Transport
// ---------------------------------------------------------------

/** The runtime rejects host calls beyond 40 in flight (storage, signedFetch, …)
 *  instead of queuing them. Queue here so a join burst costs latency, not
 *  failed reads. Kept well under the cap to leave room for other host calls. */
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

type HttpResult =
  | { ok: true;  status: number; body: string }
  | { ok: false; status?: number; error: string }

async function request(path: string, init?: { method: string; body: string }): Promise<HttpResult> {
  return withSlot(async () => {
    try {
      const url = (await storageBaseUrl()) + path
      const res = await signedFetch(
        init ? { url, init: { method: init.method, body: init.body, headers: { 'content-type': 'application/json' } } }
             : { url },
      )
      if (res.ok) return { ok: true, status: res.status, body: res.body }
      return { ok: false, status: res.status, error: `${res.status} ${res.statusText}` }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}

// ---------------------------------------------------------------
// Reads
// ---------------------------------------------------------------

/** Earlier server versions pre-stringified every value, so the service holds a
 *  JSON string inside JSON for those keys. Unwrap them; pass new values through. */
function decodeStored<T>(raw: unknown): T | null {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T } catch { return raw as unknown as T }
  }
  return raw as T
}

/** One read. A 404 or an explicit null value is "not set"; anything else that
 *  is not a 2xx is a failure the caller must not mistake for an empty key. */
export async function readValue<T>(path: string): Promise<ReadResult<T>> {
  const res = await request(path)
  if (!res.ok) {
    if (res.status === 404) return { ok: true, value: null }
    return { ok: false, error: res.error }
  }
  try {
    const body = JSON.parse(res.body || '{}') as { value?: unknown }
    return { ok: true, value: decodeStored<T>(body.value) }
  } catch {
    return { ok: false, error: 'malformed response body' }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/** Startup reads: retry a failure once after a short pause, so a single blip does
 *  not hold saves. Deliberately shallow — server() awaits these before it registers
 *  message handlers, and a longer chain of timeouts would keep the game inert. A
 *  real outage is recovered by the caller's background reload, not by retrying here.
 *  A "not set" result returns immediately; only failures retry. */
export async function readWithRetry<T>(path: string, attempts = 2, baseDelayMs = 1_000): Promise<ReadResult<T>> {
  let result = await readValue<T>(path)
  for (let attempt = 1; attempt < attempts && !result.ok; attempt++) {
    await sleep(baseDelayMs * 2 ** (attempt - 1))
    result = await readValue<T>(path)
  }
  return result
}

// ---------------------------------------------------------------
// Writes
// ---------------------------------------------------------------

async function putValue(path: string, body: string): Promise<boolean> {
  const res = await request(path, { method: 'PUT', body })
  if (!res.ok) console.error(`[Persistence] PUT ${path} failed: ${res.error}`)
  return res.ok
}

const RETRY_BASE_MS = 1_000
const RETRY_MAX_MS  = 30_000

export interface KeyWriter {
  /** Queue the current state. Coalesces: only the newest unsent snapshot is written,
   *  writes never overlap, and a failed write retries with backoff until it lands
   *  or a newer snapshot supersedes it. */
  save(snapshot: unknown): void
  /** Allow writes. Until the key's load has settled, saves are held so a
   *  not-yet-loaded blob can never be overwritten by an emptier one. */
  enable(): void
  /** Resolves once nothing is queued, in flight, or awaiting retry. */
  idle(): Promise<void>
}

export function createKeyWriter(label: string, path: string): KeyWriter {
  let enabled  = false
  let writing  = false
  let pending: string | null = null                       // serialized body of the newest unsent snapshot
  let failures = 0
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let idleWaiters: Array<() => void> = []

  function settleIdle(): void {
    if (pending !== null || writing || retryTimer !== null) return
    const waiters = idleWaiters
    idleWaiters = []
    for (const resolve of waiters) resolve()
  }

  async function flush(): Promise<void> {
    if (writing || !enabled) return
    writing = true
    while (pending !== null) {
      const body = pending
      pending = null
      if (await putValue(path, body)) { failures = 0; continue }
      if (pending !== null) continue                      // a newer snapshot superseded the failed one
      pending = body                                      // keep it for the retry
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
      pending = JSON.stringify({ value: snapshot })
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
