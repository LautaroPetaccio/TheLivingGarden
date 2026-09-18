// =============================================================
// Bloom Garden v2 — Golden seed chase (CLIENT)
//
// One golden seed per bloom wanders the garden (server: 30% into the bloom, until it
// ends). Its position is computed here from goldenSeedPos(elapsed, pathSeed) — every
// client runs the same path, so nothing streams. Get within GOLDEN_SEED_CATCH_RADIUS
// (3D, from chest height) to catch it: we ask the server (gatherSeed with its id), the
// server rolls your own Epic-or-better seed. Everyone may catch it once; it disappears
// only for the catcher.
// =============================================================

import { engine, Entity, Transform, MeshRenderer, Material, ParticleSystem, AudioSource } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import { goldenSeedPos, GOLDEN_SEED_CATCH_RADIUS, SPARKLE_SRC, rarityTierById } from './shared/config'
import { showToast } from './notifications'

// const enums in @dcl/ecs internals, not re-exported (same as plantVfx)
const PSB_ADD = 1, PS_PLAYING = 0

const GOLD        = { r: 1.0, g: 0.78, b: 0.25 }
const SIZE        = 0.32    // m — bigger than a regular seed
const CHEST_Y     = 0.9     // avatar origin is at the feet
const RETRY_MS    = 3_000
const TOAST_MS    = 5_000
const CATCH_SOUND = 'assets/scene/Sounds/MagicFX.mp3'

interface Golden { id: string; pathSeed: number; spawnLocal: number; endsLocal: number; entity: Entity; sentAt: number }
let g: Golden | null = null
let chime: Entity | null = null

function despawn(): void {
  if (g === null) return
  engine.removeEntity(g.entity)
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
  const e = engine.addEntity()
  const p = goldenSeedPos((now - spawnLocal) / 1000, data.pathSeed)
  Transform.create(e, { position: p, scale: { x: SIZE, y: SIZE, z: SIZE } })
  MeshRenderer.setSphere(e)
  Material.setPbrMaterial(e, { albedoColor: Color4.create(GOLD.r, GOLD.g, GOLD.b, 1), emissiveColor: GOLD, emissiveIntensity: 4, metallic: 0.3, roughness: 0.3 })
  ParticleSystem.create(e, {
    shape: ParticleSystem.Shape.Sphere({ radius: 0.2 }),
    rate: 18, maxParticles: 60, lifetime: 1.6,
    gravity: 0, additionalForce: { x: 0, y: 0.25, z: 0 },
    initialSize: { start: 0.05, end: 0.1 }, sizeOverTime: { start: 1, end: 0.1 },
    initialColor: { start: Color4.create(1, 0.85, 0.35, 1), end: Color4.create(1, 0.95, 0.7, 1) },
    colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
    texture: { src: SPARKLE_SRC }, billboard: true, blendMode: PSB_ADD,
    loop: true, prewarm: false, active: true, playbackState: PS_PLAYING,
  })
  g = { id: data.id, pathSeed: data.pathSeed, spawnLocal, endsLocal, entity: e, sentAt: 0 }
  showToast('A golden seed is drifting through the garden — catch it!', TOAST_MS, false)
  console.log(`[Golden] ${data.id} out for ${Math.round((endsLocal - now) / 1000)}s`)
}

function goldenSystem(): void {
  if (g === null) return
  const now = Date.now()
  if (now >= g.endsLocal) { despawn(); return }
  const p = goldenSeedPos((now - g.spawnLocal) / 1000, g.pathSeed)
  Transform.getMutable(g.entity).position = p
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  const dx = me.x - p.x, dy = me.y + CHEST_Y - p.y, dz = me.z - p.z
  if (dx * dx + dy * dy + dz * dz > GOLDEN_SEED_CATCH_RADIUS * GOLDEN_SEED_CATCH_RADIUS) return
  if (g.sentAt !== 0 && now - g.sentAt < RETRY_MS) return
  g.sentAt = now
  room.send('gatherSeed', { seedId: g.id })
}

function playChime(): void {
  const at = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!at) return
  if (chime === null) {
    chime = engine.addEntity()
    Transform.create(chime, { position: at })
    AudioSource.create(chime, { audioClipUrl: CATCH_SOUND, playing: false, loop: false, volume: 1 })
  }
  Transform.getMutable(chime).position = at
  const a = AudioSource.getMutable(chime)
  a.playing = false
  a.playing = true
}

/** Register — call after wateringSystem's room.clear() (seedSystem does). */
export function setupGoldenSeed(): void {
  room.onMessage('goldenSeed', (data) => spawn(data))
  room.onMessage('seedGathered', (data) => {
    if (g === null || data.seedId !== g.id) return
    const mine = data.byAddress.toLowerCase() === (getPlayer()?.userId ?? '').toLowerCase()
    if (!mine) return
    despawn()
    playChime()
    showToast(`You caught the golden seed — a ${rarityTierById(data.rarityTier).name} seed!`, TOAST_MS, false)
  })
  engine.addSystem(goldenSystem)
}
