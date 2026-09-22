// =============================================================
// Bloom Garden v2 — Avenue inspect card (CLIENT ONLY)
//
// design/communal-planters.md: tapping an Avenue flower zooms onto it and shows
// everything that makes that one flower singular — who grew it, who helped it grow,
// who gave it to whom, how long it has stood there, how many gardeners have stopped
// to look. The data all exists already (keepsake provenance, box waterers, gift
// chain); this is where it becomes readable.
//
// Camera: a VirtualCamera entity per open card, pointed at the cube via lookAtEntity,
// released when the card closes. AVENUE_CAMERA_ZOOM turns it off if an explorer
// mishandles it — the card still works, you just don't move.
// =============================================================

import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { engine, Entity, Transform, VirtualCamera, MainCamera, timers } from '@dcl/sdk/ecs'
import {
  AVENUE_CAMERA_ZOOM, AVENUE_CAMERA_PUSH_FRACTION, AVENUE_CAMERA_MIN_DIST, AVENUE_CAMERA_MS,
  PLANTER_TIDY_MIN_AWAY_MS, rarityTierById, plantSpeciesById,
} from './shared/config'

export interface AvenueCardData {
  slotId:     string
  ownerName:  string
  flower:     string
  rarityTier: number
  since:      number
  grownBy:    string
  openedAt:   number
  helpers:    string[]
  giftedBy:   string
  looks:      number
  mine:       boolean
  /** Where the flower sits — the camera leans toward this from wherever the player's own
   *  camera already is (see showAvenueCard), so `facing` was dropped: a fixed compass
   *  bearing isn't needed once the camera starts from the player's own pose. */
  at:         { x: number; y: number; z: number }
}

let card: AvenueCardData | null = null
let camera: Entity | null = null
let target: Entity | null = null
let onRecall: (() => void) | null = null
/** The player's own camera pose at the moment the card opened — the close transition eases
 *  BACK to this exact pose before releasing control, instead of handing control back to the
 *  live camera directly. */
let basePos: { x: number; y: number; z: number } | null = null
let baseRot: { x: number; y: number; z: number; w: number } | null = null

export function isAvenueCardOpen(): boolean { return card !== null }

export function showAvenueCard(data: AvenueCardData, recall: () => void): void {
  closeAvenueCard()
  card = data
  onRecall = recall
  if (!AVENUE_CAMERA_ZOOM) return
  const flowerPos = { x: data.at.x, y: data.at.y + 0.25, z: data.at.z }
  const playerCam = Transform.getOrNull(engine.CameraEntity)
  if (!playerCam) return   // no live camera to record — skip the move entirely rather than guess
  basePos = playerCam.position
  baseRot = playerCam.rotation
  // Lean in by a FRACTION of however far the player already is, not toward a fixed close
  // distance — proportional, so standing close to a cube doesn't turn into a macro shot
  // (KJ 2026-09-22).
  const dx = flowerPos.x - basePos.x, dz = flowerPos.z - basePos.z
  const dist = Math.max(0.001, Math.hypot(dx, dz))
  const push = Math.min(dist * AVENUE_CAMERA_PUSH_FRACTION, Math.max(0, dist - AVENUE_CAMERA_MIN_DIST))
  target = engine.addEntity()
  Transform.create(target, { position: flowerPos })
  camera = engine.addEntity()
  Transform.create(camera, { position: { x: basePos.x + (dx / dist) * push, y: basePos.y, z: basePos.z + (dz / dist) * push } })
  VirtualCamera.create(camera, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(AVENUE_CAMERA_MS / 1000) }, lookAtEntity: target })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camera })
}

export function closeAvenueCard(): void {
  card = null
  onRecall = null
  const zoomCam = camera, lookTarget = target, pos = basePos, rot = baseRot
  camera = null; target = null; basePos = null; baseRot = null
  if (zoomCam === null) return
  if (pos === null || rot === null) {   // shouldn't happen (set together with camera), but never guess a pose
    MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    engine.removeEntity(zoomCam)
    if (lookTarget !== null) engine.removeEntity(lookTarget)
    return
  }
  // Ease back through the EXACT pose the player's camera started from — no lookAtEntity, so
  // nothing forces a stare — THEN release control. Releasing straight to the live camera
  // snapped hard: the SDK's eased transition only fires on a virtualCameraEntity SWITCH, so
  // it can't be trusted to smooth a bare "go back to the default camera" on its own, and
  // lookAtEntity itself was forcing a rotation the player never actually had (KJ 2026-09-22:
  // "the return needs to be a gentle zoom, not a spin").
  const returnCam = engine.addEntity()
  Transform.create(returnCam, { position: pos, rotation: rot })
  VirtualCamera.create(returnCam, { defaultTransition: { transitionMode: VirtualCamera.Transition.Time(AVENUE_CAMERA_MS / 1000) } })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: returnCam })
  engine.removeEntity(zoomCam)
  if (lookTarget !== null) engine.removeEntity(lookTarget)
  timers.setTimeout(() => {
    // Only release if nothing newer (another card opened mid-return) has already taken over.
    if (MainCamera.getOrNull(engine.CameraEntity)?.virtualCameraEntity === returnCam) {
      MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: undefined })
    }
    engine.removeEntity(returnCam)
  }, AVENUE_CAMERA_MS + 50)
}

const DARK   = { r: 0.085, g: 0.078, b: 0.067, a: 0.96 }
const RAISED = { r: 1, g: 1, b: 1, a: 0.08 }
const CREAM  = { r: 0.957, g: 0.918, b: 0.824, a: 1 }
const DIM    = { r: 0.83,  g: 0.82,  b: 0.78,  a: 1 }
const MOSS   = { r: 0.18,  g: 0.49,  b: 0.34,  a: 1 }
const INK    = { r: 0.07,  g: 0.065, b: 0.06,  a: 1 }

/** "3 days" / "4 hours" / "just now" — the Avenue has no timers, so this is prose, not a countdown. */
function ago(ms: number): string {
  if (!ms) return ''
  const s = Math.max(0, Date.now() - ms) / 1000
  if (s < 90) return 'just now'
  const m = s / 60
  if (m < 90) return `${Math.round(m)} minute${Math.round(m) === 1 ? '' : 's'} ago`
  const h = m / 60
  if (h < 36) return `${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'} ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? '' : 's'} ago`
}

export function AvenueCardUi(props: { px: (n: number) => number; fs: (n: number) => number; mobile: boolean; maxH: number }) {
  if (!card) return null
  const { px, fs } = props
  const c    = card
  const tier = rarityTierById(c.rarityTier)
  const name = plantSpeciesById(c.flower)?.name ?? c.flower

  // Every line that has something to say; nothing rendered for what this flower lacks.
  const rows: Array<{ k: string; v: string }> = []
  rows.push({ k: 'On show by', v: c.ownerName })
  if (c.grownBy && c.grownBy !== c.ownerName) rows.push({ k: 'Grown by', v: c.grownBy })
  if (c.giftedBy) rows.push({ k: 'A gift from', v: c.giftedBy })
  if (c.openedAt) rows.push({ k: 'Opened', v: ago(c.openedAt) })
  if (c.since) rows.push({ k: 'On the Avenue', v: `since ${ago(c.since)}` })
  if (c.helpers.length > 0) rows.push({ k: c.helpers.length === 1 ? 'Watered by' : `Watered by ${c.helpers.length}`, v: c.helpers.join(', ') })
  if (c.looks > 0) rows.push({ k: 'Admired by', v: `${c.looks} gardener${c.looks === 1 ? '' : 's'}` })
  // The crowding rule (design/communal-planters.md rule 4) is otherwise invisible until it
  // happens to you — KJ 2026-09-22 asked for it explained on the owner's own card. It's
  // conditional (only fires if a newcomer actually needs the slot), so this states the rule
  // rather than faking a countdown to an event that might never happen.
  if (c.mine) rows.push({ k: 'Kept safe', v: `Returns to your inventory only if you're away ${Math.round(PLANTER_TIDY_MIN_AWAY_MS / 3_600_000)}h+ and a newcomer needs the slot — never lost` })

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '12%', left: 0 }, width: '100%', flexDirection: 'row', justifyContent: 'center' }}>
      <UiEntity
        uiTransform={{ width: px(props.mobile ? 560 : 400), maxHeight: props.maxH, flexDirection: 'column', alignItems: 'center', padding: { left: px(22), right: px(22), top: px(16), bottom: px(18) }, borderRadius: px(22) }}
        uiBackground={{ color: DARK }}
      >
        {/* close */}
        <UiEntity uiTransform={{ width: '100%', flexDirection: 'row', justifyContent: 'flex-end', height: px(30) }}>
          <UiEntity uiTransform={{ width: px(34), height: px(30), alignItems: 'center', justifyContent: 'center', borderRadius: px(15) }} uiBackground={{ color: RAISED }} onMouseDown={closeAvenueCard}>
            <Label value="x" fontSize={fs(16)} color={DIM} textAlign="middle-center" textWrap="nowrap" uiTransform={{ width: '100%', height: '100%' }} />
          </UiEntity>
        </UiEntity>

        {plantSpeciesById(c.flower)
          ? <UiEntity uiTransform={{ width: px(112), height: px(112) }} uiBackground={{ textureMode: 'stretch', texture: { src: `assets/images/plantThumbs/${c.flower}.png` } }} />
          : <UiEntity uiTransform={{ width: px(112), height: px(112), alignItems: 'center', justifyContent: 'center' }}>
              <UiEntity uiTransform={{ width: px(56), height: px(56), borderRadius: px(28) }} uiBackground={{ color: { ...tier.seedColor, a: 1 } }} />
            </UiEntity>}

        <Label value={name} fontSize={fs(24)} color={CREAM} textAlign="middle-center" textWrap="wrap" uiTransform={{ width: '100%', height: fs(34), margin: { top: px(4) } }} />

        <UiEntity uiTransform={{ height: px(30), padding: { left: px(16), right: px(16) }, margin: { top: px(6), bottom: px(10) }, alignItems: 'center', justifyContent: 'center', borderRadius: px(15) }} uiBackground={{ color: c.rarityTier > 0 ? { ...tier.seedColor, a: 1 } : RAISED }}>
          <Label value={tier.name} fontSize={fs(15)} color={c.rarityTier > 0 ? INK : CREAM} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: '100%' }} />
        </UiEntity>

        {rows.map((r) => (
          // No fixed height on the value: a long line (helper lists, the "Kept safe" rule)
          // wrapped to more lines than fs(20) tall and bled into "Take it back" below it
          // (KJ 2026-09-22 screenshot). Yoga sizes a heightless Label to its own wrapped
          // text, so the row just grows instead of clipping.
          <UiEntity key={r.k} uiTransform={{ width: '100%', flexDirection: 'row', alignItems: 'flex-start', margin: { bottom: px(6) } }}>
            <Label value={r.k} fontSize={fs(13)} color={DIM} textAlign="top-left" textWrap="nowrap" uiTransform={{ width: '38%', height: fs(20) }} />
            <Label value={r.v} fontSize={fs(13)} color={CREAM} textAlign="top-left" textWrap="wrap" uiTransform={{ width: '62%' }} />
          </UiEntity>
        ))}

        {/* Owner's action: take it back. Everyone else just closes. */}
        <UiEntity uiTransform={{ display: c.mine ? 'flex' : 'none', width: '100%', height: px(44), margin: { top: px(10) }, alignItems: 'center', justifyContent: 'center', borderRadius: px(22) }} uiBackground={{ color: MOSS }}
          onMouseDown={() => { const f = onRecall; closeAvenueCard(); f?.() }}>
          <Label value="Take it back" fontSize={fs(17)} color={CREAM} textAlign="middle-center" textWrap="nowrap" uiTransform={{ height: '100%' }} />
        </UiEntity>
      </UiEntity>
    </UiEntity>
  )
}
