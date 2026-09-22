// =============================================================
// Bloom Garden v2 — Tribute Plants (CLIENT ONLY)
//
// GDD §4.2 "week 3+": at TRIBUTE_MILESTONE lifetime waters a distinctive plant
// grows permanently with the player's name — "the tribute plant is unmissable
// in-world; it IS the tell". v2 ships with the founding tribute already grown.
//
// Server communication:
//   receive ←  tributesUpdate { json }   (all tributes; on join, full sync, and each grant)
//
// Art: founding tribute = a unique model (TRIBUTE_MODEL_FOUNDING); every later
// tribute reuses ONE standard plant (TRIBUTE_MODEL_STANDARD) tinted per player.
// While those paths are empty a greybox stem + bloom stands in, same tint rule.
// =============================================================

import {
  engine,
  Entity,
  Transform,
  MeshRenderer,
  MeshCollider,
  ColliderLayer,
  Material,
  TextShape,
  GltfContainer,
  pointerEventsSystem,
  InputAction,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { TRIBUTE_PLOTS, TRIBUTE_HERO_PLOTS, TRIBUTE_REGISTER_POS, TRIBUTE_REGISTER_ENABLED, TRIBUTE_MILESTONE, TRIBUTE_MODEL_FOUNDING, TRIBUTE_MODEL_STANDARD } from './shared/config'
import { showToast } from './notifications'
import { createSign, removeSign, setupSignSystem, Sign } from './signs'

// ---------------------------------------------------------------
// Config (greybox visuals)
// ---------------------------------------------------------------

const STEM_H        = 1.2
const STEM_R        = 0.06
const BLOOM_SCALE   = 0.5
const PLAQUE_Y      = 0.40
const PLAQUE_OFFSET_Z = -0.55   // toward the garden; readers stand on −Z
const PLAQUE_SIZE   = { w: 1.1, h: 0.55 }
const TAP_DISTANCE  = 8
const TOAST_MS      = 6_000
const COLOR_STEM    = Color4.create(0.25, 0.55, 0.25, 1)
const COLOR_FOUNDING = Color4.create(0.85, 0.10, 0.20, 1)   // a red rose until KJ's model lands

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

interface TributeRecord {
  address: string; displayName: string; earnedAt: number; plot: number; founding: boolean; note: string
}
interface TributeView { root: Entity; key: string; sign: Sign | null }

const views = new Map<number, TributeView>()   // plot → view

/** Stable per-player tint so every later tribute is recognisably "theirs". */
function tintFor(name: string): Color4 {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  const hue = (h % 360) / 60, s = 0.65, v = 0.95
  const c = v * s, x = c * (1 - Math.abs((hue % 2) - 1)), m = v - c
  const [r, g, b] = hue < 1 ? [c, x, 0] : hue < 2 ? [x, c, 0] : hue < 3 ? [0, c, x] : hue < 4 ? [0, x, c] : hue < 5 ? [x, 0, c] : [c, 0, x]
  return Color4.create(r + m, g + m, b + m, 1)
}

function plaqueText(t: TributeRecord): string {
  const when = new Date(t.earnedAt).toISOString().slice(0, 10)
  const why  = t.founding && t.note ? t.note : `${TRIBUTE_MILESTONE} lifetime waters`
  return `${t.displayName}\n${why}\n${when}`
}

// ---------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------

function createView(t: TributeRecord): TributeView {
  const pos  = TRIBUTE_PLOTS[t.plot] ?? TRIBUTE_PLOTS[0]
  const root = engine.addEntity()
  Transform.create(root, { position: { x: pos.x, y: 0, z: pos.z }, rotation: Quaternion.fromEulerDegrees(0, pos.rot ?? 0, 0) })

  const src = t.founding ? TRIBUTE_MODEL_FOUNDING : TRIBUTE_MODEL_STANDARD
  if (src) {
    GltfContainer.create(root, { src })
  } else {
    const stem = engine.addEntity()
    Transform.create(stem, { position: { x: 0, y: STEM_H / 2, z: 0 }, scale: { x: STEM_R * 2, y: STEM_H, z: STEM_R * 2 }, parent: root })
    MeshRenderer.setCylinder(stem)
    Material.setPbrMaterial(stem, { albedoColor: COLOR_STEM })

    const bloom = engine.addEntity()
    Transform.create(bloom, { position: { x: 0, y: STEM_H + BLOOM_SCALE / 2, z: 0 }, scale: { x: BLOOM_SCALE, y: BLOOM_SCALE, z: BLOOM_SCALE }, parent: root })
    MeshRenderer.setSphere(bloom)
    const c = t.founding ? COLOR_FOUNDING : tintFor(t.displayName)
    Material.setPbrMaterial(bloom, { albedoColor: c, emissiveColor: c, emissiveIntensity: 0.6 })
  }

  // Pointer-only tap target (never blocks walking); tap reads the plaque aloud as a toast
  const tap = engine.addEntity()
  Transform.create(tap, { position: { x: 0, y: 0.9, z: 0 }, scale: { x: 0.8, y: 1.8, z: 0.8 }, parent: root })
  MeshCollider.setBox(tap, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: tap, opts: { button: InputAction.IA_POINTER, hoverText: `${t.displayName}'s tribute`, maxDistance: TAP_DISTANCE } },
    () => showToast(plaqueText(t).replace(/\n/g, ' - '), TOAST_MS, false),
  )

  // Plaques only on the hero bed; hedge plots stay compact (hover + tap toast + register)
  let sign: Sign | null = null
  if (t.plot < TRIBUTE_HERO_PLOTS.length) {
    sign = createSign({ x: pos.x, y: PLAQUE_Y, z: pos.z + PLAQUE_OFFSET_Z }, 0, PLAQUE_SIZE, 0.8)
    TextShape.getMutable(sign.text).text = plaqueText(t)
  }

  return { root, key: `${t.address}|${t.displayName}|${t.note}`, sign }
}

// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------

// ── Tribute Register — the permanent roll, one text entity however long the list ──
const REGISTER_SIZE     = { w: 2.4, h: 1.5 }
const REGISTER_PER_PAGE = 8
const REGISTER_PAGE_MS  = 7_000
let registerText: Entity | null = null
let registerRecords: TributeRecord[] = []
let registerPage  = 0
let registerAccum = 0

function refreshRegister(): void {
  if (registerText === null) return
  const pages = Math.max(1, Math.ceil(registerRecords.length / REGISTER_PER_PAGE))
  const start = (registerPage % pages) * REGISTER_PER_PAGE
  const rows  = registerRecords.slice(start, start + REGISTER_PER_PAGE)
    .map(t => `${t.displayName}  -  ${new Date(t.earnedAt).toISOString().slice(0, 10)}${t.founding ? '  (founding)' : ''}`)
  const head = `TRIBUTE REGISTER  -  ${TRIBUTE_MILESTONE} lifetime waters${pages > 1 ? `  (${(registerPage % pages) + 1}/${pages})` : ''}`
  TextShape.getMutable(registerText).text = [head, '', ...(rows.length ? rows : ['No tributes yet'])].join('\n')
}

function registerPagerSystem(dt: number): void {
  if (registerRecords.length <= REGISTER_PER_PAGE) return
  registerAccum += dt * 1_000
  if (registerAccum < REGISTER_PAGE_MS) return
  registerAccum = 0
  registerPage++
  refreshRegister()
}

/** Register handlers — MUST be called after wateringSystem's room.clear(). */
export function setupTributeSystem(): void {
  if (TRIBUTE_REGISTER_ENABLED) {   // registerText stays null otherwise — refreshRegister is a no-op
    const reg = createSign({ ...TRIBUTE_REGISTER_POS }, 0, REGISTER_SIZE, 0.75)
    registerText = reg.text
    refreshRegister()
    engine.addSystem(registerPagerSystem)
  }

  room.onMessage('tributesUpdate', (data) => {
    let records: TributeRecord[] = []
    try { records = JSON.parse(data.json) } catch { return }
    const seen = new Set<number>()
    registerRecords = records.slice().sort((a, b) => a.earnedAt - b.earnedAt)
    registerPage = 0
    refreshRegister()
    for (const t of records) {
      if (t.plot < 0 || t.plot >= TRIBUTE_PLOTS.length) continue   // register-only honour
      seen.add(t.plot)
      const key = `${t.address}|${t.displayName}|${t.note}`
      const existing = views.get(t.plot)
      if (existing?.key === key) continue
      if (existing) { if (existing.sign) removeSign(existing.sign); engine.removeEntityWithChildren(existing.root) }
      views.set(t.plot, createView(t))
    }
    for (const [plot, v] of views) if (!seen.has(plot)) { if (v.sign) removeSign(v.sign); engine.removeEntityWithChildren(v.root); views.delete(plot) }
    console.log(`[Tributes] ${records.length} tribute plant(s) standing`)
  })
  setupSignSystem()
  console.log(`[Tributes] ready · listeners=${room.listenerCount('tributesUpdate')}`)
}
