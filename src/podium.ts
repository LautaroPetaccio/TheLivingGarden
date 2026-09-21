// =============================================================
// Bloom Garden v2 — Podium: the top gardeners, as AVATARS (CLIENT ONLY)
//
// KJ 2026-09-20: show the all-time leaders as their own avatars on the stand in
// scene.glb rather than as another list of names. Four at a time, paged.
//
// ⚠️ THE RISK, stated plainly: AvatarShape only renders a player's REAL look if it
// is given their wearables. For a top-of-all-time board most of those players are
// offline, so we fetch their profile from a catalyst. If that fetch fails the slot
// still renders — as the DEFAULT body — so the podium degrades to generic figures
// rather than to nothing. Watch the [Podium] logs: they say which path each slot
// took, and that is what tells us whether this idea actually works.
//
// Perf: four full skinned avatars plus their wearable downloads is not cheap, and
// the scene already runs ~20 fps on KJ's iMac. PODIUM_COUNT = 0 turns it all off.
//
// ⚠️ setupPodium() runs from index.ts AFTER setupWateringSystem() (room.clear()).
// =============================================================

import {
  engine, Transform, AvatarShape, TextShape, MeshCollider, MeshRenderer, Material,
  MaterialTransparencyMode, ColliderLayer,
  VisibilityComponent, pointerEventsSystem, InputAction, Billboard, BillboardMode, Entity,
} from '@dcl/sdk/ecs'
import { Quaternion, Vector3, Color4 } from '@dcl/sdk/math'
import { room } from './shared/messages'
import {
  PODIUM_SLOTS, PODIUM_ROTATION_Y, PODIUM_COUNT,
  PODIUM_LABEL_Y, PODIUM_PAGE_OFFSET, PODIUM_PAGE_SIZE, PODIUM_PAGE_Y, PODIUM_PAGE_COLOR,
} from './shared/config'

interface BoardEntry { displayName: string; count: number; tier: number; address?: string }
/** Both entities carry ABSOLUTE world Transforms.
 *  CORRECTION 2026-09-21: an earlier note here blamed "a renderer ignoring the parent
 *  chain" for the avatars standing nowhere near the stand. That was wrong. The real cause
 *  was the GLB→world mapping negating X (see PODIUM_SLOTS in config) — the whole podium
 *  was ~16 m out along X, parented or not. Absolute transforms are kept because they are
 *  simpler to reason about, not because parenting is broken. */
interface Slot { avatar: Entity; label: Entity }

let entries: BoardEntry[] = []
let page = 0
const slots: Slot[] = []
let built = false

interface Look {
  wearables: string[]
  bodyShape: string
  skinColor?: { r: number; g: number; b: number }
  hairColor?: { r: number; g: number; b: number }
  eyeColor?:  { r: number; g: number; b: number }
}
/** address → their look, or null if the lookup failed. Never re-fetched. */
const profiles = new Map<string, Look | null>()
const fetching = new Set<string>()

// ── Profile lookup ────────────────────────────────────────────

/** Ask a catalyst what this wallet is wearing. Returns null (and logs) on any
 *  failure — the caller then renders the default body rather than nothing. */
async function fetchProfile(address: string): Promise<void> {
  if (profiles.has(address) || fetching.has(address)) return
  fetching.add(address)
  try {
    const res = await fetch(`https://peer.decentraland.org/lambdas/profiles/${address}`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const body = await res.json()
    const av = body?.avatars?.[0]?.avatar
    const wearables: string[] = Array.isArray(av?.wearables) ? av.wearables : []
    const bodyShape: string = typeof av?.bodyShape === 'string' ? av.bodyShape : ''
    // Colours matter as much as the clothes — without them every gardener came out
    // with the same default skin and hair (KJ 2026-09-20).
    const col = (c: { r?: number; g?: number; b?: number } | undefined) =>
      c && typeof c.r === 'number' ? { r: c.r, g: c.g ?? 0, b: c.b ?? 0 } : undefined
    profiles.set(address, {
      wearables, bodyShape,
      skinColor: col(av?.skin?.color), hairColor: col(av?.hair?.color), eyeColor: col(av?.eyes?.color),
    })
    console.log(`[Podium] profile ${address.slice(0, 8)}… → ${wearables.length} wearable(s), body "${bodyShape}", skin ${av?.skin?.color ? 'yes' : 'no'}`)
  } catch (err) {
    profiles.set(address, null)
    console.log(`[Podium] profile ${address.slice(0, 8)}… FAILED (${err}) — falling back to the default body`)
  } finally {
    fetching.delete(address)
    render()
  }
}

// ── Build ─────────────────────────────────────────────────────

const podiumRotation = () => Quaternion.fromEulerDegrees(0, PODIUM_ROTATION_Y, 0)

/** Straight off the armature markers KJ placed in scene.glb — no centre-and-spacing
 *  maths, because the four are not evenly spaced and that is the point. */
function slotOffset(i: number): Vector3 {
  const p = PODIUM_SLOTS[i] ?? PODIUM_SLOTS[0]
  return Vector3.create(p.x, p.y, p.z)
}

function pageTarget(dir: -1 | 1): void {
  const pages = Math.max(1, Math.ceil(entries.length / PODIUM_COUNT))
  page = (page + dir + pages) % pages
  console.log(`[Podium] page ${page + 1}/${pages}`)
  render()
}

function makePageButton(dir: -1 | 1): void {
  // Just outside whichever marker is furthest that way, so the pagers follow the markers
  // rather than a spacing constant that no longer exists.
  const xs = PODIUM_SLOTS.map(p => p.x)
  const endX = dir > 0 ? Math.max(...xs) : Math.min(...xs)
  const z = PODIUM_SLOTS.reduce((a, p) => a + p.z, 0) / PODIUM_SLOTS.length
  const at = Vector3.create(endX + dir * PODIUM_PAGE_OFFSET, PODIUM_SLOTS[0].y + PODIUM_PAGE_Y, z)

  // Was a bare CL_POINTER box with no MeshRenderer — a working button nobody could see
  // (KJ 2026-09-21). Now an emissive panel facing the same way as the avatars, with its
  // own label, so it reads as a control rather than an invisible hotspot.
  const e = engine.addEntity()
  Transform.create(e, { position: at, rotation: podiumRotation(), scale: Vector3.create(PODIUM_PAGE_SIZE.x, PODIUM_PAGE_SIZE.y, PODIUM_PAGE_SIZE.z) })
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, {
    albedoColor: Color4.create(PODIUM_PAGE_COLOR.r, PODIUM_PAGE_COLOR.g, PODIUM_PAGE_COLOR.b, 0.92),
    emissiveColor: PODIUM_PAGE_COLOR,
    emissiveIntensity: 1.1,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
    castShadows: false,
  })
  MeshCollider.setBox(e, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: e, opts: { button: InputAction.IA_POINTER, hoverText: dir > 0 ? 'Next gardeners' : 'Previous gardeners', maxDistance: 8 } },
    () => pageTarget(dir),
  )

  // Label on its own entity: a TextShape on the panel would inherit the panel's scale and
  // come out squashed by the 0.08 depth.
  const cap = engine.addEntity()
  Transform.create(cap, { position: Vector3.create(at.x, at.y + PODIUM_PAGE_SIZE.y * 0.85, at.z) })
  TextShape.create(cap, {
    text: dir > 0 ? 'Next' : 'Prev', fontSize: 1.4,
    textColor: Color4.create(0.98, 0.9, 0.7, 1), outlineWidth: 0.14, outlineColor: Color4.Black(),
  })
  Billboard.create(cap, { billboardMode: BillboardMode.BM_Y })
}

function build(): void {
  if (built || PODIUM_COUNT <= 0) return
  built = true
  for (let i = 0; i < PODIUM_COUNT; i++) {
    const at = slotOffset(i)

    const avatar = engine.addEntity()
    Transform.create(avatar, { position: at, rotation: podiumRotation() })

    const label = engine.addEntity()
    Transform.create(label, { position: Vector3.create(at.x, at.y + PODIUM_LABEL_Y, at.z) })
    TextShape.create(label, { text: '', fontSize: 2, textColor: Color4.create(0.98, 0.78, 0.46, 1), outlineWidth: 0.12, outlineColor: Color4.Black() })
    // Y-billboard: the plates rendered mirrored from the front before this, because a
    // fixed rotation only reads correctly from one side.
    Billboard.create(label, { billboardMode: BillboardMode.BM_Y })

    slots.push({ avatar, label })
  }
  makePageButton(-1)
  makePageButton(1)
  // Print every slot's WORLD position: the stand sits under a parent rotated -90° on Y,
  // so "where did the avatars actually go" is worth one line of proof rather than a
  // second round of squinting at screenshots.
  const where = slots.map((sl, i) => {
    const t = Transform.get(sl.avatar).position
    return `#${i + 1}(${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)})`
  }).join(' ')
  console.log(`[Podium] built ${PODIUM_COUNT} plinth(s) — slots at ${where}  | from scene.glb armature markers`)
}

// ── Render ────────────────────────────────────────────────────

function render(): void {
  if (!built) return
  const start = page * PODIUM_COUNT
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i]
    const e = entries[start + i]
    const show = !!e
    VisibilityComponent.createOrReplace(slot.avatar, { visible: show })
    if (!show) {
      TextShape.getMutable(slot.label).text = ''
      AvatarShape.deleteFrom(slot.avatar)          // an empty pod holds nobody
      continue
    }

    const rank = start + i + 1
    TextShape.getMutable(slot.label).text = `#${rank}  ${e.displayName}\n${e.count} waters`

    const address = (e.address ?? '').toLowerCase()
    if (!address) { AvatarShape.deleteFrom(slot.avatar); continue }
    const p = profiles.get(address)
    if (p === undefined) { void fetchProfile(address) }   // renders default until it lands
    AvatarShape.createOrReplace(slot.avatar, {
      id: address,
      name: e.displayName,
      wearables: p?.wearables ?? [],
      emotes: [],
      ...(p?.bodyShape  ? { bodyShape: p.bodyShape }   : {}),
      ...(p?.skinColor  ? { skinColor: p.skinColor }   : {}),
      ...(p?.hairColor  ? { hairColor: p.hairColor }   : {}),
      ...(p?.eyeColor   ? { eyeColor:  p.eyeColor  }   : {}),
    })
  }
}

export function setupPodium(): void {
  if (PODIUM_COUNT <= 0) { console.log('[Podium] disabled (PODIUM_COUNT = 0)'); return }
  build()
  room.onMessage('leaderboardUpdate', (data) => {
    try { entries = JSON.parse(data.allTimeJson) as BoardEntry[] } catch { return }
    page = 0
    render()
  })
  console.log(`[Podium] ready · leaderboardUpdate listeners=${room.listenerCount('leaderboardUpdate')}`)
}
