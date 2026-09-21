// =============================================================
// Bloom Garden v2 — one-shot sound effects (CLIENT)
//
// playSfx('harvest') at the player, or playSfx('flowerOpen', planterPos) so nearby
// players hear it from the planter. The sfx/*.mp3 chimes were synthesized for Bloom
// Garden (2026-09-19, no third-party licence) — replace any file freely, same name.
//
// Replaying: flipping `playing` false→true in ONE tick never reaches the renderer (only
// the final state is sent), so we stop now and start on the next tick, alternating two
// entities per sound so a quick repeat doesn't cut the previous one off (same fix as
// wateringSystem's playMagicFXSound).
// =============================================================

import { engine, Entity, Transform, AudioSource, timers } from '@dcl/sdk/ecs'

const SFX = {
  seedCatch:  { src: 'assets/scene/Sounds/sfx/seedCatch.mp3',  volume: 0.6 },
  plant:      { src: 'assets/scene/Sounds/sfx/plant.mp3',      volume: 0.8 },
  harvest:    { src: 'assets/scene/Sounds/sfx/harvest.mp3',    volume: 0.8 },
  gift:       { src: 'assets/scene/Sounds/sfx/gift.mp3',       volume: 0.9 },
  flowerOpen: { src: 'assets/scene/Sounds/sfx/flowerOpen.mp3', volume: 0.9 },
  golden:     { src: 'assets/scene/Sounds/MagicFX.mp3',         volume: 1.0 },
} as const   // TUNING — volumes
export type SfxName = keyof typeof SFX

const pools = new Map<SfxName, { ents: Entity[]; next: number }>()

export function playSfx(name: SfxName, at?: { x: number; y: number; z: number }): void {
  const pos = at ?? Transform.getOrNull(engine.PlayerEntity)?.position
  if (!pos) return
  let pool = pools.get(name)
  if (!pool) {
    pool = { ents: [], next: 0 }
    for (let i = 0; i < 2; i++) {
      const e = engine.addEntity()
      Transform.create(e, { position: pos })
      AudioSource.create(e, { audioClipUrl: SFX[name].src, playing: false, loop: false, volume: SFX[name].volume })
      pool.ents.push(e)
    }
    pools.set(name, pool)
  }
  const e = pool.ents[pool.next]
  pool.next = (pool.next + 1) % pool.ents.length
  Transform.getMutable(e).position = pos
  AudioSource.getMutable(e).playing = false
  timers.setTimeout(() => { AudioSource.getMutable(e).playing = true }, 0)
}
