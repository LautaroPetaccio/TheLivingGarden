// =============================================================
// Bloom Garden v2 — Gallery threads (CLIENT ONLY)
//
// KJ 2026-09-27: "still two divorced games". The Rare Plant Gallery now powers the Bloom — every
// flower on show makes every Bloom's seeds rarer (server: snapshotGallery / galleryBoost). This
// makes that visible: when a Bloom triggers, one soft glowing mote per flower on show, in that
// flower's rarity colour, lifts off its stand, arcs over the walls and flies into the Bloom's
// crown. They land inside the "wait for it" window (the seeds leave BLOOM_OPEN_MS after the
// trigger), so they read as the Gallery charging the flower.
//
// Restraint (KJ's FX rule: a few big soft glows, never a swarm of tiny particles): at most
// MAX_MOTES, rarest first. Live triggers only — a joiner's mid-Bloom resend does not replay it.
// Motion is written from this system for the few seconds the motes exist (no looping Tweens:
// the explorer writes every looping-tweened Transform back to the scene every frame).
// =============================================================

import { engine, Entity, Transform, MeshRenderer, Material, MaterialTransparencyMode } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { room } from './shared/messages'
import { BLOOM_SEED_ORIGIN, rarityTierById } from './shared/config'
import { avenueSlotIds, getAvenueSlot } from './avenueSystem'
import { triggerSparkle } from './sparkleSystem'

const TRAVEL_S    = 4.5    // one mote's flight, stand → crown
const STAGGER_S   = 0.2    // gap between departures
const ARC_H       = 9      // m the flight path peaks above the higher end — clears the garden walls
const LIFT_Y      = 1.9    // m above the stand's base the mote starts (just above the flower)
const MOTE_SIZE   = 0.5    // m
const MAX_MOTES   = 24
const LIVE_ONLY_MS = 3_000 // a bloomTriggered older than this is a join resend — no replay

type V3 = { x: number; y: number; z: number }
interface Mote { e: Entity; from: V3; mid: V3; to: V3; startAt: number }
let motes: Mote[] = []
let clock = 0
let systemOn = false

const bezier = (a: number, b: number, c: number, t: number): number => (1 - t) * (1 - t) * a + 2 * (1 - t) * t * b + t * t * c
const ease   = (t: number): number => t * t * (3 - 2 * t)   // smoothstep: lift off gently, settle in gently

function launch(): void {
  const shown = avenueSlotIds()
    .map(id => getAvenueSlot(id))
    .filter((v): v is NonNullable<typeof v> => !!v && !!v.owner)
    .sort((a, b) => b.rarityTier - a.rarityTier)   // rarest first when capped
    .slice(0, MAX_MOTES)
  if (shown.length === 0) return
  const to: V3 = { x: BLOOM_SEED_ORIGIN.x, y: BLOOM_SEED_ORIGIN.y, z: BLOOM_SEED_ORIGIN.z }
  shown.forEach((v, i) => {
    const from: V3 = { x: v.pos.x, y: v.pos.y + LIFT_Y, z: v.pos.z }
    const mid: V3  = { x: (from.x + to.x) / 2, y: Math.max(from.y, to.y) + ARC_H, z: (from.z + to.z) / 2 }
    const c = rarityTierById(v.rarityTier).seedColor
    const e = engine.addEntity()
    Transform.create(e, { position: from, scale: { x: 0, y: 0, z: 0 } })
    MeshRenderer.setSphere(e)
    Material.setPbrMaterial(e, {
      albedoColor: Color4.create(c.r, c.g, c.b, 0.85), emissiveColor: Color4.create(c.r, c.g, c.b, 1), emissiveIntensity: 3,
      transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND, castShadows: false,
    })
    motes.push({ e, from, mid, to, startAt: clock + i * STAGGER_S })
  })
  if (!systemOn) { systemOn = true; engine.addSystem(threadSystem) }
  console.log(`[GalleryThreads] ${shown.length} Gallery flower(s) → the Bloom`)
}

function threadSystem(dt: number): void {
  if (motes.length === 0) return
  clock += dt
  const left: Mote[] = []
  for (const m of motes) {
    const t = (clock - m.startAt) / TRAVEL_S
    if (t >= 1) { engine.removeEntity(m.e); continue }
    left.push(m)
    if (t < 0) continue   // not away yet
    const k = ease(t)
    // Swell as it lifts off, shrink as it sinks into the flower.
    const s = MOTE_SIZE * Math.min(1, t * 6, (1 - t) * 4 + 0.35)
    const tf = Transform.getMutable(m.e)
    tf.position = { x: bezier(m.from.x, m.mid.x, m.to.x, k), y: bezier(m.from.y, m.mid.y, m.to.y, k), z: bezier(m.from.z, m.mid.z, m.to.z, k) }
    tf.scale = { x: s, y: s, z: s }
  }
  // The last one in lands with a burst at the crown.
  if (left.length === 0) triggerSparkle(motes[0].to)
  motes = left
}

export function setupGalleryThreads(): void {
  room.onMessage('bloomTriggered', (data) => {
    if ((data.elapsedMs ?? 0) > LIVE_ONLY_MS) return
    if ((data.galleryFlowers ?? 0) <= 0) return
    launch()
  })
  console.log(`[GalleryThreads] ready · bloomTriggered listeners=${room.listenerCount('bloomTriggered')}`)
}
