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
// Server communication (one message per seed — see messages.ts registry note):
//   receive ←  seedSpawned   { id, x, z, rarityTier, spawnedAt }
//   send    →  gatherSeed    { seedId }
//   receive ←  seedGathered  { seedId, by, byAddress, rarityTier }
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
import {
  SEED_FALL_MS,
  SEED_LIFETIME_MS,
  SEED_GATHER_RADIUS,
  SEED_COLLECT_RADIUS,
  SEED_SPAWN_HEIGHT,
  rarityTierById,
} from './shared/config'
import { showToast } from './notifications'
import { setupGoldenSeed } from './goldenSeed'

// ---------------------------------------------------------------
// Config (greybox visuals — replaced in the FX phase)
// ---------------------------------------------------------------

// `let` — live-tunable from the test panel admin controls (adminScaleSeeds / adminShiftSeedHeight)
let SEED_SCALE_MIN = 0.45             // greybox: oversized for visibility, tune down with real art
let SEED_SCALE_MAX = 0.6              // at the top of the rollable range (tier 5, Exotic)
let SEED_REST_Y       = 1.1           // rest at ~chest height so plants/decor don't hide seeds
const SEED_BOB_AMPL     = 0.06        // idle bob amplitude (m)
const SEED_BOB_SPEED    = 2.0         // idle bob speed (rad/s)
const SEED_SWAY_AMPL    = 0.35        // horizontal sway while falling (m)
// Chase speed scales with proximity: gentle drift at the leash edge, then it
// darts into you at close range — so walking THROUGH a seed collects it even
// at a run, while the far behaviour still reads as "drifts gently toward you".
const DRIFT_SPEED_MIN   = 2.5         // m/s at SEED_GATHER_RADIUS
const DRIFT_SPEED_MAX   = 9.0         // m/s when nearly touching (outruns a running avatar)
const CHEST_HEIGHT      = 0.9         // m above the avatar Transform origin (origin = feet)
const GATHER_RETRY_MS   = 3_000       // re-allow a gather request if no reply
const TOAST_GATHER_MS   = 4_000
// Tiers roll 0..5 in normal play (rollSeedTier) — Mythic/Unique (6, 7) are `custom`
// and only reachable via admin test tools, so scale/color just clamp at the top.
const MAX_ROLLABLE_TIER = 5
function seedScaleForTier(tier: number): number {
  const t = Math.max(0, Math.min(MAX_ROLLABLE_TIER, tier)) / MAX_ROLLABLE_TIER
  return SEED_SCALE_MIN + (SEED_SCALE_MAX - SEED_SCALE_MIN) * t
}
function seedColorForTier(tier: number): Color4 {
  const c = rarityTierById(tier).seedColor
  return Color4.create(c.r, c.g, c.b, 1)
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface Seed {
  id:          string
  entity:      Entity
  rarityTier:  number
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

function spawnSeed(rec: { id: string; x: number; z: number; rarityTier: number; spawnedAt: number }): void {
  if (seeds.has(rec.id)) return   // duplicate seedSpawned (e.g. fullSync resend)

  // Fall timing runs off the CLIENT clock from the moment the message arrives —
  // NOT clockSync. The synced server time is unreliable in this scene (Schemas.Number
  // corrupts 13-digit timestamps → tens-of-seconds offset), which would otherwise
  // launch the seed above the canopy or despawn it instantly. Seeds are transient,
  // so a fresh local fall on arrival is correct and needs no cross-client sync.
  const localSpawn = Date.now()
  const despawnAt  = localSpawn + SEED_LIFETIME_MS

  const entity = engine.addEntity()
  const scale  = seedScaleForTier(rec.rarityTier)
  Transform.create(entity, {
    position: { x: rec.x, y: SEED_SPAWN_HEIGHT, z: rec.z },
    scale:    { x: scale, y: scale, z: scale },
  })
  MeshRenderer.setSphere(entity)
  const color = seedColorForTier(rec.rarityTier)
  Material.setPbrMaterial(entity, {
    albedoColor:       color,
    emissiveColor:     color,
    // Low emissive so the tier hue actually reads — high values wash everything to white.
    // Placeholder until the real seed model with rarity as a material colour overlay.
    emissiveIntensity: rec.rarityTier > 0 ? 1.0 : 0.5,
  })

  seeds.set(rec.id, {
    id:           rec.id,
    entity,
    rarityTier:   rec.rarityTier,
    baseX:        rec.x,
    baseZ:        rec.z,
    spawnLocalMs: localSpawn,
    despawnAtMs:  despawnAt,
    phase:        Math.random() * Math.PI * 2,
    drifting:     false,
    gatherSentAt: 0,
  })
  console.log(`[Seeds] spawned ${rec.id} tier=${rec.rarityTier} at (${rec.x.toFixed(1)}, ${SEED_SPAWN_HEIGHT}, ${rec.z.toFixed(1)}) → rest y=${SEED_REST_Y}`)
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
// Admin / test-panel controls (dev only)
// ---------------------------------------------------------------

/** Spawn a seed 4 m in front of the player (far enough to watch it fall) with NO network round-trip —
 *  isolates "can the client render a seed" from "does the message arrive". */
export function adminSpawnLocalSeed(rarityTier = 0): void {
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!p) { console.log('[Seeds][admin] no player transform yet'); return }
  spawnSeed({ id: `local_${Date.now()}`, x: p.x + 4, z: p.z, rarityTier, spawnedAt: Date.now() })
}

/** Ask the server to spawn one seed near the player through the REAL seedSpawned path. */
export function adminRequestServerSeed(rarityTier = 0): void {
  const p = Transform.getOrNull(engine.PlayerEntity)?.position ?? { x: 8, y: 0, z: 12 }
  console.log('[Seeds][admin] requesting server seed')
  room.send('adminSpawnSeed', { x: p.x + 4, z: p.z, rarityTier })
}

/** Multiply seed scale (applies to live seeds immediately). */
export function adminScaleSeeds(mult: number): void {
  SEED_SCALE_MIN *= mult
  SEED_SCALE_MAX *= mult
  for (const s of seeds.values()) {
    const k = seedScaleForTier(s.rarityTier)
    Transform.getMutable(s.entity).scale = { x: k, y: k, z: k }
  }
  console.log(`[Seeds][admin] scale min=${SEED_SCALE_MIN.toFixed(2)} max=${SEED_SCALE_MAX.toFixed(2)}`)
}

/** Raise/lower the resting height (live seeds follow on their next bob frame). */
export function adminShiftSeedHeight(delta: number): void {
  SEED_REST_Y = Math.max(0.1, SEED_REST_Y + delta)
  console.log(`[Seeds][admin] rest y=${SEED_REST_Y.toFixed(2)}`)
}

/** Log every live seed with its current world position. */
export function adminListSeeds(): void {
  console.log(`[Seeds][admin] ${seeds.size} live · seedSpawned listeners=${room.listenerCount('seedSpawned')}`)
  for (const s of seeds.values()) {
    const p = Transform.getOrNull(s.entity)?.position
    console.log(`  ${s.id} tier=${s.rarityTier} at (${p?.x.toFixed(1)}, ${p?.y.toFixed(1)}, ${p?.z.toFixed(1)}) drifting=${s.drifting}`)
  }
}

export function getSeedCount(): number { return seeds.size }

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
    const dist = Math.sqrt(dx * dx + dz * dz)                 // horizontal — starts the attraction
    const dy = (playerPos.y + CHEST_HEIGHT) - t.position.y
    const dist3 = Math.sqrt(dx * dx + dz * dz + dy * dy)      // 3D — a seed overhead is NOT reached yet

    if (dist3 < SEED_COLLECT_RADIUS) {
      // ── Reached the player in 3D — request the gather (server decides) ──
      // Local admin seeds don't exist server-side, so they self-collect on contact
      // instead of following the player forever (no toast, no pouch).
      if (seed.id.startsWith('local_')) {
        console.log(`[Seeds] local test seed collected: ${seed.id}`)
        despawnSeed(seed.id)
        continue
      }
      if (seed.gatherSentAt === 0 || now - seed.gatherSentAt > GATHER_RETRY_MS) {
        seed.gatherSentAt = now
        console.log(`[Seeds] Requesting gather: ${seed.id}`)
        room.send('gatherSeed', { seedId: seed.id })
      }
    } else if (dist < SEED_GATHER_RADIUS) {
      // ── Walk-through magnetism: drift toward the player, faster as it closes ──
      seed.drifting = true
      const closeness = 1 - dist / SEED_GATHER_RADIUS   // 0 at leash edge → 1 touching
      const speed = DRIFT_SPEED_MIN + (DRIFT_SPEED_MAX - DRIFT_SPEED_MIN) * closeness
      const step = Math.min(speed * dt, dist)
      t.position.x += (dx / dist) * step
      t.position.z += (dz / dist) * step
      // Float up toward chest height while chasing — avatar origin is at the FEET,
      // so the target must be ABOVE playerPos.y or the seed burrows underground.
      t.position.y += ((playerPos.y + CHEST_HEIGHT) - t.position.y) * Math.min(dt * 6, 1)
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
  room.onMessage('seedSpawned', (data) => {
    spawnSeed(data)
  })

  room.onMessage('seedGathered', (data) => {
    // Sent to the gatherer only (per-player pickup); guard keeps a stray duplicate
    // from toasting twice.
    const existed = seeds.has(data.seedId)
    despawnSeed(data.seedId)
    if (!existed) return
    console.log(`[Seeds] gathered ${data.seedId} tier=${data.rarityTier}`)
    const localId = getPlayer()?.userId ?? ''
    if (localId && data.byAddress.toLowerCase() === localId.toLowerCase()) {
      // No emoji — the Unity client does not render them yet (PNG glyph in the FX pass)
      const tierName = rarityTierById(data.rarityTier).name
      showToast(data.rarityTier > 0 ? `You caught a ${tierName} seed!` : 'Seed gathered', TOAST_GATHER_MS, false)
    }
  })

  engine.addSystem(seedDriftSystem)
  setupGoldenSeed()   // same post-room.clear() window
  console.log(`[Seeds] Seed system ready · seedSpawned listeners=${room.listenerCount('seedSpawned')}`)
}
