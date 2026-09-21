// =============================================================
// Bloom Garden v2 — Tribute plot editor (CLIENT ONLY, admin)
//
// KJ 2026-09-21: "make it so i can move the roses in world and then bake pos and rot".
//
// Tribute plots are FIXED positions in config (TRIBUTE_HERO_PLOTS), filled in the order
// tributes are earned — so there is usually only one real rose standing (the founding
// one) and no way to judge the other seven. This tool therefore edits the PLOTS, not the
// planted roses: switch it on and every plot grows a ghost rose you can walk up to, pick
// up, nudge and turn. Export sends the draft to the server, which logs and stores it, and
// that log line is what gets baked into TRIBUTE_HERO_PLOTS by hand.
//
// Same verbs and the same ordering as planterLayoutTool so there is no second control
// scheme to learn. Deliberately smaller: no add/delete (the plot count is a design
// decision, not a layout one) and no grid snap on rotation beyond the 90° button.
//
// The draft is a DRAFT: deploys read TRIBUTE_HERO_PLOTS, never the stored copy.
// =============================================================

import {
  engine, Transform, MeshRenderer, Material, MeshCollider, ColliderLayer,
  TextShape, Billboard, BillboardMode, Entity, VisibilityComponent,
} from '@dcl/sdk/ecs'
import { Quaternion, Color4 } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { showToast } from './notifications'
import { TRIBUTE_HERO_PLOTS, TributePlot } from './shared/config'

const PLACE_AHEAD = 1.4     // m in front of you while carrying
const GRID        = 0.1     // m
const NUDGE       = 0.1     // m
const TURN        = 15      // degrees
const SELECT_NEAR = 6       // m
const MARKER_Y    = 2.4     // m above the selected plot
const SAVE_DELAY  = 1       // s after the last change
const TOAST_MS    = 3_000

const STEM_H = 0.75, STEM_R = 0.035, BLOOM = 0.24
const GHOST  = { r: 0.95, g: 0.35, b: 0.5 }
const NOSE   = { r: 1, g: 0.85, b: 0.35 }

let on = false, started = false
let selected: number | null = null   // index into plots
let carried = false
let saveIn  = 0
let plots: TributePlot[] = []
let ghosts: { root: Entity; nose: Entity }[] = []
let marker: Entity | null = null

export function isTributeToolOn(): boolean { return on }
export function tributeIsCarrying(): boolean { return carried }
export function tributeCount(): number { return plots.length }
export function tributeSelectedInfo(): string {
  if (selected === null) return 'No plot selected'
  const p = plots[selected]
  return `Plot ${selected + 1}/${plots.length} — x ${p.x.toFixed(2)}  z ${p.z.toFixed(2)}  rot ${p.rot}°`
}

const snap = (v: number) => Number((Math.round(v / GRID) * GRID).toFixed(2))
const norm = (deg: number) => ((Math.round(deg) % 360) + 360) % 360

/** My feet + the camera's horizontal facing (degrees) — same maths as the planter tool. */
function whereAmI(): { x: number; z: number; yaw: number } | null {
  const me  = Transform.getOrNull(engine.PlayerEntity)?.position
  const cam = Transform.getOrNull(engine.CameraEntity)?.rotation
  if (!me || !cam) return null
  const fx = 2 * (cam.x * cam.z + cam.w * cam.y)
  const fz = 1 - 2 * (cam.x * cam.x + cam.y * cam.y)
  return { x: me.x, z: me.z, yaw: (Math.atan2(fx, fz) * 180) / Math.PI }
}

// ── ghosts ────────────────────────────────────────────────────

/** A stem, a bloom, and a NOSE sticking out along local +Z. Without the nose a rose is
 *  rotationally symmetric on screen and there is no way to tell what "rot" is doing. */
function buildGhosts(): void {
  for (let i = 0; i < plots.length; i++) {
    const root = engine.addEntity()
    Transform.create(root, { position: { x: plots[i].x, y: 0, z: plots[i].z } })

    const stem = engine.addEntity()
    Transform.create(stem, { position: { x: 0, y: STEM_H / 2, z: 0 }, scale: { x: STEM_R * 2, y: STEM_H, z: STEM_R * 2 }, parent: root })
    MeshRenderer.setCylinder(stem, 1, 1)
    Material.setPbrMaterial(stem, { albedoColor: Color4.create(0.25, 0.5, 0.3, 1), castShadows: false })

    const bloom = engine.addEntity()
    Transform.create(bloom, { position: { x: 0, y: STEM_H + BLOOM / 2, z: 0 }, scale: { x: BLOOM, y: BLOOM, z: BLOOM }, parent: root })
    MeshRenderer.setSphere(bloom)
    Material.setPbrMaterial(bloom, { albedoColor: Color4.create(GHOST.r, GHOST.g, GHOST.b, 1), emissiveColor: GHOST, emissiveIntensity: 0.8, castShadows: false })

    const nose = engine.addEntity()
    Transform.create(nose, { position: { x: 0, y: STEM_H * 0.6, z: 0.28 }, scale: { x: 0.07, y: 0.07, z: 0.34 }, parent: root })
    MeshRenderer.setBox(nose)
    Material.setPbrMaterial(nose, { albedoColor: Color4.create(NOSE.r, NOSE.g, NOSE.b, 1), emissiveColor: NOSE, emissiveIntensity: 1, castShadows: false })

    // Tap the ghost to select it — quicker than walking to it and hitting Select nearest.
    const hit = engine.addEntity()
    Transform.create(hit, { position: { x: 0, y: 0.5, z: 0 }, scale: { x: 0.6, y: 1.2, z: 0.6 }, parent: root })
    MeshCollider.setBox(hit, ColliderLayer.CL_POINTER)

    ghosts.push({ root, nose })
  }
  refreshGhosts()
}

function refreshGhosts(): void {
  for (let i = 0; i < ghosts.length; i++) {
    const t = Transform.getMutable(ghosts[i].root)
    t.position = { x: plots[i].x, y: 0, z: plots[i].z }
    t.rotation = Quaternion.fromEulerDegrees(0, plots[i].rot, 0)
  }
  if (marker !== null && selected !== null) {
    Transform.getMutable(marker).position = { x: plots[selected].x, y: MARKER_Y, z: plots[selected].z }
    TextShape.getMutable(marker).text = `[ plot ${selected + 1} ]`
  }
}

function clearGhosts(): void {
  for (const g of ghosts) engine.removeEntity(g.root)
  ghosts = []
}

// ── lifecycle ─────────────────────────────────────────────────

export function setTributeTool(enabled: boolean): void {
  if (!started) {
    started = true
    // Registered lazily rather than from index.ts: the tool is only ever switched on long
    // after wateringSystem's room.clear(), so this can never be caught by it.
    room.onMessage('tributeDraft', (data) => {
      if (!data.json) return
      try {
        const list = JSON.parse(data.json) as TributePlot[]
        if (!Array.isArray(list) || list.length === 0) return
        plots = list.map(p => ({ x: p.x, z: p.z, rot: norm(p.rot ?? 0) }))
        if (on) { clearGhosts(); buildGhosts() }
        console.log(`[TributeLayout] loaded saved draft: ${plots.length} plots`)
      } catch { /* keep the config plots */ }
    })
    engine.addSystem(editorSystem)
  }
  on = enabled
  if (on) {
    if (plots.length === 0) plots = TRIBUTE_HERO_PLOTS.map(p => ({ x: p.x, z: p.z, rot: p.rot ?? 0 }))
    buildGhosts()
    room.send('adminTributeDraft', { json: '' })   // ask for a saved draft
    showToast(`Tribute editor on — ${plots.length} plots`, TOAST_MS, false)
  } else {
    if (carried) drop()
    select(null)
    clearGhosts()
  }
}

function changed(msg: string): void { saveIn = SAVE_DELAY; refreshGhosts(); showToast(msg, TOAST_MS, false) }

function needSelection(): number | null {
  if (!on) { showToast('Turn the tribute editor on first', TOAST_MS, false); return null }
  if (selected === null) { showToast('Select a plot first', TOAST_MS, false); return null }
  return selected
}

function select(i: number | null): void {
  selected = i
  if (i === null) { if (marker !== null) { engine.removeEntity(marker); marker = null } return }
  if (marker === null) {
    marker = engine.addEntity()
    Transform.create(marker, { position: { x: 0, y: MARKER_Y, z: 0 } })
    TextShape.create(marker, { text: '', fontSize: 3, textColor: { r: 1, g: 0.85, b: 0.3, a: 1 }, outlineWidth: 0.2, outlineColor: { r: 0, g: 0, b: 0 } })
    Billboard.create(marker, { billboardMode: BillboardMode.BM_Y })
    VisibilityComponent.create(marker, { visible: true })
  }
  refreshGhosts()
}

// ── actions (test panel) ──────────────────────────────────────

export function tributeSelectNearest(): void {
  if (!on) { showToast('Turn the tribute editor on first', TOAST_MS, false); return }
  const w = whereAmI()
  if (!w) return
  let best = -1, bestSq = SELECT_NEAR * SELECT_NEAR
  plots.forEach((p, i) => {
    const sq = (p.x - w.x) ** 2 + (p.z - w.z) ** 2
    if (sq < bestSq) { bestSq = sq; best = i }
  })
  if (best < 0) { showToast(`No plot within ${SELECT_NEAR} m`, TOAST_MS, false); return }
  select(best)
  showToast(`Selected plot ${best + 1}`, TOAST_MS, false)
}

export function tributePickUpOrDrop(): void {
  if (needSelection() === null) return
  if (carried) { drop(); return }
  carried = true
  showToast('Carrying — walk, then Drop', TOAST_MS, false)
}

function drop(): void {
  carried = false
  changed(`Dropped plot ${(selected ?? 0) + 1}`)
}

export function tributeNudge(dir: 'fwd' | 'back' | 'left' | 'right'): void {
  const i = needSelection()
  if (i === null || carried) return
  const w = whereAmI()
  if (!w) return
  // Nudge relative to where YOU are looking, so "left" means left on screen.
  const r = (w.yaw * Math.PI) / 180
  const f = { x: Math.sin(r), z: Math.cos(r) }
  const s = { x: Math.cos(r), z: -Math.sin(r) }
  const v = dir === 'fwd'  ? f
          : dir === 'back' ? { x: -f.x, z: -f.z }
          : dir === 'left' ? { x: -s.x, z: -s.z } : s
  plots[i] = { ...plots[i], x: snap(plots[i].x + v.x * NUDGE), z: snap(plots[i].z + v.z * NUDGE) }
  changed(tributeSelectedInfo())
}

function rotateBy(delta: number): void {
  const i = needSelection()
  if (i === null) return
  plots[i] = { ...plots[i], rot: norm(plots[i].rot + delta) }
  changed(tributeSelectedInfo())
}
export function tributeRotateLeft(): void { rotateBy(-TURN) }
export function tributeRotateRight(): void { rotateBy(TURN) }
export function tributeSnap90(): void {
  const i = needSelection()
  if (i === null) return
  plots[i] = { ...plots[i], rot: norm(Math.round(plots[i].rot / 90) * 90) }
  changed(tributeSelectedInfo())
}

/** Face the selected plot the way YOU are facing — much faster than nudging 15° at a time
 *  when what you actually want is "point it at me". */
export function tributeFaceMe(): void {
  const i = needSelection()
  if (i === null) return
  const w = whereAmI()
  if (!w) return
  plots[i] = { ...plots[i], rot: norm(w.yaw + 180) }
  changed(tributeSelectedInfo())
}

/** Save now and print a PASTE-READY config block. The server logs it too, which is the
 *  copy that actually gets baked into TRIBUTE_HERO_PLOTS. */
export function tributeExport(): void {
  if (carried) drop()
  saveIn = 0
  save()
  const ts = plots.map(p => `  { x: ${p.x}, z: ${p.z}, rot: ${p.rot} },`).join('\n')
  console.log(`[TributeLayout] ${plots.length} plots:\n${ts}`)
  showToast(`Saved ${plots.length} tribute plots — ready to bake`, TOAST_MS, false)
}

function save(): void { room.send('adminTributeDraft', { json: JSON.stringify(plots) }) }

// ── per frame ─────────────────────────────────────────────────

function editorSystem(dt: number): void {
  if (!on) return
  if (carried && selected !== null) {
    const w = whereAmI()
    if (w) {
      const r = (w.yaw * Math.PI) / 180
      const x = snap(w.x + Math.sin(r) * PLACE_AHEAD)
      const z = snap(w.z + Math.cos(r) * PLACE_AHEAD)
      if (x !== plots[selected].x || z !== plots[selected].z) {
        plots[selected] = { ...plots[selected], x, z }
        refreshGhosts()
      }
    }
  }
  if (saveIn > 0) { saveIn -= dt; if (saveIn <= 0) save() }
}
