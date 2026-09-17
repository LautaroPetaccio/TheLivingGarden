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
// Yield and rarity scale with BLOOM SIZE (GDD: "more gardeners means bigger,
// rarer blooms"), not with head-count, since everyone gets the whole drop.
export const SEEDS_AT_SOLO      = 4         // TUNING — quiet solo bloom (scale ≈0.32)
export const SEEDS_AT_FULL      = 8         // TUNING — full-garden bloom (scale 1)
export const SEED_RARE_AT_SOLO  = 0.10      // TUNING — "mostly normal, occasionally rare"
export const SEED_RARE_AT_FULL  = 0.20      // TUNING — full blooms roll rarer
export const SEED_FALL_MS       = 5_000     // drift-down duration from spawn height to ground
export const SEED_LIFETIME_MS   = 120_000   // ungathered seeds fade before the 6-min bloom ends
export const SEED_GATHER_RADIUS = 2.0       // m — walking this close starts the drift toward you
export const SEED_COLLECT_RADIUS = 0.7      // m — seed this close is gathered (client sends request)
export const SEED_SPAWN_HEIGHT  = 7         // m — seeds fall from the bloom canopy

/** Seeds dropped by a bloom of `bloomScale` (thresholdAtFire / full, 0–1]. */
export function seedSpawnCount(bloomScale: number): number {
  const s = Math.max(0, Math.min(1, bloomScale))
  return Math.round(SEEDS_AT_SOLO + (SEEDS_AT_FULL - SEEDS_AT_SOLO) * s)
}

/** Per-seed rare probability for a bloom of `bloomScale`. */
export function seedRareChance(bloomScale: number): number {
  const s = Math.max(0, Math.min(1, bloomScale))
  return SEED_RARE_AT_SOLO + (SEED_RARE_AT_FULL - SEED_RARE_AT_SOLO) * s
}
/** How long health must stay ≥ BLOOM_THRESHOLD (cumulatively) before bloom fires.
 *  Shared by server (sustain timer) and client (countdown display). */
export const BLOOM_SUSTAIN_MS   = 60_000
export const DAILY_WATER_LIMIT  = 8
export const WATERED_EXPIRY_MS  = 3 * 60 * 1000        // 3 minutes
export const FAST_PLANT_EXPIRY_MS = 75_000               // 75 seconds
/** How long after bloom triggers before the server resets all plants. */
export const BLOOM_RESET_DELAY_MS = 6 * 60_000          // 6 minutes

// ── Scene-wide spatial / asset constants ─────────────────────
/** World-space centre of the Bloom model — used for sound, sparkles, shockwaves. */
export const BLOOM_CENTER = { x: 6.75, y: 2, z: 24 } as const
/** Shared sparkle texture used by all particle / FX systems. */
export const SPARKLE_SRC  = 'assets/scene/Images/sparkle.png'
/** Garden walkable area bounds — used for ambient FX spawning. */
export const GARDEN_BOUNDS = { xMin: 3, xMax: 14, zMin: 3, zMax: 22 } as const

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
// Greybox row along the garden's front edge (z just inside zMin); move freely.
// Spacing 1.4 m: the planter template is ~1.8 × 2.2 m at scale 1, placed at
// BOX_MODEL_SCALE so eight fit the 11 m front edge without overlapping.
export const BOX_POSITIONS: ReadonlyArray<{ id: string; x: number; z: number }> = [
  { id: 'box_1', x: 4.0,  z: 3.6 }, { id: 'box_2', x: 5.4,  z: 3.6 },
  { id: 'box_3', x: 6.8,  z: 3.6 }, { id: 'box_4', x: 8.2,  z: 3.6 },
  { id: 'box_5', x: 9.6,  z: 3.6 }, { id: 'box_6', x: 11.0, z: 3.6 },
  { id: 'box_7', x: 12.4, z: 3.6 }, { id: 'box_8', x: 13.8, z: 3.6 },
]
/** KJ's planter template (2026-09-17): origin at the base, front (+z) faces the
 *  garden, rim at y≈1.1, balloons to y≈3.1 (static in this export — the balloon
 *  animation + countdown sync is a to-do). 4,440 tris — decimate before ship. */
export const BOX_MODEL_SRC   = 'assets/scene/Models/planterBox/planterBox.glb'
export const BOX_MODEL_SCALE = 0.6
export const BOX_MODEL_RIM_Y = 1.1 * BOX_MODEL_SCALE   // where the soil surface sits
/** TUNING — GDD: overnight scale, "an evening plant opens by next morning" (~10 h).
 *  Set to 2 minutes for the greybox playtest so the whole loop fits one session. */
export const BOX_GROW_MS = 2 * 60_000
/** Mystery-seed catalog: identity is rolled when the box opens. */
export const FLOWERS = {
  normal: ['Daisy', 'Tulip', 'Poppy'],
  rare:   ['Moonbloom', 'Sunflare'],
} as const

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
/** Greybox text tag shown before a name. Art pass: replace with a PNG glyph (no emoji — Unity client). */
export function flairTag(tier: number): string {
  return ['', '[sprout] ', '[flower] ', '[golden] '][Math.max(0, Math.min(3, tier))]
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
  { displayName: 'PeterParker', address: '', note: 'v1 gardener - reached 1,000 waters twice' },
]
/** GLB paths; empty = greybox stand-in. Founding gets a unique model (KJ's custom rose),
 *  every later tribute reuses ONE standard plant tinted per player + a plaque. */
export const TRIBUTE_MODEL_FOUNDING = ''   // e.g. 'assets/scene/Models/tribute/peterparker_rose.glb'
export const TRIBUTE_MODEL_STANDARD = ''

// ── v2 Phase 4: harvest, gift, box-watering (GDD §3 step 5, §5 social loop) ──
/** Boxes a player may hold at once. KJ decision 2026-09-16: 1 — stored per player
 *  (`boxCap` in player storage) so purchasable extra boxes can raise it later. */
export const BOX_CAP_DEFAULT       = 1
/** Keepsake collection size backstop (harvested + gifted flowers a player holds). */
export const FLOWER_COLLECTION_CAP = 20
/** Another player watering your growing box shaves this off its timer… */
export const BOX_WATER_SHAVE_MS    = Math.round(BOX_GROW_MS * 0.10)   // TUNING — 10% per water
/** …at most this many times per box, one water per visitor. */
export const BOX_WATER_MAX         = 3
