// =============================================================
// Bloom Garden v2 — the local player's inventory (CLIENT ONLY)
//
// One small store for what the player holds: seed pouch, planting preference,
// keepsake flowers, planter cap. Gameplay systems WRITE it (boxSystem from
// pouchUpdate, giftSystem from collectionUpdate); UI READS it every render.
// It imports nothing from the game, so UI ↔ gameplay never form an import cycle.
// Rarity is the 8-tier system (RARITY_TIERS in shared/config) since 2026-09-18 —
// a pouch/keepsake only ever carries a tier NUMBER, never the tier's name/color,
// so this file still doesn't need to import the game/config to stay decoupled.
// =============================================================

export interface Keepsake { flower: string; rarityTier: number; at: number; from?: string }
export interface Gardener { address: string; name: string }

let pouch: number[] = []      // counts per rarity tier, index = tier id
let preferredTier   = 0       // which tier to plant next, when the pouch holds more than one
let flowers: Keepsake[] = []
let boxCap     = 1

export function getPouch(): number[] { return pouch }
export function setPouch(counts: number[]): void {
  pouch = counts.map(n => Math.max(0, n))
}

/** Which tier the next planting uses when the pouch holds more than one. */
export function getPreferredTier(): number { return preferredTier }
export function setPreferredTier(tier: number): void { preferredTier = tier }
/** The tier the next planting will actually use, or null with an empty pouch —
 *  the preferred tier if it has stock, else the lowest-indexed tier that does. */
export function nextSeedTier(): number | null {
  if ((pouch[preferredTier] ?? 0) > 0) return preferredTier
  const firstAvailable = pouch.findIndex(n => n > 0)
  return firstAvailable === -1 ? null : firstAvailable
}

/** The keepsake kind in my hand (server-confirmed via heldFlower), or null. */
export interface HeldKind { flower: string; rarityTier: number }
let held: HeldKind | null = null
export function getHeld(): HeldKind | null { return held }
export function setHeld(h: HeldKind | null): void { held = h }
/** Collection index of a keepsake of the held kind (the newest), or null. */
export function heldFlowerIndex(): number | null {
  if (!held) return null
  for (let i = flowers.length - 1; i >= 0; i--) if (flowers[i].flower === held.flower && flowers[i].rarityTier === held.rarityTier) return i
  return null
}

export function getFlowers(): Keepsake[] { return flowers }
export function setFlowers(list: Keepsake[]): void { flowers = list }
export function getBoxCap(): number { return boxCap }
export function setBoxCap(n: number): void { boxCap = n }

// Gifting is owned by giftSystem; it registers itself here so the menu can use it.
let giftApi: { gardenersHere(): Gardener[]; give(toAddress: string, flowerIndex: number): void; hold(flowerIndex: number): void } | null = null
export function registerGiftApi(api: NonNullable<typeof giftApi>): void { giftApi = api }
export function gardenersHere(): Gardener[] { return giftApi ? giftApi.gardenersHere() : [] }
export function giveFlower(toAddress: string, flowerIndex: number): void { giftApi?.give(toAddress, flowerIndex) }
/** Ask the server to put this keepsake in my hand (-1 = empty hand). One at a time. */
export function holdFlower(flowerIndex: number): void { giftApi?.hold(flowerIndex) }
