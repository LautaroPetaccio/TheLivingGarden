// =============================================================
// Bloom Garden v2 — Rainbow seed chase (CLIENT) — "golden seed" in code names
//
// One rainbow seed per bloom wanders the garden (server: 30% into the bloom, until it
// ends). Its position is computed here from goldenSeedPos(elapsed, pathSeed) — every
// client runs the same path, so nothing streams. Get within GOLDEN_SEED_CATCH_RADIUS
// (3D, from chest height) to catch it: we ask the server (gatherSeed with its id), the
// server rolls your own Legendary+ seed (rollRainbowTier — the realistic route to
// Mythic/Unique). Everyone may catch it once; it disappears only for the catcher.
//
// LOOK (KJ 2026-09-19): it cycles through KJ's 8 tier seed models — all 8 are children of
// one root, only one visible at a time, stepped every CYCLE_STEP_MS. Each step is two
// VisibilityComponent writes; no material is ever touched (a material override breaks KJ's
// inverted-hull outline, and a recoloured body never read as rainbow anyway). Plus a few
// large cream glints. Rainbow, not gold, so gold stays the Unique tier's colour.
// =============================================================

import { engine, Entity, Transform, GltfContainer, ColliderLayer, ParticleSystem, VisibilityComponent } from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import { goldenSeedPos, GOLDEN_SEED_CATCH_RADIUS, SPARKLE_SRC, SEED_MODEL_HEIGHT, SEED_MODEL_SRCS, rarityTierById, withArticle } from './shared/config'
import { showToast } from './notifications'
import { playSfx } from './sounds'

// const enums in @dcl/ecs internals, not re-exported (same as plantVfx)
const PSB_ALPHA = 0, PS_PLAYING = 0, PSS_WORLD = 1

const SIZE          = 0.7     // m world height — bigger than any regular seed (0.45–0.62)
const SPIN_DEG_S    = 90
const CYCLE_STEP_MS = 330     // TUNING — one tier model per step: the full 8-colour cycle ≈ 2.6 s
const CHEST_Y       = 0.9     // avatar origin is at the feet
const RETRY_MS      = 3_000
const TOAST_MS      = 5_000

interface Golden { id: string; pathSeed: number; spawnLocal: number; endsLocal: number; entity: Entity; models: Entity[]; shown: number; sentAt: number }
let g: Golden | null = null

function despawn(): void {
  if (g === null) return
  engine.removeEntityWithChildren(g.entity)   // + the 8 models and the glint emitter
  g = null
}

function spawn(data: { id: string; pathSeed: number; spawnedAt: number; endsAt: number; serverNow: number }): void {
  if (g !== null && g.id === data.id) return        // join + resync can both send it
  despawn()
  const now = Date.now()
  // Local-clock anchors from the server's own delta (clockSync is untrusted, as for boxes)
  const spawnLocal = now - (Number(data.serverNow) - Number(data.spawnedAt))
  const endsLocal  = now + (Number(data.endsAt) - Number(data.serverNow))
  if (endsLocal <= now) return
  const root = engine.addEntity()
  const k = SIZE / SEED_MODEL_HEIGHT
  Transform.create(root, { position: goldenSeedPos((now - spawnLocal) / 1000, data.pathSeed), scale: { x: k, y: k, z: k } })
  const models = SEED_MODEL_SRCS.map((src, i) => {
    const m = engine.addEntity()
    Transform.create(m, { parent: root })
    GltfContainer.create(m, { src, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    VisibilityComponent.create(m, { visible: i === 0 })   // leaf entities — no child-propagation concerns on mobile
    return m
  })
  const glints = engine.addEntity()
  Transform.create(glints, { parent: root })
  ParticleSystem.create(glints, {
    shape: ParticleSystem.Shape.Sphere({ radius: 0.35 }),
    rate: 4, maxParticles: 6, lifetime: 1.4,
    gravity: 0, additionalForce: { x: 0, y: 0.25, z: 0 },
    initialVelocitySpeed: { start: 0, end: 0.1 },
    initialSize: { start: 0.35, end: 0.5 }, sizeOverTime: { start: 0.4, end: 1 },
    initialColor: { start: Color4.create(1, 0.97, 0.85, 1), end: Color4.create(1, 1, 1, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    texture: { src: SPARKLE_SRC }, billboard: true, blendMode: PSB_ALPHA,
    simulationSpace: PSS_WORLD,   // a few left behind as it wanders
    loop: true, prewarm: false, active: true, playbackState: PS_PLAYING,
  })
  g = { id: data.id, pathSeed: data.pathSeed, spawnLocal, endsLocal, entity: root, models, shown: 0, sentAt: 0 }
  showToast('A rainbow seed is drifting through the garden — catch it!', TOAST_MS, false)
  console.log(`[Golden] ${data.id} out for ${Math.round((endsLocal - now) / 1000)}s`)
}

/** Show tier model `i`, hide the previous one — two writes per step. */
function showModel(gs: Golden, i: number): void {
  if (i === gs.shown) return
  VisibilityComponent.getMutable(gs.models[gs.shown]).visible = false
  VisibilityComponent.getMutable(gs.models[i]).visible = true
  gs.shown = i
}

function goldenSystem(): void {
  if (g === null) return
  const now = Date.now()
  if (now >= g.endsLocal) { despawn(); return }
  const p = goldenSeedPos((now - g.spawnLocal) / 1000, g.pathSeed)
  const tr = Transform.getMutable(g.entity)
  tr.position = p
  tr.rotation = Quaternion.fromEulerDegrees(0, (now / 1_000 * SPIN_DEG_S) % 360, 0)
  showModel(g, Math.floor(now / CYCLE_STEP_MS) % g.models.length)
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  const dx = me.x - p.x, dy = me.y + CHEST_Y - p.y, dz = me.z - p.z
  if (dx * dx + dy * dy + dz * dz > GOLDEN_SEED_CATCH_RADIUS * GOLDEN_SEED_CATCH_RADIUS) return
  if (g.sentAt !== 0 && now - g.sentAt < RETRY_MS) return
  g.sentAt = now
  room.send('gatherSeed', { seedId: g.id })
}

/** Register — call after wateringSystem's room.clear() (seedSystem does). */
export function setupGoldenSeed(): void {
  room.onMessage('goldenSeed', (data) => spawn(data))
  // Same as the ordinary seeds: uncaught, it used to hang around past the bloom on its
  // own endsAt rather than leaving with the spectacle.
  room.onMessage('bloomReset', () => despawn())
  room.onMessage('seedGathered', (data) => {
    if (g === null || data.seedId !== g.id) return
    const mine = data.byAddress.toLowerCase() === (getPlayer()?.userId ?? '').toLowerCase()
    if (!mine) return
    despawn()
    playSfx('golden')   // was a same-tick false→true flip: only ever played the first time
    const tier = rarityTierById(data.rarityTier)
    showToast(`You caught the rainbow seed — ${withArticle(tier.name)} seed!`, TOAST_MS, false, tier.seedColor)
  })
  engine.addSystem(goldenSystem)
}
