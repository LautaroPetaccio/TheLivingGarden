// =============================================================
// Bloom Garden v2 — Seed menu (CLIENT ONLY)
//
// Opens from the seed chip under the health ring. Two sections:
//   Seeds       what you hold + which kind the next planting uses
//   My flowers  your keepsakes (grouped), rare collection x/N, Gift
// Phone: a centred sheet (both thumbs stay free). Desktop: docked under the
// ring on the right, so the garden stays visible.
// Reads playerInventory only — no gameplay imports.
// =============================================================

import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { FLOWERS } from './shared/config'
import { getPouch, getPreferRare, setPreferRare, nextSeedIsRare, getFlowers, gardenersHere, giveFlower } from './playerInventory'

let open = false
let selectedKey = ''      // `${flower}|${rare}` of the tile picked in My flowers
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
const GOLD   = { r: 0.98,  g: 0.78,  b: 0.46,  a: 1 }
const PINK   = { r: 0.96,  g: 0.55,  b: 0.75,  a: 1 }
const MOSS   = { r: 0.18,  g: 0.49,  b: 0.34,  a: 1 }
const MAX_TILES = 8

interface Group { key: string; flower: string; rare: boolean; count: number; lastIndex: number }
function groupFlowers(): Group[] {
  const map = new Map<string, Group>()
  getFlowers().forEach((f, i) => {
    const key = `${f.flower}|${f.rare}`
    const g = map.get(key)
    if (g) { g.count++; g.lastIndex = i } else map.set(key, { key, flower: f.flower, rare: f.rare, count: 1, lastIndex: i })
  })
  return [...map.values()].sort((a, b) => Number(b.rare) - Number(a.rare) || b.lastIndex - a.lastIndex)   // rares first, then newest
}

export function SeedMenuUi(props: { px: (n: number) => number; fs: (n: number) => number; mobile: boolean; topPx: number; rightPct: `${number}%`; belowChipPx: number }) {
  if (!open) return null
  const { px, fs, mobile } = props
  const W      = px(mobile ? 640 : 440)
  const PAD    = px(18)
  const pouch  = getPouch()
  const total  = pouch.normal + pouch.rare
  const next   = nextSeedIsRare()
  const groups = groupFlowers()
  const shown  = groups.slice(0, MAX_TILES)
  const rares  = new Set(getFlowers().filter(f => f.rare).map(f => f.flower)).size
  const sel    = groups.find(g => g.key === selectedKey) ?? null
  const here   = giftMode ? gardenersHere() : []
  const tileW  = Math.floor((W - PAD * 2 - px(8) * 3) / 4)

  const seg = (label: string, rare: boolean, count: number) => {
    const active = next === rare
    return (
      <UiEntity
        uiTransform={{ height: px(44), flexGrow: 1, margin: { right: rare ? 0 : px(8) }, alignItems: 'center', justifyContent: 'center', borderRadius: px(22) }}
        uiBackground={{ color: active ? MOSS : RAISED }}
        onMouseDown={() => { if (count > 0) setPreferRare(rare) }}
      >
        <Label value={`${label}  ${count}`} fontSize={fs(17)} color={count > 0 ? CREAM : { ...DIM, a: 0.45 }} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
      </UiEntity>
    )
  }

  const panel = (
    <UiEntity uiTransform={{ width: W, flexDirection: 'column', padding: { top: PAD, bottom: PAD, left: PAD, right: PAD }, borderRadius: px(20) }} uiBackground={{ color: DARK }}>

      {/* header */}
      <UiEntity uiTransform={{ width: '100%', height: fs(30), flexDirection: 'row', alignItems: 'center' }}>
        <Label value="Seed pouch" fontSize={fs(21)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: '100%' }} />
        <UiEntity uiTransform={{ width: px(44), height: px(44), alignItems: 'center', justifyContent: 'center' }} onMouseDown={() => toggleSeedMenu()}>
          <Label value="x" fontSize={fs(20)} color={DIM} textAlign="middle-center" uiTransform={{ width: '100%', height: '100%' }} />
        </UiEntity>
      </UiEntity>

      {/* seeds */}
      <Label value={total > 0 ? 'Planting next' : 'No seeds yet - catch some during a bloom'} fontSize={fs(15)} color={DIM} textAlign="middle-left" uiTransform={{ width: '100%', height: fs(26), margin: { top: px(4), bottom: px(6) } }} />
      <UiEntity uiTransform={{ display: total > 0 ? 'flex' : 'none', width: '100%', flexDirection: 'row' }}>
        {seg('Normal', false, pouch.normal)}
        {seg('Rare', true, pouch.rare)}
      </UiEntity>

      {/* divider */}
      <UiEntity uiTransform={{ width: '100%', height: Math.max(1, px(1)), margin: { top: px(16), bottom: px(12) } }} uiBackground={{ color: { r: 1, g: 1, b: 1, a: 0.14 } }} />

      {/* my flowers */}
      <UiEntity uiTransform={{ width: '100%', height: fs(28), flexDirection: 'row', alignItems: 'center' }}>
        <Label value="My flowers" fontSize={fs(19)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: '100%' }} />
        <Label value={`${getFlowers().length} kept - rare ${rares}/${FLOWERS.rare.length}`} fontSize={fs(14)} color={DIM} textAlign="middle-right" uiTransform={{ height: '100%' }} />
      </UiEntity>
      <Label value="Harvest an opened planter, or receive a gift" fontSize={fs(14)} color={{ ...DIM, a: 0.7 }} textAlign="middle-left" uiTransform={{ display: groups.length === 0 ? 'flex' : 'none', width: '100%', height: fs(26), margin: { top: px(6) } }} />

      <UiEntity uiTransform={{ display: groups.length > 0 ? 'flex' : 'none', width: '100%', flexDirection: 'row', flexWrap: 'wrap', margin: { top: px(8) } }}>
        {shown.map((g, i) => (
          <UiEntity
            key={g.key}
            uiTransform={{ width: tileW, height: px(78), margin: { right: (i % 4) === 3 ? 0 : px(8), bottom: px(8) }, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderRadius: px(12) }}
            uiBackground={{ color: g.key === selectedKey ? { ...MOSS, a: 0.55 } : RAISED }}
            onMouseDown={() => { selectedKey = selectedKey === g.key ? '' : g.key; giftMode = false }}
          >
            <UiEntity uiTransform={{ width: px(18), height: px(18), borderRadius: px(9), margin: { bottom: px(6) } }} uiBackground={{ color: g.rare ? GOLD : PINK }} />
            <Label value={g.count > 1 ? `${g.flower} x${g.count}` : g.flower} fontSize={fs(13)} color={CREAM} textAlign="middle-center" uiTransform={{ width: '100%', height: fs(20) }} />
          </UiEntity>
        ))}
      </UiEntity>
      <Label value={`+${groups.length - MAX_TILES} more kinds`} fontSize={fs(13)} color={DIM} textAlign="middle-left" uiTransform={{ display: groups.length > MAX_TILES ? 'flex' : 'none', width: '100%', height: fs(22) }} />

      {/* selection → gift */}
      <UiEntity uiTransform={{ display: sel && !giftMode ? 'flex' : 'none', width: '100%', height: px(48), flexDirection: 'row', alignItems: 'center', margin: { top: px(6) } }}>
        <Label value={sel ? `${sel.flower}${sel.rare ? ' (rare)' : ''}` : ''} fontSize={fs(16)} color={CREAM} textAlign="middle-left" uiTransform={{ flexGrow: 1, height: '100%' }} />
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
