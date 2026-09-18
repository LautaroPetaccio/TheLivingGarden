// =============================================================
// Bloom Garden v2 — Planter layout tool (CLIENT, dev/admin only)
//
// Lay out the ~100 planters (GDD §3.1) by walking the running preview: "Place here"
// drops a draft planter in front of you, turned so its front (sign side, +z) faces you,
// snapped to 90° and a 10 cm grid. Undo / remove nearest / rotate nearest to adjust.
// The draft is saved to world Storage 'planterDraft' (server, admin-gated) a second
// after each change, so it survives preview restarts; it is then BAKED into
// BOX_POSITIONS by hand — deploys never read the draft.
//
// Draft planters are ghosts: the real planter model with a number above it, no
// colliders, no gameplay. The live boxes stay exactly as they are until the bake.
// =============================================================

import { engine, Entity, Transform, GltfContainer, ColliderLayer, TextShape, Billboard, BillboardMode } from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { BOX_MODEL_SRC, BOX_MODEL_SCALE } from './shared/config'
import { showToast } from './notifications'

/** rot = degrees about Y applied to the planter (0/90/180/270); 0 = front faces +z. */
export interface DraftPlanter { x: number; z: number; rot: number }

const PLACE_AHEAD = 1.4    // m in front of you
const GRID        = 0.1    // m
const NEAR        = 2.5    // m — reach of "nearest" actions
const LABEL_Y     = 2.2    // m — number above each ghost
const SAVE_DELAY  = 1      // s after the last change
const TOAST_MS    = 3_000

const draft: DraftPlanter[] = []
const ghosts: Array<{ root: Entity; label: Entity }> = []
let on = false, loaded = false, started = false
let saveIn = 0             // s until the pending save; 0 = nothing pending

export function isLayoutToolOn(): boolean { return on }
export function layoutDraftCount(): number { return draft.length }

export function setLayoutTool(enabled: boolean): void {
  on = enabled
  if (!started) {
    started = true   // first use is a UI click, long after wateringSystem's room.clear()
    room.onMessage('planterDraft', (data) => {
      draft.length = 0
      try {
        for (const p of JSON.parse(data.json || '[]')) draft.push({ x: Number(p.x), z: Number(p.z), rot: Number(p.rot) || 0 })
      } catch { /* empty draft */ }
      loaded = true
      rebuildGhosts()
      showToast(`Planter layout: ${draft.length} loaded`, TOAST_MS, false)
    })
    engine.addSystem(saveSystem)
  }
  if (on && !loaded) room.send('adminPlanterDraft', { json: '' })
  rebuildGhosts()
}

// ── ghosts ───────────────────────────────────────────────────

function clearGhosts(): void {
  for (const g of ghosts) { engine.removeEntity(g.root); engine.removeEntity(g.label) }
  ghosts.length = 0
}

function addGhost(p: DraftPlanter): void {
  const root = engine.addEntity()
  Transform.create(root, {
    position: { x: p.x, y: 0, z: p.z },
    rotation: Quaternion.fromEulerDegrees(0, p.rot, 0),
    scale: { x: BOX_MODEL_SCALE, y: BOX_MODEL_SCALE, z: BOX_MODEL_SCALE },
  })
  GltfContainer.create(root, { src: BOX_MODEL_SRC, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  const label = engine.addEntity()
  Transform.create(label, { position: { x: p.x, y: LABEL_Y, z: p.z } })
  TextShape.create(label, { text: '', fontSize: 3, textColor: { r: 1, g: 0.85, b: 0.3, a: 1 }, outlineWidth: 0.2, outlineColor: { r: 0, g: 0, b: 0 } })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  ghosts.push({ root, label })
}

function renumber(): void {
  ghosts.forEach((g, i) => { TextShape.getMutable(g.label).text = `${i + 1}` })
}

function rebuildGhosts(): void {
  clearGhosts()
  if (on) for (const p of draft) addGhost(p)
  renumber()
}

// ── actions (test panel) ─────────────────────────────────────

/** Actions wait for the saved draft — otherwise its arrival would overwrite them. */
function ready(): boolean {
  if (on && loaded) return true
  showToast(on ? 'Planter layout still loading…' : 'Turn the planter layout tool on first', TOAST_MS, false)
  return false
}

function snap(v: number): number { return Number((Math.round(v / GRID) * GRID).toFixed(2)) }

/** My feet + the camera's horizontal facing, snapped to 90°. */
function whereAmI(): { x: number; z: number; yaw: number } | null {
  const me  = Transform.getOrNull(engine.PlayerEntity)?.position
  const cam = Transform.getOrNull(engine.CameraEntity)?.rotation
  if (!me || !cam) return null
  // Camera forward = rotate (0,0,1) by the camera quaternion (x/z components)
  const fx = 2 * (cam.x * cam.z + cam.w * cam.y)
  const fz = 1 - 2 * (cam.x * cam.x + cam.y * cam.y)
  const yaw = Math.round((Math.atan2(fx, fz) * 180) / Math.PI / 90) * 90
  return { x: me.x, z: me.z, yaw: ((yaw % 360) + 360) % 360 }
}

function nearestIndex(): number {
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return -1
  let best = -1, bestD = NEAR * NEAR
  draft.forEach((p, i) => {
    const d = (p.x - me.x) ** 2 + (p.z - me.z) ** 2
    if (d < bestD) { bestD = d; best = i }
  })
  return best
}

function changed(msg: string): void {
  saveIn = SAVE_DELAY
  showToast(`${msg} — ${draft.length} planters`, TOAST_MS, false)
}

export function layoutPlaceHere(): void {
  if (!ready()) return
  const w = whereAmI()
  if (!w) return
  const rad = (w.yaw * Math.PI) / 180
  const p: DraftPlanter = {
    x: snap(w.x + Math.sin(rad) * PLACE_AHEAD),
    z: snap(w.z + Math.cos(rad) * PLACE_AHEAD),
    rot: (w.yaw + 180) % 360,   // front (+z) turned back toward me
  }
  draft.push(p)
  addGhost(p)
  renumber()
  changed(`Placed #${draft.length}`)
}

export function layoutUndo(): void {
  if (!ready() || draft.length === 0) return
  draft.pop()
  const g = ghosts.pop()
  if (g) { engine.removeEntity(g.root); engine.removeEntity(g.label) }
  changed('Removed the last one')
}

export function layoutRemoveNearest(): void {
  if (!ready()) return
  const i = nearestIndex()
  if (i < 0) { showToast(`No draft planter within ${NEAR} m`, TOAST_MS, false); return }
  draft.splice(i, 1)
  const [g] = ghosts.splice(i, 1)
  engine.removeEntity(g.root); engine.removeEntity(g.label)
  renumber()
  changed(`Removed #${i + 1}`)
}

export function layoutRotateNearest(): void {
  if (!ready()) return
  const i = nearestIndex()
  if (i < 0) { showToast(`No draft planter within ${NEAR} m`, TOAST_MS, false); return }
  draft[i].rot = (draft[i].rot + 90) % 360
  Transform.getMutable(ghosts[i].root).rotation = Quaternion.fromEulerDegrees(0, draft[i].rot, 0)
  changed(`Rotated #${i + 1}`)
}

/** Save now and print the layout (also in the Explorer log) — then ask Claude to bake it. */
export function layoutExport(): void {
  if (!ready()) return
  saveIn = 0
  save()
  console.log(`[PlanterLayout] ${draft.length} planters: ${JSON.stringify(draft)}`)
  showToast(`Saved ${draft.length} planters — ready to bake`, TOAST_MS, false)
}

// ── saving ───────────────────────────────────────────────────

function save(): void { room.send('adminPlanterDraft', { json: JSON.stringify(draft) }) }

function saveSystem(dt: number): void {
  if (saveIn <= 0) return
  saveIn -= dt
  if (saveIn <= 0) save()
}
