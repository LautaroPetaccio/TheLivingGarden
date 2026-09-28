// =============================================================
// Bloom Garden v2 — Hall of Fame stand layout (pure data, shared by client + server)
//
// KJ's Blender scene.glb carries 55 placeholder HallOfFame_Module stands: 9 array-modifier
// rows (pitch 5.125 m) of the one module in assets/scene/Models/hallOfFameStand.
// BAKED 2026-09-25 from scene.glb nodes HallOfFame_Module … .008: each array row unrolled into
// its module origins, world = (8 - glb.x, glb.y, glb.z + 24). rot = the entity yaw that lands
// the module on its placeholder (placeholder yaw minus the yaw the module file already
// carries, mirrored). The Avenue's slots (config.ts AVENUE_POSITIONS) are derived from this.
//
// Module anatomy (measured from hallOfFameStand.glb; in ENTITY-local metres, +X = the back,
// -X = the front a visitor stands at): a stepped wedge 1.6 m wide (Z) x 1.74 m deep (X), flat
// soil top at y 1.25 spanning X -0.15..+0.8, the front face a plain vertical wall (y 0.04-0.67).
// =============================================================

export const HOF_MODULES: ReadonlyArray<{ x: number; y: number; z: number; rot: number }> = [
  // row 1
  { x: 47.794, y: 0, z: 6.642, rot: 0 },
  // row 2
  { x: 49.783, y: 0.049, z: 6.706, rot: 180 },
  { x: 49.783, y: 0.049, z: 11.832, rot: 180 },
  { x: 49.783, y: 0.049, z: 16.958, rot: 180 },
  { x: 49.783, y: 0.049, z: 22.084, rot: 180 },
  { x: 49.783, y: 0.049, z: 27.21, rot: 180 },
  { x: 49.783, y: 0.049, z: 32.336, rot: 180 },
  { x: 49.783, y: 0.049, z: 37.462, rot: 180 },
  { x: 49.783, y: 0.049, z: 42.587, rot: 180 },
  // row 3
  { x: 33.178, y: 0.049, z: 9.44, rot: 180 },
  { x: 33.178, y: 0.049, z: 14.566, rot: 180 },
  { x: 33.178, y: 0.049, z: 19.692, rot: 180 },
  { x: 33.178, y: 0.049, z: 24.818, rot: 180 },
  { x: 33.178, y: 0.049, z: 29.944, rot: 180 },
  { x: 33.178, y: 0.049, z: 35.07, rot: 180 },
  { x: 33.178, y: 0.049, z: 40.196, rot: 180 },
  // row 4
  { x: 40.286, y: 0.049, z: 10.0, rot: 180 },
  { x: 40.286, y: 0.049, z: 15.126, rot: 180 },
  { x: 40.286, y: 0.049, z: 20.252, rot: 180 },
  { x: 40.286, y: 0.049, z: 25.378, rot: 180 },
  { x: 40.286, y: 0.049, z: 30.504, rot: 180 },
  { x: 40.286, y: 0.049, z: 35.63, rot: 180 },
  { x: 40.286, y: 0.049, z: 40.756, rot: 180 },
  // row 5
  { x: 47.85, y: 0.049, z: 42.61, rot: 0 },
  { x: 47.85, y: 0.049, z: 37.485, rot: 0 },
  { x: 47.85, y: 0.049, z: 32.359, rot: 0 },
  { x: 47.85, y: 0.049, z: 27.233, rot: 0 },
  { x: 47.85, y: 0.049, z: 22.107, rot: 0 },
  { x: 47.85, y: 0.049, z: 16.981, rot: 0 },
  { x: 47.85, y: 0.049, z: 11.855, rot: 0 },
  // row 6
  { x: 55.041, y: 0.049, z: 50.182, rot: 0 },
  { x: 55.041, y: 0.049, z: 45.056, rot: 0 },
  { x: 55.041, y: 0.049, z: 39.93, rot: 0 },
  { x: 55.041, y: 0.049, z: 34.804, rot: 0 },
  { x: 55.041, y: 0.049, z: 29.678, rot: 0 },
  { x: 55.041, y: 0.049, z: 24.552, rot: 0 },
  { x: 55.041, y: 0.049, z: 19.426, rot: 0 },
  { x: 55.041, y: 0.049, z: 14.3, rot: 0 },
  { x: 55.041, y: 0.049, z: 9.174, rot: 0 },
  { x: 55.041, y: 0.049, z: 4.048, rot: 0 },
  { x: 55.041, y: 0.049, z: -1.078, rot: 0 },
  // row 7
  { x: 38.053, y: 0.049, z: 43.137, rot: 0 },
  { x: 38.053, y: 0.049, z: 38.011, rot: 0 },
  { x: 38.053, y: 0.049, z: 32.885, rot: 0 },
  { x: 38.053, y: 0.049, z: 27.76, rot: 0 },
  { x: 38.053, y: 0.049, z: 22.634, rot: 0 },
  { x: 38.053, y: 0.049, z: 17.508, rot: 0 },
  { x: 38.053, y: 0.049, z: 12.382, rot: 0 },
  { x: 38.053, y: 0.049, z: 7.256, rot: 0 },
  // row 8
  { x: 38.785, y: 0.049, z: 54.556, rot: 270 },
  { x: 43.911, y: 0.049, z: 54.556, rot: 270 },
  { x: 49.037, y: 0.049, z: 54.556, rot: 270 },
  // row 9
  { x: 49.175, y: 0.049, z: -6.95, rot: 90 },
  { x: 44.05, y: 0.049, z: -6.95, rot: 90 },
  { x: 38.924, y: 0.049, z: -6.95, rot: 90 },
]

/** Soil top: height above the module origin, and how far BEHIND the origin its centre is. */
export const HOF_SOIL_Y      = 1.25
export const HOF_SOIL_BACK   = 0.32
/** Front face: how far in FRONT of the soil centre the plain wall stands. */
export const HOF_FRONT_OUT   = 1.19

/** Unit vector a visitor faces to look at the module (its front), for entity yaw `rot`. */
function frontOf(rot: number): { x: number; z: number } {
  const r = (rot * Math.PI) / 180
  return { x: -Math.cos(r), z: Math.sin(r) }
}

/** One Avenue slot per stand: the soil centre, at soil height, facing the visitor. The Avenue's
 *  own `rot` convention is 0 = facing +z, so it is atan2(front.x, front.z). */
export function hofAvenueSlots(): Array<{ id: string; x: number; y: number; z: number; rot: number }> {
  return HOF_MODULES.map((m, i) => {
    const f = frontOf(m.rot)
    const rot = ((Math.round((Math.atan2(f.x, f.z) * 180) / Math.PI) % 360) + 360) % 360
    return {
      id: `av_${i + 1}`,
      x: Number((m.x - f.x * HOF_SOIL_BACK).toFixed(3)),
      y: Number((m.y + HOF_SOIL_Y).toFixed(3)),
      z: Number((m.z - f.z * HOF_SOIL_BACK).toFixed(3)),
      rot,
    }
  })
}
