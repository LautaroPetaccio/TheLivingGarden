// =============================================================
// Bloom Garden v2 — 100-planter performance test (CLIENT ONLY, dev tool)
//
// KJ is considering 100+ planters in the scene. This spawns 100 of the REAL planter
// model (same GLB, scale, spacing and collision mask as boxSystem — primitive pots
// gave a falsely good reading) and lets the phone answer the question with a frame
// rate: one entity per pot, a real animated balloon + sprout on every other pot
// (boxSystem's real occupied-box visual, not a cheap stand-in — an unanimated pot
// undercounts the actual cost of a busy garden), and a POOL of 8 plaques that hop
// to the pots nearest the player (a plaque per pot would be 300 more entities).
// Local only — nothing is sent to the server. Remove with the test panel before
// production.
// =============================================================

import { engine, Entity, Transform, MeshRenderer, GltfContainer, ColliderLayer, Material, TextShape, PointerEvents, PointerEventType, InputAction, Animator, timers } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { BOX_MODEL_SRC, BOX_MODEL_SCALE, BOX_MODEL_RIM_Y, BALLOON_MODEL_SRC, BALLOON_ANIM_CLIPS } from './shared/config'
import { createSign, moveSign, removeSign, setupSignSystem, Sign } from './signs'

const COLS = 10, ROWS = 10
const SPACING = 1.4                        // same pitch as the real planter row
const ORIGIN  = { x: 1.7, z: 27.5 }        // open floor past the Bloom; temporary, so overlap is fine
const PLAQUES = 8
const REHOME_MS = 500
const COLOR_SPROUT = Color4.create(0.35, 0.75, 0.35, 1)

interface Pot { x: number; z: number; label: string }
const entities: Entity[] = []
const pots: Pot[] = []
const pool: Sign[] = []
let rehomeAccum = 0

// ── frame-rate meter (always on while the dev tools are mounted) ──
let fps = 0, frames = 0, acc = 0
function fpsSystem(dt: number): void {
  frames++; acc += dt
  if (acc >= 1) { fps = Math.round(frames / acc); frames = 0; acc = 0 }
}
let meterStarted = false
export function startFpsMeter(): void { if (!meterStarted) { meterStarted = true; engine.addSystem(fpsSystem) } }
export function getFps(): number { return fps }
export function getTestPotCount(): number { return pots.length }

function rehomeSystem(dt: number): void {
  if (pots.length === 0) return
  rehomeAccum += dt * 1_000
  if (rehomeAccum < REHOME_MS) return
  rehomeAccum = 0
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  const nearest = pots.map(p => ({ p, d: (p.x - me.x) ** 2 + (p.z - me.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, pool.length)
  nearest.forEach((n, i) => {
    moveSign(pool[i], { x: n.p.x, y: BOX_MODEL_RIM_Y + 0.3, z: n.p.z - 0.5 })
    TextShape.getMutable(pool[i].text).text = n.p.label
  })
}
let rehomeStarted = false

export function spawnTestPots(): void {
  if (pots.length > 0) return
  setupSignSystem()
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const n = r * COLS + c + 1
    const x = ORIGIN.x + c * SPACING, z = ORIGIN.z + r * SPACING
    const pot = engine.addEntity()
    Transform.create(pot, { position: { x, y: 0, z }, scale: { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE } })
    GltfContainer.create(pot, { src: BOX_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS })
    PointerEvents.create(pot, { pointerEvents: [{ eventType: PointerEventType.PET_DOWN, eventInfo: { button: InputAction.IA_POINTER, hoverText: `Test planter ${n}`, maxDistance: 8 } }] })
    entities.push(pot)
    const growing = n % 2 === 0
    if (growing) {
      const sprout = engine.addEntity()
      Transform.create(sprout, { position: { x, y: BOX_MODEL_RIM_Y + 0.09, z }, scale: { x: 0.18, y: 0.18, z: 0.18 } })
      MeshRenderer.setSphere(sprout)
      Material.setPbrMaterial(sprout, { albedoColor: COLOR_SPROUT })
      entities.push(sprout)

      const balloon = engine.addEntity()
      Transform.create(balloon, { position: { x, y: 0, z }, scale: { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE } })
      GltfContainer.create(balloon, { src: BALLOON_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
      timers.setTimeout(() => Animator.createOrReplace(balloon, { states: BALLOON_ANIM_CLIPS.map(clip => ({ clip, playing: true, loop: true })) }), 1_000)
      entities.push(balloon)
    }
    pots.push({ x, z, label: growing ? `Gardener ${n}'s seed\nopens in 7h ${n % 60}m` : 'Empty planter\nTap to plant' })
  }
  for (let i = 0; i < PLAQUES; i++) pool.push(createSign({ x: ORIGIN.x, y: -5, z: ORIGIN.z }, 0, { w: 0.85, h: 0.42 }, 0.6))
  if (!rehomeStarted) { rehomeStarted = true; engine.addSystem(rehomeSystem) }
  console.log(`[PotTest] ${pots.length} pots, ${entities.length} entities + ${pool.length} pooled plaques (${pool.length * 3} entities)`)
}

export function removeTestPots(): void {
  for (const e of entities) engine.removeEntity(e)
  for (const s of pool) removeSign(s)
  entities.length = 0; pots.length = 0; pool.length = 0
  console.log('[PotTest] removed')
}
