// =============================================================
// Bloom Garden v2 — Seed System (CLIENT ONLY, greybox)
//
// GDD §3 step 3 + §6 "Gather seeds": seeds flow from the bloom and
// are gathered by WALKING NEAR them — movement only, zero taps.
// Rares sparkle differently as they fall: a gentle chase, never a
// twitch test.
//
// Greybox pass: seeds are emissive spheres (mint = normal, gold =
// rare, slightly larger + pulsing). Real seed art arrives in the
// FX/variant phase.
//
// Server communication:
//   receive ←  seedsSpawned  { seedsJson: [{id,x,z,rare,spawnedAt}] }
//   send    →  gatherSeed    { seedId }
//   receive ←  seedGathered  { seedId, by, byAddress, rare }
//
// The server is authoritative: a seed only despawns-with-reward on
// seedGathered. Client-side proximity just *requests* the gather.
// =============================================================

import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import { clockSync } from './shared/clockSync'
import {
  SEED_FALL_MS,
  SEED_LIFETIME_MS,
  SEED_GATHER_RADIUS,
  SEED_COLLECT_RADIUS,
  SEED_SPAWN_HEIGHT,
} from './shared/config'
import { showToast } from './notifications'

// ---------------------------------------------------------------
// Config (greybox visuals — replaced in the FX phase)
// ---------------------------------------------------------------

const SEED_SCALE_NORMAL = 0.22
const SEED_SCALE_RARE   = 0.30
const SEED_REST_Y       = 0.25        // resting height above the garden floor
const SEED_BOB_AMPL     = 0.06        // idle bob amplitude (m)
const SEED_BOB_SPEED    = 2.0         // idle bob speed (rad/s)
const SEED_SWAY_AMPL    = 0.35        // horizontal sway while falling (m)
const DRIFT_SPEED       = 2.2         // m/s toward a nearby player
const GATHER_RETRY_MS   = 3_000       // re-allow a gather request if no reply
const COLOR_NORMAL      = Color4.create(0.55, 0.95, 0.65, 1)
const COLOR_RARE        = Color4.create(1.0, 0.82, 0.25, 1)
const TOAST_GATHER_MS   = 4_000

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface Seed {
  id:          string
  entity:      Entity
  rare:        boolean
  baseX:       number
  baseZ:       number
  spawnLocalMs: number   // local-clock ms when the fall began (clock-synced)
  despawnAtMs: number    // local-clock ms when an ungathered seed evaporates
  phase:       number    // per-seed offset so bobbing isn't synchronized
  drifting:    boolean   // player is close — seed is chasing them
  gatherSentAt: number   // 0 = not requested; else local ms of last request
}

const seeds = new Map<string, Seed>()   // seedId → live seed

// ---------------------------------------------------------------
// Spawning / despawning
// ---------------------------------------------------------------

function spawnSeed(rec: { id: string; x: number; z: number; rare: boolean; spawnedAt: number }): void {
  if (seeds.has(rec.id)) return   // duplicate seedsSpawned (e.g. fullSync resend)

  const localSpawn = clockSync.toLocalTime(rec.spawnedAt)
  const despawnAt  = localSpawn + SEED_LIFETIME_MS
  if (despawnAt <= Date.now()) return   // already evaporated (late join)

  const entity = engine.addEntity()
  const scale  = rec.rare ? SEED_SCALE_RARE : SEED_SCALE_NORMAL
  Transform.create(entity, {
    position: { x: rec.x, y: SEED_SPAWN_HEIGHT, z: rec.z },
    scale:    { x: scale, y: scale, z: scale },
  })
  MeshRenderer.setSphere(entity)
  Material.setPbrMaterial(entity, {
    albedoColor:       rec.rare ? COLOR_RARE : COLOR_NORMAL,
    emissiveColor:     rec.rare ? COLOR_RARE : COLOR_NORMAL,
    emissiveIntensity: rec.rare ? 3 : 1.5,
  })

  seeds.set(rec.id, {
    id:           rec.id,
    entity,
    rare:         rec.rare,
    baseX:        rec.x,
    baseZ:        rec.z,
    spawnLocalMs: localSpawn,
    despawnAtMs:  despawnAt,
    phase:        Math.random() * Math.PI * 2,
    drifting:     false,
    gatherSentAt: 0,
  })
}

function despawnSeed(id: string): void {
  const seed = seeds.get(id)
  if (!seed) return
  engine.removeEntity(seed.entity)
  seeds.delete(id)
}

/** Remove every live seed — used on scene teardown safety paths. */
export function clearAllSeeds(): void {
  for (const id of [...seeds.keys()]) despawnSeed(id)
}

// ---------------------------------------------------------------
// Per-frame: fall, sway, bob, drift-to-player, collect
// ---------------------------------------------------------------

function seedDriftSystem(dt: number): void {
  if (seeds.size === 0) return
  const now       = Date.now()
  const playerPos = Transform.getOrNull(engine.PlayerEntity)?.position

  for (const seed of [...seeds.values()]) {
    if (now >= seed.despawnAtMs) { despawnSeed(seed.id); continue }

    const t  = Transform.getMutable(seed.entity)
    const fallElapsed = now - seed.spawnLocalMs

    if (fallElapsed < SEED_FALL_MS && !seed.drifting) {
      // ── Falling: ease down with a gentle horizontal sway ──
      const p = fallElapsed / SEED_FALL_MS
      t.position.y = SEED_SPAWN_HEIGHT - (SEED_SPAWN_HEIGHT - SEED_REST_Y) * p
      t.position.x = seed.baseX + Math.sin(seed.phase + p * Math.PI * 3) * SEED_SWAY_AMPL * (1 - p)
      t.position.z = seed.baseZ + Math.cos(seed.phase + p * Math.PI * 3) * SEED_SWAY_AMPL * (1 - p)
    } else if (!seed.drifting) {
      // ── Landed: idle bob ──
      t.position.y = SEED_REST_Y + Math.abs(Math.sin(now / 1_000 * SEED_BOB_SPEED + seed.phase)) * SEED_BOB_AMPL
    }

    if (!playerPos) continue

    const dx = playerPos.x - t.position.x
    const dz = playerPos.z - t.position.z
    const dist = Math.sqrt(dx * dx + dz * dz)

    if (dist < SEED_COLLECT_RADIUS) {
      // ── Close enough — request the gather (server decides) ──
      if (seed.gatherSentAt === 0 || now - seed.gatherSentAt > GATHER_RETRY_MS) {
        seed.gatherSentAt = now
        room.send('gatherSeed', { seedId: seed.id })
      }
    } else if (dist < SEED_GATHER_RADIUS) {
      // ── Walk-through magnetism: drift gently toward the player ──
      seed.drifting = true
      const step = Math.min(DRIFT_SPEED * dt, dist)
      t.position.x += (dx / dist) * step
      t.position.z += (dz / dist) * step
      // Settle toward chest height while chasing — reads as "coming to you"
      t.position.y += ((playerPos.y - 0.4) - t.position.y) * Math.min(dt * 4, 1)
    } else if (seed.drifting && dist > SEED_GATHER_RADIUS * 1.5) {
      // Player walked away — seed settles where it is and resumes bobbing
      seed.drifting = false
      seed.baseX = t.position.x
      seed.baseZ = t.position.z
    }
  }
}

// ---------------------------------------------------------------
// Setup — message handlers + system registration
// ---------------------------------------------------------------

export function setupSeedSystem(): void {
  room.onMessage('seedsSpawned', (data) => {
    if (!data?.seedsJson) return
    try {
      const records: Array<{ id: string; x: number; z: number; rare: boolean; spawnedAt: number }> = JSON.parse(data.seedsJson)
      for (const rec of records) spawnSeed(rec)
      console.log(`[Seeds] ${records.length} seeds falling (${seeds.size} live)`)
    } catch (err) {
      console.error('[Seeds] Bad seedsSpawned payload:', err)
    }
  })

  room.onMessage('seedGathered', (data) => {
    despawnSeed(data.seedId)
    const localId = getPlayer()?.userId ?? ''
    if (localId && data.byAddress.toLowerCase() === localId.toLowerCase()) {
      showToast(data.rare ? 'You caught a RARE seed! ✨' : 'Seed gathered! 🌱', TOAST_GATHER_MS, false)
    }
  })

  engine.addSystem(seedDriftSystem)
  console.log('[Seeds] Seed system ready')
}
