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
// holds a seed or an unharvested flower; a coloured sphere still stands in for the
// sprout/flower itself until those models land.
//
// Server communication (server is authoritative; the client only requests):
//   send    →  plantSeed   { boxId, rare }        empty box
//   send    →  harvestBox  { boxId }              my opened box  (Phase 4)
//   send    →  waterBox    { boxId }              someone else's growing box (Phase 4)
//   receive ←  boxState    { boxId, owner, ownerName, rare, plantedAt, opensAt, serverNow, opened, flower, waters, lastWaterer }
//   receive ←  pouchUpdate { normal, rare }   (my own seed counts)
// One world tap per box; what it does depends on whose box it is and its state.
// =============================================================

import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  Material,
  GltfContainer,
  ColliderLayer,
  TextShape,
  PointerEvents,
  pointerEventsSystem,
  InputAction,
  Animator,
  timers,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import { BOX_POSITIONS, BOX_WATER_MAX, BOX_MODEL_SRC, BOX_MODEL_SCALE, BOX_MODEL_RIM_Y, BALLOON_MODEL_SRC, BALLOON_ANIM_CLIPS, SEEDLING_MODEL_SRC } from './shared/config'
import { showToast } from './notifications'
import { setupGiftSystem } from './giftSystem'
import { setPouch, getBoxCap, nextSeedIsRare } from './playerInventory'
import { createSign, setupSignSystem } from './signs'

// ---------------------------------------------------------------
// Config (greybox visuals)
// ---------------------------------------------------------------

// Plaque standing at the planter's front edge, facing the garden (readers stand on +Z)
const PLAQUE_OFFSET_Z = 0.80
const PLAQUE_Y        = 0.42
const PLAQUE_SIZE     = { w: 1.25, h: 0.62 }
const PLAQUE_FONT     = 0.9
const SEEDLING_SCALE = 0.25
const FLOWER_SCALE  = 0.5
// Same palette for the growing seedling as the opened flower — a rarity hint before
// the reveal, not just after it.
const COLOR_SEEDLING_NORMAL = Color4.create(0.55, 0.85, 0.55, 1)   // growing, normal — soft green
const COLOR_SEEDLING_RARE   = Color4.create(1.0, 0.88, 0.45, 1)    // growing, rare — pale gold
const COLOR_NORMAL  = Color4.create(0.95, 0.55, 0.75, 1)   // opened, normal flower
const COLOR_RARE    = Color4.create(1.0, 0.82, 0.25, 1)    // opened, rare flower
const TOAST_MS      = 5_000
const LABEL_TICK_MS = 1_000
const TAP_DISTANCE  = 8     // m — mobile is third-person only, camera sits well behind the avatar
const BALLOON_ANIM_INIT_DELAY_MS = 1_000   // let the GLB load before starting the Animator

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface BoxView {
  boxId:        string
  base:         Entity
  label:        Entity
  plant:        Entity | null   // sprout or flower entity while planted
  balloon:      Entity | null   // animated balloon while the box holds a seed or flower
  owner:        string
  ownerName:    string
  rare:         boolean
  opened:       boolean
  flower:       string
  opensLocalAt: number          // local-clock ms; derived from opensAt − serverNow
  waters:       number
  lastWaterer:  string
}

const views  = new Map<string, BoxView>()
let   pouch  = { normal: 0, rare: 0 }
let   tickAccum = 0

function localId(): string { return (getPlayer()?.userId ?? '').toLowerCase() }
function isMine(v: BoxView): boolean { return !!v.owner && v.owner.toLowerCase() === localId() }
function myBoxCount(): number { let n = 0; for (const v of views.values()) if (isMine(v)) n++; return n }

// ---------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------

function labelFor(v: BoxView, now: number): string {
  if (!v.owner) {
    const have = pouch.normal + pouch.rare
    return have > 0 ? `Empty planter\nTap to plant (${have} seeds)` : 'Empty planter\nCatch a bloom seed'
  }
  const who = isMine(v) ? 'Your' : `${v.ownerName}'s`
  if (v.opened) return `${who} ${v.flower}${v.rare ? ' (rare)' : ''}${isMine(v) ? '\nTap to harvest' : ''}`
  const left = Math.max(0, v.opensLocalAt - now)
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000), s = Math.floor((left % 60_000) / 1_000)
  const t = h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`
  const watered = v.waters > 0 ? `\nwatered x${v.waters} by ${v.lastWaterer}` : ''
  return `${who} ${v.rare ? 'rare ' : ''}seed\nopens in ${t}${watered}`
}

/** Hover prompt for the one tap the box currently offers. */
function hoverFor(v: BoxView): string {
  if (!v.owner) return 'Plant seed'
  if (isMine(v)) return v.opened ? 'Harvest' : 'Growing…'
  if (v.opened) return `${v.ownerName}'s flower`
  return v.waters >= BOX_WATER_MAX ? 'Fully watered' : 'Water'
}

function setPlantVisual(v: BoxView, pos: { x: number; z: number }): void {
  if (v.plant !== null) { engine.removeEntity(v.plant); v.plant = null }
  if (!v.owner) return
  const e = engine.addEntity()

  if (!v.opened) {
    // Growing: KJ's seedling model, untextured — tinted per rarity in code so it
    // hints at what's coming before the flower is revealed.
    const k = SEEDLING_SCALE
    Transform.create(e, { position: { x: pos.x, y: BOX_MODEL_RIM_Y, z: pos.z }, scale: { x: k, y: k, z: k } })
    GltfContainer.create(e, { src: SEEDLING_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
    const c = v.rare ? COLOR_SEEDLING_RARE : COLOR_SEEDLING_NORMAL
    Material.setPbrMaterial(e, { albedoColor: c, emissiveColor: c, emissiveIntensity: 0.3 })
    v.plant = e
    return
  }

  // Opened: still the greybox flower sphere until a real flower model lands.
  const k = FLOWER_SCALE
  Transform.create(e, { position: { x: pos.x, y: BOX_MODEL_RIM_Y + k / 2, z: pos.z }, scale: { x: k, y: k, z: k } })
  MeshRenderer.setSphere(e)
  const c = v.rare ? COLOR_RARE : COLOR_NORMAL
  Material.setPbrMaterial(e, { albedoColor: c, emissiveColor: c, emissiveIntensity: 0.8 })
  v.plant = e
}

/** Create/remove the balloon on ownership change only — recreating it on every
 *  refresh() (every water, every tick) would restart its animation and pop. */
function setBalloonVisual(v: BoxView, pos: { x: number; z: number }): void {
  const wantBalloon = !!v.owner
  if (wantBalloon === (v.balloon !== null)) return
  if (!wantBalloon) {
    if (v.balloon !== null) engine.removeEntity(v.balloon)
    v.balloon = null
    return
  }
  const balloon = engine.addEntity()
  Transform.create(balloon, { position: { x: pos.x, y: 0, z: pos.z }, scale: { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE } })
  GltfContainer.create(balloon, { src: BALLOON_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  v.balloon = balloon
  timers.setTimeout(() => {
    if (v.balloon !== balloon) return   // box was emptied before the GLB finished loading
    Animator.createOrReplace(balloon, { states: BALLOON_ANIM_CLIPS.map(clip => ({ clip, playing: true, loop: true })) })
  }, BALLOON_ANIM_INIT_DELAY_MS)
}

function refresh(v: BoxView): void {
  const pos = BOX_POSITIONS.find(p => p.id === v.boxId)!
  setPlantVisual(v, pos)
  setBalloonVisual(v, pos)
  TextShape.getMutable(v.label).text = labelFor(v, Date.now())
  const pe = PointerEvents.getMutableOrNull(v.base)?.pointerEvents[0]?.eventInfo
  if (pe) pe.hoverText = hoverFor(v)
}

// ---------------------------------------------------------------
// Planting (world tap — GDD §6: "Tap an empty box, confirm. Large target, no drag.")
// ---------------------------------------------------------------

function tryPlant(v: BoxView): void {
  if (v.owner) return
  if (myBoxCount() >= getBoxCap()) {
    showToast(getBoxCap() === 1 ? 'You already have a box — harvest it when it opens' : `You already have ${getBoxCap()} boxes`, TOAST_MS, false)
    return
  }
  if (pouch.normal <= 0 && pouch.rare <= 0) {
    showToast('No seeds yet — catch some from a bloom', TOAST_MS, false)
    return
  }
  // One kind in the pouch → that kind; both → the player's choice in the seed menu.
  const rare = nextSeedIsRare() === true
  console.log(`[Boxes] planting ${rare ? 'RARE' : 'normal'} seed in ${v.boxId}`)
  room.send('plantSeed', { boxId: v.boxId, rare })
}

// Phase 4 — one tap, dispatched by whose box it is and its state.
// Server re-validates everything; these local checks only save a round trip.
function onTap(v: BoxView): void {
  if (!v.owner) { tryPlant(v); return }
  if (isMine(v)) {
    if (v.opened) { console.log(`[Boxes] harvesting ${v.boxId}`); room.send('harvestBox', { boxId: v.boxId }); return }
    showToast(`Still growing — ${labelFor(v, Date.now()).split('\n')[1]}`, TOAST_MS, false)
    return
  }
  if (v.opened) { showToast(`${v.ownerName}'s ${v.flower} — they'll harvest it`, TOAST_MS, false); return }
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

  const sign  = createSign({ x: p.x, y: PLAQUE_Y, z: p.z + PLAQUE_OFFSET_Z }, 180, PLAQUE_SIZE, PLAQUE_FONT)
  const label = sign.text

  const v: BoxView = { boxId: p.id, base, label, plant: null, balloon: null, owner: '', ownerName: '', rare: false, opened: false, flower: '', opensLocalAt: 0, waters: 0, lastWaterer: '' }
  pointerEventsSystem.onPointerDown(
    { entity: base, opts: { button: InputAction.IA_POINTER, hoverText: 'Plant seed', maxDistance: TAP_DISTANCE } },
    () => onTap(v),
  )
  return v
}

function boxTickSystem(dt: number): void {
  tickAccum += dt * 1_000
  if (tickAccum < LABEL_TICK_MS) return
  tickAccum = 0
  const now = Date.now()
  for (const v of views.values()) TextShape.getMutable(v.label).text = labelFor(v, now)
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
    v.rare      = data.rare
    v.opened    = data.opened
    v.flower    = data.flower
    v.waters      = data.waters
    v.lastWaterer = data.lastWaterer
    // Countdown from the server's own clock delta — clockSync is unreliable here
    v.opensLocalAt = Date.now() + (Number(data.opensAt) - Number(data.serverNow))
    refresh(v)
    if (!wasOpened && v.opened && isMine(v)) {
      showToast(`Your ${v.flower} opened! Tap the box to harvest it${v.rare ? ' — a rare one.' : '.'}`, TOAST_MS, false)
    } else if (!wasMine && isMine(v) && !v.opened) {
      showToast('Seed planted — come back when it opens', TOAST_MS, false)
    }
  })

  setupGiftSystem()   // same post-room.clear() window as this system

  room.onMessage('pouchUpdate', (data) => {
    pouch = { normal: data.normal, rare: data.rare }
    setPouch(pouch.normal, pouch.rare)   // HUD chip + seed menu read the shared store
    for (const v of views.values()) if (!v.owner) TextShape.getMutable(v.label).text = labelFor(v, Date.now())
  })

  setupSignSystem()
  engine.addSystem(boxTickSystem)
  console.log(`[Boxes] ${views.size} seed boxes ready · boxState listeners=${room.listenerCount('boxState')}`)
}
