// =============================================================
// Bloom Garden v2 — Plaques (CLIENT ONLY, greybox)
//
// KJ 2026-09-17: "too much floating text w/o background feels noisy in a
// peaceful garden — like a cemetery for the living". So world text lives on
// small plaques: a dark backing panel + wrapped text, STATIC (no per-frame
// Billboard), facing the path, and only shown when a player is near.
// The backing is a thin box until KJ's plaque model lands — swap the panel
// for a GltfContainer and keep the text child.
//
// Orientation rule (TextMeshPro convention, same as the wall boards): at
// rotation 0 the text reads for a viewer standing on the plaque's −Z side.
// Pass facingDeg = 180 when readers stand on the +Z side.
// =============================================================

import { engine, Entity, Transform, MeshRenderer, Material, TextShape, TextAlignMode } from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'

const PANEL_COLOR   = Color4.create(0.10, 0.08, 0.06, 0.92)
const TEXT_COLOR    = Color4.create(1.0, 0.95, 0.82, 1)
const PANEL_DEPTH   = 0.03
const SIGN_SHOW_M   = 9       // plaques farther than this are hidden (less noise, fewer draw calls)
const SIGN_MAX_VISIBLE = 8    // even within range, only the N nearest are shown — a crowd of
                               // planters (100-planter perf test, a busy tribute bed) must not
                               // pop every plaque at once. KJ 2026-09-17: "too much floating
                               // text... like a cemetery for the living".
const FADE_S        = 0.30    // grow-in / shrink-out, not a hard pop
const SCAN_MS       = 400

export interface Sign { root: Entity; text: Entity }
interface SignState { root: Entity; x: number; z: number; shown: boolean; k: number }

const signs: SignState[] = []
let scanAccum = 0

export function createSign(
  pos: { x: number; y: number; z: number },
  facingDeg: number,
  size: { w: number; h: number },
  fontSize: number,
  withPanel = true,   // false = text only, for signs that sit on a model's own board
): Sign {
  const root = engine.addEntity()
  Transform.create(root, { position: pos, rotation: Quaternion.fromEulerDegrees(0, facingDeg, 0), scale: { x: 0, y: 0, z: 0 } })

  if (withPanel) {
    // Backing sits BEHIND the text as seen by the reader (reader is on local −Z)
    const panel = engine.addEntity()
    Transform.create(panel, { position: { x: 0, y: 0, z: PANEL_DEPTH }, scale: { x: size.w, y: size.h, z: PANEL_DEPTH }, parent: root })
    MeshRenderer.setBox(panel)
    Material.setPbrMaterial(panel, { albedoColor: PANEL_COLOR, metallic: 0, roughness: 1 })
  }

  const text = engine.addEntity()
  Transform.create(text, { parent: root })
  TextShape.create(text, {
    text: '', fontSize, textColor: TEXT_COLOR,
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER,
    textWrapping: true, width: size.w * 0.92, height: size.h * 0.9,
    // No dark panel behind it: an outline keeps it legible on light wood by day and at night
    ...(withPanel ? {} : { outlineWidth: 0.2, outlineColor: { r: 0.16, g: 0.09, b: 0.04 } }),
  })

  signs.push({ root, x: pos.x, z: pos.z, shown: false, k: 0 })
  return { root, text }
}

/** Re-home a (pooled) plaque: moves it and keeps the proximity check pointed at the new spot. */
export function moveSign(sign: Sign, pos: { x: number; y: number; z: number }): void {
  const st = signs.find(s => s.root === sign.root)
  if (st) { st.x = pos.x; st.z = pos.z }
  Transform.getMutable(sign.root).position = pos
}

export function removeSign(sign: Sign): void {
  const i = signs.findIndex(s => s.root === sign.root)
  if (i >= 0) signs.splice(i, 1)
  engine.removeEntityWithChildren(sign.root)
}

/** Decide WHICH plaques should be visible: in range, nearest SIGN_MAX_VISIBLE win — a
 *  crowd of them (a busy tribute bed, 100 test planters) must not all pop up together. */
function signRankSystem(dt: number): void {
  scanAccum += dt * 1_000
  if (scanAccum < SCAN_MS) return
  scanAccum = 0
  const me = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!me) return
  const inRange = signs
    .map(s => ({ s, d: Math.hypot(s.x - me.x, s.z - me.z) }))
    .filter(r => r.d <= SIGN_SHOW_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, SIGN_MAX_VISIBLE)
  const winners = new Set(inRange.map(r => r.s))
  for (const s of signs) s.shown = winners.has(s)
}

/** Ease every plaque's scale toward its target every frame — a fade, not a pop. */
function signFadeSystem(dt: number): void {
  const step = dt / FADE_S
  for (const s of signs) {
    const target = s.shown ? 1 : 0
    if (s.k === target) continue
    s.k = target > s.k ? Math.min(target, s.k + step) : Math.max(target, s.k - step)
    Transform.getMutable(s.root).scale = { x: s.k, y: s.k, z: s.k }
  }
}

let started = false
export function setupSignSystem(): void {
  if (started) return
  started = true
  engine.addSystem(signRankSystem)
  engine.addSystem(signFadeSystem)
}
