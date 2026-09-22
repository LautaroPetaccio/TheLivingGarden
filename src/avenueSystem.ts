// =============================================================
// Bloom Garden v2 — The Avenue (CLIENT ONLY)
//
// design/communal-planters.md (2026-09-22): 72 wall planters along the entrance, holding
// harvested Rare+ flowers. A gallery, not a garden — nothing grows or wilts here, the
// flower is simply on show with its owner's name until they take it back (or the
// crowding rule returns it to My flowers). The planters themselves are part of
// scene.glb; this file only adds the tap box, the flower and a pooled plaque per slot.
//
// Server communication (server is authoritative; the client only requests):
//   send    →  displayFlower { slotId, flowerIndex }   slotId '' = first free slot
//   send    →  recallFlower  { slotId }                my own slot
//   send    →  inspectAvenue { slotId }                counts a look (card in Phase 3)
//   receive ←  avenueState   { slotId, owner, ownerName, flower, rarityTier, since,
//                              grownBy, openedAt, helpersJson, giftedBy, looks }
// One world tap per slot: empty + flower in hand → display it here; empty + empty hand →
// the seed menu opens on Flowers for this slot; mine → tap twice to take it back;
// someone else's → inspect.
// =============================================================

import {
  engine, Entity, Transform, GltfContainer, GltfContainerLoadingState, GltfNodeModifiers,
  ColliderLayer, MeshCollider, TextShape, Material, MaterialTransparencyMode,
  pointerEventsSystem, InputAction,
} from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import {
  AVENUE_POSITIONS, AVENUE_CUBE_FRONT_OFFSET, AVENUE_CUBE_HEIGHT, AVENUE_FLOWER_SCALE,
  AVENUE_WILD_TINT, PLANT_SPECIES, PlantSpecies, plantSpeciesById, rarityTierById,
} from './shared/config'
import { PLANT_MATERIALS } from './plantMaterials'
import { showToast } from './notifications'
import { attachPlantVfx, detachPlantVfx } from './plantVfx'
import { getHeld, heldFlowerIndex, registerAvenueApi } from './playerInventory'
import { openSeedMenuForAvenue } from './seedMenu'
import { createSign, moveSign, Sign } from './signs'
import { showAvenueCard, closeAvenueCard, isAvenueCardOpen } from './avenueCard'
import { playSfx } from './sounds'

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

const TAP_DISTANCE   = 8
const TOAST_MS       = 5_000
// Tap box = the cube's own body (soil − cube height → a little above the soil), 5 cm
// proud of the cube's front so it beats the wall's collider. It must NOT reach up into the
// row above: rows are 0.65 m apart and the first cut (0.5 m box ABOVE each soil) overlapped
// the cube above it, so the whole wall read as one target (KJ 2026-09-22).
const HIT_ABOVE_SOIL = 0.18
const HIT_SIZE       = { x: 0.54, y: AVENUE_CUBE_HEIGHT + HIT_ABOVE_SOIL, z: AVENUE_CUBE_FRONT_OFFSET + 0.05 }
// Plaque on the cube's front face, just proud of it, centred on the face
const PLAQUE_OUT     = AVENUE_CUBE_FRONT_OFFSET + 0.02
const PLAQUE_DROP    = AVENUE_CUBE_HEIGHT / 2
const PLAQUE_SIZE    = { w: 0.6, h: 0.26 }
const PLAQUE_FONT    = 0.32   // TUNING — two short lines on a 0.6 × 0.26 board
// Pooled like boxSystem's: signs.ts shows the nearest 8 within 9 m anyway
const PLAQUE_POOL    = 8
const PLAQUE_RANGE_M = 12
const PLAQUE_SCAN_MS = 400
const LS_FINISHED    = 4   // LoadingState (const enum in @dcl/ecs internals, not re-exported —
                            // same local copy plantVfx.ts and boxSystem.ts each keep)

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

type SlotPos = { x: number; y: number; z: number; rot: number }

interface SlotView {
  slotId:     string
  pos:        SlotPos
  hit:        Entity
  plant:      Entity | null
  plantKey:   string
  labelText:  string
  owner:      string
  ownerName:  string
  flower:     string
  rarityTier: number
  since:      number
  grownBy:    string
  openedAt:   number
  helpers:    string[]
  giftedBy:   string
  looks:      number
}
interface Plaque { sign: Sign; slotId: string | null }

const views   = new Map<string, SlotView>()
const plaques: Plaque[] = []
const synced  = new Set<string>()   // had the join snapshot — no sounds for that one
// Wild-bloom GLBs waiting for their model to finish loading before the dim tint can be
// applied (GltfNodeModifiers paths only resolve against an already-instantiated
// hierarchy — same load-order gotcha plantVfx.ts documents for the rarity pulse).
const pendingWildTint = new Map<Entity, PlantSpecies>()
let   plaqueAccum = 0

function localId(): string { return (getPlayer()?.userId ?? '').toLowerCase() }
function isMine(v: SlotView): boolean { return !!v.owner && v.owner.toLowerCase() === localId() }
function speciesName(id: string): string { return plantSpeciesById(id)?.name ?? id }
/** Out of the wall into the avenue, along the slot's facing (rot 0 = +z). */
function outward(pos: SlotPos, d: number): { x: number; z: number } {
  const r = (pos.rot * Math.PI) / 180
  return { x: pos.x + d * Math.sin(r), z: pos.z + d * Math.cos(r) }
}
function slotPoint(pos: SlotPos, lx: number, lz: number): { x: number; z: number } {
  const r = (pos.rot * Math.PI) / 180
  return { x: pos.x + lx * Math.cos(r) + lz * Math.sin(r), z: pos.z - lx * Math.sin(r) + lz * Math.cos(r) }
}

/** Public read for the inspect card (Phase 3) and the test panel. */
export function getAvenueSlot(slotId: string): Readonly<SlotView> | undefined { return views.get(slotId) }
export function avenueSlotIds(): string[] { return [...views.keys()] }

/** Onboarding: the nearest EMPTY slot to a point — mirrors boxSystem's
 *  nearestFreePlanter, same purpose (a shell highlight to make one findable among 72). */
export function nearestFreeAvenueSlot(from: { x: number; z: number }): { slotId: string; x: number; y: number; z: number; rot: number } | null {
  let best: { slotId: string; x: number; y: number; z: number; rot: number } | null = null
  let bestSq = Infinity
  for (const v of views.values()) {
    if (v.owner) continue
    const dx = v.pos.x - from.x, dz = v.pos.z - from.z
    const sq = dx * dx + dz * dz
    if (sq < bestSq) { bestSq = sq; best = { slotId: v.slotId, x: v.pos.x, y: v.pos.y, z: v.pos.z, rot: v.pos.rot } }
  }
  return best
}

// ---------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------

function labelFor(v: SlotView): string {
  // design/communal-planters.md: an empty slot holds a system-owned wild bloom, and its
  // plaque says so — "Unclaimed" is the one word that can't be mistaken for a real display.
  if (!v.owner) return 'Unclaimed\ntap to plant here'
  const tier = v.rarityTier > 0 ? rarityTierById(v.rarityTier).name + ' ' : ''
  return `${v.ownerName}\n${tier}${speciesName(v.flower)}`
}

/** Deterministic filler species for an empty slot — same flower for every viewer, stable
 *  across reloads, no server round trip needed (it's decoration, not state). */
function wildSpeciesFor(slotId: string): PlantSpecies {
  let h = 0
  for (let i = 0; i < slotId.length; i++) h = (h * 31 + slotId.charCodeAt(i)) >>> 0
  return PLANT_SPECIES[h % PLANT_SPECIES.length]
}

/** Dim a wild bloom's real material so it never reads as someone's genuine display —
 *  same GltfNodeModifiers mechanism plantVfx.ts uses for the rarity pulse (a `Material`
 *  component on the GltfContainer entity itself does not retint an imported mesh). */
function applyWildTint(e: Entity, species: PlantSpecies): void {
  const mats = PLANT_MATERIALS[species.id]
  if (!mats || mats.length === 0) return
  GltfNodeModifiers.create(e, {
    modifiers: mats.map(m => {
      const tex = m.texture ? Material.Texture.Common({ src: m.texture }) : undefined
      return {
        // ONE mesh node → GLOBAL modifier (path ''): the single-root GLB gotcha
        // plantVfx.ts documents (a named path fails to resolve on a single-mesh model).
        path: mats.length === 1 ? '' : m.path,
        material: { material: { $case: 'pbr' as const, pbr: {
          texture: tex,
          albedoColor: { r: m.color[0] * AVENUE_WILD_TINT, g: m.color[1] * AVENUE_WILD_TINT, b: m.color[2] * AVENUE_WILD_TINT, a: m.color[3] },
          transparencyMode: m.blend ? MaterialTransparencyMode.MTM_ALPHA_BLEND : MaterialTransparencyMode.MTM_OPAQUE,
          metallic: 0, roughness: 1,   // flat and matte — the opposite of a rarity pulse's shine
        } } },
      }
    }),
  })
}

/** Retry each pending wild bloom until its GLB has actually loaded (usually one or two
 *  ticks after spawn) — same wait plantVfx.ts's pulse does, just applied once, not budgeted. */
function wildTintSystem(): void {
  if (pendingWildTint.size === 0) return
  for (const [e, species] of pendingWildTint) {
    if (GltfContainerLoadingState.getOrNull(e)?.currentState !== LS_FINISHED) continue
    applyWildTint(e, species)
    pendingWildTint.delete(e)
  }
}

/** Empty slot: a system-owned filler flower (design/communal-planters.md "wild bloom") —
 *  no attribution, dimmed, replaced the instant a player plants here. */
function setWildBloom(v: SlotView): void {
  const species = wildSpeciesFor(v.slotId)
  const k  = species.scale * AVENUE_FLOWER_SCALE
  const at = slotPoint(v.pos, species.offsetX * AVENUE_FLOWER_SCALE, species.offsetZ * AVENUE_FLOWER_SCALE)
  const e  = engine.addEntity()
  Transform.create(e, { position: { x: at.x, y: v.pos.y + species.baseYOffset * AVENUE_FLOWER_SCALE, z: at.z }, rotation: Quaternion.fromEulerDegrees(0, v.pos.rot, 0), scale: { x: k, y: k, z: k } })
  GltfContainer.create(e, { src: species.modelSrc, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  v.plant = e
  pendingWildTint.set(e, species)
}

function setPlantVisual(v: SlotView): void {
  const key = v.owner ? `${v.flower}|${v.rarityTier}` : `wild:${v.slotId}`
  if (key === v.plantKey) return
  v.plantKey = key
  detachPlantVfx(`av:${v.slotId}`)
  if (v.plant !== null) { pendingWildTint.delete(v.plant); engine.removeEntity(v.plant); v.plant = null }
  if (!v.owner) { setWildBloom(v); return }
  const species = plantSpeciesById(v.flower)
  if (!species) return
  const k  = species.scale * AVENUE_FLOWER_SCALE
  const at = slotPoint(v.pos, species.offsetX * AVENUE_FLOWER_SCALE, species.offsetZ * AVENUE_FLOWER_SCALE)
  const e  = engine.addEntity()
  Transform.create(e, { position: { x: at.x, y: v.pos.y + species.baseYOffset * AVENUE_FLOWER_SCALE, z: at.z }, rotation: Quaternion.fromEulerDegrees(0, v.pos.rot, 0), scale: { x: k, y: k, z: k } })
  GltfContainer.create(e, { src: species.modelSrc, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  attachPlantVfx(`av:${v.slotId}`, e, species.id, v.rarityTier, { x: v.pos.x, y: v.pos.y, z: v.pos.z })
  v.plant = e
}

function setLabel(v: SlotView, text: string): void {
  if (v.labelText === text) return
  v.labelText = text
  const pl = plaques.find(q => q.slotId === v.slotId)
  if (pl) TextShape.getMutable(pl.sign.text).text = text
}

function refresh(v: SlotView): void {
  setPlantVisual(v)
  setLabel(v, labelFor(v))
}

function placePlaque(pl: Plaque, pos: SlotPos): void {
  const at = outward(pos, PLAQUE_OUT)
  moveSign(pl.sign, { x: at.x, y: pos.y - PLAQUE_DROP, z: at.z })
  Transform.getMutable(pl.sign.root).rotation = Quaternion.fromEulerDegrees(0, (180 + pos.rot) % 360, 0)   // reader stands out in the avenue
}
function freePlaque(pl: Plaque): void { pl.slotId = null; moveSign(pl.sign, { x: 0, y: -50, z: 0 }) }

/** Keep the pool on the nearest slots (same scheme as boxSystem's plaqueHomeSystem). */
function plaqueHomeSystem(dt: number): void {
  plaqueAccum += dt * 1_000
  if (plaqueAccum < PLAQUE_SCAN_MS) return
  plaqueAccum = 0
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  const wanted = new Set([...views.values()]
    .map(v => ({ id: v.slotId, d: Math.hypot(v.pos.x - me.x, v.pos.z - me.z) }))
    .filter(r => r.d <= PLAQUE_RANGE_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, PLAQUE_POOL)
    .map(r => r.id))
  for (const pl of plaques) if (pl.slotId !== null && !wanted.has(pl.slotId)) freePlaque(pl)
  for (const id of wanted) {
    if (plaques.some(q => q.slotId === id)) continue
    const pl = plaques.find(q => q.slotId === null)
    const v = views.get(id)
    if (!pl || !v) break
    pl.slotId = id
    placePlaque(pl, v.pos)
    TextShape.getMutable(pl.sign.text).text = v.labelText
  }
}

// ---------------------------------------------------------------
// Tap
// ---------------------------------------------------------------

function onTap(v: SlotView): void {
  if (!v.owner) {
    const idx = getHeld() ? heldFlowerIndex() : null
    if (idx !== null) { console.log(`[Avenue] displaying keepsake ${idx} at ${v.slotId}`); room.send('displayFlower', { slotId: v.slotId, flowerIndex: idx }); return }
    openSeedMenuForAvenue(v.slotId)
    return
  }
  if (!isMine(v)) room.send('inspectAvenue', { slotId: v.slotId })   // a look is someone else stopping by
  openCard(v)
}

let openCardSlot = ''
/** The inspect card — everything this one flower remembers, and a camera move onto it. */
function openCard(v: SlotView): void {
  openCardSlot = v.slotId
  showAvenueCard({
    slotId: v.slotId, ownerName: v.ownerName, flower: v.flower, rarityTier: v.rarityTier,
    since: v.since, grownBy: v.grownBy, openedAt: v.openedAt, helpers: v.helpers,
    giftedBy: v.giftedBy, looks: v.looks, mine: isMine(v),
    at: { x: v.pos.x, y: v.pos.y, z: v.pos.z },
  }, () => { console.log(`[Avenue] recalling ${v.slotId}`); room.send('recallFlower', { slotId: v.slotId }) })
}

function createSlot(p: SlotPos & { id: string }): SlotView {
  const hit = engine.addEntity()
  const c = outward(p, HIT_SIZE.z / 2)   // box runs from the soil centre out past the cube front
  Transform.create(hit, { position: { x: c.x, y: p.y + HIT_ABOVE_SOIL - HIT_SIZE.y / 2, z: c.z }, rotation: Quaternion.fromEulerDegrees(0, p.rot, 0), scale: HIT_SIZE })
  MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)   // the wall itself already blocks walking
  const v: SlotView = { slotId: p.id, pos: p, hit, plant: null, plantKey: '', labelText: '', owner: '', ownerName: '', flower: '', rarityTier: 0, since: 0, grownBy: '', openedAt: 0, helpers: [], giftedBy: '', looks: 0 }
  pointerEventsSystem.onPointerDown(
    { entity: hit, opts: { button: InputAction.IA_POINTER, hoverText: 'Avenue planter', maxDistance: TAP_DISTANCE } },
    () => onTap(v),
  )
  return v
}

// ---------------------------------------------------------------
// Setup — MUST be called after wateringSystem's room.clear()
// ---------------------------------------------------------------

export function setupAvenueSystem(): void {
  if (AVENUE_POSITIONS.length === 0) return
  for (let i = 0; i < PLAQUE_POOL; i++) plaques.push({ sign: createSign({ x: 0, y: -50, z: 0 }, 0, PLAQUE_SIZE, PLAQUE_FONT, true), slotId: null })
  for (const p of AVENUE_POSITIONS) views.set(p.id, createSlot(p))

  room.onMessage('avenueState', (data) => {
    const v = views.get(data.slotId)
    if (!v) return
    const live     = synced.has(v.slotId)
    const wasOwned = !!v.owner
    const wasMine  = isMine(v)
    synced.add(v.slotId)
    v.owner = data.owner; v.ownerName = data.ownerName
    v.flower = data.flower; v.rarityTier = data.rarityTier; v.since = Number(data.since)
    v.grownBy = data.grownBy; v.openedAt = Number(data.openedAt); v.giftedBy = data.giftedBy; v.looks = data.looks
    try { v.helpers = JSON.parse(data.helpersJson) } catch { v.helpers = [] }
    refresh(v)
    if (isAvenueCardOpen() && openCardSlot === v.slotId) { if (v.owner) openCard(v); else closeAvenueCard() }
    const at = { x: v.pos.x, y: v.pos.y, z: v.pos.z }
    if (live && !wasOwned && v.owner) playSfx('plant', at)
    if (live && wasMine && !v.owner) playSfx('harvest')
  })

  registerAvenueApi({
    display: (slotId, flowerIndex) => room.send('displayFlower', { slotId, flowerIndex }),
    recall:  (slotId) => room.send('recallFlower', { slotId }),
  })
  engine.addSystem(plaqueHomeSystem)
  engine.addSystem(wildTintSystem)
  console.log(`[Avenue] ${views.size} slots ready · avenueState listeners=${room.listenerCount('avenueState')}`)
}

// ---------------------------------------------------------------
// Admin test tools (test panel only — see testPanel.tsx)
// ---------------------------------------------------------------

/** Fill empty Avenue slots with real, persisted, Rare+ flowers so the Avenue can be
 *  playtested without a genuine harvest chain. count 0/omitted = the server's default. */
export function adminFillAvenue(count = 8): void { room.send('adminFillAvenue', { count }) }
/** Empty every Avenue slot the admin filled with adminFillAvenue — never touches a real
 *  player's display (server-enforced: only the admin's own slots). */
export function adminClearAvenue(): void { room.send('adminClearAvenue', {}) }
