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
import { BOX_POSITIONS, BOX_WATER_MAX, BOX_MODEL_SRC, BOX_MODEL_SCALE, BOX_MODEL_RIM_Y, BALLOON_MODEL_SRC, BALLOON_ANIM_CLIPS, SEEDLING_MODEL_SRC_NORMAL, SEEDLING_MODEL_SRC_RARE, rarityTierById, plantSpeciesById } from './shared/config'
import { showToast } from './notifications'
import { attachPlantVfx, detachPlantVfx, setupPlantVfx } from './plantVfx'
import { setupGiftSystem } from './giftSystem'
import { setPouch, getBoxCap, nextSeedTier } from './playerInventory'
import { createSign, setupSignSystem } from './signs'
import { BALLOON_TEXT_TRACK } from './balloonTextTrack'

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
  label:        Entity
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

function setPlantVisual(v: BoxView, pos: { x: number; z: number }): void {
  detachPlantVfx(v.boxId)
  if (v.plant !== null) { retirePlant(v.plant); v.plant = null }
  if (!v.owner) return
  const e = engine.addEntity()

  if (!v.opened) {
    // Growing: KJ's seedling model — only a normal/rare tint is baked into art so
    // far (SEEDLING_MODEL_SRC_NORMAL/_RARE), so tier 0 (Common) gets normal and
    // everything above it borrows the rare variant until per-tier seedling art exists.
    const k = SEEDLING_SCALE
    Transform.create(e, { position: { x: pos.x, y: BOX_MODEL_RIM_Y - SEEDLING_MODEL_MIN_Y * k, z: pos.z }, scale: { x: k, y: k, z: k } })
    const src = v.rarityTier > 0 ? SEEDLING_MODEL_SRC_RARE : SEEDLING_MODEL_SRC_NORMAL
    GltfContainer.create(e, { src, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    v.plant = e
    return
  }

  // Opened: the real species model, normalised from its own geometry (PLANT_SPECIES
  // scale/offsets); rarity effects are layered on by plantVfx.
  const species = plantSpeciesById(v.flower)
  if (species) {
    Transform.create(e, { position: { x: pos.x + species.offsetX, y: BOX_MODEL_RIM_Y + species.baseYOffset, z: pos.z + species.offsetZ }, scale: { x: species.scale, y: species.scale, z: species.scale } })
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

/** One pooled balloon per box, created once and never removed — shown/hidden by scale.
 *  Removing it made the Unity explorer's ResetMaterialSystem throw (it restores the
 *  Text.002 override's material on a GLB already being torn down — KJ log 2026-09-18
 *  15:40, on harvest), and every replant re-loaded the GLB and re-synced its clip. */
function setBalloonVisual(v: BoxView, pos: { x: number; z: number }): void {
  if (v.balloon === null) createBalloon(v, pos)
  const k = v.owner ? BOX_MODEL_SCALE : 0
  const tr = Transform.getMutable(v.balloon!)
  if (tr.scale.x !== k) tr.scale = { x: k, y: k, z: k }
}

function createBalloon(v: BoxView, pos: { x: number; z: number }): void {
  const balloon = engine.addEntity()
  Transform.create(balloon, { position: { x: pos.x, y: 0, z: pos.z }, scale: { x: 0, y: 0, z: 0 } })
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
    const p = BOX_POSITIONS.find(b => b.id === v.boxId)!
    const d = me ? (p.x - me.x) ** 2 + (p.z - me.z) ** 2 : 0
    if (d < bestD) { bestD = d; best = v }
  }
  if (best === null) return
  pendingPlant.delete(best)
  setPlantVisual(best, BOX_POSITIONS.find(b => b.id === best!.boxId)!)
  best.plantKey = plantKeyFor(best)
}

function refresh(v: BoxView): void {
  const pos = BOX_POSITIONS.find(p => p.id === v.boxId)!
  if (plantKeyFor(v) !== v.plantKey) pendingPlant.add(v)   // built by plantRevealSystem
  setBalloonVisual(v, pos)
  if (v.balloonText !== null) TextShape.getMutable(v.balloonText).text = balloonTextFor(v, Date.now())
  TextShape.getMutable(v.label).text = labelFor(v)
  const pe = PointerEvents.getMutableOrNull(v.base)?.pointerEvents[0]?.eventInfo
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

function createBox(p: { id: string; x: number; z: number }): BoxView {
  // KJ's planter template. The GLB has no _collider mesh, so the visible meshes
  // carry both pointer (tap) and physics (walkable) collision.
  const base = engine.addEntity()
  Transform.create(base, { position: { x: p.x, y: 0, z: p.z }, scale: { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE } })
  GltfContainer.create(base, { src: BOX_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_POINTER | ColliderLayer.CL_PHYSICS })

  const sign  = createSign({ x: p.x, y: PLAQUE_Y, z: p.z + PLAQUE_OFFSET_Z }, 180, PLAQUE_SIZE, PLAQUE_FONT, false)
  const label = sign.text

  const v: BoxView = { boxId: p.id, base, label, plant: null, plantKey: '', balloon: null, balloonText: null, balloonMover: null, balloonPivot: null, balloonAnimPending: false, owner: '', ownerName: '', rarityTier: 0, opened: false, flower: '', opensLocalAt: 0, waters: 0, lastWaterer: '' }
  pointerEventsSystem.onPointerDown(
    { entity: base, opts: { button: InputAction.IA_POINTER, hoverText: 'Plant seed', maxDistance: TAP_DISTANCE } },
    () => onTap(v),
  )
  return v
}

/** Test-panel only: force two boxes into the growing state so the rarity-tinted
 *  seedling colors can be compared side by side without waiting on real timers.
 *  Client-only, cosmetic — the next boxState broadcast (or a rejoin) overwrites it. */
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
  demo('box_1', 0)
  demo('box_2', 3)
  console.log('[Boxes] demo seedlings: box_1 = Common, box_2 = Epic — the next real box update clears it')
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
  for (const p of BOX_POSITIONS) views.set(p.id, createBox(p))

  room.onMessage('boxState', (data) => {
    const v = views.get(data.boxId)
    if (!v) return
    const wasOpened = v.opened
    const wasMine   = isMine(v)
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
    if (!wasOpened && v.opened && isMine(v)) {
      const tierName = rarityTierById(v.rarityTier).name
      showToast(`Your ${flowerName(v)} opened!${v.rarityTier > 0 ? ` A ${tierName} one!` : ''} Harvest it, or leave it on show.`, TOAST_MS, false)
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
