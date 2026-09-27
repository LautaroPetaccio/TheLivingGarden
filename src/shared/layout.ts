// =============================================================
// Bloom Garden v2 — Code-owned plant layout
//
// Creator Hub is unavailable and the Blender layout is changing, so plant
// positions are owned HERE rather than hand-edited in main.composite. The
// composite still provides the plant ENTITIES (names, GLBs, animators) —
// this table only overrides where they stand. Everything derived from a
// plant (anchor, rose, water drop, labels, click box) is created after the
// override, so it all follows automatically.
//
// BAKED 2026-09-21 from KJ's in-world Plant editor (src/plantLayoutTool.ts): place the
// plants in world, Save / export, and the server logs this block. That replaced the
// Blender round trip (tools/blender_export_layout.py + fit-layout.mjs), which existed
// only because Creator Hub was unavailable — those still work, they are just not the
// only path now. An EMPTY table is an exact no-op: every plant keeps its composite
// transform. Coordinates rounded to 3 dp (sub-millimetre) for legibility.
//
//   x, y, z  — scene-local metres (same space as the composite)
//   rotY     — optional yaw in degrees
//   scale    — optional uniform scale
// =============================================================

export interface PlantPlacement { x: number; y: number; z: number; rotY?: number; scale?: number }

export const PLANT_LAYOUT: Readonly<Record<string, PlantPlacement>> = {
  'FastPlant_1': { x: 8.2, y: 0.771, z: -4.6, rotY: 135, scale: 0.6 },
  'FastPlant_2': { x: 20.5, y: 0.812, z: 7, rotY: 57, scale: 0.6 },
  'FastPlant_3': { x: 11.4, y: 0.833, z: 10.5, rotY: 162, scale: 0.382 },
  'FastPlant_4': { x: 11.5, y: 0.818, z: 8.3, rotY: 297, scale: 0.382 },
  'FastPlant_5': { x: 23.6, y: 0.773, z: 46.8, rotY: 27, scale: 0.382 },
  'FastPlant_6': { x: 11.5, y: 0.886, z: 40.5, rotY: 222, scale: 0.382 },
  'Plant_1': { x: 20.3, y: 0.84, z: 11.6, rotY: 45, scale: 0.691 },
  'Plant_10': { x: 6.6, y: 0.836, z: -4.3, rotY: 75, scale: 1.1 },
  'Plant_11': { x: 23.1, y: 0.969, z: -4.4, rotY: 15, scale: 1 },
  'Plant_12': { x: 20.5, y: 0.759, z: 41.6, rotY: 60, scale: 1 },
  'Plant_13': { x: 20.7, y: 0.868, z: 38.8, rotY: 330, scale: 0.8 },
  'Plant_14': { x: 20.6, y: 0.724, z: 36.5, rotY: 300, scale: 0.7 },
  'Plant_15': { x: 11.3, y: 0.849, z: 36.6, rotY: 270, scale: 1 },
  'Plant_16': { x: 11.7, y: 0.864, z: 39.2, rotY: 345, scale: 1 },
  'Plant_17': { x: 9.1, y: 0.806, z: 52.5, rotY: 225, scale: 0.7 },
  'Plant_18': { x: 21.5, y: 0.577, z: 27.4, rotY: 225, scale: 1 },
  'Plant_19': { x: 12.4, y: 0.475, z: 31.7, rotY: 195, scale: 0.8 },
  'Plant_2': { x: 23.3, y: 0.501, z: 1, rotY: 0, scale: 1 },
  'Plant_20': { x: 7.7, y: 0.771, z: 52.7, rotY: 255, scale: 1 },
  'Plant_21': { x: 8.2, y: 0.643, z: 46.8, rotY: 120, scale: 0.7 },
  'Plant_22': { x: 3.5, y: 0.822, z: 52.5, rotY: 225, scale: 1 },
  'Plant_23': { x: 12.5, y: 0.552, z: 16.3, rotY: 150, scale: 0.643 },
  'Plant_24': { x: 11.4, y: 0.852, z: 11.6, rotY: 125, scale: 0.643 },
  'Plant_25': { x: 20.5, y: 0.812, z: 6.1, rotY: 249, scale: 0.541 },
  'Plant_26': { x: 9.6, y: 0.818, z: -4.5, rotY: 194, scale: 0.7 },
  'Plant_27': { x: 3.9, y: 0.789, z: -4.5, rotY: 60, scale: 0.848 },
  'Plant_28': { x: 5.2, y: 0.833, z: -4.5, rotY: 89, scale: 0.541 },
  'Plant_29': { x: 11.4, y: 0.93, z: 41.7, rotY: 90, scale: 0.7 },
  'Plant_3': { x: 21.6, y: 0.678, z: 20.5, rotY: 120, scale: 1 },
  'Plant_30': { x: 11.5, y: 0.796, z: 37.9, rotY: 120, scale: 0.7 },
  'Plant_31': { x: 20.6, y: 0.812, z: 40.2, rotY: 195, scale: 0.7 },
  'Plant_32': { x: 20.5, y: 0.805, z: 37.5, rotY: 150, scale: 0.6 },
  'Plant_4': { x: 8.3, y: 0.569, z: 1, rotY: 45, scale: 0.6 },
  'Plant_5': { x: 11.3, y: 0.763, z: 9.3, rotY: 135, scale: 0.9 },
  'Plant_6': { x: 28.1, y: 0.98, z: -4.3, rotY: 135, scale: 0.8 },
  'Plant_7': { x: 20.6, y: 0.922, z: 8.7, rotY: 315, scale: 1 },
  'Plant_8': { x: 20.8, y: 1.009, z: 10.1, rotY: 150, scale: 0.691 },
  'Plant_9': { x: 11.3, y: 0.831, z: 6, rotY: 240, scale: 0.7 },
}

/** Loose composite props (lampposts and their light overlays, sit spots, Discord buttons) moved with
 *  the Test panel's Prop editor (propLayoutTool.ts). Keyed by composite entity NAME; every member of a
 *  prop is listed, so a lamp's post and its three light overlays stay together. Empty = a no-op. */
export interface PropPlacement { x: number; y: number; z: number; rotY?: number }
export const PROP_LAYOUT: Readonly<Record<string, PropPlacement>> = {
  'lamppost': { x: 1.75, y: 0, z: 3.84 },
  'lamppost_light_high': { x: 1.75, y: 0, z: 3.84 },
  'lamppost_light_mid': { x: 1.75, y: 0, z: 3.84 },
  'lamppost_light_low': { x: 1.75, y: 0, z: 3.84 },
  'lamppost_2': { x: 1.2, y: 0, z: 46.4 },
  'lamppost_light_high_2': { x: 1.2, y: 0, z: 46.399 },
  'lamppost_light_mid_2': { x: 1.2, y: 0, z: 46.399 },
  'lamppost_light_low_2': { x: 1.2, y: 0, z: 46.399 },
  'lamppost_3': { x: 30.9, y: 0, z: 39 },
  'lamppost_light_high_3': { x: 30.905, y: 0, z: 39.003 },
  'lamppost_light_mid_3': { x: 30.905, y: 0, z: 39.003 },
  'lamppost_light_low_3': { x: 30.905, y: 0, z: 39.003 },
  'lamppost_4': { x: 30.9, y: 0, z: 9 },
  'lamppost_light_high_4': { x: 30.902, y: 0, z: 9.005 },
  'lamppost_light_mid_4': { x: 30.902, y: 0, z: 9.005 },
  'lamppost_light_low_4': { x: 30.902, y: 0, z: 9.005 },
  'Sit Spot_1': { x: 3.271, y: 0, z: 16.853 },
  'Sit Spot_2': { x: 5.642, y: 0, z: 16.148 },
  'Sit Spot_3': { x: 2.317, y: 0, z: 19.555 },
  'Sit Spot_4': { x: 1.64, y: 0, z: 21.371 },
  'Sit Spot_5': { x: 1.64, y: 0, z: 22.037 },
  'Sit Spot_6': { x: 1.64, y: 0, z: 22.661 },
  'Sit Spot_7': { x: 1.64, y: 0, z: 25.302 },
  'Sit Spot_8': { x: 1.64, y: 0, z: 25.93 },
  'Sit Spot_9': { x: 1.64, y: 0, z: 26.544 },
  'Sit Spot_10': { x: 2.42, y: 0, z: 28.698 },
  'Sit Spot_11': { x: 3.3, y: 0, z: 32.1 },
  'Sit Spot_12': { x: 5.294, y: 0, z: 31.7 },
  'Discord Button': { x: -17, y: 1.7, z: 46.6, rotY: 90 },
  'Discord Button_2': { x: 39.5, y: 1.1, z: 2.1 },
  'PouchRack': { x: -29.2, y: 0.2, z: 46.1, rotY: 180 },
  'FlowerShelf': { x: -21, y: 0.1, z: 54.7, rotY: 0 },
  'AlmanacWall': { x: -31.4, y: -0.1, z: 50.4, rotY: 270 },
  'ExamTable': { x: -25.4, y: 0.2, z: 53.6 },
}
