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
  GltfContainer,
  GltfNodeModifiers,
  ColliderLayer,
  ParticleSystem,
  LightSource,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import {
  SEED_FALL_MS,
  SEED_LIFETIME_MS,
  SEED_GATHER_RADIUS,
  SEED_COLLECT_RADIUS,
  SEED_SPAWN_HEIGHT,
  SEED_MODEL_HEIGHT,
  SPARKLE_SRC,
  seedModelSrc,
  rarityTierById,
  withArticle,
} from './shared/config'
import { showToast } from './notifications'
import { setupGoldenSeed } from './goldenSeed'
import { playSfx } from './sounds'

// ---------------------------------------------------------------
// Config (greybox visuals — replaced in the FX phase)
// ---------------------------------------------------------------

// `let` — live-tunable from the test panel admin controls (adminScaleSeeds / adminShiftSeedHeight)
let SEED_SCALE_MIN = 0.45             // world HEIGHT (m) of a Common seed — sized for visibility
let SEED_SCALE_MAX = 0.62             // world height at the top of the range (tier 7, Unique)
let SEED_REST_Y       = 1.1           // rest at ~chest height so plants/decor don't hide seeds
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
// Tiers roll 0..7 (Mythic/Unique joined the roll 2026-09-19); size ramps across all of them.
const MAX_ROLLABLE_TIER = 7
function seedScaleForTier(tier: number): number {
  const t = Math.max(0, Math.min(MAX_ROLLABLE_TIER, tier)) / MAX_ROLLABLE_TIER
  return (SEED_SCALE_MIN + (SEED_SCALE_MAX - SEED_SCALE_MIN) * t) / SEED_MODEL_HEIGHT
}

// ---------------------------------------------------------------
// Tier FX ladder (KJ 2026-09-19) — restraint over quantity: "too much for too little".
// Motion carries the tiers and is FREE — the drift system already rewrites every live seed's
// Transform each frame, so spin / bob / heartbeat throb / wobble / spiral fall ride on that
// same write. On top, AT MOST ONE emitter per seed (Epic+): a few LARGE soft glints (≤ ~5
// alive), alpha-blended so they read on the bright floor, world-space so a falling seed leaves
// one or two behind. Seed materials are NEVER overridden: KJ's outline is an inverted hull
// (flipped normals + back-face culling) that an override material turns into a solid blob.
// ---------------------------------------------------------------

type RGB = { r: number; g: number; b: number }
interface SeedFx {
  spinDegS: number
  bob:      number                                  // idle bob height (m)
  throb:    { periodS: number; amp: number } | null // heartbeat scale spike
  wobbleDeg: number                                 // tilt sway while spinning
  spiral:   number                                  // fall sway multiplier (1 = the old sway)
  glints:   { a: RGB; b: RGB; rate: number; size: number } | null
  light:    RGB | null                              // desktop only (godot LightSource flicker)
}
const BLUE = { r: 0.26, g: 0.56, b: 1 }, ICE = { r: 0.7, g: 0.88, b: 1 }
const PURPLE = { r: 0.63, g: 0.29, b: 0.95 }, LAVENDER = { r: 0.9, g: 0.78, b: 1 }
const LIME = { r: 0.61, g: 0.82, b: 0.26 }, RED = { r: 1, g: 0.2, b: 0.15 }, PINK = { r: 1, g: 0.29, b: 0.93 }
const GOLD = { r: 1, g: 0.64, b: 0.09 }, CREAM = { r: 1, g: 0.93, b: 0.7 }
// TUNING — the whole ladder. glints.rate is per second; lifetime 1.2 s → rate × 1.2 alive.
const SEED_FX: ReadonlyArray<SeedFx> = [
  /* Common    */ { spinDegS: 40, bob: 0.05, throb: null,                         wobbleDeg: 0,  spiral: 1,   glints: null, light: null },
  /* Uncommon  */ { spinDegS: 60, bob: 0.08, throb: null,                         wobbleDeg: 0,  spiral: 1,   glints: null, light: null },
  /* Rare      */ { spinDegS: 60, bob: 0.08, throb: { periodS: 1.5, amp: 0.10 },  wobbleDeg: 0,  spiral: 1,   glints: null, light: null },
  /* Epic      */ { spinDegS: 70, bob: 0.09, throb: { periodS: 1.5, amp: 0.10 },  wobbleDeg: 12, spiral: 1,   glints: { a: BLUE,   b: ICE,      rate: 2,   size: 0.35 }, light: null },
  /* Legendary */ { spinDegS: 70, bob: 0.10, throb: { periodS: 1.3, amp: 0.12 },  wobbleDeg: 12, spiral: 2.2, glints: { a: PURPLE, b: LAVENDER, rate: 2.5, size: 0.4 },  light: null },
  /* Exotic    */ { spinDegS: 90, bob: 0.10, throb: { periodS: 0.8, amp: 0.14 },  wobbleDeg: 22, spiral: 2.2, glints: { a: LIME,   b: RED,      rate: 3,   size: 0.4 },  light: null },
  /* Mythic    */ { spinDegS: 90, bob: 0.12, throb: { periodS: 0.8, amp: 0.16 },  wobbleDeg: 22, spiral: 2.6, glints: { a: PINK,   b: CREAM,    rate: 3.5, size: 0.45 }, light: null },
  /* Unique    */ { spinDegS: 45, bob: 0.12, throb: { periodS: 1.1, amp: 0.14 },  wobbleDeg: 8,  spiral: 2.6, glints: { a: GOLD,   b: CREAM,    rate: 4,   size: 0.5 },  light: GOLD },
]
const seedFx = (tier: number): SeedFx => SEED_FX[Math.max(0, Math.min(SEED_FX.length - 1, tier))]
const PSB_ALPHA = 0, PS_PLAYING = 0, PSS_WORLD = 1   // const enums in @dcl/ecs internals (same as plantVfx)

/** Heartbeat: a sharp throb then rest (sin⁸ spike), 0..1. */
const heartbeat = (tS: number, periodS: number): number => Math.pow(Math.max(0, Math.sin(Math.PI * ((tS / periodS) % 1))), 8)

/** The seed's one accent emitter (+ Unique's light), as CHILDREN — removed with it. */
function attachSeedFx(seed: Entity, fx: SeedFx): void {
  if (fx.glints) {
    const { a, b, rate, size } = fx.glints
    const e = engine.addEntity()
    Transform.create(e, { parent: seed })
    ParticleSystem.create(e, {
      shape: ParticleSystem.Shape.Sphere({ radius: 0.3 }),
      rate, maxParticles: Math.ceil(rate * 1.2) + 1, lifetime: 1.2,
      gravity: 0, additionalForce: { x: 0, y: 0.25, z: 0 },
      initialVelocitySpeed: { start: 0, end: 0.1 },
      initialSize: { start: size * 0.7, end: size }, sizeOverTime: { start: 0.4, end: 1 },   // swell…
      initialColor: { start: Color4.create(a.r, a.g, a.b, 1), end: Color4.create(b.r, b.g, b.b, 1) },
      colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },   // …then fade
      texture: { src: SPARKLE_SRC }, billboard: true, blendMode: PSB_ALPHA,
      simulationSpace: PSS_WORLD,
      loop: true, prewarm: false, active: true, playbackState: PS_PLAYING,
    })
  }
  if (fx.light && !isMobile()) {
    const l = engine.addEntity()
    Transform.create(l, { parent: seed })
    LightSource.create(l, { active: true, color: fx.light, intensity: 2_500, shadow: false, type: { $case: 'point', point: {} } })
  }
}

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface Seed {
  id:          string
  entity:      Entity
  rarityTier:  number
  fx:          SeedFx
  baseScale:   number
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
  // KJ's tier seed model (was a greybox sphere). Proximity-collected, so no colliders;
  // small and numerous during a bloom, so no shadow casting either.
  GltfContainer.create(entity, { src: seedModelSrc(rec.rarityTier), visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  GltfNodeModifiers.create(entity, { modifiers: [{ path: '', castShadows: false }] })
  const fx = seedFx(rec.rarityTier)
  attachSeedFx(entity, fx)

  seeds.set(rec.id, {
    id:           rec.id,
    entity,
    rarityTier:   rec.rarityTier,
    fx,
    baseScale:    scale,
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
  engine.removeEntityWithChildren(seed.entity)   // + its glint emitter / light
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

/** Test panel: one LOCAL seed of every tier (Common → Unique) in a row 4 m out, 1.2 m apart —
 *  compare the whole FX ladder side by side. Local seeds self-collect on contact. */
export function adminSpawnSeedLadder(): void {
  const p = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!p) return
  for (let tier = 0; tier < SEED_FX.length; tier++) {
    spawnSeed({ id: `local_${Date.now()}_${tier}`, x: p.x + 4, z: p.z + (tier - (SEED_FX.length - 1) / 2) * 1.2, rarityTier: tier, spawnedAt: Date.now() })
  }
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
  for (const s of seeds.values()) s.baseScale = seedScaleForTier(s.rarityTier)   // applied on the next frame
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
    // Tier motion — all in this one Transform write (no extra messages)
    const fx = seed.fx, tS = now / 1_000
    const tilt = fx.wobbleDeg * Math.sin(tS * 1.7 + seed.phase)
    t.rotation = Quaternion.fromEulerDegrees(tilt, (tS * fx.spinDegS + seed.phase * 57) % 360, 0)
    const k = seed.baseScale * (1 + (fx.throb ? fx.throb.amp * heartbeat(tS + seed.phase, fx.throb.periodS) : 0))
    t.scale = { x: k, y: k, z: k }

    if (fallElapsed < SEED_FALL_MS && !seed.drifting) {
      // ── Falling: ease down with a gentle horizontal sway ──
      const p = fallElapsed / SEED_FALL_MS
      t.position.y = SEED_SPAWN_HEIGHT - (SEED_SPAWN_HEIGHT - SEED_REST_Y) * p
      // Rarer tiers spiral down wider and with more turns (fx.spiral)
      const turns = Math.PI * 3 * fx.spiral, amp = SEED_SWAY_AMPL * fx.spiral * (1 - p)
      t.position.x = seed.baseX + Math.sin(seed.phase + p * turns) * amp
      t.position.z = seed.baseZ + Math.cos(seed.phase + p * turns) * amp
    } else if (!seed.drifting) {
      // ── Landed: idle bob ──
      t.position.y = SEED_REST_Y + Math.abs(Math.sin(now / 1_000 * SEED_BOB_SPEED + seed.phase)) * fx.bob
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
      playSfx('seedCatch')
      const tierName = rarityTierById(data.rarityTier).name
      showToast(data.rarityTier > 0 ? `You caught ${withArticle(tierName)} seed!` : 'Seed gathered', TOAST_GATHER_MS, false, rarityTierById(data.rarityTier).seedColor)
    }
  })

  engine.addSystem(seedDriftSystem)
  setupGoldenSeed()   // same post-room.clear() window
  console.log(`[Seeds] Seed system ready · seedSpawned listeners=${room.listenerCount('seedSpawned')}`)
}
