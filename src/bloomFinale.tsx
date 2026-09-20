// =============================================================
// Bloom Garden v2 — Bloom finale card (CLIENT ONLY)
//
// The closing beat of a bloom. The during-bloom contributor names in the garden
// are untouched; this is what the garden says once the spectacle ends, so a
// bloom finishes on a RESULT rather than just stopping:
//
//     This bloom
//     4 gardeners · 31 waters · 2 rares
//     You: 9 waters, 3 seeds, 1 rare
//
// The personal line is hidden for anyone who did nothing this cycle — a player
// who walked in during the last ten seconds should not be told they did zero.
//
// Own state + own message handler, rendered by ui.tsx — the seedMenu.tsx pattern.
// ⚠️ setupBloomFinale() runs from index.ts AFTER setupWateringSystem(), which
// calls room.clear(): a handler registered before that clear is silently wiped.
// =============================================================

import ReactEcs, { UiEntity, Label } from '@dcl/sdk/react-ecs'
import { room } from './shared/messages'
import { BLOOM_FINALE_MS } from './shared/config'

interface Summary {
  gardeners: number; waters: number; seeds: number; rares: number
  youWaters: number; youSeeds: number; youRares: number
}

let summary: Summary | null = null
let shownAt = 0

const FADE_MS = 400
const DARK  = { r: 0.07, g: 0.063, b: 0.055, a: 0.92 }
const CREAM = { r: 0.957, g: 0.918, b: 0.824 }
const GOLD  = { r: 0.98,  g: 0.78,  b: 0.46 }
const DIM   = { r: 0.83,  g: 0.82,  b: 0.78 }

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function setupBloomFinale(): void {
  room.onMessage('bloomSummary', (data) => {
    summary = {
      gardeners: data.gardeners, waters: data.waters, seeds: data.seeds, rares: data.rares,
      youWaters: data.youWaters, youSeeds: data.youSeeds, youRares: data.youRares,
    }
    shownAt = Date.now()
    console.log(`[Finale] ${data.gardeners} gardener(s), ${data.waters} waters, ${data.seeds} seeds (${data.rares} rare+) · you ${data.youWaters}/${data.youSeeds}`)
  })
}

/** Alpha-only fade in and out — size/position tweens jitter on the phone. */
function alpha(now: number): number {
  const age  = now - shownAt
  const left = BLOOM_FINALE_MS - age
  if (left <= 0) return 0
  return Math.min(1, age / FADE_MS, left / FADE_MS)
}

export function BloomFinaleUi(props: { px: (n: number) => number; fs: (n: number) => number }) {
  if (!summary) return null
  const a = alpha(Date.now())
  if (a <= 0.02) return null
  const { px, fs } = props
  const s = summary

  const communal = `${plural(s.gardeners, 'gardener')} · ${plural(s.waters, 'water')}${s.rares > 0 ? ` · ${plural(s.rares, 'rare')}` : ''}`
  const didSomething = s.youWaters > 0 || s.youSeeds > 0
  const personal = `You: ${plural(s.youWaters, 'water')}, ${plural(s.youSeeds, 'seed')}${s.youRares > 0 ? `, ${plural(s.youRares, 'rare')}` : ''}`

  return (
    <UiEntity uiTransform={{ positionType: 'absolute', position: { top: '22%', left: 0 }, width: '100%', flexDirection: 'row', justifyContent: 'center' }}>
      <UiEntity
        uiTransform={{ flexDirection: 'column', alignItems: 'center', padding: { left: px(30), right: px(30), top: px(18), bottom: px(18) }, borderRadius: px(22) }}
        uiBackground={{ color: { ...DARK, a: DARK.a * a } }}
      >
        <Label value="This bloom" fontSize={fs(18)} color={{ ...DIM, a }} textAlign="middle-center" uiTransform={{ height: fs(26) }} />
        <Label value={communal} fontSize={fs(30)} color={{ ...GOLD, a }} textAlign="middle-center" uiTransform={{ height: fs(40) }} />
        <Label
          value={didSomething ? personal : ''}
          fontSize={fs(19)}
          color={{ ...CREAM, a }}
          textAlign="middle-center"
          uiTransform={{ display: didSomething ? 'flex' : 'none', height: fs(28), margin: { top: px(4) } }}
        />
      </UiEntity>
    </UiEntity>
  )
}
