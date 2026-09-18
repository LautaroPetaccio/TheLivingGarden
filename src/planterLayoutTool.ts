// =============================================================
// Bloom Garden v2 — Planter layout editor (CLIENT, dev/admin only)
//
// Edit the REAL planters in the running preview, Creator-Hub style (GDD §3.1):
//   Select nearest · Pick up / Drop (it rides 1.4 m in front of you) · Nudge 10 cm
//   (relative to where you face) · Rotate ±15° · Snap 90° · Add here · Delete
// Edits move this client's planters only (boxSystem editor API). The layout — a list of
// { id, x, z, rot } — is saved to world Storage 'planterDraft' (server, admin-gated) a
// second after each change and re-applied when an admin joins, so it survives restarts.
// It is then BAKED into BOX_POSITIONS; deploys never read the draft. A deleted planter's
// seed/flower is handed back to its owner by the server at the bake.
// =============================================================

import { engine, Entity, Transform, TextShape, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { getPlayer } from '@dcl/sdk/players'
import { room } from './shared/messages'
import { ADMIN_ADDRESSES } from './shared/config'
import { showToast } from './notifications'
import {
  getPlanterLayout, setPlanterPose, beginCarry, endCarry, addPlanter, deletePlanter,
  isPlanterDeleted, applyPlanterLayout, PlanterPose,
} from './boxSystem'

const PLACE_AHEAD = 1.4    // m in front of you (Add here / carrying)
const GRID        = 0.1    // m
const NUDGE       = 0.1    // m
const TURN        = 15     // degrees
const SELECT_NEAR = 4      // m
const MARKER_Y    = 2.4    // m above the selected planter
const SAVE_DELAY  = 1      // s after the last change
const TOAST_MS    = 3_000

let on = false, started = false
let selected: string | null = null
let carried  = false
let saveIn   = 0
let marker: Entity | null = null

export function isLayoutToolOn(): boolean { return on }
export function layoutIsCarrying(): boolean { return carried }
export function layoutCount(): number { return getPlanterLayout().length }
export function layoutSelectedInfo(): string {
  const p = selected ? getPlanterLayout().find(q => q.id === selected) : undefined
  return p ? `${p.id}  x ${p.x}  z ${p.z}  ${p.rot}°` : 'nothing selected'
}

function isAdmin(): boolean {
  return ADMIN_ADDRESSES.includes((getPlayer()?.userId ?? '').toLowerCase())
}

/** Call from setupBoxSystem (after wateringSystem's room.clear()). Admins get their saved
 *  layout re-applied on join, so the preview shows the layout being edited. */
export function setupPlanterLayoutTool(): void {
  if (started) return
  started = true
  room.onMessage('planterDraft', (data) => {
    let list: PlanterPose[] = []
    try { list = JSON.parse(data.json || '[]') } catch { list = [] }
    // Drafts from the old ghost tool have no ids — the baked layout already holds them
    if (list.length === 0 || list.some(p => typeof p.id !== 'string')) return
    applyPlanterLayout(list.map(p => ({ id: p.id, x: Number(p.x), z: Number(p.z), rot: Number(p.rot) || 0 })))
    console.log(`[PlanterLayout] applied saved layout: ${list.length} planters`)
  })
  engine.addSystem(editorSystem)
  if (isAdmin()) room.send('adminPlanterDraft', { json: '' })
}

export function setLayoutTool(enabled: boolean): void {
  if (!enabled && carried) drop()
  on = enabled
  if (!on) select(null)
}

// ── helpers ──────────────────────────────────────────────────

const snap = (v: number) => Number((Math.round(v / GRID) * GRID).toFixed(2))
const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360

/** My feet + the camera's horizontal facing (unsnapped, degrees). */
function whereAmI(): { x: number; z: number; yaw: number } | null {
  const me  = Transform.getOrNull(engine.PlayerEntity)?.position
  const cam = Transform.getOrNull(engine.CameraEntity)?.rotation
  if (!me || !cam) return null
  const fx = 2 * (cam.x * cam.z + cam.w * cam.y)          // camera forward = q · (0,0,1)
  const fz = 1 - 2 * (cam.x * cam.x + cam.y * cam.y)
  return { x: me.x, z: me.z, yaw: (Math.atan2(fx, fz) * 180) / Math.PI }
}

function aheadOfMe(): { x: number; z: number; yaw90: number } | null {
  const w = whereAmI()
  if (!w) return null
  const r = (w.yaw * Math.PI) / 180
  return { x: snap(w.x + Math.sin(r) * PLACE_AHEAD), z: snap(w.z + Math.cos(r) * PLACE_AHEAD), yaw90: norm(Math.round(w.yaw / 90) * 90) }
}

function pose(id: string): PlanterPose | undefined { return getPlanterLayout().find(p => p.id === id) }

function changed(msg: string): void {
  saveIn = SAVE_DELAY
  showToast(msg, TOAST_MS, false)
}

function needSelection(): string | null {
  if (!on) { showToast('Turn the planter editor on first', TOAST_MS, false); return null }
  if (!selected || isPlanterDeleted(selected)) { showToast('Select a planter first', TOAST_MS, false); return null }
  return selected
}

function select(id: string | null): void {
  selected = id
  if (id === null) { if (marker !== null) { engine.removeEntity(marker); marker = null } return }
  if (marker === null) {
    marker = engine.addEntity()
    Transform.create(marker, { position: { x: 0, y: MARKER_Y, z: 0 } })
    TextShape.create(marker, { text: '', fontSize: 3, textColor: { r: 1, g: 0.85, b: 0.3, a: 1 }, outlineWidth: 0.2, outlineColor: { r: 0, g: 0, b: 0 } })
    Billboard.create(marker, { billboardMode: BillboardMode.BM_Y })
  }
  TextShape.getMutable(marker).text = `[ ${id} ]`
}

// ── actions (test panel) ─────────────────────────────────────

export function layoutSelectNearest(): void {
  if (!on) { showToast('Turn the planter editor on first', TOAST_MS, false); return }
  if (carried) return
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  let best: string | null = null, bestD = SELECT_NEAR * SELECT_NEAR
  for (const p of getPlanterLayout()) {
    const d = (p.x - me.x) ** 2 + (p.z - me.z) ** 2
    if (d < bestD) { bestD = d; best = p.id }
  }
  if (best === null) { showToast(`No planter within ${SELECT_NEAR} m`, TOAST_MS, false); return }
  select(best)
}

export function layoutPickUpOrDrop(): void {
  if (carried) { drop(); return }
  const id = needSelection()
  if (!id) return
  carried = true
  beginCarry(id)
  showToast(`Carrying ${id} — walk, then Drop`, TOAST_MS, false)
}

function drop(): void {
  if (!carried || !selected) return
  carried = false
  endCarry(selected)
  changed(`Dropped ${selected}`)
}

/** Nudge relative to where you face (snapped to the grid axes). */
export function layoutNudge(dir: 'fwd' | 'back' | 'left' | 'right'): void {
  const id = needSelection()
  const w = whereAmI()
  const p = id ? pose(id) : undefined
  if (!id || !w || !p || carried) return
  const r = (norm(Math.round(w.yaw / 90) * 90) * Math.PI) / 180
  const f = { x: Math.sin(r), z: Math.cos(r) }, rt = { x: Math.cos(r), z: -Math.sin(r) }
  const d = dir === 'fwd' ? f : dir === 'back' ? { x: -f.x, z: -f.z } : dir === 'right' ? rt : { x: -rt.x, z: -rt.z }
  setPlanterPose(id, { x: snap(p.x + d.x * NUDGE), z: snap(p.z + d.z * NUDGE), rot: p.rot })
  changed(`${id} nudged`)
}

function rotateBy(deltaDeg: number): void {
  const id = needSelection()
  const p = id ? pose(id) : undefined
  if (!id || !p) return
  setPlanterPose(id, { x: p.x, z: p.z, rot: norm(p.rot + deltaDeg) })
  changed(`${id} → ${norm(p.rot + deltaDeg)}°`)
}
export const layoutRotateLeft  = () => rotateBy(-TURN)
export const layoutRotateRight = () => rotateBy(TURN)

export function layoutSnap90(): void {
  const id = needSelection()
  const p = id ? pose(id) : undefined
  if (!id || !p) return
  setPlanterPose(id, { x: p.x, z: p.z, rot: norm(Math.round(p.rot / 90) * 90) })
  changed(`${id} snapped`)
}

export function layoutAddHere(): void {
  if (!on) { showToast('Turn the planter editor on first', TOAST_MS, false); return }
  if (carried) return
  const a = aheadOfMe()
  if (!a) return
  const id = addPlanter({ x: a.x, z: a.z, rot: norm(a.yaw90 + 180) })   // front faces me
  select(id)
  changed(`Added ${id} — ${layoutCount()} planters (new ones work after the bake)`)
}

export function layoutDelete(): void {
  const id = needSelection()
  if (!id || carried) return
  deletePlanter(id)
  select(null)
  changed(`Deleted ${id} — ${layoutCount()} planters`)
}

/** Save now and print the layout (also in the Explorer log) — then ask Claude to bake it. */
export function layoutExport(): void {
  if (carried) drop()
  saveIn = 0
  save()
  console.log(`[PlanterLayout] ${layoutCount()} planters: ${JSON.stringify(getPlanterLayout())}`)
  showToast(`Saved ${layoutCount()} planters — ready to bake`, TOAST_MS, false)
}

// ── per frame: carrying, marker, delayed save ────────────────

function save(): void { room.send('adminPlanterDraft', { json: JSON.stringify(getPlanterLayout()) }) }

function editorSystem(dt: number): void {
  if (carried && selected) {
    const a = aheadOfMe()
    const p = pose(selected)
    if (a && p && (a.x !== p.x || a.z !== p.z)) setPlanterPose(selected, { x: a.x, z: a.z, rot: p.rot })
  }
  if (marker !== null && selected) {
    const p = pose(selected)
    if (p) Transform.getMutable(marker).position = { x: p.x, y: MARKER_Y, z: p.z }
  }
  if (saveIn > 0) {
    saveIn -= dt
    if (saveIn <= 0) save()
  }
}
