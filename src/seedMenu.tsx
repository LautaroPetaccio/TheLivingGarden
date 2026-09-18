// =============================================================
// Bloom Garden v2 — Seed menu (CLIENT ONLY)
//
// Opens from the seed chip under the health ring. Two sections:
//   Seeds       what you hold, grouped by rarity tier — tap a tile to choose which
//               tier the next planting uses (replaced the old Normal/Rare two-button
//               toggle 2026-09-18, when rarity grew from 2 tiers to 8)
//   My flowers  your keepsakes (grouped), species collection progress, Gift
// Phone: a centred sheet (both thumbs stay free). Desktop: docked under the
// ring on the right, so the garden stays visible.
// Reads playerInventory + the rarity/species tables — no gameplay imports.
// =============================================================

import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { PLANT_SPECIES, rarityTierById } from './shared/config'
import { getPouch, getPreferredTier, setPreferredTier, nextSeedTier, getFlowers, gardenersHere, giveFlower } from './playerInventory'

let open = false
let selectedKey = ''      // `${flower}|${rarityTier}` of the tile picked in My flowers
let giftMode = false      // choosing who to give the selected flower to

export function isSeedMenuOpen(): boolean { return open }
export function toggleSeedMenu(): void { open = !open; if (!open) { selectedKey = ''; giftMode = false } }
export function openSeedMenu(): void { open = true }

/** The keepsake index the menu currently has selected for gifting, or null if none —
 *  the world tap-a-player shortcut reuses this instead of guessing "the newest one". */
export function getSelectedGiftIndex(): number | null {
  if (!selectedKey) return null
  const g = groupFlowers().find(g => g.key === selectedKey)
  return g ? g.lastIndex : null
}

const DARK   = { r: 0.085, g: 0.078, b: 0.067, a: 0.95 }
const RAISED = { r: 1, g: 1, b: 1, a: 0.08 }
const CREAM  = { r: 0.957, g: 0.918, b: 0.824, a: 1 }
const DIM    = { r: 0.83,  g: 0.82,  b: 0.78,  a: 1 }
const MOSS   = { r: 0.18,  g: 0.49,  b: 0.34,  a: 1 }
const MAX_TILES = 8

interface Group { key: string; flower: string; rarityTier: number; count: number; lastIndex: number }
function groupFlowers(): Group[] {
  const map = new Map<string, Group>()
  getFlowers().forEach((f, i) => {
    const key = `${f.flower}|${f.rarityTier}`
    const g = map.get(key)
    if (g) { g.count++; g.lastIndex = i } else map.set(key, { key, flower: f.flower, rarityTier: f.rarityTier, count: 1, lastIndex: i })
  })
  return [...map.values()].sort((a, b) => b.rarityTier - a.rarityTier || b.lastIndex - a.lastIndex)   // rarest first, then newest
}

interface TierGroup { tier: number; count: number }
function groupPouch(): TierGroup[] {
  const pouch = getPouch()
  const out: TierGroup[] = []
  for (let tier = 0; tier < pouch.length; tier++) if (pouch[tier] > 0) out.push({ tier, count: pouch[tier] })
  return out.sort((a, b) => b.tier - a.tier)   // rarest first
}

export function SeedMenuUi(props: { px: (n: number) => number; fs: (n: number) => number; mobile: boolean; topPx: number; rightPct: `${number}%`; belowChipPx: number }) {
  if (!open) return null
  const { px, fs, mobile } = props
  const W      = px(mobile ? 640 : 440)
  const PAD    = px(18)
  const pouchGroups = groupPouch()
  const total  = pouchGroups.reduce((a, g) => a + g.count, 0)
  const next   = nextSeedTier()
  const groups = groupFlowers()
  const shown  = groups.slice(0, MAX_TILES)
  const speciesFound = new Set(getFlowers().map(f => f.flower)).size
  const sel    = groups.find(g => g.key === selectedKey) ?? null
  const here   = giftMode ? gardenersHere() : []
  const tileW  = Math.floor((W - PAD * 2 - px(8) * 3) / 4)

  /** One tile — reused for both the seed pouch (tap = choose what plants next) and
   *  the flower collection (tap = choose what to gift). Same visual language: a
   *  tier-colored swatch + label, so "this is rarity" reads consistently everywhere.
   *  `i` positions it in a 4-column wrapped row (no right-margin on every 4th). */
  const tile = (key: string, i: number, tierColor: { r: number; g: number; b: number }, label: string, active: boolean, onClick: () => void) => (
    <UiEntity
      key={key}
      uiTransform={{ width: tileW, height: px(78), margin: { right: (i % 4) === 3 ? 0 : px(8), bottom: px(8) }, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: px(12) }}
      uiBackground={{ color: active ? { ...MOSS, a: 0.55 } : RAISED }}
      onMouseDown={onClick}
    >
      <UiEntity uiTransform={{ width: px(18), height: px(18), borderRadius: px(9), margin: { bottom: px(6) } }} uiBackground={{ color: { ...tierColor, a: 1 } }} />
      <Label value={label} fontSize={fs(13)} color={CREAM} textAlign="middle-center" uiTransform={{ width: '100%', height: fs(20) }} />
    </UiEntity>
  )

  const panel = (
    <UiEntity uiTransform={{ width: W, flexDirection: 'column', padding: { top: PAD, bottom: PAD, left: PAD, right: PAD }, borderRadius: px(20) }} uiBackground={{ color: DARK }}>

      {/* header */}
      <UiEntity uiTransform={{ width: '100%', height: fs(30), flexDirection: 'row', alignItems: 'center' }}>
        <Label value="Seed pouch" fontSize={fs(21)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: '100%' }} />
        <UiEntity uiTransform={{ width: px(44), height: px(44), alignItems: 'center', justifyContent: 'center' }} onMouseDown={() => toggleSeedMenu()}>
          <Label value="x" fontSize={fs(20)} color={DIM} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
        </UiEntity>
      </UiEntity>

      {/* seeds — one tile per rarity tier you're holding, tap to choose what plants next */}
      <Label value={total > 0 ? 'Planting next' : 'No seeds yet - catch some during a bloom'} fontSize={fs(15)} color={DIM} textAlign="middle-left" uiTransform={{ width: '100%', height: fs(26), margin: { top: px(4), bottom: px(6) } }} />
      <UiEntity uiTransform={{ display: total > 0 ? 'flex' : 'none', width: '100%', flexDirection: 'row', flexWrap: 'wrap' }}>
        {pouchGroups.map((g, i) => tile(
          `pouch-${g.tier}`, i, rarityTierById(g.tier).seedColor, `${rarityTierById(g.tier).name}  ${g.count}`,
          next === g.tier, () => setPreferredTier(g.tier),
        ))}
      </UiEntity>

      {/* divider */}
      <UiEntity uiTransform={{ width: '100%', height: Math.max(1, px(1)), margin: { top: px(16), bottom: px(12) } }} uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.14 } }} />

      {/* my flowers */}
      <UiEntity uiTransform={{ width: '100%', height: fs(28), flexDirection: 'row', alignItems: 'center' }}>
        <Label value="My flowers" fontSize={fs(19)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: '100%' }} />
        <Label value={`${getFlowers().length} kept - ${speciesFound}/${PLANT_SPECIES.length} species found`} fontSize={fs(14)} color={DIM} textAlign="middle-right" uiTransform={{ height: '100%' }} />
      </UiEntity>
      <Label value="Harvest an opened planter, or receive a gift" fontSize={fs(14)} color={{ ...DIM, a: 0.7 }} textAlign="middle-left" uiTransform={{ display: groups.length === 0 ? 'flex' : 'none', width: '100%', height: fs(26), margin: { top: px(6) } }} />

      <UiEntity uiTransform={{ display: groups.length > 0 ? 'flex' : 'none', width: '100%', flexDirection: 'row', flexWrap: 'wrap', margin: { top: px(8) } }}>
        {shown.map((g, i) => tile(
          g.key, i, rarityTierById(g.rarityTier).seedColor, g.count > 1 ? `${g.flower} x${g.count}` : g.flower,
          g.key === selectedKey, () => { selectedKey = selectedKey === g.key ? '' : g.key; giftMode = false },
        ))}
      </UiEntity>
      <Label value={`+${groups.length - MAX_TILES} more kinds`} fontSize={fs(13)} color={DIM} textAlign="middle-left" uiTransform={{ display: groups.length > MAX_TILES ? 'flex' : 'none', width: '100%', height: fs(22) }} />

      {/* selection → gift */}
      <UiEntity uiTransform={{ display: sel && !giftMode ? 'flex' : 'none', width: '100%', height: px(48), flexDirection: 'row', alignItems: 'center', margin: { top: px(6) } }}>
        <Label value={sel ? `${sel.flower}${sel.rarityTier > 0 ? ` (${rarityTierById(sel.rarityTier).name})` : ''}` : ''} fontSize={fs(16)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: '100%' }} />
        <UiEntity uiTransform={{ height: px(44), padding: { left: px(22), right: px(22) }, alignItems: 'center', justifyContent: 'center', borderRadius: px(22) }} uiBackground={{ color: MOSS }} onMouseDown={() => { giftMode = true }}>
          <Label value="Gift" fontSize={fs(17)} color={CREAM} textAlign="middle-center" uiTransform={{ height: '100%' }} />
        </UiEntity>
      </UiEntity>

      {/* who to give it to */}
      <UiEntity uiTransform={{ display: sel && giftMode ? 'flex' : 'none', width: '100%', flexDirection: 'column', margin: { top: px(6) } }}>
        <Label value={here.length > 0 ? `Give your ${sel ? sel.flower : ''} to` : 'No other gardeners here right now - you can also tap a gardener in the garden'} fontSize={fs(14)} color={DIM} textAlign="middle-left" uiTransform={{ width: '100%', height: fs(26) }} />
        {here.slice(0, 5).map((g) => (
          <UiEntity
            key={g.address}
            uiTransform={{ width: '100%', height: px(44), margin: { top: px(6) }, alignItems: 'center', justifyContent: 'center', borderRadius: px(22) }}
            uiBackground={{ color: RAISED }}
            onMouseDown={() => { if (sel) giveFlower(g.address, sel.lastIndex); selectedKey = ''; giftMode = false }}
          >
            <Label value={g.name} fontSize={fs(16)} color={CREAM} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
          </UiEntity>
        ))}
      </UiEntity>
    </UiEntity>
  )

  return mobile
    ? <UiEntity uiTransform={{ positionType: 'absolute', position: { top: props.topPx, left: 0 }, width: '100%', flexDirection: 'row', justifyContent: 'center' }}>{panel}</UiEntity>
    : <UiEntity uiTransform={{ positionType: 'absolute', position: { top: props.belowChipPx, right: props.rightPct } }}>{panel}</UiEntity>
}
