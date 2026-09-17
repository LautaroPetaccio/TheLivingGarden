// =============================================================
// Bloom Garden v2 — Moonlit Bloom spectacle (CLIENT ONLY)
//
// The rare variant has to READ as rare. Retinting the bloom FX cool-white is
// invisible in daylight, so the Moonlit Bloom changes the light itself:
//   1. night falls   — SkyboxTime on the root entity rolls the sky to midnight;
//                      removing it at bloom reset lets dawn break again
//   2. moon wisps    — slow glowing lights rise from the whole garden, only
//                      readable because the sky is dark
// Everything is created on the first Moonlit Bloom — zero cost on a normal day.
// =============================================================

import {
  engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode,
  Billboard, BillboardMode, SkyboxTime, TransitionMode,
} from '@dcl/sdk/ecs'
import { GARDEN_BOUNDS, SPARKLE_SRC } from './shared/config'

const NIGHT_TIME_S   = 0        // seconds since 00:00 — midnight
const WISP_COUNT     = 28       // TUNING — pooled, billboard planes
const WISP_Y_MIN     = 0.2
const WISP_Y_MAX     = 6.5
const WISP_SIZE_MIN  = 0.22
const WISP_SIZE_MAX  = 0.55
const WISP_RAMP_S    = 6        // wisps swell in over the nightfall, not all at once
const SYSTEM_NAME    = 'moonlight-wisps'

interface Wisp {
  entity: Entity
  x: number; z: number; y: number
  size: number; speed: number
  swayPhase: number; swayFreq: number; swayAmp: number
}

const wisps: Wisp[] = []
let active = false
let ramp   = 0   // 0→1 master scale, eases the whole field in

function rnd(min: number, max: number): number { return min + Math.random() * (max - min) }

function respawn(w: Wisp, y: number): void {
  w.x = rnd(GARDEN_BOUNDS.xMin, GARDEN_BOUNDS.xMax)
  w.z = rnd(GARDEN_BOUNDS.zMin, GARDEN_BOUNDS.zMax)
  w.y = y
}

function createWisps(): void {
  for (let i = 0; i < WISP_COUNT; i++) {
    const entity = engine.addEntity()
    Transform.create(entity, { position: { x: 0, y: -100, z: 0 }, scale: { x: 0, y: 0, z: 0 } })
    MeshRenderer.setPlane(entity)
    Material.setPbrMaterial(entity, {
      texture:           Material.Texture.Common({ src: SPARKLE_SRC }),
      alphaTexture:      Material.Texture.Common({ src: SPARKLE_SRC }),
      transparencyMode:  MaterialTransparencyMode.MTM_ALPHA_BLEND,
      albedoColor:       { r: 0.85, g: 0.92, b: 1.0, a: 0.9 },
      emissiveColor:     { r: 0.55, g: 0.75, b: 1.0 },
      emissiveIntensity: 3,
      castShadows:       false,
    })
    Billboard.create(entity, { billboardMode: BillboardMode.BM_ALL })
    const w: Wisp = {
      entity, x: 0, z: 0, y: 0,
      size: rnd(WISP_SIZE_MIN, WISP_SIZE_MAX), speed: rnd(0.18, 0.42),
      swayPhase: rnd(0, Math.PI * 2), swayFreq: rnd(0.2, 0.5), swayAmp: rnd(0.25, 0.7),
    }
    respawn(w, rnd(WISP_Y_MIN, WISP_Y_MAX))   // start spread through the column, not in one sheet
    wisps.push(w)
  }
}

function wispSystem(dt: number): void {
  ramp = Math.min(1, ramp + dt / WISP_RAMP_S)
  for (const w of wisps) {
    w.y += w.speed * dt
    if (w.y > WISP_Y_MAX) respawn(w, WISP_Y_MIN)
    w.swayPhase += w.swayFreq * dt
    // Swell from nothing at the ground to full mid-column and back to nothing at the top —
    // no pop at either end, and no per-frame material writes.
    const k = Math.sin(((w.y - WISP_Y_MIN) / (WISP_Y_MAX - WISP_Y_MIN)) * Math.PI) * w.size * ramp
    const t = Transform.getMutable(w.entity)
    t.position = { x: w.x + Math.sin(w.swayPhase) * w.swayAmp, y: w.y, z: w.z + Math.cos(w.swayPhase * 0.7) * w.swayAmp }
    t.scale    = { x: k, y: k, z: k }
  }
}

/** Night falls and the wisps rise. Safe to call again mid-bloom (late joiner re-send). */
export function startMoonlight(): void {
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: NIGHT_TIME_S, transitionMode: TransitionMode.TM_FORWARD })
  if (active) return
  active = true
  ramp   = 0
  if (wisps.length === 0) createWisps()
  engine.addSystem(wispSystem, undefined, SYSTEM_NAME)
  console.log('[Moonlight] night falls')
}

/** Dawn breaks: hand the sky back to the world clock and put the wisps away. */
export function stopMoonlight(): void {
  if (!active) return
  active = false
  SkyboxTime.deleteFrom(engine.RootEntity)
  engine.removeSystem(SYSTEM_NAME)
  for (const w of wisps) {
    const t = Transform.getMutable(w.entity)
    t.position = { x: w.x, y: -100, z: w.z }
    t.scale    = { x: 0, y: 0, z: 0 }
  }
  console.log('[Moonlight] dawn')
}
