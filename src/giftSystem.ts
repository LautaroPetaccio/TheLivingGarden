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
//   receive ←  giftReceived     { from, flower, rarityTier }
//   receive ←  notice           { text }                  (server feedback toasts)
//   send    →  holdFlower       { flowerIndex }           (-1 = put away)
//   receive ←  heldFlower       { address, flower, rarityTier }   (anyone's hand, incl. mine)
//
// Held flower: one keepsake shown in a gardener's right hand, for everyone. Interlocks
// with gifting — a world tap on a player with nothing picked in the menu gives the flower
// you're holding; giving away the last one of that kind empties your hand (server).
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
  GltfContainer,
} from '@dcl/sdk/ecs'
import { Quaternion } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { showToast } from './notifications'
import { getPlayer } from '@dcl/sdk/players'
import { getFlowers, setFlowers, setBoxCap, registerGiftApi, Keepsake, setHeld, heldFlowerIndex } from './playerInventory'
import { getSelectedGiftIndex, openSeedMenu } from './seedMenu'
import { rarityTierById, plantSpeciesById, withArticle } from './shared/config'
import { isBloomFlowerActive } from './bloomFlowerSystem'
import { playSfx } from './sounds'

// ---------------------------------------------------------------
// Config
// ---------------------------------------------------------------

const TAG_SIZE      = { x: 0.8, y: 1.8, z: 0.8 }   // roughly an avatar's body
const TAG_OFFSET_Y  = 0.9                           // AAPT_POSITION anchors at the feet
const GIFT_DISTANCE = 6     // m — mobile is third-person only
const SCAN_MS       = 1_000
const TOAST_MS      = 5_000
// Held flower in the RIGHT hand with the bloom contributor's hand-flower offset/rotation
// (bloomFlowerSystem) so it faces forward the same way — the left hand's bone is mirrored
// and the same rotation pointed the flower backwards (KJ 2026-09-18). My own keepsake hides
// while that bloom flower is out (it's local-only, so other players still see the keepsake).
// Size is a fraction of the species' planter-box size.
const HAND_K        = 0.4
const HAND_OFFSET   = { x: 0, y: 0.06, z: 0 }
const HAND_ROTATION = Quaternion.fromEulerDegrees(90, 0, 0)

// ---------------------------------------------------------------
// State
// ---------------------------------------------------------------

let scanAccum = 0
const tags = new Map<string, Entity>()   // remote address → AvatarAttach parent
const hands = new Map<string, Entity>()  // address → held-flower AvatarAttach parent (mine included)
let   myHolder: Entity | null = null       // my keepsake's holder — scaled to 0 while the bloom flower is out



// ---------------------------------------------------------------
// Gifting (world tap on a player)
// ---------------------------------------------------------------

function tryGift(toAddress: string): void {
  const flowers = getFlowers()
  if (flowers.length === 0) {
    showToast('No flower to give yet — harvest one first', TOAST_MS, false)
    return
  }
  // World-tap is a shortcut for "who" — "which flower" comes from the seed menu's own
  // picker (My flowers → tap a kind → Gift), so tapping a player sends THAT selection
  // instead of silently guessing the newest keepsake.
  const flowerIndex = getSelectedGiftIndex() ?? heldFlowerIndex()
  if (flowerIndex === null) {
    showToast('Hold a flower, or pick one in your seed pouch, to gift it', TOAST_MS, false)
    openSeedMenu()
    return
  }
  console.log(`[Gift] offering ${flowers[flowerIndex]?.flower ?? '?'} to ${toAddress}`)
  room.send('giftFlower', { toAddress, flowerIndex })
  playSfx('gift')
}

function localAddress(): string { return (getPlayer()?.userId ?? '').toLowerCase() }

/** Show (or clear, flower '') what a gardener holds. Mine attaches to the local avatar. */
function setHand(address: string, flower: string, rarityTier: number): void {
  const old = hands.get(address)
  if (old !== undefined) { engine.removeEntityWithChildren(old); hands.delete(address) }
  const mine = address === localAddress()
  if (mine) { setHeld(flower ? { flower, rarityTier } : null); myHolder = null }
  const species = flower ? plantSpeciesById(flower) : null
  if (!species) return
  const parent = engine.addEntity()
  AvatarAttach.create(parent, mine
    ? { anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND }
    : { avatarId: address, anchorPointId: AvatarAnchorPointType.AAPT_RIGHT_HAND })
  const holder = engine.addEntity()
  Transform.create(holder, { parent, position: HAND_OFFSET, rotation: HAND_ROTATION })
  if (mine) { myHolder = holder; syncMyHand() }
  const model = engine.addEntity()
  const k = species.scale * HAND_K
  Transform.create(model, {
    parent: holder,
    position: { x: species.offsetX * HAND_K, y: species.baseYOffset * HAND_K, z: species.offsetZ * HAND_K },
    scale: { x: k, y: k, z: k },
  })
  GltfContainer.create(model, { src: species.modelSrc, visibleMeshesCollisionMask: ColliderLayer.CL_NONE, invisibleMeshesCollisionMask: ColliderLayer.CL_NONE })
  hands.set(address, parent)
}

/** Hide my keepsake while the bloom hand-flower occupies the same hand. */
function syncMyHand(): void {
  if (myHolder === null) return
  const k = isBloomFlowerActive() ? 0 : 1
  const tr = Transform.getMutable(myHolder)
  if (tr.scale.x !== k) tr.scale = { x: k, y: k, z: k }
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
  syncMyHand()

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
    let list: Keepsake[] = []
    try { list = JSON.parse(data.flowersJson) } catch { list = [] }
    setFlowers(list)
    setBoxCap(data.boxCap)
    console.log(`[Gift] collection: ${list.length} flower(s), box cap ${data.boxCap}`)
  })

  room.onMessage('giftReceived', (data) => {
    playSfx('gift')
    const tierName = rarityTierById(data.rarityTier).name
    showToast(`${data.from} gave you ${withArticle(plantSpeciesById(data.flower)?.name ?? data.flower)}${data.rarityTier > 0 ? ` — ${withArticle(tierName)} one!` : ''}`, TOAST_MS, false)
  })

  room.onMessage('heldFlower', (data) => {
    setHand(data.address.toLowerCase(), data.flower, data.rarityTier)
  })

  room.onMessage('notice', (data) => {
    showToast(data.text, TOAST_MS, false)
  })

  // The seed menu gifts through the store: who is here (same set the avatar tap targets
  // track) and the one call that sends a flower.
  registerGiftApi({
    gardenersHere: () => [...tags.keys()].map(address => ({ address, name: getPlayer({ userId: address })?.name || `${address.slice(0, 6)}...` })),
    give: (toAddress, flowerIndex) => { console.log(`[Gift] menu gift #${flowerIndex} to ${toAddress}`); room.send('giftFlower', { toAddress, flowerIndex }); playSfx('gift') },
    hold: (flowerIndex) => { console.log(`[Gift] hold #${flowerIndex}`); room.send('holdFlower', { flowerIndex }) },
  })
  engine.addSystem(tagScanSystem)
  console.log(`[Gift] ready · notice listeners=${room.listenerCount('notice')}`)
}
