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
  pointerEventsSystem,
  InputAction,
} from '@dcl/sdk/ecs'
import { room } from './shared/messages'
import { showToast } from './notifications'

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
    console.log(`[Gift] collection: ${flowers.length} flower(s), box cap ${boxCap}`)
  })

  room.onMessage('giftReceived', (data) => {
    showToast(`${data.from} gave you a ${data.flower}${data.rare ? ' — a rare one!' : ''}`, TOAST_MS, false)
  })

  room.onMessage('notice', (data) => {
    showToast(data.text, TOAST_MS, false)
  })

  engine.addSystem(tagScanSystem)
  console.log(`[Gift] ready · notice listeners=${room.listenerCount('notice')}`)
}
