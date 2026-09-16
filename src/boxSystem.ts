// =============================================================
// Bloom Garden v2 — Seed Boxes (CLIENT ONLY, greybox)
//
// GDD §3 step 4 / §4.1 / §4.3 "seed appointment": tap an empty box to
// plant a caught seed; the box takes your name and grows on a real-world
// timer; when it opens, the mystery flower is revealed. This is the D1
// return hook, so the box, its name, its sprout and its countdown must all
// be visible in the shared garden — to everyone.
//
// Greybox pass: a brown box with a floating label; a green sprout while
// growing; a coloured sphere as the flower. Real models come in the FX phase.
//
// Server communication (server is authoritative; the client only requests):
//   send    →  plantSeed  { boxId, rare }
//   receive ←  boxState   { boxId, owner, ownerName, rare, plantedAt, opensAt, serverNow, opened, flower }
//   receive ←  pouchUpdate { normal, rare }   (my own seed counts)
// =============================================================

import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  Material,
  TextShape,
  Billboard,
  BillboardMode,
  pointerEventsSystem,
  InputAction,
} from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import { BOX_POSITIONS } from './shared/config'
import { showToast } from './notifications'

// ---------------------------------------------------------------
// Config (greybox visuals)
// ---------------------------------------------------------------

const BOX_SIZE      = { x: 0.9, y: 0.45, z: 0.9 }
const BOX_Y         = 0.225
const LABEL_Y       = 1.35
const SPROUT_SCALE  = 0.25
const FLOWER_SCALE  = 0.5
const COLOR_BOX     = Color4.create(0.45, 0.30, 0.18, 1)
const COLOR_BOX_MINE = Color4.create(0.55, 0.40, 0.22, 1)
const COLOR_SPROUT  = Color4.create(0.35, 0.75, 0.35, 1)
const COLOR_NORMAL  = Color4.create(0.95, 0.55, 0.75, 1)   // opened, normal flower
const COLOR_RARE    = Color4.create(1.0, 0.82, 0.25, 1)    // opened, rare flower
const TOAST_MS      = 5_000
const LABEL_TICK_MS = 1_000

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface BoxView {
  boxId:        string
  base:         Entity
  label:        Entity
  plant:        Entity | null   // sprout or flower entity while planted
  owner:        string
  ownerName:    string
  rare:         boolean
  opened:       boolean
  flower:       string
  opensLocalAt: number          // local-clock ms; derived from opensAt − serverNow
}

const views  = new Map<string, BoxView>()
let   pouch  = { normal: 0, rare: 0 }
let   tickAccum = 0

export function getPouch(): { normal: number; rare: number } { return { ...pouch } }

function localId(): string { return (getPlayer()?.userId ?? '').toLowerCase() }
function isMine(v: BoxView): boolean { return !!v.owner && v.owner.toLowerCase() === localId() }

// ---------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------

function labelFor(v: BoxView, now: number): string {
  if (!v.owner) {
    const have = pouch.normal + pouch.rare
    return have > 0 ? `Empty box\nTap to plant a seed (${have} in pouch)` : 'Empty box\nCatch a bloom seed to plant'
  }
  const who = isMine(v) ? 'Your' : `${v.ownerName}'s`
  if (v.opened) return `${who} ${v.flower}${v.rare ? ' (rare)' : ''}`
  const left = Math.max(0, v.opensLocalAt - now)
  const h = Math.floor(left / 3_600_000), m = Math.floor((left % 3_600_000) / 60_000), s = Math.floor((left % 60_000) / 1_000)
  const t = h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`
  return `${who} ${v.rare ? 'rare ' : ''}seed\nopens in ${t}`
}

function setPlantVisual(v: BoxView, pos: { x: number; z: number }): void {
  if (v.plant !== null) { engine.removeEntity(v.plant); v.plant = null }
  if (!v.owner) return
  const e = engine.addEntity()
  const k = v.opened ? FLOWER_SCALE : SPROUT_SCALE
  Transform.create(e, { position: { x: pos.x, y: BOX_Y + BOX_SIZE.y / 2 + k / 2, z: pos.z }, scale: { x: k, y: k, z: k } })
  MeshRenderer.setSphere(e)
  const c = v.opened ? (v.rare ? COLOR_RARE : COLOR_NORMAL) : COLOR_SPROUT
  Material.setPbrMaterial(e, { albedoColor: c, emissiveColor: c, emissiveIntensity: v.opened ? 0.8 : 0.3 })
  v.plant = e
}

function refresh(v: BoxView): void {
  const pos = BOX_POSITIONS.find(p => p.id === v.boxId)!
  Material.setPbrMaterial(v.base, { albedoColor: isMine(v) ? COLOR_BOX_MINE : COLOR_BOX })
  setPlantVisual(v, pos)
  TextShape.getMutable(v.label).text = labelFor(v, Date.now())
}

// ---------------------------------------------------------------
// Planting (world tap — GDD §6: "Tap an empty box, confirm. Large target, no drag.")
// ---------------------------------------------------------------

function tryPlant(v: BoxView): void {
  if (v.owner) return
  if (pouch.normal <= 0 && pouch.rare <= 0) {
    showToast('No seeds yet — catch some from a bloom', TOAST_MS, false)
    return
  }
  // Plant a normal seed when you have one; rares only when that's all you hold.
  // (An explicit choice UI can come with the box art.)
  const rare = pouch.normal <= 0
  console.log(`[Boxes] planting ${rare ? 'RARE' : 'normal'} seed in ${v.boxId}`)
  room.send('plantSeed', { boxId: v.boxId, rare })
}

// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------

function createBox(p: { id: string; x: number; z: number }): BoxView {
  const base = engine.addEntity()
  Transform.create(base, { position: { x: p.x, y: BOX_Y, z: p.z }, scale: BOX_SIZE })
  MeshRenderer.setBox(base)
  MeshCollider.setBox(base)
  Material.setPbrMaterial(base, { albedoColor: COLOR_BOX })

  const label = engine.addEntity()
  Transform.create(label, { position: { x: p.x, y: LABEL_Y, z: p.z } })
  TextShape.create(label, { text: '', fontSize: 1.6, textColor: Color4.White(), outlineWidth: 0.1, outlineColor: Color4.Black() })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })

  const v: BoxView = { boxId: p.id, base, label, plant: null, owner: '', ownerName: '', rare: false, opened: false, flower: '', opensLocalAt: 0 }
  pointerEventsSystem.onPointerDown(
    { entity: base, opts: { button: InputAction.IA_POINTER, hoverText: 'Plant seed', maxDistance: 4 } },
    () => tryPlant(v),
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
    // Countdown from the server's own clock delta — clockSync is unreliable here
    v.opensLocalAt = Date.now() + (Number(data.opensAt) - Number(data.serverNow))
    refresh(v)
    if (!wasOpened && v.opened && isMine(v)) {
      showToast(`Your ${v.flower} opened!${v.rare ? ' A rare one.' : ''}`, TOAST_MS, false)
    } else if (!wasMine && isMine(v) && !v.opened) {
      showToast('Seed planted — come back when it opens', TOAST_MS, false)
    }
  })

  room.onMessage('pouchUpdate', (data) => {
    pouch = { normal: data.normal, rare: data.rare }
    for (const v of views.values()) if (!v.owner) TextShape.getMutable(v.label).text = labelFor(v, Date.now())
  })

  engine.addSystem(boxTickSystem)
  console.log(`[Boxes] ${views.size} seed boxes ready · boxState listeners=${room.listenerCount('boxState')}`)
}
