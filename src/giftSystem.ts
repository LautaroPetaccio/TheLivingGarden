// =============================================================
// Bloom Garden v2 — Keepsake Collection & Gifting (CLIENT ONLY, greybox)
//
// GDD §3 step 5 / §5 social loop: a harvested flower is a keepsake you keep
// or give away. Gifting is a world tap on another player — no menu, no drag
// (GDD §6 "large target"). The server moves the flower; we only ask.
//
// Server communication:
//   send    →  giftFlower       { toAddress, flowerIndex }
//   receive ←  collectionUpdate { flowersJson, boxCap }   (mine, after harvest/gift/join)
//   receive ←  giftReceived     { from, flower, rare }
//   receive ←  notice           { text }                  (server feedback toasts)
//
// Tap target: an invisible pointer-only collider attached to each remote
// avatar (AvatarAttach by avatarId, like the bloom hand-flower). Pointer
// layer only, so it never blocks walking or plant clicks through a player.
// =============================================================

import {
  engine,
  Entity,
  Transform,
  MeshCollider,
  ColliderLayer,
  AvatarAttach,
  AvatarAnchorPointType,
  PlayerIdentityData,
  TextShape,
  pointerEventsSystem,
  InputAction,
} from '@dcl/sdk/ecs'
import { room } from './shared/messages'
import { showToast } from './notifications'
import { createSign, setupSignSystem } from './signs'
import { FLOWERS } from './shared/config'

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

const TAG_SIZE      = { x: 0.8, y: 1.8, z: 0.8 }   // roughly an avatar's body
const TAG_OFFSET_Y  = 0.9                           // AAPT_POSITION anchors at the feet
const GIFT_DISTANCE = 6     // m — mobile is third-person only
const SCAN_MS       = 1_000
const TOAST_MS      = 5_000

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

export interface Keepsake { flower: string; rare: boolean; at: number; from?: string }

let flowers: Keepsake[] = []
let boxCap  = 1
let scanAccum = 0
const tags = new Map<string, Entity>()   // remote address → AvatarAttach parent

export function getCollection(): Keepsake[] { return flowers.slice() }

// Keepsakes post — right end of the planter row. The only place a player can SEE what
// they hold (GDD §4.2 "the rare collection at x/N"); tap lists every flower.
const KEEPSAKE_POST_POS  = { x: 15.2, y: 0.75, z: 4.4 }
const KEEPSAKE_POST_SIZE = { w: 1.3, h: 0.85 }
let keepsakePostText: Entity | null = null

function raresFound(): number {
  const found = new Set<string>()
  for (const f of flowers) if (f.rare) found.add(f.flower)
  return found.size
}
function refreshKeepsakePost(): void {
  if (keepsakePostText === null) return
  const newest = flowers.length > 0 ? flowers[flowers.length - 1].flower : 'none yet'
  TextShape.getMutable(keepsakePostText).text =
    `Your keepsakes: ${flowers.length}\nRare collection ${raresFound()}/${FLOWERS.rare.length}\nNewest: ${newest}`
}
function createKeepsakePost(): void {
  const sign = createSign(KEEPSAKE_POST_POS, 180, KEEPSAKE_POST_SIZE, 0.85)
  keepsakePostText = sign.text
  const tap = engine.addEntity()
  Transform.create(tap, { position: KEEPSAKE_POST_POS, scale: { x: KEEPSAKE_POST_SIZE.w, y: KEEPSAKE_POST_SIZE.h, z: 0.3 } })
  MeshCollider.setBox(tap, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: tap, opts: { button: InputAction.IA_POINTER, hoverText: 'My keepsakes', maxDistance: GIFT_DISTANCE + 2 } },
    () => {
      if (flowers.length === 0) { showToast('No keepsakes yet — harvest a flower, or receive one as a gift', TOAST_MS, false); return }
      const counts = new Map<string, number>()
      for (const f of flowers) { const k = f.rare ? `${f.flower} (rare)` : f.flower; counts.set(k, (counts.get(k) ?? 0) + 1) }
      showToast([...counts].map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(', '), TOAST_MS + 2_000, false)
    },
  )
  refreshKeepsakePost()
}
export function getBoxCap(): number { return boxCap }

// ---------------------------------------------------------------
// Gifting (world tap on a player)
// ---------------------------------------------------------------

function tryGift(toAddress: string): void {
  if (flowers.length === 0) {
    showToast('No flower to give yet — harvest one first', TOAST_MS, false)
    return
  }
  // Give the newest keepsake; a picker can come with the collection UI.
  const flowerIndex = flowers.length - 1
  console.log(`[Gift] offering ${flowers[flowerIndex].flower} to ${toAddress}`)
  room.send('giftFlower', { toAddress, flowerIndex })
}

function createTag(address: string): Entity {
  const parent = engine.addEntity()
  AvatarAttach.create(parent, { avatarId: address, anchorPointId: AvatarAnchorPointType.AAPT_POSITION })

  const body = engine.addEntity()
  Transform.create(body, { position: { x: 0, y: TAG_OFFSET_Y, z: 0 }, scale: TAG_SIZE, parent })
  MeshCollider.setBox(body, ColliderLayer.CL_POINTER)
  pointerEventsSystem.onPointerDown(
    { entity: body, opts: { button: InputAction.IA_POINTER, hoverText: 'Gift a flower', maxDistance: GIFT_DISTANCE } },
    () => tryGift(address),
  )
  return parent
}

/** Keep one tap target per remote avatar; drop them when players leave. */
function tagScanSystem(dt: number): void {
  scanAccum += dt * 1_000
  if (scanAccum < SCAN_MS) return
  scanAccum = 0

  const present = new Set<string>()
  for (const [entity, ident] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (entity === engine.PlayerEntity) continue
    const address = ident.address.toLowerCase()
    present.add(address)
    if (!tags.has(address)) tags.set(address, createTag(address))
  }
  for (const [address, parent] of tags) {
    if (present.has(address)) continue
    engine.removeEntityWithChildren(parent)
    tags.delete(address)
  }
}

// ---------------------------------------------------------------
// Setup
// ---------------------------------------------------------------

/** Register handlers — MUST be called after wateringSystem's room.clear(). */
export function setupGiftSystem(): void {
  room.onMessage('collectionUpdate', (data) => {
    try { flowers = JSON.parse(data.flowersJson) } catch { flowers = [] }
    boxCap = data.boxCap
    refreshKeepsakePost()
    console.log(`[Gift] collection: ${flowers.length} flower(s), box cap ${boxCap}`)
  })

  room.onMessage('giftReceived', (data) => {
    showToast(`${data.from} gave you a ${data.flower}${data.rare ? ' — a rare one!' : ''}`, TOAST_MS, false)
  })

  room.onMessage('notice', (data) => {
    showToast(data.text, TOAST_MS, false)
  })

  setupSignSystem()
  createKeepsakePost()
  engine.addSystem(tagScanSystem)
  console.log(`[Gift] ready · notice listeners=${room.listenerCount('notice')}`)
}
