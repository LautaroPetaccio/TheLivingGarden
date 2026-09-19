// =============================================================
// Bloom Garden v2 — Seed Boxes (CLIENT ONLY, greybox)
//
// GDD §3 step 4 / §4.1 / §4.3 "seed appointment": tap an empty box to
// plant a caught seed; the box takes your name and grows on a real-world
// timer; when it opens, the mystery flower is revealed. This is the D1
// return hook, so the box, its name, its sprout and its countdown must all
// be visible in the shared garden — to everyone.
//
// Real planter model + an animated balloon (both KJ's Blender exports) while the box
// holds a seed or an unharvested flower: KJ's seedling while growing, the real species
// model once opened (rarity effects in plantVfx.ts).
//
// Server communication (server is authoritative; the client only requests):
//   send    →  plantSeed   { boxId, rarityTier }   empty box
//   send    →  harvestBox  { boxId }              my opened box  (Phase 4)
//   send    →  waterBox    { boxId }              someone else's growing box (Phase 4)
//   receive ←  boxState    { boxId, owner, ownerName, rarityTier, plantedAt, opensAt, serverNow, opened, flower, waters, lastWaterer }
//   receive ←  pouchUpdate { countsJson }   (my own seed counts, one per rarity tier)
// One world tap per box; what it does depends on whose box it is and its state.
// `flower` is a PLANT_SPECIES id once opened — the harvest-time mystery, independent
// of rarityTier (fixed at planting, visible the whole time like a DCL wearable's rarity).
// =============================================================

import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
  MaterialTransparencyMode,
  GltfContainer,
  GltfNodeModifiers,
  ColliderLayer,
  MeshCollider,
  TextShape,
  TextAlignMode,
  PointerEvents,
  pointerEventsSystem,
  InputAction,
  Animator,
  GltfContainerLoadingState,
  Tween,
  TweenSequence,
  timers,
} from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import { BOX_POSITIONS, BOX_WATER_MAX, BOX_MODEL_SRC, BOX_MODEL_SCALE, BOX_MODEL_RIM_Y, BALLOON_MODEL_SRC, BALLOON_ANIM_CLIPS, SEEDLING_MODEL_SRC_NORMAL, SEEDLING_MODEL_SRC_RARE, rarityTierById, plantSpeciesById, withArticle } from './shared/config'
import { showToast } from './notifications'
import { attachPlantVfx, attachSeedlingVfx, detachPlantVfx, setupPlantVfx } from './plantVfx'
import { setupGiftSystem } from './giftSystem'
import { setPouch, getBoxCap, nextSeedTier } from './playerInventory'
import { createSign, moveSign, setupSignSystem, Sign } from './signs'
import { BALLOON_TEXT_TRACK } from './balloonTextTrack'
import { playSfx } from './sounds'

// ---------------------------------------------------------------
// Config (greybox visuals)
// ---------------------------------------------------------------

// Text on the planter's own light wooden board (planterBox.glb node Cube.012: centre
// y 0.988, front face z≈1.048, 0.96 × 0.32 at model scale — × BOX_MODEL_SCALE here).
// Readers stand on +Z.
const PLAQUE_OFFSET_Z = 1.055 * BOX_MODEL_SCALE
const PLAQUE_Y        = 0.988 * BOX_MODEL_SCALE
const PLAQUE_SIZE     = { w: 0.92 * BOX_MODEL_SCALE, h: 0.30 * BOX_MODEL_SCALE }
const PLAQUE_FONT     = 0.4    // TUNING — two lines on a 0.55 × 0.18 m board
const SEEDLING_SCALE = 0.25
const SEEDLING_MODEL_MIN_Y = 1.15   // seedling.glb's geometry starts 1.15 above its origin
// Balloon countdown, in the balloon GLB's own space (the entity carries BOX_MODEL_SCALE).
// Same spot as the baked 'Text.002' mesh it replaces, nudged just in front of it.
const BALLOON_TEXT_NODE = 'Text.002'
const BALLOON_TEXT_POS  = { x: -0.011, y: 2.816, z: -0.29 }
const BALLOON_TEXT_FONT = 0.8   // TUNING — must fit inside the balloon's dark disc
const BALLOON_TEXT_COLOR = { r: 1.0, g: 0.95, b: 0.82, a: 1 }
const FLOWER_SCALE  = 0.5   // fallback sphere size, only used if a species id isn't found
const TOAST_MS      = 5_000
const LABEL_TICK_MS = 1_000
const TAP_DISTANCE  = 8     // m — mobile is third-person only, camera sits well behind the avatar
// const enums in @dcl/ecs internals, not re-exported (same as plantVfx's particle enums)
const LS_NOT_FOUND = 2, LS_FINISHED_WITH_ERROR = 3, LS_FINISHED = 4   // LoadingState
const EF_LINEAR  = 0   // EasingFunction
const TL_RESTART = 0   // TweenLoop

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface BoxView {
  boxId:        string
  base:         Entity
  hit:          Entity          // box collider child: tap target + walk blocker
  label:        Entity
  sign:         Sign            // the plaque (root + text) — moved by the layout editor
  plant:        Entity | null   // sprout or flower entity while planted
  plantKey:     string          // what `plant` currently shows — rebuilt only when this changes
  balloon:      Entity | null   // animated balloon while the box holds a seed or flower
  balloonText:  Entity | null   // countdown / "Ready to Harvest" on the balloon
  balloonMover: Entity | null   // text parent: replays Bone.003's position (Tween)
  balloonPivot: Entity | null   // child of the mover: replays Bone.003's rotation (Tween)
  balloonAnimPending: boolean   // waiting for the balloon GLB to load before starting clip + text together
  owner:        string
  ownerName:    string
  rarityTier:   number
  opened:       boolean
  flower:       string
  opensLocalAt: number          // local-clock ms; derived from opensAt − serverNow
  waters:       number
  lastWaterer:  string
}

const views  = new Map<string, BoxView>()
/** Live planter layout: BOX_POSITIONS, as edited in preview by the planter editor
 *  (planterLayoutTool). Everything positions planters from HERE, never BOX_POSITIONS. */
const layout   = new Map<string, PlanterPos>()
const deleted  = new Set<string>()   // removed in the editor (hidden until the next bake)
const carrying = new Set<string>()   // being carried by the editor — plant rebuilt on drop
const synced   = new Set<string>()   // boxes that have had their first boxState (join sync) — no sounds for that one
let   pouch: number[] = []   // counts per rarity tier, from pouchUpdate
let   tickAccum = 0

function localId(): string { return (getPlayer()?.userId ?? '').toLowerCase() }
function isMine(v: BoxView): boolean { return !!v.owner && v.owner.toLowerCase() === localId() }
function myBoxCount(): number { let n = 0; for (const v of views.values()) if (isMine(v)) n++; return n }

// ---------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------

function flowerName(v: BoxView): string { return plantSpeciesById(v.flower)?.name ?? v.flower }

/** Board text. The countdown lives on the balloon (balloonTextFor), so this only changes on events. */
function labelFor(v: BoxView): string {
  if (!v.owner) {
    const have = pouch.reduce((a, b) => a + b, 0)
    return have > 0 ? `Empty planter\nTap to plant (${have} seeds)` : 'Empty planter\nCatch a bloom seed'
  }
  const tierName = rarityTierById(v.rarityTier).name
  const who = isMine(v) ? 'Your' : `${v.ownerName}'s`
  if (v.opened) return `${who} ${flowerName(v)}${v.rarityTier > 0 ? `\n${tierName}` : ''}`
  const watered = v.waters > 0 ? `\nwatered x${v.waters} by ${v.lastWaterer}` : ''
  return `${who} ${v.rarityTier > 0 ? `${tierName} ` : ''}seed${watered}`
}

function countdown(v: BoxView, now: number): string {
  const left = Math.max(0, v.opensLocalAt - now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(Math.floor(left / 3_600_000))}:${pad(Math.floor((left % 3_600_000) / 60_000))}:${pad(Math.floor((left % 60_000) / 1_000))}`
}

function balloonTextFor(v: BoxView, now: number): string {
  return v.opened ? 'Ready to\nHarvest' : `Harvest in\n${countdown(v, now)}`
}

/** Hover prompt for the one tap the box currently offers. */
function hoverFor(v: BoxView): string {
  if (!v.owner) return 'Plant seed'
  if (isMine(v)) return v.opened ? 'Harvest (or leave it on show)' : 'Growing…'
  if (v.opened) return `${v.ownerName}'s flower`
  return v.waters >= BOX_WATER_MAX ? 'Fully watered' : 'Water'
}

/** A pulsing flower carries a GltfNodeModifiers material override. Removing the entity
 *  with the override still on makes the Unity explorer's ResetMaterialSystem restore
 *  materials on a GLB it is already destroying (same error as the old balloon removal),
 *  so drop the override first, hide it, and remove the entity once that has settled. */
const PLANT_RETIRE_MS = 1_000
function retirePlant(e: Entity): void {
  if (!GltfNodeModifiers.has(e)) { engine.removeEntity(e); return }
  GltfNodeModifiers.deleteFrom(e)
  Transform.getMutable(e).scale = { x: 0, y: 0, z: 0 }
  timers.setTimeout(() => engine.removeEntity(e), PLANT_RETIRE_MS)
}

type PlanterPos = { x: number; z: number; rot: number }

/** A point given in the planter's own frame (lx right, lz front) → world x/z. Same
 *  convention as Quaternion.fromEulerDegrees(0, rot, 0): rot 90 turns the front to +x. */
function planterPoint(pos: PlanterPos, lx: number, lz: number): { x: number; z: number } {
  const r = (pos.rot * Math.PI) / 180
  return { x: pos.x + lx * Math.cos(r) + lz * Math.sin(r), z: pos.z - lx * Math.sin(r) + lz * Math.cos(r) }
}
const planterRotation = (pos: PlanterPos) => Quaternion.fromEulerDegrees(0, pos.rot, 0)

function setPlantVisual(v: BoxView, pos: PlanterPos): void {
  detachPlantVfx(v.boxId)
  if (v.plant !== null) { retirePlant(v.plant); v.plant = null }
  if (!v.owner) return
  const e = engine.addEntity()

  if (!v.opened) {
    // Growing: KJ's seedling model — only a normal/rare tint is baked into art so
    // far (SEEDLING_MODEL_SRC_NORMAL/_RARE), so tier 0 (Common) gets normal and
    // everything above it borrows the rare variant until per-tier seedling art exists.
    const k = SEEDLING_SCALE
    Transform.create(e, { position: { x: pos.x, y: BOX_MODEL_RIM_Y - SEEDLING_MODEL_MIN_Y * k, z: pos.z }, rotation: planterRotation(pos), scale: { x: k, y: k, z: k } })
    const src = v.rarityTier > 0 ? SEEDLING_MODEL_SRC_RARE : SEEDLING_MODEL_SRC_NORMAL
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    attachSeedlingVfx(v.boxId, e, v.rarityTier)   // tier pulse while growing (Rare and up)
    v.plant = e
    return
  }

  // Opened: the real species model, normalised from its own geometry (PLANT_SPECIES
  // scale/offsets); rarity effects are layered on by plantVfx.
  const species = plantSpeciesById(v.flower)
  if (species) {
    const at = planterPoint(pos, species.offsetX, species.offsetZ)   // footprint-centring offset turns with the planter
    Transform.create(e, { position: { x: at.x, y: BOX_MODEL_RIM_Y + species.baseYOffset, z: at.z }, rotation: planterRotation(pos), scale: { x: species.scale, y: species.scale, z: species.scale } })
    GltfContainer.create(e, { src: species.modelSrc, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    attachPlantVfx(v.boxId, e, species.id, v.rarityTier, { x: pos.x, y: BOX_MODEL_RIM_Y, z: pos.z })
  } else {
    // Species id not in the catalog (shouldn't happen) — fall back to a tinted sphere.
    const k = FLOWER_SCALE
    Transform.create(e, { position: { x: pos.x, y: BOX_MODEL_RIM_Y + k / 2, z: pos.z }, scale: { x: k, y: k, z: k } })
    MeshRenderer.setSphere(e)
    const c = rarityTierById(v.rarityTier).seedColor
    Material.setPbrMaterial(e, { albedoColor: { ...c, a: 1 }, emissiveColor: c, emissiveIntensity: 0.8 })
  }
  v.plant = e
}

/** One pooled balloon per box, created the first time the box is planted and never removed —
 *  shown/hidden by scale. Removing it made the Unity explorer's ResetMaterialSystem throw (it
 *  restores the Text.002 override's material on a GLB already being torn down — KJ log
 *  2026-09-18 15:40, on harvest), and every replant re-loaded the GLB and re-synced its clip.
 *  While hidden its clip and text Tweens are STOPPED: the explorer writes every looping-tweened
 *  entity's Transform back to the scene each frame, hidden or not — 96 always-on balloons were
 *  192 messages per tick and held the scene tick at ~13 fps (KJ debug panel 2026-09-19). */
function setBalloonVisual(v: BoxView, pos: PlanterPos): void {
  if (!v.owner) { if (v.balloon !== null) hideBalloon(v); return }
  if (v.balloon === null) createBalloon(v, pos)
  else if (v.balloonMover !== null && !Tween.has(v.balloonMover)) v.balloonAnimPending = true   // replanted — restart clip + text together
  const tr = Transform.getMutable(v.balloon!)
  if (tr.scale.x !== BOX_MODEL_SCALE) tr.scale = { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE }
}

function hideBalloon(v: BoxView): void {
  if (v.balloon === null) return
  const tr = Transform.getMutable(v.balloon)
  if (tr.scale.x !== 0) tr.scale = { x: 0, y: 0, z: 0 }
  v.balloonAnimPending = false
  if (Animator.has(v.balloon)) Animator.stopAllAnimations(v.balloon)
  for (const e of [v.balloonMover, v.balloonPivot]) {
    if (e === null) continue
    TweenSequence.deleteFrom(e)
    Tween.deleteFrom(e)
  }
}

function createBalloon(v: BoxView, pos: PlanterPos): void {
  const balloon = engine.addEntity()
  Transform.create(balloon, { position: { x: pos.x, y: 0, z: pos.z }, rotation: planterRotation(pos), scale: { x: 0, y: 0, z: 0 } })
  GltfContainer.create(balloon, { src: BALLOON_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  // Hide the baked "Harvest in" mesh (KJ's GLB left untouched) — the live text below replaces it
  GltfNodeModifiers.create(balloon, { modifiers: [{
    path: BALLOON_TEXT_NODE, castShadows: false,
    material: { material: { $case: 'pbr', pbr: { albedoColor: { r: 1, g: 1, b: 1, a: 0 }, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND } } },
  }] })
  // balloon → mover (bone position) → pivot (bone rotation) → text (facing). The motion is
  // renderer-side Tweens started on the same tick as the Animator (balloonStartSystem).
  const mover = engine.addEntity()
  Transform.create(mover, { parent: balloon, position: BALLOON_TEXT_POS })
  const pivot = engine.addEntity()
  Transform.create(pivot, { parent: mover })
  const text = engine.addEntity()
  Transform.create(text, { parent: pivot, rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  TextShape.create(text, { text: balloonTextFor(v, Date.now()), fontSize: BALLOON_TEXT_FONT, textColor: BALLOON_TEXT_COLOR, textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  v.balloon = balloon
  v.balloonText = text
  v.balloonMover = mover
  v.balloonPivot = pivot
  v.balloonAnimPending = true
}

/** Everything setPlantVisual depends on. boxState arrives on every watering too, and the
 *  plant (GLB + rarity VFX) used to be torn down and rebuilt each time. */
function plantKeyFor(v: BoxView): string {
  return v.owner ? `${v.owner}|${v.opened}|${v.flower}|${v.rarityTier}` : ''
}

/** Boxes whose plant must be (re)built. One per frame, nearest to the player first, so a
 *  join sync (all 8 boxes in one tick) doesn't instantiate every GLB + emitter at once. */
const pendingPlant = new Set<BoxView>()
function plantRevealSystem(): void {
  if (pendingPlant.size === 0) return
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  let best: BoxView | null = null, bestD = Infinity
  for (const v of pendingPlant) {
    if (carrying.has(v.boxId)) continue
    const p = layout.get(v.boxId)!
    const d = me ? (p.x - me.x) ** 2 + (p.z - me.z) ** 2 : 0
    if (d < bestD) { bestD = d; best = v }
  }
  if (best === null) return
  pendingPlant.delete(best)
  setPlantVisual(best, layout.get(best.boxId)!)
  best.plantKey = plantKeyFor(best)
}

function refresh(v: BoxView): void {
  if (deleted.has(v.boxId)) return   // removed in the layout editor — stays hidden until the bake
  const pos = layout.get(v.boxId)!
  if (plantKeyFor(v) !== v.plantKey) pendingPlant.add(v)   // built by plantRevealSystem
  setBalloonVisual(v, pos)
  if (v.balloonText !== null) TextShape.getMutable(v.balloonText).text = balloonTextFor(v, Date.now())
  TextShape.getMutable(v.label).text = labelFor(v)
  const pe = PointerEvents.getMutableOrNull(v.hit)?.pointerEvents[0]?.eventInfo
  if (pe) pe.hoverText = hoverFor(v)
}

// ---------------------------------------------------------------
// Planting (world tap — GDD §6: "Tap an empty box, confirm. Large target, no drag.")
// ---------------------------------------------------------------

function tryPlant(v: BoxView): void {
  if (v.owner) return
  if (myBoxCount() >= getBoxCap()) {
    showToast(`You're using all ${getBoxCap()} of your planters — harvest one to plant again`, TOAST_MS, false)
    return
  }
  const tier = nextSeedTier()
  if (tier === null) {
    showToast('No seeds yet — catch some from a bloom', TOAST_MS, false)
    return
  }
  console.log(`[Boxes] planting tier-${tier} seed in ${v.boxId}`)
  room.send('plantSeed', { boxId: v.boxId, rarityTier: tier })
}

// Phase 4 — one tap, dispatched by whose box it is and its state.
// Server re-validates everything; these local checks only save a round trip.
function onTap(v: BoxView): void {
  if (!v.owner) { tryPlant(v); return }
  if (isMine(v)) {
    if (v.opened) { console.log(`[Boxes] harvesting ${v.boxId}`); room.send('harvestBox', { boxId: v.boxId }); return }
    showToast(`Still growing — ready in ${countdown(v, Date.now())}`, TOAST_MS, false)
    return
  }
  if (v.opened) { showToast(`${v.ownerName}'s ${flowerName(v)}, on show`, TOAST_MS, false); return }
  if (v.waters >= BOX_WATER_MAX) { showToast(`${v.ownerName}'s seed has had all the water it can take`, TOAST_MS, false); return }
  console.log(`[Boxes] watering ${v.ownerName}'s ${v.boxId}`)
  room.send('waterBox', { boxId: v.boxId })
}

// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------

// Model-space (before BOX_MODEL_SCALE): the planter body up to the soil rim
const PLANTER_COLLIDER_CENTER = { x: 0, y: 0.55, z: 0.06 }
const PLANTER_COLLIDER_SIZE   = { x: 1.8, y: 1.1, z: 1.95 }

function createBox(p: PlanterPos & { id: string }): BoxView {
  // KJ's planter template has no _collider mesh. Its visible meshes used to carry pointer +
  // physics collision: 96 × 1,577-tri mesh colliders tested on every pointer raycast and
  // physics step. One box collider per planter instead, sized to the model (glTF bounds
  // x ±0.9, y 0–1.31, z −0.93…1.05; the box stops at the rim so the decorations stay free).
  const base = engine.addEntity()
  Transform.create(base, { position: { x: p.x, y: 0, z: p.z }, rotation: planterRotation(p), scale: { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE } })
  GltfContainer.create(base, { src: BOX_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  // No shadow casting (KJ 2026-09-19): 96 planters were drawn again for every shadow cascade
  GltfNodeModifiers.create(base, { modifiers: [{ path: '', castShadows: false }] })
  const hit = engine.addEntity()
  Transform.create(hit, { parent: base, position: PLANTER_COLLIDER_CENTER, scale: PLANTER_COLLIDER_SIZE })
  MeshCollider.setBox(hit, ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS)

  const at    = planterPoint(p, 0, PLAQUE_OFFSET_Z)   // on the planter's front board
  const sign  = createSign({ x: at.x, y: PLAQUE_Y, z: at.z }, (180 + p.rot) % 360, PLAQUE_SIZE, PLAQUE_FONT, false)
  const label = sign.text

  const v: BoxView = { boxId: p.id, base, hit, label, sign, plant: null, plantKey: '', balloon: null, balloonText: null, balloonMover: null, balloonPivot: null, balloonAnimPending: false, owner: '', ownerName: '', rarityTier: 0, opened: false, flower: '', opensLocalAt: 0, waters: 0, lastWaterer: '' }
  pointerEventsSystem.onPointerDown(
    { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: 'Plant seed', maxDistance: TAP_DISTANCE } },
    () => onTap(v),
  )
  return v
}

/** Test-panel only: force two boxes into the growing state so the rarity-tinted
 *  seedling colors can be compared side by side without waiting on real timers.
 *  Client-only, cosmetic — the next boxState broadcast (or a rejoin) overwrites it. */
// ---------------------------------------------------------------
// Planter layout editor API (planterLayoutTool) — moves the REAL planters in this
// client only; the result is baked into BOX_POSITIONS. The server only knows ids.
// ---------------------------------------------------------------

export type PlanterPose = PlanterPos & { id: string }

/** Current layout, deleted planters excluded — what gets saved and baked. */
export function getPlanterLayout(): PlanterPose[] {
  return [...layout.entries()].filter(([id]) => !deleted.has(id)).map(([id, p]) => ({ id, ...p }))
}

/** Move/turn one planter and everything on it. Plant is rebuilt (unless it's being carried). */
export function setPlanterPose(id: string, pose: PlanterPos): void {
  const v = views.get(id)
  if (!v) return
  layout.set(id, pose)
  const base = Transform.getMutable(v.base)
  base.position = { x: pose.x, y: 0, z: pose.z }
  base.rotation = planterRotation(pose)
  const at = planterPoint(pose, 0, PLAQUE_OFFSET_Z)
  moveSign(v.sign, { x: at.x, y: PLAQUE_Y, z: at.z })
  Transform.getMutable(v.sign.root).rotation = Quaternion.fromEulerDegrees(0, (180 + pose.rot) % 360, 0)
  if (v.balloon !== null) {
    const b = Transform.getMutable(v.balloon)
    b.position = { x: pose.x, y: 0, z: pose.z }
    b.rotation = planterRotation(pose)
  }
  if (!carrying.has(id) && v.plant !== null) { v.plantKey = ''; pendingPlant.add(v) }
}

/** Editor: lift a planter — its plant is taken down while it moves, rebuilt on drop. */
export function beginCarry(id: string): void {
  const v = views.get(id)
  if (!v) return
  carrying.add(id)
  detachPlantVfx(id)
  if (v.plant !== null) { retirePlant(v.plant); v.plant = null }
  v.plantKey = ''
}
export function endCarry(id: string): void {
  const v = views.get(id)
  carrying.delete(id)
  if (v) pendingPlant.add(v)
}

/** Editor: a new planter (client-only until baked — the server doesn't know its id yet). */
export function addPlanter(pose: PlanterPos): string {
  let n = views.size + 1
  while (views.has(`box_${n}`)) n++
  const id = `box_${n}`
  layout.set(id, pose)
  views.set(id, createBox({ id, ...pose }))
  refresh(views.get(id)!)
  return id
}

/** Editor: hide a planter until the next bake drops it (the server hands back its contents). */
export function deletePlanter(id: string): void {
  const v = views.get(id)
  if (!v || deleted.has(id)) return
  deleted.add(id)
  detachPlantVfx(id)
  if (v.plant !== null) { retirePlant(v.plant); v.plant = null }
  const zero = { x: 0, y: 0, z: 0 }
  Transform.getMutable(v.base).scale = zero
  hideBalloon(v)
  moveSign(v.sign, { x: 0, y: -50, z: 0 })
}
export function isPlanterDeleted(id: string): boolean { return deleted.has(id) }

/** Editor: apply a saved layout — move known planters, add new ids, delete missing ones. */
export function applyPlanterLayout(list: PlanterPose[]): void {
  const keep = new Set(list.map(p => p.id))
  for (const p of list) {
    if (views.has(p.id)) setPlanterPose(p.id, { x: p.x, z: p.z, rot: p.rot })
    else { layout.set(p.id, { x: p.x, z: p.z, rot: p.rot }); views.set(p.id, createBox(p)); refresh(views.get(p.id)!) }
  }
  for (const id of [...views.keys()]) if (!keep.has(id)) deletePlanter(id)
}

/** Test panel: run the crowding rule once now (server picks the longest-away owner's planter). */
export function adminTidyPlanter(): void { room.send('adminTidyPlanter', {}) }

export function demoSeedlings(): void {
  const demo = (boxId: string, rarityTier: number) => {
    const v = views.get(boxId)
    if (!v) return
    v.owner        = '0xdemo'
    v.ownerName    = 'Demo'
    v.rarityTier   = rarityTier
    v.opened       = false
    v.opensLocalAt = Date.now() + 3_600_000
    refresh(v)
  }
  // One per seedling effect in KJ's table (Common = none); box_1..6 are a row in the current layout
  demo('box_1', 0); demo('box_2', 2); demo('box_3', 3); demo('box_4', 4); demo('box_5', 5); demo('box_6', 7)
  console.log('[Boxes] demo seedlings: box_1 Common, 2 Rare, 3 Epic, 4 Legendary, 5 Exotic, 6 Unique — the next real box update clears it')
}

/** Test-panel only: force four OTHER boxes into the opened/revealed state, one per
 *  effect tier (Rare pulse, Epic particles, Legendary pulse+particles, Exotic all + tween),
 *  without waiting on a real grow cycle. Client-only, cosmetic — clears on the next real update. */
export function demoRevealedFlowers(): void {
  const demo = (boxId: string, flower: string, rarityTier: number) => {
    const v = views.get(boxId)
    if (!v) return
    v.owner      = '0xdemo'
    v.ownerName  = 'Demo'
    v.rarityTier = rarityTier
    v.opened     = true
    v.flower     = flower
    refresh(v)
  }
  demo('box_5', 'rose', 2)               // Rare — green pulse
  demo('box_6', 'sunflower', 3)          // Epic — blue particles
  demo('box_7', 'bird_of_paradise', 4)   // Legendary — tonal purple pulse + particles (double-sided leaves)
  demo('box_8', 'void_tulip', 5)         // Exotic — lime/red pulse + particles + sway
  console.log('[Boxes] demo revealed flowers: box_5 Rose (Rare), box_6 Sunflower (Epic), box_7 Bird of Paradise (Legendary), box_8 Void Tulip (Exotic) — the next real box update clears it')
}

/** Once a second: only the balloon countdown moves; the board text is event-driven. */
function boxTickSystem(dt: number): void {
  tickAccum += dt * 1_000
  if (tickAccum < LABEL_TICK_MS) return
  tickAccum = 0
  const now = Date.now()
  for (const v of views.values()) if (v.owner && v.balloonText !== null) TextShape.getMutable(v.balloonText).text = balloonTextFor(v, now)
}

/** Bone.003's baked motion as looping renderer-side Tween sequences (one segment per track key). */
function trackSequence(kind: 'move' | 'rotate'): NonNullable<Parameters<typeof Tween.create>[1]>[] {
  const out: NonNullable<Parameters<typeof Tween.create>[1]>[] = []
  for (let i = 0; i + 1 < BALLOON_TEXT_TRACK.length; i++) {
    const a = BALLOON_TEXT_TRACK[i], b = BALLOON_TEXT_TRACK[i + 1]
    const duration = Math.round((b[0] - a[0]) * 1000)
    out.push(kind === 'move'
      ? { duration, easingFunction: EF_LINEAR, mode: { $case: 'move', move: { start: { x: a[1], y: a[2], z: a[3] }, end: { x: b[1], y: b[2], z: b[3] } } } }
      : { duration, easingFunction: EF_LINEAR, mode: { $case: 'rotate', rotate: { start: { x: a[4], y: a[5], z: a[6], w: a[7] }, end: { x: b[4], y: b[5], z: b[6], w: b[7] } } } })
  }
  return out
}
const MOVE_SEQ   = trackSequence('move')
const ROTATE_SEQ = trackSequence('rotate')

/** Start the balloon clip and its text's Tweens on the SAME tick, once the renderer reports
 *  the GLB loaded. A fixed timer guessed the load time: on a slow/late-joining client the
 *  clip started when the GLB finished loading, seconds after the guess, and the text ran
 *  ahead of the balloon by that gap forever (KJ, mobile preview 2026-09-18). */
function balloonStartSystem(): void {
  for (const v of views.values()) {
    if (!v.balloonAnimPending || v.balloon === null || v.balloonMover === null || v.balloonPivot === null) continue
    const state = GltfContainerLoadingState.getOrNull(v.balloon)?.currentState
    if (state === LS_NOT_FOUND || state === LS_FINISHED_WITH_ERROR) { v.balloonAnimPending = false; continue }
    if (state !== LS_FINISHED) continue
    v.balloonAnimPending = false
    Animator.createOrReplace(v.balloon, { states: BALLOON_ANIM_CLIPS.map(clip => ({ clip, playing: true, loop: true, shouldReset: true })) })
    Tween.createOrReplace(v.balloonMover, MOVE_SEQ[0])
    TweenSequence.createOrReplace(v.balloonMover, { sequence: MOVE_SEQ.slice(1), loop: TL_RESTART })
    Tween.createOrReplace(v.balloonPivot, ROTATE_SEQ[0])
    TweenSequence.createOrReplace(v.balloonPivot, { sequence: ROTATE_SEQ.slice(1), loop: TL_RESTART })
  }
}

/** Register handlers — MUST be called after wateringSystem's room.clear(). */
export function setupBoxSystem(): void {
  for (const p of BOX_POSITIONS) { layout.set(p.id, { x: p.x, z: p.z, rot: p.rot }); views.set(p.id, createBox(p)) }

  room.onMessage('boxState', (data) => {
    const v = views.get(data.boxId)
    if (!v) return
    const wasOpened = v.opened
    const wasMine   = isMine(v)
    const wasOwned  = !!v.owner
    const live      = synced.has(v.boxId)   // false for the join/resync snapshot
    synced.add(v.boxId)
    v.owner     = data.owner
    v.ownerName = data.ownerName
    v.rarityTier = data.rarityTier
    v.opened    = data.opened
    v.flower    = data.flower
    v.waters      = data.waters
    v.lastWaterer = data.lastWaterer
    // Countdown from the server's own clock delta — clockSync is unreliable here
    v.opensLocalAt = Date.now() + (Number(data.opensAt) - Number(data.serverNow))
    refresh(v)
    // Sounds (sounds.ts): planting + opening play AT the planter so neighbours hear them too
    const p = layout.get(v.boxId)
    const at = p ? { x: p.x, y: 1, z: p.z } : undefined
    if (live && !wasOwned && v.owner) playSfx('plant', at)
    if (live && !wasOpened && v.opened) playSfx('flowerOpen', at)
    if (live && wasMine && wasOpened && !v.owner) playSfx('harvest')
    if (!wasOpened && v.opened && isMine(v)) {
      const tierName = rarityTierById(v.rarityTier).name
      showToast(`Your ${flowerName(v)} opened!${v.rarityTier > 0 ? ` ${withArticle(tierName, true)} one!` : ''} Harvest it, or leave it on show.`, TOAST_MS, false)
    } else if (!wasMine && isMine(v) && !v.opened) {
      showToast('Seed planted — come back when it opens', TOAST_MS, false)
    }
  })

  setupGiftSystem()   // same post-room.clear() window as this system

  room.onMessage('pouchUpdate', (data) => {
    try { pouch = JSON.parse(data.countsJson) } catch { pouch = [] }
    setPouch(pouch)   // HUD chip + seed menu read the shared store
    for (const v of views.values()) if (!v.owner) TextShape.getMutable(v.label).text = labelFor(v)
  })

  setupSignSystem()
  setupPlantVfx()
  engine.addSystem(boxTickSystem)
  engine.addSystem(balloonStartSystem)
  engine.addSystem(plantRevealSystem)
  console.log(`[Boxes] ${views.size} seed boxes ready · boxState listeners=${room.listenerCount('boxState')}`)
}
