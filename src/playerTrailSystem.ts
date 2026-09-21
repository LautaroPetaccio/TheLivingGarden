// =============================================================
// The Living Garden — Player Sparkle Trail
//
// After the bloom event closes, every player in the scene leaves
// a gentle sparkle trail for TRAIL_DURATION_MS (10 min).
//
// One renderer-side ParticleSystem per avatar (AvatarAttach), simulated in
// WORLD space so sparkles stay where they were emitted — a trail, not an aura.
// Zero per-frame scene work: the old 100-entity pool re-sent a Transform per
// live sparkle every frame (~9 per player) for the whole 10 minutes.
// A 1 s roster loop adds emitters for joiners and removes them for leavers.
//
// Public API:
//   setupPlayerTrailSystem()  — call once at scene startup
//   startPlayerTrail()        — call on bloomReset; auto-stops after 10 min
//   stopPlayerTrail()         — stop emitting now (live sparkles fade out)
// =============================================================

import {
  engine,
  Entity,
  Transform,
  AvatarAttach,
  AvatarAnchorPointType,
  ParticleSystem,
  PlayerIdentityData,
  timers,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { SPARKLE_SRC } from './shared/config'

// const enums in @dcl/ecs internals, not re-exported (same as plantVfx)
const PSB_ALPHA = 0, PS_PLAYING = 0, PSS_WORLD = 1   // alpha, not additive: additive vanishes on the bright garden

// ---------------------------------------------------------------
// Config  (tweak here — no magic numbers below)
// ---------------------------------------------------------------

/** Total duration of the trail effect after bloom closes (ms). */
const TRAIL_DURATION_MS  = 10 * 60_000

/** Sparkles per second per player (was 2 every 350 ms). */
const TRAIL_RATE         = 3    // few and big (KJ 2026-09-19)

/** World-space sparkle diameter at peak (m). */
const TRAIL_SPARKLE_SIZE = 0.4

/** Sparkle lifetime (s). */
const TRAIL_LIFE_S       = 1.6

/** Emitter height above the avatar's feet (m). */
const TRAIL_SPAWN_Y      = 0.8

/** Gentle upward drift (m/s²). */
const TRAIL_DRIFT_Y      = 0.4

/** Emitter sphere radius — horizontal jitter (m). */
const TRAIL_JITTER_R     = 0.5

/** How often the emitter roster is reconciled with the players in scene (ms). */
const ROSTER_MS          = 1_000

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

const emitters = new Map<string, { parent: Entity; emitter: Entity }>()   // address ('' = local player)
let trailGen   = 0

// ---------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------

function addEmitter(address: string): void {
  const parent = engine.addEntity()
  AvatarAttach.create(parent, address === ''
    ? { anchorPointId: AvatarAnchorPointType.AAPT_POSITION }
    : { avatarId: address, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })
  const emitter = engine.addEntity()
  Transform.create(emitter, { parent, position: { x: 0, y: TRAIL_SPAWN_Y, z: 0 } })
  ParticleSystem.create(emitter, {
    shape: ParticleSystem.Shape.Sphere({ radius: TRAIL_JITTER_R }),
    rate: TRAIL_RATE, maxParticles: Math.ceil(TRAIL_RATE * TRAIL_LIFE_S) + 2, lifetime: TRAIL_LIFE_S,
    gravity: 0, additionalForce: { x: 0, y: TRAIL_DRIFT_Y, z: 0 },
    initialVelocitySpeed: { start: 0.05, end: 0.2 },
    initialSize: { start: TRAIL_SPARKLE_SIZE, end: TRAIL_SPARKLE_SIZE }, sizeOverTime: { start: 1, end: 0 },
    initialColor: { start: Color4.create(1.0, 0.95, 0.78, 1), end: Color4.create(1.0, 0.88, 0.52, 1) },   // warm cream → gold
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    texture: { src: SPARKLE_SRC }, billboard: true, blendMode: PSB_ALPHA,
    simulationSpace: PSS_WORLD,
    loop: true, prewarm: false, active: true, playbackState: PS_PLAYING,
  })
  emitters.set(address, { parent, emitter })
}

/** Stop emitting now; remove once the last sparkles have faded. */
function retireAllEmitters(): void {
  const retired = [...emitters.values()]
  emitters.clear()
  for (const e of retired) ParticleSystem.getMutable(e.emitter).active = false
  timers.setTimeout(() => { for (const e of retired) engine.removeEntityWithChildren(e.parent) }, TRAIL_LIFE_S * 1_000)
}

function syncRoster(gen: number): void {
  if (trailGen !== gen) return
  const present = new Set<string>([''])
  for (const [entity, id] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (entity === engine.PlayerEntity) continue
    present.add(id.address.toLowerCase())
  }
  for (const [address, e] of emitters) {
    if (!present.has(address)) { engine.removeEntityWithChildren(e.parent); emitters.delete(address) }
  }
  for (const address of present) if (!emitters.has(address)) addEmitter(address)
  timers.setTimeout(() => syncRoster(gen), ROSTER_MS)
}

// ---------------------------------------------------------------
// Public API
// ---------------------------------------------------------------

/** Kept for the startup call order — emitters are created on demand. */
export function setupPlayerTrailSystem(): void {
  console.log('[PlayerTrail] Setup complete — renderer particles')
}

/**
 * Start the post-bloom sparkle trail for all players.
 * Bumping the gen-counter makes it safe to call again mid-run
 * (e.g. a second bloom in the same session): a fresh 10-minute window starts.
 * Auto-stops after TRAIL_DURATION_MS.
 */
export function startPlayerTrail(): void {
  const gen = ++trailGen
  syncRoster(gen)
  timers.setTimeout(() => {
    if (trailGen === gen) stopPlayerTrail()
  }, TRAIL_DURATION_MS)
  console.log('[PlayerTrail] Started — 10 min trail active')
}

/** Stop emitting immediately; live sparkles finish their fade. */
export function stopPlayerTrail(): void {
  trailGen++
  retireAllEmitters()
  console.log('[PlayerTrail] Stopped')
}
