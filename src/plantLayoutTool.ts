// =============================================================
// Bloom Garden v2 — Plant layout editor (CLIENT ONLY, admin)
//
// KJ 2026-09-21: move the plants players WATER, in world, then bake pos + rot.
//
// The 38 garden plants come from main.composite. `shared/layout.ts`'s PLANT_LAYOUT
// already overrides where they stand (applied before setupPlant derives anything from
// their transforms), and was meant to be generated from a Blender export — Creator Hub
// being unavailable is what put it there. This tool replaces that round trip: walk up to
// a plant, carry it, nudge it, turn it, export, and the server logs a paste-ready
// PLANT_LAYOUT block to bake.
//
// ⚠️ A plant moves as a PAIR. The plant entity holds the model; a sibling ANCHOR mirrors
// its transform and owns every derived child — rose, water drop, labels, click box. Move
// the plant alone and its drop and click box stay behind. `plantMovePair` returns both.
//
// Same verbs and ordering as planterLayoutTool, so there is one control scheme.
// The draft is a DRAFT: deploys read PLANT_LAYOUT, never the stored copy.
// =============================================================

import { engine, Transform, TextShape, Billboard, BillboardMode, Entity } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { showToast } from './notifications'
import { plantNames, plantMovePair } from './wateringSystem'

const PLACE_AHEAD = 1.4
const GRID        = 0.1
const NUDGE       = 0.1
const NUDGE_Y     = 0.05
const TURN        = 15
const SELECT_NEAR = 6
const MARKER_Y    = 2.2
const SAVE_DELAY  = 1
const TOAST_MS    = 3_000

interface Pose { x: number; y: number; z: number; rotY: number; scale: number }

let on = false, started = false
let selected: string | null = null
let carried = false
let saveIn  = 0
let poses = new Map<string, Pose>()
// The client and the scene SERVER share one bundle, but only the client reloads: the
// server loads its half at startup, so a newly added message type is unknown to a server
// that has not been restarted. On 2026-09-21 that silently ate 12 saves — the server
// logged "Unknown event type: adminPlantDraft" and the client still toasted "Saved".
// An unacknowledged export now says so, and points at the console copy, which is real.
let ackWait = 0
let marker: Entity | null = null

export function isPlantToolOn(): boolean { return on }
export function plantIsCarrying(): boolean { return carried }
export function plantToolCount(): number { return poses.size }
export function plantSelectedInfo(): string {
  if (!selected) return 'No plant selected'
  const p = poses.get(selected)
  if (!p) return 'No plant selected'
  return `${selected} — x ${p.x.toFixed(2)} y ${p.y.toFixed(2)} z ${p.z.toFixed(2)}  rot ${p.rotY}°`
}

const snap = (v: number) => Number((Math.round(v / GRID) * GRID).toFixed(2))
const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360
const yaw  = (q: { x: number; y: number; z: number; w: number }) =>
  norm((Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x)) * 180) / Math.PI)

function whereAmI(): { x: number; z: number; yaw: number } | null {
  const me  = Transform.getOrNull(engine.PlayerEntity)?.position
  const cam = Transform.getOrNull(engine.CameraEntity)?.rotation
  if (!me || !cam) return null
  const fx = 2 * (cam.x * cam.z + cam.w * cam.y)
  const fz = 1 - 2 * (cam.x * cam.x + cam.y * cam.y)
  return { x: me.x, z: me.z, yaw: (Math.atan2(fx, fz) * 180) / Math.PI }
}

/** Read every plant's CURRENT transform — whatever the composite and PLANT_LAYOUT left it
 *  at — so the export is the full table and a bake is deterministic. */
function readPoses(): void {
  poses = new Map()
  for (const name of plantNames()) {
    const pair = plantMovePair(name)
    if (!pair) continue
    const t = Transform.getOrNull(pair.plant)
    if (!t) continue
    poses.set(name, { x: t.position.x, y: t.position.y, z: t.position.z, rotY: yaw(t.rotation), scale: t.scale.x })
  }
}

/** Write a pose onto BOTH the plant and its anchor. */
function apply(name: string): void {
  const pair = plantMovePair(name)
  const p = poses.get(name)
  if (!pair || !p) return
  const rot = Quaternion.fromEulerDegrees(0, p.rotY, 0)
  for (const e of [pair.plant, pair.anchor]) {
    const t = Transform.getMutableOrNull(e)
    if (!t) continue
    t.position = { x: p.x, y: p.y, z: p.z }
    t.rotation = rot
  }
  if (marker !== null && selected === name) {
    Transform.getMutable(marker).position = { x: p.x, y: p.y + MARKER_Y, z: p.z }
  }
}

export function setPlantTool(enabled: boolean): void {
  if (!started) {
    started = true
    room.onMessage('plantDraft', (data) => {
      if (!data.json) return
      ackWait = 0
      try {
        const list = JSON.parse(data.json) as Record<string, Pose>
        let n = 0
        for (const [name, p] of Object.entries(list)) {
          if (!poses.has(name)) continue
          poses.set(name, { x: p.x, y: p.y, z: p.z, rotY: norm(p.rotY ?? 0), scale: p.scale ?? 1 })
          apply(name); n++
        }
        console.log(`[PlantLayout] loaded saved draft: ${n} plants`)
      } catch { /* keep what the composite gave us */ }
    })
    engine.addSystem(editorSystem)
  }
  on = enabled
  if (on) {
    readPoses()
    room.send('adminPlantDraft', { json: '' })
    showToast(`Plant editor on — ${poses.size} plants`, TOAST_MS, false)
  } else {
    if (carried) drop()
    select(null)
  }
}

function changed(msg: string): void {
  saveIn = SAVE_DELAY
  if (selected) apply(selected)
  showToast(msg, TOAST_MS, false)
}

function needSelection(): string | null {
  if (!on) { showToast('Turn the plant editor on first', TOAST_MS, false); return null }
  if (!selected) { showToast('Select a plant first', TOAST_MS, false); return null }
  return selected
}

function select(name: string | null): void {
  selected = name
  if (name === null) { if (marker !== null) { engine.removeEntity(marker); marker = null } return }
  if (marker === null) {
    marker = engine.addEntity()
    Transform.create(marker, { position: { x: 0, y: MARKER_Y, z: 0 } })
    TextShape.create(marker, { text: '', fontSize: 2.4, textColor: { r: 1, g: 0.85, b: 0.3, a: 1 }, outlineWidth: 0.2, outlineColor: { r: 0, g: 0, b: 0 } })
    Billboard.create(marker, { billboardMode: BillboardMode.BM_Y })
  }
  TextShape.getMutable(marker).text = `[ ${name} ]`
  apply(name)
}

// ── actions ───────────────────────────────────────────────────

export function plantSelectNearest(): void {
  if (!on) { showToast('Turn the plant editor on first', TOAST_MS, false); return }
  const w = whereAmI()
  if (!w) return
  let best: string | null = null, bestSq = SELECT_NEAR * SELECT_NEAR
  poses.forEach((p, name) => {
    const sq = (p.x - w.x) ** 2 + (p.z - w.z) ** 2
    if (sq < bestSq) { bestSq = sq; best = name }
  })
  if (best === null) { showToast(`No plant within ${SELECT_NEAR} m`, TOAST_MS, false); return }
  select(best)
  showToast(`Selected ${best}`, TOAST_MS, false)
}

export function plantPickUpOrDrop(): void {
  if (needSelection() === null) return
  if (carried) { drop(); return }
  carried = true
  showToast('Carrying — walk, then Drop', TOAST_MS, false)
}
function drop(): void { carried = false; changed(plantSelectedInfo()) }

export function plantNudge(dir: 'fwd' | 'back' | 'left' | 'right' | 'up' | 'down'): void {
  const name = needSelection()
  if (name === null || carried) return
  const p = poses.get(name)!
  if (dir === 'up' || dir === 'down') {
    poses.set(name, { ...p, y: Number((p.y + (dir === 'up' ? NUDGE_Y : -NUDGE_Y)).toFixed(3)) })
    changed(plantSelectedInfo()); return
  }
  const w = whereAmI()
  if (!w) return
  const r = (w.yaw * Math.PI) / 180
  const f = { x: Math.sin(r), z: Math.cos(r) }
  const s = { x: Math.cos(r), z: -Math.sin(r) }
  const v = dir === 'fwd'  ? f
          : dir === 'back' ? { x: -f.x, z: -f.z }
          : dir === 'left' ? { x: -s.x, z: -s.z } : s
  poses.set(name, { ...p, x: snap(p.x + v.x * NUDGE), z: snap(p.z + v.z * NUDGE) })
  changed(plantSelectedInfo())
}

function rotateBy(d: number): void {
  const name = needSelection()
  if (name === null) return
  const p = poses.get(name)!
  poses.set(name, { ...p, rotY: norm(p.rotY + d) })
  changed(plantSelectedInfo())
}
export function plantRotateLeft(): void { rotateBy(-TURN) }
export function plantRotateRight(): void { rotateBy(TURN) }
export function plantSnap90(): void {
  const name = needSelection()
  if (name === null) return
  const p = poses.get(name)!
  poses.set(name, { ...p, rotY: norm(Math.round(p.rotY / 90) * 90) })
  changed(plantSelectedInfo())
}

/** Save and print a paste-ready PLANT_LAYOUT block. The server logs the same thing — that
 *  is the copy that gets baked, since the Explorer console is not readable from here. */
export function plantExport(): void {
  if (carried) drop()
  saveIn = 0
  save()
  const body = [...poses.entries()]
    .map(([n, p]) => `  '${n}': { x: ${p.x}, y: ${Number(p.y.toFixed(3))}, z: ${p.z}, rotY: ${p.rotY}, scale: ${Number(p.scale.toFixed(4))} },`)
    .join('\n')
  console.log(`[PlantLayout] ${poses.size} plants:\n${body}`)
  ackWait = ACK_TIMEOUT_S
  showToast(`Saving ${poses.size} plants…`, TOAST_MS, false)
}

/** The server echoes the stored draft back as `plantDraft`, so a round trip is the only
 *  honest proof it landed. */
const ACK_TIMEOUT_S = 4
function save(): void { room.send('adminPlantDraft', { json: JSON.stringify(Object.fromEntries(poses)) }) }

function editorSystem(dt: number): void {
  if (!on) return
  if (carried && selected) {
    const w = whereAmI()
    const p = poses.get(selected)
    if (w && p) {
      const r = (w.yaw * Math.PI) / 180
      const x = snap(w.x + Math.sin(r) * PLACE_AHEAD)
      const z = snap(w.z + Math.cos(r) * PLACE_AHEAD)
      if (x !== p.x || z !== p.z) { poses.set(selected, { ...p, x, z }); apply(selected) }
    }
  }
  if (saveIn > 0) { saveIn -= dt; if (saveIn <= 0) save() }
  if (ackWait > 0) {
    ackWait -= dt
    if (ackWait <= 0) {
      showToast('Server did not confirm the save — copy the block from the console', 8_000, false)
      console.log('[PlantLayout] NO ACK from the server. Either the scene server is running an older bundle (restart it) or you are not an admin wallet. The block above is still valid — paste it to bake.')
    }
  }
}
