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
import { BALLOON_TEXT_TRACK, BALLOON_TRACK_DURATION_S } from './balloonTextTrack'

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
  balloonText:  Entity | null   // countdown / "Ready to Harvest" on the balloon
  balloonAnimStart: number      // local ms the balloon Animator started (0 = not yet) — text follows it
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
  if (isMine(v)) return v.opened ? 'Harvest' : 'Growing…'
  if (v.opened) return `${v.ownerName}'s flower`
  return v.waters >= BOX_WATER_MAX ? 'Fully watered' : 'Water'
}

function setPlantVisual(v: BoxView, pos: { x: number; z: number }): void {
  detachPlantVfx(v.boxId)
  if (v.plant !== null) { engine.removeEntity(v.plant); v.plant = null }
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

/** Create/remove the balloon on ownership change only — recreating it on every
 *  refresh() (every water, every tick) would restart its animation and pop. */
function setBalloonVisual(v: BoxView, pos: { x: number; z: number }): void {
  const wantBalloon = !!v.owner
  if (wantBalloon === (v.balloon !== null)) return
  if (!wantBalloon) {
    if (v.balloon !== null) engine.removeEntityWithChildren(v.balloon)
    v.balloon = null
    v.balloonText = null
    return
  }
  const balloon = engine.addEntity()
  Transform.create(balloon, { position: { x: pos.x, y: 0, z: pos.z }, scale: { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE } })
  GltfContainer.create(balloon, { src: BALLOON_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  // Hide the baked "Harvest in" mesh (KJ's GLB left untouched) — the live text below replaces it
  GltfNodeModifiers.create(balloon, { modifiers: [{
    path: BALLOON_TEXT_NODE, castShadows: false,
    material: { material: { $case: 'pbr', pbr: { albedoColor: { r: 1, g: 1, b: 1, a: 0 }, transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND } } },
  }] })
  const text = engine.addEntity()
  Transform.create(text, { parent: balloon, position: BALLOON_TEXT_POS, rotation: Quaternion.fromEulerDegrees(0, 180, 0) })
  TextShape.create(text, { text: balloonTextFor(v, Date.now()), fontSize: BALLOON_TEXT_FONT, textColor: BALLOON_TEXT_COLOR, textAlign: TextAlignMode.TAM_MIDDLE_CENTER })
  v.balloon = balloon
  v.balloonText = text
  v.balloonAnimStart = 0
  timers.setTimeout(() => {
    if (v.balloon !== balloon) return   // box was emptied before the GLB finished loading
    Animator.createOrReplace(balloon, { states: BALLOON_ANIM_CLIPS.map(clip => ({ clip, playing: true, loop: true })) })
    v.balloonAnimStart = Date.now()
  }, BALLOON_ANIM_INIT_DELAY_MS)
}

function refresh(v: BoxView): void {
  const pos = BOX_POSITIONS.find(p => p.id === v.boxId)!
  setPlantVisual(v, pos)
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
    showToast(getBoxCap() === 1 ? 'You already have a box — harvest it when it opens' : `You already have ${getBoxCap()} boxes`, TOAST_MS, false)
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
  if (v.opened) { showToast(`${v.ownerName}'s ${flowerName(v)} — they'll harvest it`, TOAST_MS, false); return }
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

  const v: BoxView = { boxId: p.id, base, label, plant: null, balloon: null, balloonText: null, balloonAnimStart: 0, owner: '', ownerName: '', rarityTier: 0, opened: false, flower: '', opensLocalAt: 0, waters: 0, lastWaterer: '' }
  pointerEventsSystem.onPointerDown(
    { entity: base, opts: { button: InputAction.IA_POINTER, hoverText: 'Plant seed', maxDistance: TAP_DISTANCE } },
    () => onTap(v),
  )
  return v
}

/** Test-panel only: force two boxes into the growing state so the rarity-tinted
 *  seedling colors can be compared side by side without waiting on real timers.
 *  Client-only, cosmetic — the next boxState broadcast (or a rejoin) overwrites it. */
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
  for (const v of views.values()) if (v.balloonText !== null) TextShape.getMutable(v.balloonText).text = balloonTextFor(v, now)
}

const TEXT_FACING = Quaternion.fromEulerDegrees(0, 180, 0)

/** Every frame: replay the balloon bone's motion on its countdown text (BALLOON_TEXT_TRACK). */
function balloonTextFollowSystem(): void {
  const now = Date.now()
  for (const v of views.values()) {
    if (v.balloonText === null || v.balloonAnimStart === 0) continue
    const t = ((now - v.balloonAnimStart) / 1000) % BALLOON_TRACK_DURATION_S
    let i = 0
    while (i < BALLOON_TEXT_TRACK.length - 2 && BALLOON_TEXT_TRACK[i + 1][0] <= t) i++
    const a = BALLOON_TEXT_TRACK[i], b = BALLOON_TEXT_TRACK[i + 1]
    const u = Math.min(1, Math.max(0, (t - a[0]) / (b[0] - a[0])))
    const lp = (k: number) => a[k] + (b[k] - a[k]) * u
    const rot = Quaternion.slerp(Quaternion.create(a[4], a[5], a[6], a[7]), Quaternion.create(b[4], b[5], b[6], b[7]), u)
    const tr = Transform.getMutable(v.balloonText)
    tr.position = { x: lp(1), y: lp(2), z: lp(3) }
    tr.rotation = Quaternion.multiply(rot, TEXT_FACING)
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
      showToast(`Your ${flowerName(v)} opened!${v.rarityTier > 0 ? ` A ${tierName} one!` : ''} Tap the box to harvest it.`, TOAST_MS, false)
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
  engine.addSystem(balloonTextFollowSystem)
  console.log(`[Boxes] ${views.size} seed boxes ready · boxState listeners=${room.listenerCount('boxState')}`)
}
