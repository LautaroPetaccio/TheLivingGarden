// =============================================================
// Bloom Garden v2 — Rarity VFX on a revealed flower (CLIENT ONLY)
//
// KJ's tier table (2026-09-18), with KJ's meaning of the words:
//   "pulse"     = emissive pulsed INTO the plant's own material (not a halo beside it)
//   "particles" = many small sparkles above and around the plant
//   Rare       green pulse
//   Epic       blue particles
//   Legendary  tonal purple pulse + purple particles           (+ pulsing light, desktop)
//   Exotic     alternating lime/red pulse + particles + tween  (+ pulsing light, desktop)
// Common/Uncommon get nothing. Mythic/Unique are custom models (not built).
//
// The pulse uses GltfNodeModifiers, which REPLACES a node's material — so it re-supplies
// the plant's real texture/colour/alpha from PLANT_MATERIALS and adds emissive on top.
// It steps through PULSE_LEVELS fixed states and only re-sends on a step change: in the
// Unity explorer every material change restarts that material's (async, throttled) load,
// so a continuous 12 Hz float never finished loading and no pulse was ever visible
// (KJ 2026-09-18). A handful of repeating states become material-cache hits instead.
// Each step is still a main-thread material rebuild, so the step count and period are the
// perf knobs: 3 levels = 4 rebuilds per period (was 8 with 5 levels).
// The Exotic sway is a renderer-side Tween (was a per-frame Transform write).
// vfxFlags lets the dev test panel switch each effect off live for fps A/B checks.
// =============================================================

import { engine, Entity, Transform, GltfNodeModifiers, ParticleSystem, Material, MaterialTransparencyMode, LightSource, Tween, TweenSequence } from '@dcl/sdk/ecs'
import { Color4, Quaternion } from '@dcl/sdk/math'
import { isMobile } from '@dcl/sdk/platform'
import { SPARKLE_SRC } from './shared/config'
import { PLANT_MATERIALS, PlantNodeMaterial } from './plantMaterials'

// const enums in @dcl/ecs internals, not re-exported (same as Clean The Club's stinkSystem)
const PSB_ADD    = 1
const PS_PLAYING = 0
const EF_EASESINE = 6   // EasingFunction
const TL_YOYO     = 1   // TweenLoop

type RGB = { r: number; g: number; b: number }
const GREEN       = { r: 0.204, g: 0.808, b: 0.463 }
const BLUE        = { r: 0.263, g: 0.561, b: 1.000 }
const ICE         = { r: 0.550, g: 0.800, b: 1.000 }
const PURPLE      = { r: 0.631, g: 0.294, b: 0.953 }
const LAVENDER    = { r: 0.860, g: 0.700, b: 1.000 }
const DEEP_PURPLE = { r: 0.380, g: 0.080, b: 0.780 }
const LIME        = { r: 0.608, g: 0.820, b: 0.255 }
const RED         = { r: 1.000, g: 0.200, b: 0.150 }

interface Sparkles { colors: [RGB, RGB]; rate: number; max: number; size: [number, number] }
interface TierVfx {
  pulse:     { colors: RGB[]; mode: 'solid' | 'tonal' | 'alternate'; periodS: number; peak: number } | null
  particles: Sparkles | null
  light:     number   // peak LightSource intensity (0 = none); desktop only
  tween:     boolean
}
// TUNING — every number here. Each tier must read as clearly MORE than the one below.
const TIER_VFX: Record<number, TierVfx> = {
  2: { pulse: { colors: [GREEN], mode: 'solid', periodS: 3.0, peak: 3 }, particles: null, light: 0, tween: false },
  3: { pulse: null, particles: { colors: [BLUE, ICE], rate: 30, max: 90, size: [0.05, 0.11] }, light: 0, tween: false },
  4: { pulse: { colors: [DEEP_PURPLE, LAVENDER], mode: 'tonal', periodS: 2.6, peak: 5 }, particles: { colors: [PURPLE, LAVENDER], rate: 45, max: 120, size: [0.06, 0.13] }, light: 3_000, tween: false },
  5: { pulse: { colors: [LIME, RED], mode: 'alternate', periodS: 2.2, peak: 7 }, particles: { colors: [LIME, RED], rate: 65, max: 170, size: [0.06, 0.15] }, light: 4_500, tween: true },
}

const PULSE_LEVELS    = 3      // cached material states per colour (0 = no emissive) — each step = one material rebuild
const SPARKLE_RADIUS  = 0.38   // m — emitter sphere around the plant
const SPARKLE_Y       = 0.30   // m above the soil — roughly the middle of a 0.55 m plant
const LIGHT_Y         = 0.45   // m above the soil
const TWEEN_YAW_DEG   = 18     // Exotic: sway, not a spin (off-centre model origins would orbit)
const TWEEN_YAW_S     = 6

/** Dev A/B switches (test panel). Runtime only; production keeps everything on. */
export const vfxFlags = { pulse: true, particles: true, lights: true }

interface Active {
  plant:     Entity
  mats:      ReadonlyArray<PlantNodeMaterial>
  def:       TierVfx
  emitter:   Entity | null
  light:     Entity | null
  phase:     number
  sentKey:   string   // last pulse state sent — re-send only when it changes
}
const active = new Map<string, Active>()

/** Start the tier's effects on a just-created flower entity. Safe to call repeatedly. */
export function attachPlantVfx(key: string, plant: Entity, speciesId: string, tier: number, soil: { x: number; y: number; z: number }): void {
  detachPlantVfx(key)
  const def = TIER_VFX[tier]
  if (!def) return
  let emitter: Entity | null = null
  if (def.particles) {
    const p = def.particles, [a, b] = p.colors
    emitter = engine.addEntity()
    Transform.create(emitter, { position: { x: soil.x, y: soil.y + SPARKLE_Y, z: soil.z } })
    ParticleSystem.create(emitter, {
      shape: ParticleSystem.Shape.Sphere({ radius: SPARKLE_RADIUS }),
      rate: p.rate, maxParticles: p.max, lifetime: 2.0,
      gravity: 0, additionalForce: { x: 0, y: 0.18, z: 0 },
      initialVelocitySpeed: { start: 0.03, end: 0.15 },
      initialSize: { start: p.size[0], end: p.size[1] }, sizeOverTime: { start: 1, end: 0.15 },
      initialColor: { start: Color4.create(a.r, a.g, a.b, 1), end: Color4.create(b.r, b.g, b.b, 1) },
      colorOverTime: { start: Color4.create(1, 1, 1, 1), end: Color4.create(1, 1, 1, 0) },
      texture: { src: SPARKLE_SRC }, billboard: true, blendMode: PSB_ADD,
      loop: true, prewarm: false, active: vfxFlags.particles, playbackState: PS_PLAYING,   // prewarm simulated a full lifetime on the spawn frame
    })
  }
  // Real light is desktop-only for the same reason as the moonlight: godot-explorer's
  // LightSource flicker bug (#2868) on mobile.
  let light: Entity | null = null
  if (def.light > 0 && !isMobile()) {
    light = engine.addEntity()
    Transform.create(light, { position: { x: soil.x, y: soil.y + LIGHT_Y, z: soil.z } })
    const c = def.pulse?.colors[0] ?? { r: 1, g: 1, b: 1 }
    LightSource.create(light, { active: vfxFlags.lights, color: c, intensity: 0, shadow: false, type: { $case: 'point', point: {} } })
  }
  active.set(key, {
    plant, emitter, light, def,
    mats: PLANT_MATERIALS[speciesId] ?? [],
    phase: Math.random() * 10,
    sentKey: '',
  })
  if (def.tween) {
    // Sway −yaw → +yaw → back, sine-eased, looping in the renderer
    const half = TWEEN_YAW_S * 500
    const base = Transform.get(plant).rotation
    const l = Quaternion.multiply(base, Quaternion.fromEulerDegrees(0, -TWEEN_YAW_DEG, 0))
    const r = Quaternion.multiply(base, Quaternion.fromEulerDegrees(0, TWEEN_YAW_DEG, 0))
    Tween.createOrReplace(plant, { duration: half, easingFunction: EF_EASESINE, mode: { $case: 'rotate', rotate: { start: l, end: r } } })
    TweenSequence.createOrReplace(plant, { sequence: [], loop: TL_YOYO })
  }
}

/** Test panel: switch one effect family on/off on every live flower. */
export function setVfxFlag(name: keyof typeof vfxFlags, on: boolean): void {
  vfxFlags[name] = on
  for (const a of active.values()) {
    if (name === 'particles' && a.emitter !== null) ParticleSystem.getMutable(a.emitter).active = on
    if (name === 'lights' && a.light !== null) LightSource.getMutable(a.light).active = on
    if (name === 'pulse') {
      a.sentKey = ''
      if (!on && GltfNodeModifiers.has(a.plant)) GltfNodeModifiers.deleteFrom(a.plant)
    }
  }
}

/** Remove particles + light; the caller owns the plant entity (its override goes with it). */
export function detachPlantVfx(key: string): void {
  const a = active.get(key)
  if (!a) return
  if (a.emitter !== null) engine.removeEntity(a.emitter)
  if (a.light !== null) engine.removeEntity(a.light)
  active.delete(key)
}

function lerp(a: RGB, b: RGB, t: number): RGB {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t }
}

function applyPulse(a: Active, now: number): void {
  const p = a.def.pulse
  if (!p || !vfxFlags.pulse) return
  const t = (now + a.phase) / p.periodS
  const cycle = Math.floor(t)
  const level = Math.round(Math.sin(Math.PI * (t - cycle)) * (PULSE_LEVELS - 1))   // 0 → top → 0; colour swaps at 0
  const colorIdx = p.mode === 'alternate' ? cycle % p.colors.length : 0
  const key = `${colorIdx}|${level}`
  if (key === a.sentKey) return
  a.sentKey = key
  const k = level / (PULSE_LEVELS - 1)
  const color = p.mode === 'tonal' ? lerp(p.colors[0], p.colors[1], k) : p.colors[colorIdx]
  if (a.light !== null) {
    const l = LightSource.getMutable(a.light)
    l.color = color
    l.intensity = a.def.light * (0.25 + 0.75 * k)
  }
  if (a.mats.length === 0) return
  GltfNodeModifiers.createOrReplace(a.plant, {
    modifiers: a.mats.map(m => {
      const tex = m.texture ? Material.Texture.Common({ src: m.texture }) : undefined
      return {
        path: m.path,
        material: { material: { $case: 'pbr' as const, pbr: {
          texture: tex,
          emissiveTexture: tex,
          albedoColor: { r: m.color[0], g: m.color[1], b: m.color[2], a: m.color[3] },
          transparencyMode: m.blend ? MaterialTransparencyMode.MTM_ALPHA_BLEND : MaterialTransparencyMode.MTM_OPAQUE,
          metallic: m.metallic,
          roughness: m.roughness,
          emissiveColor: color,
          emissiveIntensity: p.peak * k,
        } } },
      }
    }),
  })
}

function plantVfxSystem(): void {
  if (active.size === 0) return
  const now = Date.now() / 1000
  for (const a of active.values()) applyPulse(a, now)
}

let started = false
export function setupPlantVfx(): void {
  if (started) return
  started = true
  engine.addSystem(plantVfxSystem)
}
