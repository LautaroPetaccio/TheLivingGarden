// =============================================================
// Bloom Garden v2 — the local player's inventory (CLIENT ONLY)
//
// One small store for what the player holds: seed pouch, planting preference,
// keepsake flowers, planter cap. Gameplay systems WRITE it (boxSystem from
// pouchUpdate, giftSystem from collectionUpdate); UI READS it every render.
// It imports nothing from the game, so UI ↔ gameplay never form an import cycle.
// Rarity is still two-tier here on purpose — the tier ladder is not decided yet.
// =============================================================

export interface Keepsake { flower: string; rare: boolean; at: number; from?: string }
export interface Gardener { address: string; name: string }

let pouch      = { normal: 0, rare: 0 }
let preferRare = false
let flowers: Keepsake[] = []
let boxCap     = 1

export function getPouch(): { normal: number; rare: number } { return pouch }
export function setPouch(normal: number, rare: number): void {
  pouch = { normal: Math.max(0, normal), rare: Math.max(0, rare) }
}

/** Which kind the next planting uses when the pouch holds both. */
export function getPreferRare(): boolean { return preferRare }
export function setPreferRare(v: boolean): void { preferRare = v }
/** The kind the next planting will actually use, or null with an empty pouch. */
export function nextSeedIsRare(): boolean | null {
  if (pouch.normal <= 0 && pouch.rare <= 0) return null
  return pouch.normal <= 0 ? true : pouch.rare <= 0 ? false : preferRare
}

export function getFlowers(): Keepsake[] { return flowers }
export function setFlowers(list: Keepsake[]): void { flowers = list }
export function getBoxCap(): number { return boxCap }
export function setBoxCap(n: number): void { boxCap = n }

// Gifting is owned by giftSystem; it registers itself here so the menu can use it.
let giftApi: { gardenersHere(): Gardener[]; give(toAddress: string, flowerIndex: number): void } | null = null
export function registerGiftApi(api: NonNullable<typeof giftApi>): void { giftApi = api }
export function gardenersHere(): Gardener[] { return giftApi ? giftApi.gardenersHere() : [] }
export function giveFlower(toAddress: string, flowerIndex: number): void { giftApi?.give(toAddress, flowerIndex) }
