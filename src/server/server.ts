// =============================================================
// The Living Garden — Authoritative Server
// Runs headlessly alongside the scene. Owns all game state:
//   • Plant watered/expired state  (PlantSync component, persisted)
//   • Bloom trigger + reset        (threshold check + timer)
//   • Seed pouches, boxes, keepsakes (persisted per player / per scene)
// Memory is authoritative. persistence.ts gives every key a coalesced, ordered,
// retried write-through and never mistakes a storage outage for empty data.
// =============================================================

import {
  engine,
  Entity,
  PlayerIdentityData,
  executeTask,
} from '@dcl/sdk/ecs'
import { loadScene, loadPlayer, createSceneWriter, createPlayerWriter, KeyWriter } from './persistence'
import { PlantSync }          from '../shared/schemas'
import { room }               from '../shared/messages'
import {
  PLANT_NAMES,
  BLOOM_THRESHOLD,
  WATERED_EXPIRY_MS,
  FAST_PLANT_EXPIRY_MS,
  FAST_PLANT_NAMES,
  BLOOM_RESET_DELAY_MS,
  BLOOM_SUSTAIN_MS,
  BLOOM_WINDOWS,
  scaledBloomThreshold,
  seedSpawnCount,
  seedRareChance,
  SEED_LIFETIME_MS,
  GARDEN_BOUNDS,
  BOX_POSITIONS,
  BOX_GROW_MS,
  FLOWERS,
  BOX_CAP_DEFAULT,
  FLOWER_COLLECTION_CAP,
  BOX_WATER_SHAVE_MS,
  BOX_WATER_MAX,
} from '../shared/config'

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

const plantEntities   = new Map<string, Entity>()   // plantId → entity
const knownPlayers    = new Set<Entity>()            // entities seen this session
const playerAddresses = new Map<Entity, string>()    // entity → address (for disconnect cleanup)
const syncRateLimits  = new Map<string, number>()    // address → last requestFullSync ms
const SYNC_RATE_MS    = 5_000                        // min ms between full syncs per player
let   bloomActive      = false
let   bloomScale       = 1                    // thresholdAtFire / BLOOM_THRESHOLD of the active bloom


// ── Leaderboard ──────────────────────────────────────────────
interface LeaderboardEntry { displayName: string; total: number }
const leaderboard = new Map<string, LeaderboardEntry>()  // address → entry

// ---------------------------------------------------------------
// Persistence — scene-level blobs
// A blob whose startup load failed stays write-locked (saves are held) until a
// later load succeeds and is merged, so a storage outage at boot can never be
// overwritten by an emptier in-memory state. On merge, memory wins for anything
// touched this session and stored state fills the rest.
// ---------------------------------------------------------------

const plantsWriter      = createSceneWriter('plants')
const leaderboardWriter = createSceneWriter('leaderboard')
const resetAtWriter     = createSceneWriter('leaderboardResetAt')
const boxesWriter       = createSceneWriter('boxes')

const STORAGE_UNAVAILABLE_NOTICE = 'Your garden data is unavailable right now — try again in a moment'
const RELOAD_INTERVAL_MS         = 30_000

/** Keep retrying a failed startup load in the background until it succeeds. */
function scheduleReload(label: string, load: () => Promise<boolean>): void {
  setTimeout(() => executeTask(async () => {
    if (await load()) {
      console.log(`[Server] ${label}: late load succeeded — merged into live state, saves resumed`)
      checkBloomThreshold()
      return
    }
    scheduleReload(label, load)
  }), RELOAD_INTERVAL_MS)
}

interface PlantRecord {
  plantId:   string
  isWatered: boolean
  wateredAt: number   // ms timestamp stored as number (not BigInt)
  wateredBy: string   // display name of the player who watered it
}

// In-memory map of plantId → display name (kept in sync with PlantRecord)
const wateredByMap = new Map<string, string>()

/** Load (or late-load) plant states. Returns false if storage was unreachable. */
async function loadPlantStates(): Promise<boolean> {
  const res = await loadScene<PlantRecord[]>('plants')
  if (!res.ok) { console.error('[Server] plants: storage unreachable — saves held until a reload succeeds'); return false }

  // Parse defensively — a legacy or hand-edited value may not have this shape.
  const records = Array.isArray(res.value) ? res.value : []
  const now = Date.now()
  let restored = 0
  for (const rec of records) {
    const entity = plantEntities.get(rec.plantId)
    if (!entity || !rec.isWatered) continue
    if (PlantSync.getOrNull(entity)?.isWatered) continue   // watered this session — memory wins

    const expiryMs = FAST_PLANT_NAMES.has(rec.plantId) ? FAST_PLANT_EXPIRY_MS : WATERED_EXPIRY_MS
    const elapsed  = now - rec.wateredAt
    if (elapsed >= expiryMs) continue  // expired while server was down

    const ps = PlantSync.getMutable(entity)
    ps.isWatered = true
    ps.wateredAt = rec.wateredAt
    if (rec.wateredBy) wateredByMap.set(rec.plantId, rec.wateredBy)
    scheduleExpiry(rec.plantId, entity, rec.wateredAt, expiryMs - elapsed)
    room.send('plantStateUpdate', { plantId: rec.plantId, isWatered: true, wateredAt: rec.wateredAt, wateredBy: rec.wateredBy ?? '' })
    restored++
  }
  console.log(res.value === null ? '[Server] No persisted plant states — starting fresh' : `[Server] Restored ${restored} watered plants from storage`)
  plantsWriter.enable()
  return true
}

function savePlantStates(): void {
  const records: PlantRecord[] = []
  for (const [plantId, entity] of plantEntities) {
    const ps = PlantSync.getOrNull(entity)
    if (!ps) continue
    records.push({ plantId, isWatered: ps.isWatered, wateredAt: Number(ps.wateredAt), wateredBy: wateredByMap.get(plantId) ?? '' })
  }
  plantsWriter.save(records)
}

// ── Leaderboard helpers ──────────────────────────────────────

const LEADERBOARD_RESET_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000  // 7 days

interface LeaderboardRecord extends LeaderboardEntry { address: string }

/** Load (or late-load) the leaderboard and its weekly reset clock. Returns false
 *  if storage was unreachable. Stored totals are added to this session's totals. */
async function loadLeaderboard(): Promise<boolean> {
  const [board, resetAt] = await Promise.all([
    loadScene<LeaderboardRecord[]>('leaderboard'),
    loadScene<number>('leaderboardResetAt'),
  ])
  if (!board.ok || !resetAt.ok) {
    console.error('[Server] leaderboard: storage unreachable — saves held until a reload succeeds')
    return false
  }

  for (const r of Array.isArray(board.value) ? board.value : []) {
    const live = leaderboard.get(r.address)
    if (live) live.total += r.total
    else leaderboard.set(r.address, { displayName: r.displayName, total: r.total })
  }
  console.log(`[Server] Loaded leaderboard: ${leaderboard.size} players`)
  leaderboardWriter.enable()
  resetAtWriter.enable()

  // Weekly reset — if the clock is missing, start it now (preserves existing data)
  const storedResetAt = Number(resetAt.value ?? 0)
  if (!storedResetAt) {
    resetAtWriter.save(Date.now())
    console.log('[Server] Leaderboard weekly reset clock started')
  } else if (Date.now() - storedResetAt >= LEADERBOARD_RESET_INTERVAL_MS) {
    leaderboard.clear()
    resetAtWriter.save(Date.now())
    console.log('[Server] Weekly leaderboard reset complete')
  }
  saveLeaderboard()
  return true
}

function saveLeaderboard(): void {
  const records: LeaderboardRecord[] = [...leaderboard.entries()].map(([address, e]) => ({ address, ...e }))
  leaderboardWriter.save(records)
}

/** Top-10 sorted entries as JSON, ready to send over the wire. */
function leaderboardJson(): string {
  return JSON.stringify(
    [...leaderboard.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(e => ({ displayName: e.displayName, count: e.total }))
  )
}

function broadcastLeaderboard(to?: string[]): void {
  const entriesJson = leaderboardJson()
  if (to) {
    // Targeted send — used on player join to push current state to one client
    room.send('leaderboardUpdate', { entriesJson }, { to })
  } else {
    // Broadcast — reaches all connected clients including the triggering player
    room.send('leaderboardUpdate', { entriesJson })
  }
}

// ---------------------------------------------------------------
// Bloom
// ---------------------------------------------------------------

function getWateredCount(): number {
  let count = 0
  for (const [, entity] of plantEntities) {
    if (PlantSync.getOrNull(entity)?.isWatered) count++
  }
  return count
}

// ── v2: scaled bloom threshold ───────────────────────────────

/** Bloom threshold scaled to gardeners currently present (solo → small quiet bloom). */
function currentBloomThreshold(): number {
  return scaledBloomThreshold(knownPlayers.size)
}

let lastBroadcastThreshold = -1

/** Send the scaled threshold — targeted to one player, or broadcast when it changed.
 *  A broadcast-side change also re-evaluates the sustain timer: a join can raise the
 *  threshold above current health (pause), a leave can drop it below (resume). */
function sendThreshold(to?: string[]): void {
  const threshold = currentBloomThreshold()
  const gardeners = Math.max(1, knownPlayers.size)
  if (to) {
    room.send('thresholdUpdate', { threshold, gardeners }, { to })
    return
  }
  if (threshold === lastBroadcastThreshold) return
  lastBroadcastThreshold = threshold
  room.send('thresholdUpdate', { threshold, gardeners })
  console.log(`[Server] Bloom threshold now ${threshold} (${gardeners} gardeners present)`)
  checkBloomThreshold()
}

// ── Sustained-health bloom trigger ───────────────────────────

let bloomSustainTimer:     ReturnType<typeof setTimeout> | null = null
let bloomSustainStartedAt: number | null = null   // wall-clock ms when current run began
let bloomSustainElapsedMs: number        = 0      // ms accumulated before current run

/** Pause the sustain countdown (health dipped below threshold).
 *  Preserves elapsed time so the timer resumes from where it left off. */
function pauseBloomSustain(): void {
  if (bloomSustainTimer !== null) {
    clearTimeout(bloomSustainTimer)
    bloomSustainTimer = null
    if (bloomSustainStartedAt !== null) {
      bloomSustainElapsedMs += Date.now() - bloomSustainStartedAt
      bloomSustainStartedAt  = null
    }
    console.log(`[Server] Bloom sustain paused — ${Math.round(bloomSustainElapsedMs / 1_000)}s elapsed so far`)
  }
}

/** Full reset — called when bloom fires or garden resets. */
function cancelBloomSustain(): void {
  if (bloomSustainTimer !== null) {
    clearTimeout(bloomSustainTimer)
    bloomSustainTimer = null
  }
  bloomSustainStartedAt = null
  bloomSustainElapsedMs = 0
}

/** Call after any change to watered count.
 *  Resumes (or starts) the sustain countdown when health ≥ threshold;
 *  pauses it — without resetting — if health dips below. */
function checkBloomThreshold(): void {
  if (bloomActive) return
  const count     = getWateredCount()
  const threshold = currentBloomThreshold()
  if (count >= threshold) {
    if (bloomSustainTimer === null) {
      const remaining = BLOOM_SUSTAIN_MS - bloomSustainElapsedMs
      bloomSustainStartedAt = Date.now()
      console.log(`[Server] Health ${count}/${threshold} ≥ threshold — bloom fires in ${Math.ceil(remaining / 1_000)}s (${Math.round(bloomSustainElapsedMs / 1_000)}s already elapsed)`)
      bloomSustainTimer = setTimeout(() => {
        executeTask(async () => {
          bloomSustainTimer     = null
          bloomSustainStartedAt = null
          // Only reset elapsed after confirming we can bloom — if a plant expired in the
          // same tick, we want checkBloomThreshold() (called on next water) to restart
          // from 0 rather than an incorrect partial value.
          if (!bloomActive && getWateredCount() >= currentBloomThreshold()) {
            bloomSustainElapsedMs = 0
            triggerBloom()
          } else {
            bloomSustainElapsedMs = 0   // full cycle elapsed; reset for next attempt
            console.log('[Server] Bloom sustain timer fired but health below threshold — resetting countdown')
          }
        })
      }, remaining)
    }
  } else {
    pauseBloomSustain()
  }
}

function triggerBloom(): void {
  if (bloomActive) return
  const threshold = currentBloomThreshold()
  cancelBloomSustain()
  bloomActive    = true
  bloomScale     = threshold / BLOOM_THRESHOLD
  console.log(`[Server] Bloom triggered! (${getWateredCount()}/${threshold} plants, scale ${bloomScale.toFixed(2)})`)
  room.send('bloomTriggered', { scale: bloomScale })
  spawnBloomSeeds()
  setTimeout(() => executeTask(resetGarden), BLOOM_RESET_DELAY_MS)
}

// ---------------------------------------------------------------
// v2 — Bloom seeds (GDD §3 step 3: "gather seeds")
// ---------------------------------------------------------------

interface SeedRecord {
  id:         string
  x:          number
  z:          number
  rare:       boolean
  spawnedAt:  number
  gatheredBy: Set<string>   // addresses that already collected this seed (per-player pickup)
}

const activeSeeds = new Map<string, SeedRecord>()   // seedId → record, until lifetime expiry
let   seedCounter = 0

/** Broadcast one seed (or send it to a specific joining player). */
function sendSeed(seed: SeedRecord, to?: string[]): void {
  const payload = { id: seed.id, x: seed.x, z: seed.z, rare: seed.rare, spawnedAt: seed.spawnedAt }
  room.send('seedSpawned', payload, to ? { to } : undefined)
}

/** Roll and broadcast this bloom's seed drop — yield and rarity scale with bloom size. */
function spawnBloomSeeds(): void {
  const count      = seedSpawnCount(bloomScale)
  const rareChance = seedRareChance(bloomScale)
  const now        = Date.now()
  const batch: SeedRecord[] = []
  for (let i = 0; i < count; i++) {
    const seed: SeedRecord = {
      id:         `seed_${now}_${seedCounter++}`,
      x:          GARDEN_BOUNDS.xMin + Math.random() * (GARDEN_BOUNDS.xMax - GARDEN_BOUNDS.xMin),
      z:          GARDEN_BOUNDS.zMin + Math.random() * (GARDEN_BOUNDS.zMax - GARDEN_BOUNDS.zMin),
      rare:       Math.random() < rareChance,
      spawnedAt:  now,
      gatheredBy: new Set(),
    }
    batch.push(seed)
    activeSeeds.set(seed.id, seed)
    // Ungathered seeds evaporate — clients despawn on their own matching timer
    setTimeout(() => activeSeeds.delete(seed.id), SEED_LIFETIME_MS)
    sendSeed(seed)
  }
  console.log(`[Server] Spawned ${count} bloom seeds (${batch.filter(s => s.rare).length} rare, scale ${bloomScale.toFixed(2)})`)
}

/** Seeds this player can still collect — for joins/resyncs mid-bloom. */
function remainingSeeds(address: string): SeedRecord[] {
  const cutoff = Date.now() - SEED_LIFETIME_MS
  return [...activeSeeds.values()].filter(s => s.spawnedAt > cutoff && !s.gatheredBy.has(address))
}

interface SeedPouch { normal: number; rare: number }

// ---------------------------------------------------------------
// Persistence — per-player records (pouch, keepsakes, box cap)
// One cached object per (address, key) is the session's source of truth, with
// its own ordered write-through writer — without this, concurrent gathers each
// read→modified→wrote the stored value and overwrote each other (11 gathers
// persisted as 6). A record whose load failed is NOT cached: the caller gets
// null, tells the player, and the next action retries. Concurrent loads of the
// same record share one request. Records are evicted once the player leaves
// and their writes have landed.
// ---------------------------------------------------------------

interface PlayerRecord { value: unknown; writer: KeyWriter }
const playerRecords = new Map<string, PlayerRecord>()       // `${address}:${key}` → live record
const playerLoads   = new Map<string, Promise<unknown>>()   // in-flight loads for the same key

function recordKey(address: string, key: string): string { return `${address}:${key}` }

async function loadPlayerRecord<T>(address: string, key: string, def: () => T): Promise<T | null> {
  const k    = recordKey(address, key)
  const live = playerRecords.get(k)
  if (live) return live.value as T
  const inFlight = playerLoads.get(k)
  if (inFlight) return inFlight as Promise<T | null>

  const load = (async (): Promise<T | null> => {
    const res = await loadPlayer<T>(address, key)
    if (!res.ok) { console.error(`[Server] ${key} for ${address.slice(0, 8)}…: storage unreachable`); return null }
    // Parse defensively — fall back to the default when the stored shape is wrong.
    const stored = res.value
    const value  = stored !== null && typeof stored === 'object' ? stored : def()
    const writer = createPlayerWriter(address, key)
    writer.enable()
    playerRecords.set(k, { value, writer })
    return value
  })()
  playerLoads.set(k, load)
  try { return await load } finally { playerLoads.delete(k) }
}

function savePlayerRecord(address: string, key: string): void {
  const rec = playerRecords.get(recordKey(address, key))
  if (rec) rec.writer.save(rec.value)
}

/** Forget a departed player's records once their pending writes have landed. */
function evictPlayerRecords(address: string): void {
  const prefix = `${address}:`
  const keys   = [...playerRecords.keys()].filter(k => k.startsWith(prefix))
  if (keys.length === 0) return
  executeTask(async () => {
    await Promise.all(keys.map(k => playerRecords.get(k)?.writer.idle() ?? Promise.resolve()))
    if (isConnected(address)) return   // came back while flushing — keep the cache warm
    for (const k of keys) playerRecords.delete(k)
  })
}

const loadPouch = (a: string) => loadPlayerRecord<SeedPouch>(a, 'seeds', () => ({ normal: 0, rare: 0 }))
const savePouch = (a: string) => savePlayerRecord(a, 'seeds')

async function sendPouch(address: string): Promise<void> {
  const p = await loadPouch(address)
  if (p) room.send('pouchUpdate', { normal: p.normal, rare: p.rare }, { to: [address] })
}

// ---------------------------------------------------------------
// v2 — Seed boxes (GDD §3 step 4: plant → overnight timer → reveal)
// Shared world state → the scene-level 'boxes' blob, per the storage decision.
// ---------------------------------------------------------------

interface BoxRecord {
  boxId:       string
  owner:       string   // address; '' = empty
  ownerName:   string
  rare:        boolean
  plantedAt:   number
  opensAt:     number
  opened:      boolean
  flower:      string   // '' until opened
  waters:      number   // Phase 4: how many visitors have watered this growing seed
  waterers:    string[] // their addresses (one water each) — server-only, not on the wire
  lastWaterer: string   // display name shown on the label
}

const boxes     = new Map<string, BoxRecord>()                       // boxId → record
const boxTimers = new Map<string, ReturnType<typeof setTimeout>>()  // boxId → open timer

function emptyBox(boxId: string): BoxRecord {
  return { boxId, owner: '', ownerName: '', rare: false, plantedAt: 0, opensAt: 0, opened: false, flower: '', waters: 0, waterers: [], lastWaterer: '' }
}

function sendBox(b: BoxRecord, to?: string[]): void {
  const payload = {
    boxId: b.boxId, owner: b.owner, ownerName: b.ownerName, rare: b.rare,
    plantedAt: b.plantedAt, opensAt: b.opensAt, serverNow: Date.now(),
    opened: b.opened, flower: b.flower, waters: b.waters, lastWaterer: b.lastWaterer,
  }
  room.send('boxState', payload, to ? { to } : undefined)
}

function boxesOwnedBy(address: string): number {
  let n = 0
  for (const b of boxes.values()) if (b.owner === address) n++
  return n
}

interface FlowerKeepsake { flower: string; rare: boolean; at: number; from?: string }

const loadFlowers = (a: string) => loadPlayerRecord<FlowerKeepsake[]>(a, 'flowers', () => [])
const saveFlowers = (a: string) => savePlayerRecord(a, 'flowers')
/** Read lazily — only plantSeed needs it, and nothing writes it yet (see BOX_CAP_DEFAULT). */
const loadBoxCap  = (a: string) => loadPlayerRecord<{ cap: number }>(a, 'boxCap', () => ({ cap: BOX_CAP_DEFAULT }))

function cachedBoxCap(address: string): number {
  const rec = playerRecords.get(recordKey(address, 'boxCap'))
  return rec ? (rec.value as { cap: number }).cap : BOX_CAP_DEFAULT
}

async function sendCollection(address: string): Promise<void> {
  const flowers = await loadFlowers(address)
  if (!flowers) return   // unavailable — the client keeps its last known collection
  room.send('collectionUpdate', { flowersJson: JSON.stringify(flowers), boxCap: cachedBoxCap(address) }, { to: [address] })
}

function sendNotice(address: string, text: string): void {
  room.send('notice', { text }, { to: [address] })
}

function isConnected(address: string): boolean {
  for (const a of playerAddresses.values()) if (a === address) return true
  return false
}

function saveBoxes(): void {
  boxesWriter.save([...boxes.values()])
}

function rollFlower(rare: boolean): string {
  const pool = rare ? FLOWERS.rare : FLOWERS.normal
  return pool[Math.floor(Math.random() * pool.length)]
}

/** The box's timer elapsed: reveal the flower, persist, tell everyone. */
function openBox(boxId: string): void {
  const b = boxes.get(boxId)
  if (!b || !b.owner || b.opened) return
  boxTimers.delete(boxId)
  b.opened = true
  b.flower = rollFlower(b.rare)
  console.log(`[Server] ${b.boxId} opened for ${b.ownerName}: ${b.flower}${b.rare ? ' (RARE)' : ''}`)
  sendBox(b)
  saveBoxes()
}

/** Schedule (or immediately fire) the open for a planted box. Safe to call on restart. */
function scheduleOpen(b: BoxRecord): void {
  if (!b.owner || b.opened) return
  const existing = boxTimers.get(b.boxId)
  if (existing) clearTimeout(existing)
  const delay = Math.max(0, b.opensAt - Date.now())
  boxTimers.set(b.boxId, setTimeout(() => executeTask(async () => openBox(b.boxId)), delay))
}

/** Load (or late-load) the boxes. Returns false if storage was unreachable.
 *  A box claimed this session wins over its stored record. */
async function loadBoxes(): Promise<boolean> {
  const res = await loadScene<Array<Partial<BoxRecord> & { boxId: string }>>('boxes')
  if (!res.ok) { console.error('[Server] boxes: storage unreachable — saves held until a reload succeeds'); return false }

  // Records saved before Phase 4 lack the watering fields; an undefined string
  // makes every boxState send throw in the event bus, so backfill on load.
  for (const r of Array.isArray(res.value) ? res.value : []) {
    const live = boxes.get(r.boxId)
    if (!live || live.owner) continue
    const restored: BoxRecord = { ...emptyBox(r.boxId), ...r, waters: r.waters ?? 0, waterers: r.waterers ?? [], lastWaterer: r.lastWaterer ?? '' }
    boxes.set(r.boxId, restored)
    if (restored.owner) sendBox(restored)
  }
  let growing = 0
  for (const b of boxes.values()) if (b.owner && !b.opened && !boxTimers.has(b.boxId)) { scheduleOpen(b); growing++ }
  console.log(`[Server] Boxes: ${boxes.size} total, ${[...boxes.values()].filter(b => b.owner).length} planted, ${growing} growing (timers rescheduled)`)
  boxesWriter.enable()
  saveBoxes()
  return true
}

async function resetGarden(): Promise<void> {
  // Idempotent guard — ignore if bloom is no longer active (already reset)
  if (!bloomActive) return
  console.log('[Server] Resetting garden...')
  cancelBloomSustain()
  bloomActive    = false

  for (const [plantId, entity] of plantEntities) {
    const ps     = PlantSync.getMutable(entity)
    ps.isWatered = false
    ps.wateredAt = 0
    wateredByMap.delete(plantId)
    room.send('plantStateUpdate', { plantId, isWatered: false, wateredAt: 0, wateredBy: '' })
  }

  room.send('bloomReset', {})
  console.log('[Server] Garden reset complete')
  savePlantStates()
}

// ---------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------

function scheduleExpiry(
  plantId:          string,
  entity:           Entity,
  sessionTimestamp: number,
  delayMs:          number,
): void {
  setTimeout(() => {
    executeTask(async () => {
      const ps = PlantSync.getOrNull(entity)
      if (!ps || !ps.isWatered || Number(ps.wateredAt) !== sessionTimestamp) return

      const expired = PlantSync.getMutable(entity)
      expired.isWatered = false
      expired.wateredAt = 0
      wateredByMap.delete(plantId)
      savePlantStates()
      room.send('plantStateUpdate', { plantId, isWatered: false, wateredAt: 0, wateredBy: '' })
      console.log(`[Server] Plant expired: ${plantId}`)
      // Pause (not cancel) — preserves elapsed progress; timer resumes when health recovers.
      // Expiry must never start the sustain timer, only pause it.
      if (getWateredCount() < currentBloomThreshold()) pauseBloomSustain()
    })
  }, delayMs)
}

// ---------------------------------------------------------------
// Scheduled bloom check — fires at every 6am and 6pm UTC
// ---------------------------------------------------------------

function msUntilNextBloomWindow(): number {
  const now = Date.now()
  const d   = new Date(now)
  const y   = d.getUTCFullYear()
  const mo  = d.getUTCMonth()
  const day = d.getUTCDate()
  let nearest = Infinity
  for (const w of BLOOM_WINDOWS) {
    const today    = Date.UTC(y, mo, day,     w.hour, w.minute, 0, 0)
    const tomorrow = Date.UTC(y, mo, day + 1, w.hour, w.minute, 0, 0)
    const ms = today - now
    if (ms > 500 && ms < nearest) nearest = ms          // today's window still ahead
    else if (tomorrow - now < nearest) nearest = tomorrow - now  // fall back to tomorrow
  }
  return nearest
}

/** Build a playerDailyState payload stamped with the current server time and
 *  the absolute timestamp of the next bloom window (for client clock-sync). */
function dailyStatePayload() {
  const sentAt    = Date.now()
  const bloomTime = sentAt + msUntilNextBloomWindow()
  return { sentAt, bloomTime }
}

function scheduleBloomCheck(): void {
  const delay    = msUntilNextBloomWindow()
  const windowAt = new Date(Date.now() + delay).toISOString()
  console.log(`[Server] Next bloom window: ${windowAt} (in ${Math.round(delay / 60_000)} min)`)

  setTimeout(() => {
    executeTask(async () => {
      const count = getWateredCount()
      console.log(`[Server] Bloom window reached — health ${count}/${currentBloomThreshold()}`)
      checkBloomThreshold()  // starts/resets sustain timer; bloom fires 60 s later if health holds
      scheduleBloomCheck()   // always reschedule for the next window
    })
  }, delay)
}

// ---------------------------------------------------------------
// Player join detection
// ---------------------------------------------------------------

function playerJoinSystem(): void {
  // Detect disconnections — entities removed from the engine no longer have PlayerIdentityData
  for (const entity of [...knownPlayers]) {
    if (!PlayerIdentityData.getOrNull(entity)) {
      const address = playerAddresses.get(entity)
      knownPlayers.delete(entity)
      playerAddresses.delete(entity)
      if (address) {
        syncRateLimits.delete(address)
        evictPlayerRecords(address)
        console.log(`[Server] Player disconnected: ${address}`)
      }
    }
  }

  for (const [entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (knownPlayers.has(entity)) continue
    knownPlayers.add(entity)
    const address = identity.address
    playerAddresses.set(entity, address)
    executeTask(async () => {
      room.send('playerDailyState', dailyStatePayload(), { to: [address] })

      // Send current state of all plants so the client can restore visuals
      for (const [plantId, plantEntity] of plantEntities) {
        const ps = PlantSync.getOrNull(plantEntity)
        if (!ps) continue
        room.send('plantStateUpdate', { plantId, isWatered: ps.isWatered, wateredAt: Number(ps.wateredAt), wateredBy: wateredByMap.get(plantId) ?? '' }, { to: [address] })
      }

      broadcastLeaderboard([address])
      sendThreshold([address])
      await sendPouch(address)
      // Re-send bloom state to players who join while it is already active
      if (bloomActive) room.send('bloomTriggered', { scale: bloomScale }, { to: [address] })
      for (const seed of remainingSeeds(address)) sendSeed(seed, [address])
      for (const b of boxes.values()) sendBox(b, [address])
      await sendCollection(address)
      console.log(`[Server] Player joined: ${address} (${getWateredCount()}/${currentBloomThreshold()} watered, bloom=${bloomActive})`)
    })
  }

  // v2 — joins/leaves above may have moved the scaled threshold; broadcast only on change
  sendThreshold()
}

// ---------------------------------------------------------------
// Message handler helper
// ---------------------------------------------------------------

/** Wraps room.onMessage with context validation and executeTask so
 *  every handler is guaranteed a valid sender address. */
function onRoomMessage<T>(
  name:    Parameters<typeof room.onMessage>[0],
  handler: (data: T, address: string) => Promise<void>,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  room.onMessage(name, (data: any, context) => {
    if (!context) return
    executeTask(() => handler(data as T, context.from))
  })
}

// ---------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------

export async function server(): Promise<void> {
  console.log('[Server] Starting up...')

  // Create PlantSync component for every plant (server-side state tracking only)
  for (const name of PLANT_NAMES) {
    const entity = engine.getEntityOrNullByName(name)
    if (!entity) { console.log(`[Server] Plant entity not found: ${name}`); continue }
    PlantSync.create(entity, { isWatered: false, wateredAt: 0 })
    plantEntities.set(name, entity)
  }

  console.log(`[Server] ${plantEntities.size} plants registered`)
  for (const p of BOX_POSITIONS) boxes.set(p.id, emptyBox(p.id))

  // Restore persisted state. Loads never throw; a blob that could not be read
  // starts empty, keeps its saves held, and is reloaded in the background until
  // it can be merged — so an outage at boot neither aborts server() nor lets the
  // first save overwrite the real data.
  const loads: Array<[string, () => Promise<boolean>]> = [
    ['plants',      loadPlantStates],
    ['leaderboard', loadLeaderboard],
    ['boxes',       loadBoxes],
  ]
  const outcomes = await Promise.all(loads.map(([, load]) => load()))
  loads.forEach(([label, load], i) => { if (!outcomes[i]) scheduleReload(label, load) })
  const restoredCount = getWateredCount()
  console.log(`[Server] ${restoredCount} plants currently watered`)

  // If health is already at/above threshold on startup (persisted from before restart),
  // start the sustain timer immediately so the bloom can still fire.
  // Without this, the client would start its countdown (seeing count ≥ threshold via
  // requestFullSync) but the server would have no timer — bloom would never trigger.
  if (restoredCount >= currentBloomThreshold() && !bloomActive) {
    console.log('[Server] Restored state already at/above bloom threshold — starting sustain timer')
    checkBloomThreshold()
  }

  // ── Message: waterPlant ──────────────────────────────────────
  onRoomMessage<{ plantId: string }>('waterPlant', async (data, playerAddress) => {
    const { plantId } = data
    const entity      = plantEntities.get(plantId)

    if (!entity) {
      console.log(`[Server] Unknown plant: ${plantId}`)
      return
    }

    {
      const ps = PlantSync.getOrNull(entity)
      if (!ps) return

      // Reject if bloom is active
      if (bloomActive) {
        room.send('waterRejected', { plantId, reason: 'bloom_active' }, { to: [playerAddress] })
        return
      }

      // Reject if already watered — prevents concurrent double-water when two players
      // click the same unwatered plant before either receives the other's confirmation.
      // isWatered is set synchronously before any await, so this check is race-free.
      if (ps.isWatered) {
        room.send('waterRejected', { plantId, reason: 'already_watered' }, { to: [playerAddress] })
        return
      }

      // ── All valid — water the plant ──────────────────────────
      const now      = Date.now()
      const watered  = PlantSync.getMutable(entity)
      watered.isWatered = true
      watered.wateredAt = now

      // Update all-time leaderboard total for this player
      const entry = leaderboard.get(playerAddress)
      if (entry) {
        entry.total += 1
      } else {
        leaderboard.set(playerAddress, { displayName: playerAddress.slice(0, 8) + '…', total: 1 })
      }

      const displayName = leaderboard.get(playerAddress)?.displayName ?? playerAddress.slice(0, 8) + '…'
      wateredByMap.set(plantId, displayName)

      savePlantStates()
      saveLeaderboard()
      scheduleExpiry(plantId, entity, now, FAST_PLANT_NAMES.has(plantId) ? FAST_PLANT_EXPIRY_MS : WATERED_EXPIRY_MS)

      room.send('plantStateUpdate', { plantId, isWatered: true, wateredAt: now, wateredBy: displayName })
      broadcastLeaderboard()
      console.log(`[Server] ${plantId} watered by ${playerAddress} (${getWateredCount()}/${currentBloomThreshold()} garden)`)
      checkBloomThreshold()
    }
  })

  // ── Message: gatherSeed (v2) ────────────────────────────────
  onRoomMessage<{ seedId: string }>('gatherSeed', async (data, playerAddress) => {
    const seed = activeSeeds.get(data.seedId)
    if (!seed) return   // expired or never existed — client despawns on its own lifetime timer
    // Per-player pickup: each player may collect each seed once; the seed stays for
    // everyone else. Mark synchronously before any await so a duplicate request
    // from the same client cannot double-award (same pattern as waterPlant).
    // NOTE (anticheat, later round): no server-side distance check yet — the
    // server does not trust position here; acceptable while seeds are un-tradeable.
    if (seed.gatheredBy.has(playerAddress)) return
    seed.gatheredBy.add(playerAddress)

    const displayName = leaderboard.get(playerAddress)?.displayName ?? playerAddress.slice(0, 8) + '…'
    const pouch = await loadPouch(playerAddress)
    if (!pouch) {
      seed.gatheredBy.delete(playerAddress)   // let them retry once storage is back
      sendNotice(playerAddress, STORAGE_UNAVAILABLE_NOTICE)
      return
    }
    if (seed.rare) pouch.rare += 1     // synchronous on the shared live object
    else pouch.normal += 1
    savePouch(playerAddress)           // ordered write-through, retried on failure
    console.log(`[Server] ${displayName} gathered ${seed.rare ? 'RARE ' : ''}seed ${seed.id} (pouch ${pouch.normal}+${pouch.rare}r)`)
    void sendPouch(playerAddress)
    // Targeted, not broadcast — only the gatherer's client despawns it
    room.send('seedGathered', { seedId: seed.id, by: displayName, byAddress: playerAddress, rare: seed.rare }, { to: [playerAddress] })
  })

  // ── Message: adminSpawnSeed (test panel) ────────────────────
  onRoomMessage<{ x: number; z: number; rare: boolean }>('adminSpawnSeed', async (data, address) => {
    const seed: SeedRecord = { id: `admin_${Date.now()}`, x: data.x, z: data.z, rare: data.rare, spawnedAt: Date.now(), gatheredBy: new Set() }
    activeSeeds.set(seed.id, seed)
    setTimeout(() => activeSeeds.delete(seed.id), SEED_LIFETIME_MS)
    sendSeed(seed)
    console.log(`[Server] adminSpawnSeed from ${address.slice(0, 8)} → ${seed.id} at (${data.x.toFixed(1)}, ${data.z.toFixed(1)})`)
  })

  // ── Message: plantSeed (v2) ─────────────────────────────────
  onRoomMessage<{ boxId: string; rare: boolean }>('plantSeed', async (data, playerAddress) => {
    const b = boxes.get(data.boxId)
    if (!b) return
    if (b.owner) { sendBox(b, [playerAddress]); return }          // taken — resync the tapper
    const [pouch, capRecord] = await Promise.all([loadPouch(playerAddress), loadBoxCap(playerAddress)])
    if (!pouch || !capRecord) { sendNotice(playerAddress, STORAGE_UNAVAILABLE_NOTICE); return }
    const cap = capRecord.cap
    if (b.owner) { sendBox(b, [playerAddress]); return }          // re-check after the awaits
    if (boxesOwnedBy(playerAddress) >= cap) {
      sendNotice(playerAddress, cap === 1 ? 'You already have a box — harvest it when it opens' : `You already have ${cap} boxes`)
      return
    }
    if (data.rare ? pouch.rare <= 0 : pouch.normal <= 0) { void sendPouch(playerAddress); sendNotice(playerAddress, 'No seeds — catch some from a bloom'); return }
    // Consume the seed and claim the box synchronously — no await between check and claim
    if (data.rare) pouch.rare -= 1
    else pouch.normal -= 1
    const now = Date.now()
    b.owner     = playerAddress
    b.ownerName = leaderboard.get(playerAddress)?.displayName ?? playerAddress.slice(0, 8) + '…'
    b.rare      = data.rare
    b.plantedAt = now
    b.opensAt   = now + BOX_GROW_MS
    b.opened    = false
    b.flower    = ''
    b.waters    = 0
    b.waterers  = []
    b.lastWaterer = ''
    scheduleOpen(b)
    console.log(`[Server] ${b.ownerName} planted a ${data.rare ? 'RARE ' : ''}seed in ${b.boxId} (opens in ${Math.round(BOX_GROW_MS / 60_000)} min)`)
    sendBox(b)
    void sendPouch(playerAddress)
    savePouch(playerAddress)
    saveBoxes()
  })

  // ── Message: harvestBox (Phase 4) ───────────────────────────
  onRoomMessage<{ boxId: string }>('harvestBox', async (data, playerAddress) => {
    const b = boxes.get(data.boxId)
    if (!b || b.owner !== playerAddress) return
    if (!b.opened) { sendNotice(playerAddress, 'Still growing — come back when it opens'); return }
    const flowers = await loadFlowers(playerAddress)
    if (!flowers) { sendNotice(playerAddress, STORAGE_UNAVAILABLE_NOTICE); return }
    if (!b.opened || b.owner !== playerAddress) return           // re-check after the await
    if (flowers.length >= FLOWER_COLLECTION_CAP) { sendNotice(playerAddress, 'Your collection is full — gift a flower first'); return }
    const keepsake: FlowerKeepsake = { flower: b.flower, rare: b.rare, at: Date.now() }
    flowers.push(keepsake)
    const name = b.ownerName
    boxes.set(b.boxId, emptyBox(b.boxId))                        // frees the box
    console.log(`[Server] ${name} harvested ${keepsake.flower}${keepsake.rare ? ' (RARE)' : ''} from ${b.boxId} (collection ${flowers.length})`)
    sendBox(boxes.get(b.boxId)!)
    saveBoxes()
    saveFlowers(playerAddress)
    void sendCollection(playerAddress)
    sendNotice(playerAddress, `Harvested your ${keepsake.flower} — box is free again`)
  })

  // ── Message: waterBox (Phase 4 — the quiet social loop) ─────
  onRoomMessage<{ boxId: string }>('waterBox', async (data, playerAddress) => {
    const b = boxes.get(data.boxId)
    console.log(`[Server] waterBox ${data.boxId} from ${playerAddress.slice(0, 8)}… → ${!b ? 'unknown box' : !b.owner ? 'empty' : b.opened ? 'opened' : `growing, waters ${b.waters}/${BOX_WATER_MAX}`}`)
    if (!b || !b.owner) return
    if (b.owner === playerAddress) { sendNotice(playerAddress, 'Only visitors can water your seed'); return }
    if (b.opened) { sendNotice(playerAddress, `${b.ownerName}'s ${b.flower} has already opened`); return }
    if (b.waterers.includes(playerAddress)) { sendNotice(playerAddress, `You already watered ${b.ownerName}'s seed`); return }
    if (b.waters >= BOX_WATER_MAX) { sendNotice(playerAddress, `${b.ownerName}'s seed has had all the water it can take`); return }
    const name = leaderboard.get(playerAddress)?.displayName ?? playerAddress.slice(0, 8) + '…'
    b.waters += 1
    b.waterers.push(playerAddress)
    b.lastWaterer = name
    b.opensAt = Math.max(Date.now(), b.opensAt - BOX_WATER_SHAVE_MS)
    scheduleOpen(b)
    console.log(`[Server] ${name} watered ${b.ownerName}'s ${b.boxId} (${b.waters}/${BOX_WATER_MAX}, −${Math.round(BOX_WATER_SHAVE_MS / 1000)}s)`)
    sendBox(b)
    saveBoxes()
    sendNotice(playerAddress, `You watered ${b.ownerName}'s seed — it opens sooner`)
    if (isConnected(b.owner)) sendNotice(b.owner, `${name} watered your seed`)
  })

  // ── Message: giftFlower (Phase 4 — keepsakes) ───────────────
  onRoomMessage<{ toAddress: string; flowerIndex: number }>('giftFlower', async (data, playerAddress) => {
    const to = (data.toAddress || '').toLowerCase()
    if (!to || to === playerAddress) return
    if (!isConnected(to)) { sendNotice(playerAddress, 'That player is not here'); return }
    const [mine, theirs] = await Promise.all([loadFlowers(playerAddress), loadFlowers(to)])
    if (!mine || !theirs) { sendNotice(playerAddress, STORAGE_UNAVAILABLE_NOTICE); return }
    const idx = Math.floor(data.flowerIndex)
    if (idx < 0 || idx >= mine.length) { sendNotice(playerAddress, 'You have no flower to give'); return }
    if (theirs.length >= FLOWER_COLLECTION_CAP) { sendNotice(playerAddress, 'Their collection is full'); return }
    const fromName = leaderboard.get(playerAddress)?.displayName ?? playerAddress.slice(0, 8) + '…'
    const toName   = leaderboard.get(to)?.displayName ?? to.slice(0, 8) + '…'
    const [gift] = mine.splice(idx, 1)
    theirs.push({ ...gift, from: fromName, at: Date.now() })
    console.log(`[Server] ${fromName} gifted ${gift.flower}${gift.rare ? ' (RARE)' : ''} to ${toName}`)
    saveFlowers(playerAddress)
    saveFlowers(to)
    void sendCollection(playerAddress)
    void sendCollection(to)
    room.send('giftReceived', { from: fromName, flower: gift.flower, rare: gift.rare }, { to: [to] })
    sendNotice(playerAddress, `You gave your ${gift.flower} to ${toName}`)
  })

  // ── Message: forceBloom ─────────────────────────────────────
  onRoomMessage<Record<string, never>>('forceBloom', async (_data, _address) => {
    triggerBloom()
  })

  // ── Message: forceWater80 (test panel) ──────────────────────
  onRoomMessage<Record<string, never>>('forceWater80', async (_data, _address) => {
    if (bloomActive) return
    const needed = Math.max(0, currentBloomThreshold() - getWateredCount())
    if (needed === 0) {
      console.log('[Server] forceWater80: already at/above threshold')
      return
    }
    const now = Date.now()
    let watered = 0
    for (const [plantId, entity] of plantEntities) {
      if (watered >= needed) break
      const ps = PlantSync.getOrNull(entity)
      if (ps && !ps.isWatered) {
        const mutable     = PlantSync.getMutable(entity)
        mutable.isWatered = true
        mutable.wateredAt = now
        wateredByMap.set(plantId, '[Test Mode]')
        scheduleExpiry(plantId, entity, now, FAST_PLANT_NAMES.has(plantId) ? FAST_PLANT_EXPIRY_MS : WATERED_EXPIRY_MS)
        room.send('plantStateUpdate', { plantId, isWatered: true, wateredAt: now, wateredBy: '[Test Mode]' })
        watered++
      }
    }
    if (watered > 0) savePlantStates()
    console.log(`[Server] forceWater80: watered ${watered} plants (${getWateredCount()}/${currentBloomThreshold()} total)`)
    checkBloomThreshold()
  })

  // ── Message: requestFullSync ─────────────────────────────────
  onRoomMessage<Record<string, never>>('requestFullSync', async (_data, address) => {
    const now      = Date.now()
    const lastSync = syncRateLimits.get(address) ?? 0
    if (now - lastSync < SYNC_RATE_MS) {
      console.log(`[Server] requestFullSync rate-limited for ${address}`)
      return
    }
    syncRateLimits.set(address, now)
    room.send('playerDailyState', dailyStatePayload(), { to: [address] })
    for (const [plantId, plantEntity] of plantEntities) {
      const ps = PlantSync.getOrNull(plantEntity)
      if (!ps) continue
      room.send('plantStateUpdate', { plantId, isWatered: ps.isWatered, wateredAt: Number(ps.wateredAt), wateredBy: wateredByMap.get(plantId) ?? '' }, { to: [address] })
    }
    broadcastLeaderboard([address])
    sendThreshold([address])
    await sendPouch(address)
    if (bloomActive) room.send('bloomTriggered', { scale: bloomScale }, { to: [address] })
    for (const seed of remainingSeeds(address)) sendSeed(seed, [address])
    for (const b of boxes.values()) sendBox(b, [address])
    await sendCollection(address)
    console.log(`[Server] Full sync sent to ${address} (${getWateredCount()}/${currentBloomThreshold()} watered)`)
  })

  // ── Message: registerPlayer ──────────────────────────────────
  onRoomMessage<{ displayName: string }>('registerPlayer', async (data, address) => {
    const entry = leaderboard.get(address)
    if (entry) {
      entry.displayName = data.displayName
    } else {
      leaderboard.set(address, { displayName: data.displayName, total: 0 })
    }
    saveLeaderboard()
    broadcastLeaderboard([address])
    console.log(`[Server] Registered player: ${data.displayName} (${address})`)
  })

  // Player join detection — runs every frame, lightweight
  engine.addSystem(playerJoinSystem)

  // Schedule bloom checks at every 6am/6pm UTC window
  scheduleBloomCheck()

  // Clock-sync heartbeat — lets clients keep their clockSync offset calibrated
  const SERVER_TIME_INTERVAL_MS = 30_000
  room.send('notifyServerTime', { sentAt: Date.now() })
  setInterval(() => room.send('notifyServerTime', { sentAt: Date.now() }), SERVER_TIME_INTERVAL_MS)

  console.log('[Server] Ready')
}
