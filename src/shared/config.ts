// =============================================================
// The Living Garden — Shared Configuration
// Imported by both server and client so constants stay in sync.
// =============================================================

/** Daily bloom windows in UTC. Add or remove entries to change the schedule. */
export const BLOOM_WINDOWS: ReadonlyArray<{ hour: number; minute: number }> = [
  { hour:  5, minute: 30 },   // 05:30 UTC
  { hour: 17, minute: 30 },   // 17:30 UTC
]

export const TOTAL_PLANTS       = 38   // 32 regular + 6 fast
export const BLOOM_THRESHOLD    = Math.ceil(TOTAL_PLANTS * 0.8)

// ── v2: gardener-scaled DECAY (KJ decision 2026-09-16, replaces threshold scaling) ──
// The bloom threshold stays a flat 80% of the garden for everyone, so a solo
// player still "completes" the watering; what scales with gardeners present is
// how fast plants dry out. Solo pace is ~1 plant per 4–5 s (31 plants ≈ 2.5 min),
// so solo decay must comfortably exceed that; the garden gets thirstier with
// each extra gardener until the v1 rate at DECAY_FULL_GARDENERS (GDD §5 "four").
export const DECAY_FACTOR_AT_SOLO  = 3.0   // TUNING — solo: 3 min × 3 = 9 min per plant
export const DECAY_FULL_GARDENERS  = 4     // at this many, decay is the base (v1) rate

/** Multiplier on the base expiry for `gardeners` present: 1 → 3.0, 2 → 2.33, 3 → 1.67, 4+ → 1. */
export function decayFactor(gardeners: number): number {
  const n = Math.max(1, Math.min(DECAY_FULL_GARDENERS, gardeners))
  return DECAY_FACTOR_AT_SOLO + (1 - DECAY_FACTOR_AT_SOLO) * (n - 1) / (DECAY_FULL_GARDENERS - 1)
}

/** Bloom size for the FX/seed phases: solo blooms stay small and quiet (GDD §3),
 *  a full-garden bloom needs DECAY_FULL_GARDENERS present. */
export function bloomScaleFor(gardeners: number): number {
  return Math.max(1, Math.min(DECAY_FULL_GARDENERS, gardeners)) / DECAY_FULL_GARDENERS
}

// ── v2: bloom seeds (GDD §3 step 3, §6 walk-through gathering) ──
// Seeds are a SHARED spectacle with PER-PLAYER pickup: every player sees the same
// rain and may collect each seed once — nobody takes a seed from anyone else.
// Yield and rarity scale with CONTRIBUTORS — players who watered this cycle (KJ
// 2026-09-18), same count as the bloom's length. Since everyone collects every seed,
// count is capped (~×2.5) and the group reward goes into RARITY instead (~×3), plus a
// guaranteed Rare-or-better seed when enough gardeners bloom together.
const SEEDS_BY_CONTRIBUTORS     = [4, 5, 6, 7, 8, 10]            // TUNING — 1..6+
const RARE_MULT_BY_CONTRIBUTORS = [1, 1.4, 1.8, 2.2, 2.6, 3]     // TUNING — × SEED_RARE_AT_SOLO
export const SEED_RARE_AT_SOLO  = 0.10      // TUNING — "mostly normal, occasionally rare"
export const GUARANTEED_RARE_AT_CONTRIBUTORS = 4   // TUNING — one seed of tier ≥ Rare from here
export const SEED_FALL_MS       = 5_000     // drift-down duration from spawn height to ground
export const SEED_LIFETIME_MS   = 120_000   // ungathered seeds fade after 2 min (the trickle's last wave lands 1 min before the end)
export const SEED_GATHER_RADIUS = 2.0       // m — walking this close starts the drift toward you
export const SEED_COLLECT_RADIUS = 0.7      // m — seed this close is gathered (client sends request)
export const SEED_SPAWN_HEIGHT  = 7         // m — seeds fall from the bloom canopy

const byContributors = <T>(table: ReadonlyArray<T>, contributors: number): T =>
  table[Math.max(1, Math.min(table.length, contributors)) - 1]

/** Seeds a bloom drops in total (across all its trickle waves). */
export function seedSpawnCount(contributors: number): number {
  return byContributors(SEEDS_BY_CONTRIBUTORS, contributors)
}

/** Chance a seed rolls ABOVE Common: 10% solo → 30% at 6+ contributors. `rareSeedMult`
 *  is BLOOM_VARIANTS' per-variant boost (moonlit blooms roll rarer); capped at 1. See
 *  rollSeedTier for what "above Common" rolls into. */
export function seedRareChance(contributors: number, rareSeedMult = 1): number {
  return Math.min(1, SEED_RARE_AT_SOLO * byContributors(RARE_MULT_BY_CONTRIBUTORS, contributors) * rareSeedMult)
}
/** How long health must stay ≥ BLOOM_THRESHOLD (cumulatively) before bloom fires.
 *  Shared by server (sustain timer) and client (countdown display). */
export const BLOOM_SUSTAIN_MS   = 60_000   // the FULL-garden hold (4+ gardeners)
/** Hold time scales with gardeners like decay does (KJ 2026-09-17): solo, a minute is dead
 *  time — nothing can dry at 9-min decay — while in a group the hold IS the tension. */
const SUSTAIN_BY_GARDENERS_MS = [20_000, 35_000, 50_000, BLOOM_SUSTAIN_MS]   // TUNING — 1, 2, 3, 4+
export function bloomSustainMs(gardeners: number): number {
  return SUSTAIN_BY_GARDENERS_MS[Math.max(1, Math.min(SUSTAIN_BY_GARDENERS_MS.length, gardeners)) - 1]
}
export const DAILY_WATER_LIMIT  = 8
export const WATERED_EXPIRY_MS  = 3 * 60 * 1000        // 3 minutes
export const FAST_PLANT_EXPIRY_MS = 75_000               // 75 seconds
/** How long after bloom triggers before the server resets all plants. */
export const BLOOM_RESET_DELAY_MS = 6 * 60_000          // 6 minutes — the LONGEST bloom (see bloomDurationMs)

/** Bloom length by CONTRIBUTORS this cycle (players who watered since the last reset —
 *  not just present, so idlers can't stretch it). KJ 2026-09-18: solo 2 min … 6+ → 6 min.
 *  Index = contributors − 1; beyond the table stays at the last value. */
const BLOOM_MINUTES_BY_CONTRIBUTORS = [2, 3, 3.5, 4, 5, 6]   // TUNING
export function bloomDurationMs(contributors: number): number {
  const i = Math.max(1, Math.min(BLOOM_MINUTES_BY_CONTRIBUTORS.length, contributors)) - 1
  return BLOOM_MINUTES_BY_CONTRIBUTORS[i] * 60_000
}

/** Seed trickle: the bloom's seeds fall in waves across the bloom instead of all at once.
 *  Waves are SEED_WAVE_GAP_MS apart at most; the last one lands SEED_LAST_WAVE_BEFORE_END_MS
 *  before the bloom ends so it can still be gathered in the bloom. */
export const SEED_WAVE_GAP_MS             = 30_000   // TUNING
export const SEED_LAST_WAVE_BEFORE_END_MS = 60_000   // TUNING

// ── Scene-wide spatial / asset constants ─────────────────────
/** World-space centre of the Bloom model — used for sound, sparkles, shockwaves. */
export const BLOOM_CENTER = { x: 6.75, y: 2, z: 24 } as const
/** Shared sparkle texture used by all particle / FX systems. */
export const SPARKLE_SRC  = 'assets/scene/Images/sparkle.png'
/** Garden walkable area bounds — used for ambient FX spawning. */
export const GARDEN_BOUNDS = { xMin: 3, xMax: 14, zMin: 3, zMax: 22 } as const

// ── Golden seed chase (KJ 2026-09-18) ──
// One per bloom: appears GOLDEN_SEED_AT_FRACTION into the bloom and wanders the garden
// until it ends. Everyone may catch it once; each catcher rolls their own tier ≥
// GOLDEN_SEED_MIN_TIER. The server sends only { spawnedAt, pathSeed } — every client
// computes the same position from goldenSeedPos, so nothing streams per frame.
export const GOLDEN_SEED_AT_FRACTION   = 0.3   // TUNING — late enough that bloom-arrivals see it
export const GOLDEN_SEED_MIN_TIER      = 3     // TUNING — Epic or better
export const GOLDEN_SEED_CATCH_RADIUS  = 1.3   // m, 3D from chest height — generous for mobile

/** Where the golden seed is `tSec` after it appeared: a slow Lissajous wander inside
 *  GARDEN_BOUNDS (top speed ≈ 1 m/s — a gentle chase, never a sprint). */
export function goldenSeedPos(tSec: number, pathSeed: number): { x: number; y: number; z: number } {
  const b  = GARDEN_BOUNDS, margin = 0.8
  const cx = (b.xMin + b.xMax) / 2, ax = (b.xMax - b.xMin) / 2 - margin
  const cz = (b.zMin + b.zMax) / 2, az = (b.zMax - b.zMin) / 2 - margin
  const f  = (k: number) => (pathSeed * k) % 1                 // pathSeed-derived 0..1 values
  const w1 = 0.08 + 0.04 * f(0.37), w2 = 0.05 + 0.03 * f(0.71)
  return {
    x: cx + ax * Math.sin(w1 * tSec + f(0.13) * Math.PI * 2),
    y: 1.5 + 0.35 * Math.sin(0.9 * tSec + f(0.53) * Math.PI * 2),
    z: cz + az * Math.sin(w2 * tSec + f(0.91) * Math.PI * 2),
  }
}

export const PLANT_NAMES: string[] = [
  'Plant_1',  'Plant_2',  'Plant_3',  'Plant_4',
  'Plant_5',  'Plant_6',  'Plant_7',  'Plant_8',
  'Plant_9',  'Plant_10', 'Plant_11', 'Plant_12',
  'Plant_13', 'Plant_14', 'Plant_15', 'Plant_16',
  'Plant_17', 'Plant_18', 'Plant_19', 'Plant_20',
  'Plant_21', 'Plant_22', 'Plant_23', 'Plant_24',
  'Plant_25', 'Plant_26', 'Plant_27', 'Plant_28',
  'Plant_29', 'Plant_30', 'Plant_31', 'Plant_32',
  'FastPlant_1', 'FastPlant_2', 'FastPlant_3',
  'FastPlant_4', 'FastPlant_5', 'FastPlant_6',
]

/** Set of plant names that use FAST_PLANT_EXPIRY_MS instead of WATERED_EXPIRY_MS. */
export const FAST_PLANT_NAMES = new Set([
  'FastPlant_1', 'FastPlant_2', 'FastPlant_3',
  'FastPlant_4', 'FastPlant_5', 'FastPlant_6',
])

/** How long a plant stays watered when watered with `gardeners` present. */
export function plantDecayMs(plantId: string, gardeners: number): number {
  const base = FAST_PLANT_NAMES.has(plantId) ? FAST_PLANT_EXPIRY_MS : WATERED_EXPIRY_MS
  return Math.round(base * decayFactor(gardeners))
}

// ── v2: seed boxes (GDD §3 step 4, §4.1 D1 hook, §4.3 seed appointment) ──
// A caught seed is planted in a named box in the SHARED garden; it grows on a
// real-world timer and opens as an unidentified flower (rarity known, identity not).
// Planter layout — baked 2026-09-18 from KJ's in-preview placement (planterLayoutTool,
// Storage 'planterDraft'), 96 planters. TEMPORARY positions: KJ will re-lay them out.
// rot = degrees about Y; 0 = front (sign side) faces +z. Ids are stable: box_1..box_8
// kept their records (planted seeds moved onto these first eight spots).
export const BOX_POSITIONS: ReadonlyArray<{ id: string; x: number; z: number; rot: number }> = [
  { id: 'box_1', x: 29.8, z: 20.4, rot: 0 },
  { id: 'box_2', x: 27.9, z: 20.5, rot: 0 },
  { id: 'box_3', x: 26.2, z: 20.2, rot: 0 },
  { id: 'box_4', x: 24.6, z: 21.1, rot: 0 },
  { id: 'box_5', x: 22.4, z: 20.9, rot: 0 },
  { id: 'box_6', x: 21.1, z: 20.8, rot: 0 },
  { id: 'box_7', x: 30.2, z: 27.2, rot: 180 },
  { id: 'box_8', x: 28.9, z: 27.3, rot: 180 },
  { id: 'box_9', x: 27, z: 27.6, rot: 180 },
  { id: 'box_10', x: 25.7, z: 27.8, rot: 180 },
  { id: 'box_11', x: 24, z: 27.9, rot: 180 },
  { id: 'box_12', x: 22.5, z: 28.1, rot: 180 },
  { id: 'box_13', x: 21.3, z: 28.2, rot: 180 },
  { id: 'box_14', x: 1.8, z: 36.2, rot: 90 },
  { id: 'box_15', x: 1.9, z: 38.4, rot: 90 },
  { id: 'box_16', x: 2, z: 40.7, rot: 90 },
  { id: 'box_17', x: 1.4, z: 42.5, rot: 90 },
  { id: 'box_18', x: 1.9, z: 45.5, rot: 90 },
  { id: 'box_19', x: 1.6, z: 47.8, rot: 90 },
  { id: 'box_20', x: 1.5, z: 48.9, rot: 90 },
  { id: 'box_21', x: 1.3, z: 49.8, rot: 90 },
  { id: 'box_22', x: 2.7, z: 51.9, rot: 180 },
  { id: 'box_23', x: 3.9, z: 52.1, rot: 180 },
  { id: 'box_24', x: 5.1, z: 52.2, rot: 180 },
  { id: 'box_25', x: 6.6, z: 52.6, rot: 180 },
  { id: 'box_26', x: 8.5, z: 52.8, rot: 180 },
  { id: 'box_27', x: 10.2, z: 52.3, rot: 180 },
  { id: 'box_28', x: 17, z: 52.3, rot: 180 },
  { id: 'box_29', x: 18.3, z: 52.4, rot: 180 },
  { id: 'box_30', x: 20.2, z: 52.6, rot: 180 },
  { id: 'box_31', x: 21.4, z: 52.7, rot: 180 },
  { id: 'box_32', x: 23.5, z: 52.9, rot: 180 },
  { id: 'box_33', x: 25.6, z: 53, rot: 180 },
  { id: 'box_34', x: 28.1, z: 53.2, rot: 180 },
  { id: 'box_35', x: 29.9, z: 53.3, rot: 180 },
  { id: 'box_36', x: 30.6, z: 50.5, rot: 270 },
  { id: 'box_37', x: 30.8, z: 49, rot: 270 },
  { id: 'box_38', x: 30.8, z: 47.1, rot: 270 },
  { id: 'box_39', x: 31, z: 46, rot: 270 },
  { id: 'box_40', x: 31.3, z: 44.7, rot: 270 },
  { id: 'box_41', x: 30.9, z: 42.7, rot: 270 },
  { id: 'box_42', x: 31, z: 41.4, rot: 270 },
  { id: 'box_43', x: 31.1, z: 40.2, rot: 270 },
  { id: 'box_44', x: 30.2, z: 38.9, rot: 270 },
  { id: 'box_45', x: 30.6, z: 37.4, rot: 270 },
  { id: 'box_46', x: 30.8, z: 35.9, rot: 270 },
  { id: 'box_47', x: 31, z: 33.6, rot: 270 },
  { id: 'box_48', x: 30, z: 32, rot: 270 },
  { id: 'box_49', x: 30.3, z: 30.3, rot: 270 },
  { id: 'box_50', x: 1.7, z: 11.3, rot: 90 },
  { id: 'box_51', x: 2.1, z: 9.6, rot: 90 },
  { id: 'box_52', x: 2.2, z: 8.1, rot: 90 },
  { id: 'box_53', x: 1.8, z: 6.6, rot: 90 },
  { id: 'box_54', x: 1.6, z: 5.2, rot: 90 },
  { id: 'box_55', x: 2, z: 1.7, rot: 90 },
  { id: 'box_56', x: 1.5, z: 0, rot: 90 },
  { id: 'box_57', x: 1.3, z: -2.1, rot: 90 },
  { id: 'box_58', x: 2.9, z: -4.6, rot: 0 },
  { id: 'box_59', x: 4.9, z: -4.7, rot: 0 },
  { id: 'box_60', x: 7.4, z: -4.7, rot: 0 },
  { id: 'box_61', x: 9.3, z: -4.2, rot: 0 },
  { id: 'box_62', x: 11.8, z: -4.4, rot: 0 },
  { id: 'box_63', x: 17.7, z: -4.6, rot: 0 },
  { id: 'box_64', x: 19.5, z: -4.6, rot: 0 },
  { id: 'box_65', x: 21.4, z: -4.3, rot: 0 },
  { id: 'box_66', x: 23.4, z: -4.7, rot: 0 },
  { id: 'box_67', x: 25.6, z: -4.6, rot: 0 },
  { id: 'box_68', x: 27.9, z: -4.6, rot: 0 },
  { id: 'box_69', x: 30, z: -4.7, rot: 0 },
  { id: 'box_70', x: 30.7, z: -2.3, rot: 270 },
  { id: 'box_71', x: 31, z: -0.4, rot: 270 },
  { id: 'box_72', x: 31.2, z: 1.1, rot: 270 },
  { id: 'box_73', x: 30.6, z: 2.6, rot: 270 },
  { id: 'box_74', x: 30.8, z: 3.7, rot: 270 },
  { id: 'box_75', x: 30.9, z: 4.8, rot: 270 },
  { id: 'box_76', x: 31.1, z: 6, rot: 270 },
  { id: 'box_77', x: 31.4, z: 7, rot: 270 },
  { id: 'box_78', x: 31.6, z: 8.3, rot: 270 },
  { id: 'box_79', x: 31.1, z: 10, rot: 270 },
  { id: 'box_80', x: 31.1, z: 11.7, rot: 270 },
  { id: 'box_81', x: 31.3, z: 13.1, rot: 270 },
  { id: 'box_82', x: 31.6, z: 14.7, rot: 270 },
  { id: 'box_83', x: 31.5, z: 16.6, rot: 270 },
  { id: 'box_84', x: 30.6, z: 18.4, rot: 270 },
  { id: 'box_85', x: 25.5, z: 0.7, rot: 0 },
  { id: 'box_86', x: 26.2, z: 1.2, rot: 0 },
  { id: 'box_87', x: 26.8, z: 1.7, rot: 0 },
  { id: 'box_88', x: 26.7, z: 16.9, rot: 270 },
  { id: 'box_89', x: 26.7, z: 17.5, rot: 270 },
  { id: 'box_90', x: 27.6, z: 15.1, rot: 270 },
  { id: 'box_91', x: 26.6, z: 32.1, rot: 270 },
  { id: 'box_92', x: 25.9, z: 31.4, rot: 270 },
  { id: 'box_93', x: 25.4, z: 31.2, rot: 270 },
  { id: 'box_94', x: 27.8, z: 46.5, rot: 270 },
  { id: 'box_95', x: 26.6, z: 47.7, rot: 270 },
  { id: 'box_96', x: 26.1, z: 48.2, rot: 270 },
]
/** KJ's planter template (2026-09-17): origin at the base, front (+z) faces the
 *  garden, rim at y≈1.1. 4,440 tris — decimate before ship. */
export const BOX_MODEL_SRC   = 'assets/scene/Models/planterBox/planterBox.glb'
export const BOX_MODEL_SCALE = 0.6
export const BOX_MODEL_RIM_Y = 1.1 * BOX_MODEL_SCALE   // where the soil surface sits
/** KJ split the balloons out of the box template (2026-09-17) into their own GLB so
 *  they can animate independently — same origin/scale as the box, balloons rise to
 *  y≈3.1 in model space, so placing it at the box's own transform reconstructs the
 *  original combined layout exactly. Shown while a box holds a seed or an unharvested
 *  flower (v.owner truthy). The file has two 5 s loop clips, presumably one per balloon
 *  cluster — both are played simultaneously since it isn't confirmed which drives what. */
export const BALLOON_MODEL_SRC   = 'assets/scene/Models/planterBalloon/planterBalloon.glb'
export const BALLOON_ANIM_CLIPS  = ['balloons', 'balloons.001'] as const
/** KJ's seedling model (2026-09-17), stands in for the greybox sprout sphere while a
 *  box's seed is growing (unopened). The source file ships with no material — a
 *  `Material` component on the GltfContainer entity does NOT retint an imported mesh
 *  (that's not a thing GltfContainer supports; confirmed 2026-09-17 after the first
 *  attempt showed no visible difference between rarities). The two rarity colors are
 *  baked directly into two exported variants instead. */
export const SEEDLING_MODEL_SRC_NORMAL = 'assets/scene/Models/seedling/seedling_normal.glb'
export const SEEDLING_MODEL_SRC_RARE   = 'assets/scene/Models/seedling/seedling_rare.glb'
/** TUNING — GDD: overnight scale, "an evening plant opens by next morning" (~10 h).
 *  Set to 2 minutes for the greybox playtest so the whole loop fits one session. */
export const BOX_GROW_MS = 2 * 60_000

// ── Rarity + plant species catalog (2026-09-18) ──────────────────────────────
// KJ's expansion plan: 78 base models (77 from the original inventory + Void Tulip, a
// bonus find kept 2026-09-18) from Foundation's public asset-packs (Pirates,
// Genesis City, Fantasy, Halloween, Voxels, Western) x 6 procedural rarity tiers
// (Common..Exotic) = 468 look combinations via color/VFX layering, no new art per
// combination. Mythic and Unique are reserved for bespoke custom models (TBD),
// outside this generic tier system. Foundation asset-packs GLBs carry no explicit
// license — treat as CC BY-NC (non-commercial) pending KJ's conversation with
// Foundation (in progress 2026-09-18).
//
// WIRED UP 2026-09-18 (Phase 2): messages.ts, server.ts, boxSystem.ts, seedSystem.ts,
// playerInventory.ts, seedMenu.tsx, giftSystem.ts, ui.tsx, testPanel.tsx all roll and
// carry rarityTier/species now — the old rare:boolean is gone. Not yet done: real
// per-species flower/seedling models (still greybox spheres + a 2-color seedling GLB
// tinted by tier bucket, not per-species) and the actual pulse/particle VFX layer
// KJ's tier table calls for (only the seed/flower base COLOR is wired so far).

export interface PlantSpecies {
  id:          string   // stable id — also the asset folder name (disambiguated where
                         // two packs happened to reuse the same one, e.g. 'cactus')
  name:        string   // display name
  pack:        string   // source Foundation asset pack, kept for licensing/attribution tracking
  modelSrc:    string   // GLB path
  // Every model was authored at its own scale/origin/up-axis. These are computed from
  // each GLB's world-space bounds (accessor bounds pushed through the node hierarchy's
  // rotation/scale/translation — raw accessor bounds alone mis-sized 29 of 78, e.g.
  // Z-up voxel models and cm-authored meshes) so the largest dimension is ~0.55 m, the
  // lowest point sits at y=0 and the footprint is centred on the box.
  scale:       number
  baseYOffset: number
  offsetX:     number   // DCL metres; assumes explorers mirror glTF X (glTF +X = DCL -X)
  offsetZ:     number
}
/** The 78 committed base models. */
export const PLANT_SPECIES: ReadonlyArray<PlantSpecies> = [
  { id: 'curly_magic_bean_sprout', name: 'Curly Magic Bean Sprout', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/curly_magic_bean_sprout/curly_magic_bean_sprout.glb', scale: 0.4318, baseYOffset: 0.0057, offsetX: -0.0123, offsetZ: 0.0605 },
  { id: 'dracaena', name: 'Dracaena', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/dracaena/dracaena.glb', scale: 0.4089, baseYOffset: 0.0031, offsetX: -0.0081, offsetZ: 0.0017 },
  { id: 'large_light_green_grass_mound', name: 'Large Light Green Grass Mound', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/large_light_green_grass_mound/large_light_green_grass_mound.glb', scale: 0.0847, baseYOffset: 0.0188, offsetX: -0.0104, offsetZ: -0.0209 },
  { id: 'large_yellow-green_grass_mound', name: 'Large Yellow-Green Grass Mound', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/large_yellow-green_grass_mound/large_yellow-green_grass_mound.glb', scale: 0.0845, baseYOffset: 0.0015, offsetX: -0.0001, offsetZ: -0.0111 },
  { id: 'magic_bean_sprout', name: 'Magic Bean Sprout', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/magic_bean_sprout/magic_bean_sprout.glb', scale: 0.4877, baseYOffset: 0.0013, offsetX: -0.0461, offsetZ: 0.0504 },
  { id: 'mountain_ragweed', name: 'Mountain Ragweed', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/mountain_ragweed/mountain_ragweed.glb', scale: 0.4273, baseYOffset: 0.0125, offsetX: 0.1083, offsetZ: 0.0064 },
  { id: 'nutsedge', name: 'Nutsedge', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/nutsedge/nutsedge.glb', scale: 0.6076, baseYOffset: 0.0037, offsetX: 0.009, offsetZ: 0.002 },
  { id: 'purple_heart_plant', name: 'Purple Heart Plant', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/purple_heart_plant/purple_heart_plant.glb', scale: 0.4619, baseYOffset: -0.0, offsetX: 0.0052, offsetZ: 0.0775 },
  { id: 'purple_oyster_plant', name: 'Purple Oyster Plant', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/purple_oyster_plant/purple_oyster_plant.glb', scale: 0.497, baseYOffset: -0.0005, offsetX: 0.0102, offsetZ: 0.0371 },
  { id: 'shreed_plant', name: 'Shreed Plant', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/shreed_plant/shreed_plant.glb', scale: 0.3774, baseYOffset: 0.006, offsetX: -0.0243, offsetZ: 0.0951 },
  { id: 'single_magic_bean_sprout', name: 'Single Magic Bean Sprout', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/single_magic_bean_sprout/single_magic_bean_sprout.glb', scale: 0.6086, baseYOffset: 0.0014, offsetX: 0.0188, offsetZ: -0.0 },
  { id: 'small_green_grass_mound', name: 'Small Green Grass Mound', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/small_green_grass_mound/small_green_grass_mound.glb', scale: 0.168, baseYOffset: 0.0038, offsetX: 0.0137, offsetZ: -0.0067 },
  { id: 'small_lighter_green_grass_mound', name: 'Small Lighter Green Grass Mound', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/small_lighter_green_grass_mound/small_lighter_green_grass_mound.glb', scale: 0.1771, baseYOffset: 0.0041, offsetX: 0.0092, offsetZ: -0.0133 },
  { id: 'swamp_lily_pad', name: 'Swamp Lily Pad', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/swamp_lily_pad/swamp_lily_pad.glb', scale: 1.1633, baseYOffset: -0.019, offsetX: -0.0, offsetZ: 0.0035 },
  { id: 'swamp_red_cactus', name: 'Swamp Red Cactus', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/swamp_red_cactus/swamp_red_cactus.glb', scale: 0.2731, baseYOffset: 0.0, offsetX: 0.0003, offsetZ: 0.0085 },
  { id: 'sweet_geranium', name: 'Sweet Geranium', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/sweet_geranium/sweet_geranium.glb', scale: 0.3617, baseYOffset: 0.0082, offsetX: 0.0043, offsetZ: -0.0124 },
  { id: 'three-spiked_grass', name: 'Three-Spiked Grass', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/three-spiked_grass/three-spiked_grass.glb', scale: 1.1145, baseYOffset: 0.0188, offsetX: 0.0047, offsetZ: 0.0876 },
  { id: 'wild_chives', name: 'Wild Chives', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/wild_chives/wild_chives.glb', scale: 0.2772, baseYOffset: 0.0058, offsetX: 0.0036, offsetZ: 0.0558 },
  { id: 'wild_long_mushrooms', name: 'Wild Long Mushrooms', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/wild_long_mushrooms/wild_long_mushrooms.glb', scale: 0.7344, baseYOffset: 0.006, offsetX: 0.0036, offsetZ: 0.0325 },
  { id: 'yellow_croton_plant', name: 'Yellow Croton Plant', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/yellow_croton_plant/yellow_croton_plant.glb', scale: 0.3957, baseYOffset: -0.0072, offsetX: -0.0049, offsetZ: 0.0316 },
  { id: 'balsam_flower', name: 'Balsam Flower', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/balsam_flower/balsam_flower.glb', scale: 0.4457, baseYOffset: 0.0006, offsetX: -0.0048, offsetZ: -0.0058 },
  { id: 'birds_nest_fern', name: 'Birds Nest Fern', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/birds_nest_fern/birds_nest_fern.glb', scale: 0.5157, baseYOffset: -0.0124, offsetX: 0.0005, offsetZ: 0.0045 },
  { id: 'genesis_cactus', name: 'Cactus', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/cactus/cactus.glb', scale: 0.3071, baseYOffset: 0.0122, offsetX: 0.0, offsetZ: 0.0178 },
  { id: 'dandelion', name: 'Dandelion', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/dandelion/dandelion.glb', scale: 0.7793, baseYOffset: 0.0003, offsetX: 0.0093, offsetZ: 0.0684 },
  { id: 'flower_sprouts', name: 'Flower Sprouts', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/flower_sprouts/flower_sprouts.glb', scale: 0.7001, baseYOffset: 0.0104, offsetX: 0.0528, offsetZ: 0.0429 },
  { id: 'grass_sprout', name: 'Grass Sprout', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/grass_sprout/grass_sprout.glb', scale: 0.7863, baseYOffset: 0.0298, offsetX: -0.0244, offsetZ: 0.0011 },
  { id: 'gypsy_mushroom', name: 'Gypsy Mushroom', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/gypsy_mushroom/gypsy_mushroom.glb', scale: 1.6652, baseYOffset: -0.0, offsetX: 0.0002, offsetZ: 0.0 },
  { id: 'java_fern', name: 'Java Fern', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/java_fern/java_fern.glb', scale: 1.0099, baseYOffset: 0.0035, offsetX: 0.0208, offsetZ: -0.0132 },
  { id: 'kangaroo_paws', name: 'Kangaroo Paws', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/kangaroo_paws/kangaroo_paws.glb', scale: 0.3869, baseYOffset: 0.0063, offsetX: 0.0188, offsetZ: -0.0399 },
  { id: 'magenta_mushroom', name: 'Magenta Mushroom', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/magenta_mushroom/magenta_mushroom.glb', scale: 2.5405, baseYOffset: 0.0636, offsetX: -0.0893, offsetZ: 0.054 },
  { id: 'maidenhair_fern', name: 'Maidenhair Fern', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/maidenhair_fern/maidenhair_fern.glb', scale: 0.63, baseYOffset: 0.0069, offsetX: -0.0293, offsetZ: -0.0516 },
  { id: 'moss_rose', name: 'Moss Rose', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/moss_rose/moss_rose.glb', scale: 0.8545, baseYOffset: -0.0099, offsetX: 0.0096, offsetZ: -0.0164 },
  { id: 'ostrich_ferns', name: 'Ostrich Ferns', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/ostrich_ferns/ostrich_ferns.glb', scale: 0.9194, baseYOffset: 0.0061, offsetX: 0.0101, offsetZ: -0.0243 },
  { id: 'rose', name: 'Rose', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/rose/rose.glb', scale: 0.5522, baseYOffset: 0.0136, offsetX: 0.0124, offsetZ: -0.0188 },
  { id: 'rose_head', name: 'Rose Head', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/rose_head/rose_head.glb', scale: 0.8369, baseYOffset: 0.0193, offsetX: 0.0476, offsetZ: -0.0017 },
  { id: 'sunflower', name: 'Sunflower', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/sunflower/sunflower.glb', scale: 1.1275, baseYOffset: 0.0236, offsetX: -0.0568, offsetZ: -0.0829 },
  { id: 'sunflower_head', name: 'Sunflower Head', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/sunflower_head/sunflower_head.glb', scale: 0.815, baseYOffset: 0.0018, offsetX: -0.0, offsetZ: -0.005 },
  { id: 'sweet_pea', name: 'Sweet Pea', pack: 'genesis_city', modelSrc: 'assets/scene/Models/plants/genesis_city/sweet_pea/sweet_pea.glb', scale: 0.3951, baseYOffset: 0.0075, offsetX: 0.0437, offsetZ: -0.0355 },
  { id: 'flower_01', name: 'Flower 01', pack: 'halloween', modelSrc: 'assets/scene/Models/plants/halloween/flower_01/flower_01.glb', scale: 2.0068, baseYOffset: 0.0041, offsetX: -0.0039, offsetZ: -0.0338 },
  { id: 'flower_02', name: 'Flower 02', pack: 'halloween', modelSrc: 'assets/scene/Models/plants/halloween/flower_02/flower_02.glb', scale: 1.8143, baseYOffset: 0.0025, offsetX: -0.0053, offsetZ: -0.006 },
  { id: 'pumpkin_leaf', name: 'Pumpkin Leaf', pack: 'halloween', modelSrc: 'assets/scene/Models/plants/halloween/pumpkin_leaf/pumpkin_leaf.glb', scale: 1.1499, baseYOffset: 0.0122, offsetX: -0.1067, offsetZ: -0.037 },
  { id: 'pumpkin_leaf__2', name: 'Pumpkin Leaf  2', pack: 'halloween', modelSrc: 'assets/scene/Models/plants/halloween/pumpkin_leaf__2/pumpkin_leaf__2.glb', scale: 1.5643, baseYOffset: 0.0182, offsetX: -0.2681, offsetZ: 0.0482 },
  { id: 'areca_palm', name: 'Areca Palm', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/areca_palm/areca_palm.glb', scale: 0.2141, baseYOffset: 0.0, offsetX: -0.0175, offsetZ: -0.0032 },
  { id: 'bamboo', name: 'Bamboo', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/bamboo/bamboo.glb', scale: 0.1581, baseYOffset: 0.0002, offsetX: -0.0039, offsetZ: -0.0265 },
  { id: 'bamboo_culms', name: 'Bamboo Culms', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/bamboo_culms/bamboo_culms.glb', scale: 0.1483, baseYOffset: -0.0009, offsetX: 0.0, offsetZ: -0.0039 },
  { id: 'beach_fern', name: 'Beach Fern', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/beach_fern/beach_fern.glb', scale: 1.9661, baseYOffset: 0.0071, offsetX: 0.0341, offsetZ: 0.0015 },
  { id: 'beachgrass', name: 'Beachgrass', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/beachgrass/beachgrass.glb', scale: 0.4657, baseYOffset: 0.012, offsetX: 0.0186, offsetZ: -0.0222 },
  { id: 'beachgrass_fern', name: 'Beachgrass Fern', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/beachgrass_fern/beachgrass_fern.glb', scale: 0.4151, baseYOffset: -0.0023, offsetX: 0.0005, offsetZ: -0.0001 },
  { id: 'bird_of_paradise', name: 'Bird Of Paradise', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/bird_of_paradise/bird_of_paradise.glb', scale: 1.4774, baseYOffset: -0.0187, offsetX: -0.0445, offsetZ: 0.1149 },
  { id: 'blue_star_fern', name: 'Blue Star Fern', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/blue_star_fern/blue_star_fern.glb', scale: 1.0695, baseYOffset: 0.0092, offsetX: 0.0464, offsetZ: -0.0619 },
  { id: 'cretan_brake_fern', name: 'Cretan Brake Fern', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/cretan_brake_fern/cretan_brake_fern.glb', scale: 1.0517, baseYOffset: -0.0005, offsetX: 0.047, offsetZ: -0.0248 },
  { id: 'jungle_fern', name: 'Jungle Fern', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/jungle_fern/jungle_fern.glb', scale: 0.3237, baseYOffset: 0.001, offsetX: -0.0214, offsetZ: 0.0102 },
  { id: 'lilypad', name: 'Lilypad', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/lilypad/lilypad.glb', scale: 0.6986, baseYOffset: 0.0005, offsetX: 0.0, offsetZ: -0.0294 },
  { id: 'monstera_deliciosa', name: 'Monstera Deliciosa', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/monstera_deliciosa/monstera_deliciosa.glb', scale: 0.3209, baseYOffset: -0.0026, offsetX: 0.0288, offsetZ: 0.058 },
  { id: 'musa_acuminata', name: 'Musa Acuminata', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/musa_acuminata/musa_acuminata.glb', scale: 0.2669, baseYOffset: -0.0028, offsetX: 0.038, offsetZ: 0.07 },
  { id: 'plumeria', name: 'Plumeria', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/plumeria/plumeria.glb', scale: 0.5215, baseYOffset: -0.0068, offsetX: -0.0401, offsetZ: -0.003 },
  { id: 'sand_reed', name: 'Sand Reed', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/sand_reed/sand_reed.glb', scale: 0.3378, baseYOffset: 0.0045, offsetX: -0.0167, offsetZ: -0.0143 },
  { id: 'sand_weeds', name: 'Sand Weeds', pack: 'pirates', modelSrc: 'assets/scene/Models/plants/pirates/sand_weeds/sand_weeds.glb', scale: 0.4861, baseYOffset: 0.0127, offsetX: 0.0055, offsetZ: 0.0088 },
  { id: 'voxels_cactus', name: 'Cactus', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/cactus/cactus.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: 0.0 },
  { id: 'flower_red', name: 'Flower Red', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/flower_red/flower_red.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: -0.0 },
  { id: 'flower_yellow', name: 'Flower Yellow', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/flower_yellow/flower_yellow.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: -0.0 },
  { id: 'grass_long', name: 'Grass Long', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/grass_long/grass_long.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: -0.0 },
  { id: 'grass_long_2', name: 'Grass Long 2', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/grass_long_2/grass_long_2.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: -0.0 },
  { id: 'grass_medium', name: 'Grass Medium', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/grass_medium/grass_medium.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: -0.0 },
  { id: 'mushroom_brown', name: 'Mushroom Brown', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/mushroom_brown/mushroom_brown.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: -0.0 },
  { id: 'vegetation_flowers', name: 'Vegetation Flowers', pack: 'voxels_pack', modelSrc: 'assets/scene/Models/plants/voxels_pack/vegetation_flowers/vegetation_flowers.glb', scale: 0.55, baseYOffset: 0.0, offsetX: 0.0, offsetZ: 0.0 },
  { id: 'cactus_1', name: 'Cactus 1', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_1/cactus_1.glb', scale: 0.1296, baseYOffset: 0.0077, offsetX: -0.0201, offsetZ: -0.0142 },
  { id: 'cactus_2', name: 'Cactus 2', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_2/cactus_2.glb', scale: 0.1566, baseYOffset: 0.0111, offsetX: 0.0058, offsetZ: -0.0061 },
  { id: 'cactus_3', name: 'Cactus 3', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_3/cactus_3.glb', scale: 0.1234, baseYOffset: 0.0046, offsetX: 0.009, offsetZ: -0.0022 },
  { id: 'cactus_4', name: 'Cactus 4', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_4/cactus_4.glb', scale: 0.2242, baseYOffset: 0.0115, offsetX: 0.0351, offsetZ: -0.0407 },
  { id: 'cactus_5', name: 'Cactus 5', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_5/cactus_5.glb', scale: 0.1271, baseYOffset: 0.0057, offsetX: -0.0444, offsetZ: -0.0112 },
  { id: 'cactus_6', name: 'Cactus 6', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_6/cactus_6.glb', scale: 0.2062, baseYOffset: 0.0202, offsetX: 0.0158, offsetZ: -0.0173 },
  { id: 'cactus_7', name: 'Cactus 7', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_7/cactus_7.glb', scale: 0.1734, baseYOffset: 0.0058, offsetX: 0.0215, offsetZ: -0.0214 },
  { id: 'cactus_8', name: 'Cactus 8', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_8/cactus_8.glb', scale: 0.1699, baseYOffset: 0.0082, offsetX: -0.0016, offsetZ: 0.0078 },
  { id: 'cactus_9', name: 'Cactus 9', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/cactus_9/cactus_9.glb', scale: 0.2829, baseYOffset: 0.0181, offsetX: 0.028, offsetZ: -0.0049 },
  { id: 'plant_1', name: 'Plant 1', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/plant_1/plant_1.glb', scale: 0.2579, baseYOffset: 0.0467, offsetX: 0.0087, offsetZ: -0.0074 },
  { id: 'plant_2', name: 'Plant 2', pack: 'western', modelSrc: 'assets/scene/Models/plants/western/plant_2/plant_2.glb', scale: 0.1765, baseYOffset: 0.009, offsetX: 0.0166, offsetZ: -0.0153 },
  // Bonus find, kept by KJ 2026-09-18 — not in the original 77-item list, but a real,
  // on-theme flower.
  { id: 'void_tulip', name: 'Void Tulip', pack: 'fantasy', modelSrc: 'assets/scene/Models/plants/fantasy/void_tulip/void_tulip.glb', scale: 0.3216, baseYOffset: 0.0046, offsetX: 0.0095, offsetZ: 0.0217 },
]

export interface RarityTierDef {
  id:        number   // 0 = Common .. 7 = Unique
  name:      string
  seedColor: { r: number; g: number; b: number }
  seedVfx:   string    // KJ's spec, in prose — translated into engine params when the VFX system is built
  plantVfx:  string
  custom:    boolean   // true for Mythic/Unique — bespoke, outside the generic tier engine
}
/** KJ's rarity spec (2026-09-18), following DCL wearable rarity conventions. */
export const RARITY_TIERS: ReadonlyArray<RarityTierDef> = [
  { id: 0, name: 'Common',    seedColor: { r: 0.451, g: 0.827, b: 0.827 }, seedVfx: 'None',  plantVfx: 'None', custom: false },
  { id: 1, name: 'Uncommon',  seedColor: { r: 1.000, g: 0.514, b: 0.384 }, seedVfx: 'None',  plantVfx: 'None', custom: false },
  { id: 2, name: 'Rare',      seedColor: { r: 0.204, g: 0.808, b: 0.463 }, seedVfx: 'Green pulse',  plantVfx: 'Green pulse', custom: false },
  { id: 3, name: 'Epic',      seedColor: { r: 0.263, g: 0.561, b: 1.000 }, seedVfx: 'Blue pulse',   plantVfx: 'Blue particles', custom: false },
  { id: 4, name: 'Legendary', seedColor: { r: 0.631, g: 0.294, b: 0.953 }, seedVfx: 'Purple pulse', plantVfx: 'Tonal purple pulse and particles', custom: false },
  { id: 5, name: 'Exotic',    seedColor: { r: 0.608, g: 0.820, b: 0.255 }, seedVfx: 'Red pulse',    plantVfx: 'Alternating colour pulse, particles, slow scale/rotation tween', custom: false },
  { id: 6, name: 'Mythic',    seedColor: { r: 1.000, g: 0.294, b: 0.929 }, seedVfx: 'Pink pulse',   plantVfx: 'Custom', custom: true },
  { id: 7, name: 'Unique',    seedColor: { r: 0.996, g: 0.635, b: 0.090 }, seedVfx: 'Gold pulse',   plantVfx: 'Custom', custom: true },
]
export function rarityTierById(id: number): RarityTierDef {
  return RARITY_TIERS[id] ?? RARITY_TIERS[0]
}

/** Relative odds among Uncommon..Exotic (tiers 1-5) once a seed rolls "above Common" —
 *  see seedRareChance. Mythic/Unique (6, 7) are `custom` — no art yet, excluded from
 *  general rolling until they have models. */
const TIER_ROLL_WEIGHTS: ReadonlyArray<number> = [55, 30, 10, 4, 1]   // tier 1..5

/** Rolls a rarity tier for a newly-spawned seed: seedRareChance(...) decides whether
 *  it beats Common at all, then this weights which of Uncommon..Exotic it lands on. */
export function rollSeedTier(contributors: number, rareSeedMult = 1): number {
  if (Math.random() >= seedRareChance(contributors, rareSeedMult)) return 0   // Common
  return rollTierAtLeast(1)
}

/** A tier ≥ `minTier` (1..5) by TIER_ROLL_WEIGHTS — the guaranteed Rare+ seed uses 2. */
export function rollTierAtLeast(minTier: number): number {
  const from    = Math.max(1, Math.min(TIER_ROLL_WEIGHTS.length, minTier))
  const weights = TIER_ROLL_WEIGHTS.slice(from - 1)
  let r = Math.random() * weights.reduce((a, b) => a + b, 0)
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return from + i
  }
  return from
}

/** Rolls a species for a revealed plant — uniform across the committed catalog for now
 *  (all 78 equally likely); rarity tier is a fully separate axis, rolled independently
 *  at the seed stage via rollSeedTier. */
export function rollPlantSpecies(): string {
  return PLANT_SPECIES[Math.floor(Math.random() * PLANT_SPECIES.length)].id
}
export function plantSpeciesById(id: string): PlantSpecies | null {
  return PLANT_SPECIES.find(s => s.id === id) ?? null
}

// ── Test tooling ─────────────────────────────────────────────
/** Wallets allowed to use test handlers that write PERMANENT data (lifetime board /
 *  tributes). Lower-case. Pre-production: gate every test handler + unmount TestPanelUi. */
export const ADMIN_ADDRESSES: ReadonlyArray<string> = ['0x8967ad851ccbd4c1a2d57a128d3c606fcab29bad']

// ── v2 Phase 6: bloom variants + scaled-bloom FX (GDD §3 step 3, §5 "shareable moment") ──
// The variant SYSTEM ships now; the catalog grows later and odds can be rotated
// every few weeks without a new build of anything but this table (GDD §9).
export interface RGB { r: number; g: number; b: number }
export interface BloomPalette { albedo: RGB; emissive: RGB }   // sparkles, shockwaves, ripples, fireflies
export interface BloomVariant {
  id: string
  name: string
  weight: number        // relative odds among eligible variants
  minScale: number      // bloom scale required (bloomScaleFor: 1 gardener 0.25 … 4+ = 1)
  rareSeedMult: number  // multiplies the per-seed rare chance for this bloom
  palette: BloomPalette
}
export const BLOOM_VARIANTS: ReadonlyArray<BloomVariant> = [
  { id: 'classic', name: 'Bloom',         weight: 9, minScale: 0,    rareSeedMult: 1,
    palette: { albedo: { r: 1.0, g: 0.95, b: 0.78 }, emissive: { r: 1.0, g: 0.88, b: 0.52 } } },   // warm gold (v1 look)
  { id: 'moonlit', name: 'Moonlit Bloom', weight: 1, minScale: 0.75, rareSeedMult: 2,             // TUNING — rare; needs 3+ gardeners
    palette: { albedo: { r: 0.85, g: 0.92, b: 1.0 }, emissive: { r: 0.55, g: 0.75, b: 1.0 } } },   // cool moonlight
]
export function bloomVariantById(id: string): BloomVariant {
  return BLOOM_VARIANTS.find(v => v.id === id) ?? BLOOM_VARIANTS[0]
}
/** Weighted roll among variants eligible for this bloom's scale. */
export function rollBloomVariant(bloomScale: number): BloomVariant {
  const eligible = BLOOM_VARIANTS.filter(v => bloomScale >= v.minScale)
  const total = eligible.reduce((s, v) => s + v.weight, 0)
  let r = Math.random() * total
  for (const v of eligible) { r -= v.weight; if (r <= 0) return v }
  return eligible[eligible.length - 1] ?? BLOOM_VARIANTS[0]
}
/** FX budget for a bloom of `scale`: 0 = quiet solo bloom, 1 = gentle (2–3 gardeners), 2 = full spectacle. */
export function bloomFxLevel(scale: number): 0 | 1 | 2 {
  return scale >= 0.99 ? 2 : scale >= 0.5 ? 1 : 0
}

// ── v2 Phase 5: boards + milestone flair (GDD §4.3 hook 2, §5 recognition) ──
/** Lifetime-water thresholds for the flair tiers: sprout → flower → golden flower. */
export const FLAIR_TIERS = [100, 500, 1000] as const   // TUNING — GDD "~100 / 500 / 1,000"
/** 0 = none, 1 = sprout, 2 = flower, 3 = golden. */
export function flairTier(lifetimeWaters: number): number {
  let tier = 0
  for (const t of FLAIR_TIERS) if (lifetimeWaters >= t) tier++
  return tier
}
/** Flair icon shown beside a name (boards) or above a "Watered by" label: the HUD glyph
 *  set, tinted per tier. null = no flair yet. (Text tags retired 2026-09-17.) */
export function flairIcon(tier: number): { src: string; tint: { r: number; g: number; b: number } } | null {
  if (tier >= 3) return { src: 'assets/scene/Images/ui/glyph_flower.png', tint: { r: 1.0,  g: 0.82, b: 0.30 } }   // golden flower
  if (tier === 2) return { src: 'assets/scene/Images/ui/glyph_flower.png', tint: { r: 0.96, g: 0.55, b: 0.75 } }   // flower
  if (tier === 1) return { src: 'assets/scene/Images/ui/glyph_seed.png',   tint: { r: 0.45, g: 0.85, b: 0.55 } }   // sprout
  return null
}
/** Weekly board cadence — the reset moment is shown in-world (GDD §4.3). */
export const WEEKLY_RESET_MS = 7 * 24 * 60 * 60 * 1000

// ── v2 Phase 5b: tribute plants (GDD §4.2 "week 3+": a permanent, personal mark) ──
/** Lifetime waters that grow a permanent tribute plant with the player's name. */
export const TRIBUTE_MILESTONE = 1000   // TUNING — GDD "TBD: threshold, ~1,000"
/** Fixed memorial-bed plots, filled in the order tributes are earned (never placed
 *  dynamically — clutter would cheapen the founding rose). Add plots when the bed fills. */
export const TRIBUTE_HERO_PLOTS: ReadonlyArray<{ x: number; z: number }> = [
  { x: 4.5, z: 21.5 }, { x: 5.7, z: 21.5 }, { x: 6.9,  z: 21.5 }, { x: 8.1,  z: 21.5 },
  { x: 9.3, z: 21.5 }, { x: 10.5, z: 21.5 }, { x: 11.7, z: 21.5 }, { x: 12.9, z: 21.5 },
]
/** Overflow plots once the hero bed is full — rendered COMPACT (one model, hover text,
 *  no plaque). Left EMPTY on purpose: the plants run along the garden's edges and the
 *  Blender layout is about to change, so these come from the new layout export, not
 *  from a generated row. Until then, tribute #9+ is register-only. */
export const TRIBUTE_HEDGE_PLOTS: ReadonlyArray<{ x: number; z: number }> = []
/** All plant-bearing plots, hero first. A record with plot −1 lives on the register only. */
export const TRIBUTE_PLOTS: ReadonlyArray<{ x: number; z: number }> = [...TRIBUTE_HERO_PLOTS, ...TRIBUTE_HEDGE_PLOTS]
/** The permanent roll of every tribute (one text entity, paged) — in front of the bed. */
export const TRIBUTE_REGISTER_POS = { x: 8.7, y: 1.25, z: 20.3 } as const
export interface FoundingTribute { displayName: string; address: string; note: string }
/** Seeded on first run — v2 ships with the first tribute already grown (GDD §4.2).
 *  address: fill in the honoree's wallet when known → the server also seeds their
 *  lifetime total to TRIBUTE_MILESTONE so they carry golden flair on the boards. */
export const FOUNDING_TRIBUTES: ReadonlyArray<FoundingTribute> = [
  { displayName: 'PeterParker', address: '0xCE0A77432DC952460c6cA1B8d8cf54169db3e210', note: 'v1 gardener - reached 1,000 waters twice' },
]
/** GLB paths; empty = greybox stand-in. Founding gets a unique model (KJ's custom rose),
 *  every later tribute reuses ONE standard plant tinted per player + a plaque. */
export const TRIBUTE_MODEL_FOUNDING = ''   // e.g. 'assets/scene/Models/tribute/peterparker_rose.glb'
export const TRIBUTE_MODEL_STANDARD = ''

// ── v2 Phase 4: harvest, gift, box-watering (GDD §3 step 5, §5 social loop) ──
/** Planters a player may hold at once — growing AND displaying (GDD §3.1, 2026-09-18:
 *  displaying = leaving an opened flower in its planter). Stored per player (`boxCap`)
 *  so purchasable extra planters can raise it; the effective cap is max(stored, this). */
export const BOX_CAP_DEFAULT       = 2   // TUNING
/** Crowding rule (GDD §3.1): keep this many planters free. When fewer are free, the
 *  planter of the owner away longest (not connected, away ≥ PLANTER_TIDY_MIN_AWAY_MS) is
 *  tidied up — opened flower → their My flowers, growing seed → back to their pouch. */
export const PLANTER_RESERVE_FREE    = 5                     // TUNING — at ~100 planters
export const PLANTER_TIDY_MIN_AWAY_MS = 24 * 60 * 60 * 1000  // TUNING
/** Keepsake collection size backstop (harvested + gifted flowers a player holds). */
export const FLOWER_COLLECTION_CAP = 20
/** Another player watering your growing box shaves this off its timer… */
export const BOX_WATER_SHAVE_MS    = Math.round(BOX_GROW_MS * 0.10)   // TUNING — 10% per water
/** …at most this many times per box, one water per visitor. */
export const BOX_WATER_MAX         = 3
