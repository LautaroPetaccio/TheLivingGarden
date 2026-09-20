// =============================================================
// Bloom Garden v2 — Onboarding (CLIENT ONLY)
//
// Two stages, in the order the game actually allows:
//   1. WATER  — taught at spawn. The only verb available immediately.
//   2. PLANT  — sleeps until the player is actually holding a seed (seeds only
//               fall from blooms), then points at a planter held for them and
//               wears KJ's toon shell over it.
//
// Both stages draw the same thing: a row of chevrons running from the target
// back toward the player, with a pulse travelling along it. The direction is
// carried by MOTION, not by more geometry — 4 × 20 tris for the whole trail.
// The bob is driven from this system's own tick, never a looping Tween (the
// explorer writes every actively-tweened Transform back into the scene every
// frame — that is what tanked scene tick fps in the 09-18 perf pass).
//
// Which stage is live is the SERVER's call, via onboardingState { watered,
// planted } — persisted per wallet, sent on join and after each first.
//
// ⚠️ Registered from index.ts AFTER setupWateringSystem(), which calls
// room.clear() — a handler registered before that clear is silently wiped.
// =============================================================

import { engine, Transform, GltfContainer, VisibilityComponent, ColliderLayer, Entity } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { PlantData } from './wateringSystem'
import { isBloomActive } from './bloomSystem'
import { nearestFreePlanter, freePlanterPos } from './boxSystem'
import { showPersistent, hidePersistent, showToast } from './notifications'
import {
  ARROW_MODEL_SRC, ARROW_SCALE, ARROW_FORWARD_YAW, ARROW_STANDOFF, ARROW_GROUND_LIFT,
  ARROW_BOB_AMPLITUDE, ARROW_BOB_PERIOD_MS,
  ARROW_CHEVRON_COUNT, ARROW_CHEVRON_SPACING, ARROW_CHEVRON_WAVE_MS,
  TOON_HIGHLIGHT_SRC, TOON_HIGHLIGHT_SCALE,
  ONBOARDING_REPICK_S, ONBOARDING_MAX_RANGE,
  ONBOARDING_WATER_HINT, ONBOARDING_PLANT_HINT,
  ONBOARDING_SEED_TOAST, ONBOARDING_SEED_TOAST_MS,
  PLANTER_RESERVE_RETRY_S,
} from './shared/config'

type Stage = 'none' | 'water' | 'plant'

let watered = true          // assume done until the server says otherwise — never nag on a
let planted = true          // dropped message
let hasSeeds = false
let stage: Stage = 'none'
let seedToastShown = false

let chevrons: Entity[] = []
let shell: Entity | null = null

let target: Vector3 | null = null   // what the trail points at
let heldBoxId = ''                  // planter the server is holding for us ('' = none)
let repickIn = 0
let retryIn  = 0
let elapsed  = 0

// ── Entities ──────────────────────────────────────────────────

function ensureChevrons(): Entity[] {
  if (chevrons.length === 0) {
    for (let i = 0; i < ARROW_CHEVRON_COUNT; i++) {
      const e = engine.addEntity()
      Transform.create(e, { scale: Vector3.create(ARROW_SCALE, ARROW_SCALE, ARROW_SCALE) })
      // No colliders: a decal on the ground must not swallow a tap meant for a plant.
      GltfContainer.create(e, {
        src: ARROW_MODEL_SRC,
        visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
        invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      })
      VisibilityComponent.create(e, { visible: false })
      chevrons.push(e)
    }
  }
  return chevrons
}

function ensureShell(): Entity {
  if (shell === null) {
    shell = engine.addEntity()
    Transform.create(shell, { scale: Vector3.create(TOON_HIGHLIGHT_SCALE, TOON_HIGHLIGHT_SCALE, TOON_HIGHLIGHT_SCALE) })
    GltfContainer.create(shell, {
      src: TOON_HIGHLIGHT_SRC,
      visibleMeshesCollisionMask: ColliderLayer.CL_NONE,
      invisibleMeshesCollisionMask: ColliderLayer.CL_NONE,
    })
    VisibilityComponent.create(shell, { visible: false })
  }
  return shell
}

function showChevrons(visible: boolean): void {
  for (const e of chevrons) VisibilityComponent.getMutable(e).visible = visible
}

function showShell(visible: boolean): void {
  if (shell !== null) VisibilityComponent.getMutable(shell).visible = visible
}

function clearVisuals(): void {
  showChevrons(false)
  showShell(false)
  hidePersistent()
}

// ── Targets ───────────────────────────────────────────────────

/** Nearest plant that still needs water, as a COPY — the live Transform position
 *  keeps changing underneath us. */
function nearestDroopyPlant(from: Vector3): Vector3 | null {
  let best: Vector3 | null = null
  let bestSq = ONBOARDING_MAX_RANGE * ONBOARDING_MAX_RANGE
  for (const [entity, plant] of engine.getEntitiesWith(PlantData)) {
    if (plant.isWatered) continue
    const p = Transform.getOrNull(entity)?.position
    if (!p) continue
    const dx = p.x - from.x
    const dz = p.z - from.z
    const sq = dx * dx + dz * dz
    if (sq < bestSq) { bestSq = sq; best = Vector3.create(p.x, p.y, p.z) }
  }
  return best
}

/** Keep a planter held for us, and return where it stands. Asks again when we have
 *  none, or when the one we held was taken/deleted in the meantime. */
function heldPlanter(from: Vector3, dt: number): Vector3 | null {
  retryIn -= dt
  if (heldBoxId) {
    const p = freePlanterPos(heldBoxId)
    if (p) {
      const shellEntity = ensureShell()
      const st = Transform.getMutable(shellEntity)
      st.position = Vector3.create(p.x, 0, p.z)
      st.rotation = Quaternion.fromEulerDegrees(0, p.rot, 0)
      showShell(true)
      return Vector3.create(p.x, 0, p.z)
    }
    heldBoxId = ''            // someone planted in it — ask for another
    showShell(false)
  }
  if (retryIn <= 0) {
    retryIn = PLANTER_RESERVE_RETRY_S
    const candidate = nearestFreePlanter(from)
    if (candidate) room.send('reserveBox', { boxId: candidate.boxId })
  }
  return null
}

// ── The trail ─────────────────────────────────────────────────

/** Lay the chevrons from `to` back toward the player, all aimed at `to`, with the
 *  pulse running along the row so the eye is pulled toward the target. */
function drawTrail(player: Vector3, to: Vector3): void {
  const row = ensureChevrons()
  let dx = player.x - to.x
  let dz = player.z - to.z
  const len = Math.sqrt(dx * dx + dz * dz)
  if (len > 0.001) { dx /= len; dz /= len } else { dx = 0; dz = 1 }
  const yaw = Math.atan2(-dx, -dz) * 180 / Math.PI + ARROW_FORWARD_YAW
  const rotation = Quaternion.fromEulerDegrees(0, yaw, 0)

  // Don't run the row past the player when they are standing on top of the target.
  const span = Math.min(len, ARROW_STANDOFF + ARROW_CHEVRON_SPACING * (ARROW_CHEVRON_COUNT - 1))

  for (let i = 0; i < row.length; i++) {
    const frac = row.length === 1 ? 0 : i / (row.length - 1)
    const out  = ARROW_STANDOFF + (span - ARROW_STANDOFF) * frac
    // Phase runs from the far chevron to the near one, so the pulse travels toward `to`.
    const phase = (elapsed * 1000 / ARROW_CHEVRON_WAVE_MS) - frac
    const bob   = (Math.sin(phase * Math.PI * 2) + 1) * 0.5 * ARROW_BOB_AMPLITUDE
    const t = Transform.getMutable(row[i])
    t.position = Vector3.create(to.x + dx * out, to.y + ARROW_GROUND_LIFT + bob, to.z + dz * out)
    t.rotation = rotation
    VisibilityComponent.getMutable(row[i]).visible = out <= len + 0.01
  }
}

// ── Stage selection ───────────────────────────────────────────

function currentStage(): Stage {
  if (!watered) return 'water'
  if (!planted && hasSeeds) return 'plant'
  return 'none'
}

function applyStage(): void {
  const next = currentStage()
  if (next === stage) return
  stage = next
  repickIn = 0
  retryIn  = 0
  target   = null
  clearVisuals()
  if (stage === 'plant' && !seedToastShown) {
    seedToastShown = true
    showToast(ONBOARDING_SEED_TOAST, ONBOARDING_SEED_TOAST_MS)
  }
  console.log(`[Onboarding] stage → ${stage}`)
}

// ── System ────────────────────────────────────────────────────

function onboardingSystem(dt: number): void {
  if (stage === 'none') return
  elapsed += dt

  // Nothing droops during a bloom and the server rejects watering outright — telling a
  // new player to tap a plant right then would only earn them a rejection.
  if (stage === 'water' && isBloomActive()) { clearVisuals(); return }

  const player = Transform.getOrNull(engine.PlayerEntity)?.position
  if (!player) return

  if (stage === 'water') {
    repickIn -= dt
    if (repickIn <= 0) {
      repickIn = ONBOARDING_REPICK_S
      target = nearestDroopyPlant(player)
    }
  } else {
    target = heldPlanter(player, dt)
  }

  if (!target) { showChevrons(false); hidePersistent(); return }
  drawTrail(player, target)

  // Re-assert every tick: the persistent pill is shared, and a bloom start or a garden
  // reset calls hidePersistent() from the watering system.
  showPersistent(stage === 'water' ? ONBOARDING_WATER_HINT : ONBOARDING_PLANT_HINT)
}

export function setupOnboarding(): void {
  room.onMessage('onboardingState', (data) => {
    watered = !!data.watered
    planted = !!data.planted
    applyStage()
  })
  room.onMessage('pouchUpdate', (data) => {
    let total = 0
    try { for (const n of JSON.parse(data.countsJson) as number[]) total += n } catch { return }
    hasSeeds = total > 0
    applyStage()
  })
  room.onMessage('boxReserved', (data) => {
    heldBoxId = data.boxId
    if (!heldBoxId) showShell(false)
    else console.log(`[Onboarding] planter ${heldBoxId} held for this gardener`)
  })
  engine.addSystem(onboardingSystem)
  console.log(`[Onboarding] ready · onboardingState listeners=${room.listenerCount('onboardingState')}`)
}
