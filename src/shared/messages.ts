// =============================================================
// The Living Garden — Shared Message Definitions
// Imported by both server and client.
//
// Registry ORDER does NOT matter for delivery (event types travel as strings —
// see @dcl/sdk/src/network/events/protocol.ts). A 2026-09-16 "position cutoff"
// theory was WRONG: the real cause of undelivered seed messages was
// wateringSystem.ts calling room.clear() AFTER setupSeedSystem() had registered
// its listeners. If a handler never fires, check WHEN it was registered relative
// to room.clear() before suspecting the transport.
//
// ⚠️ Never put a 13-digit Date.now() in a Schemas.Number message field —
// float32 rounds it by up to ~131 s (this broke clockSync, ±50 s offsets).
// Use Schemas.Int64 for epoch-ms, matching PlantSync.wateredAt in schemas.ts.
// =============================================================

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const room = registerMessages({
  // ── v2: bloom seeds ──────────────────────────────────────
  seedSpawned:      Schemas.Map({ id: Schemas.String, x: Schemas.Number, z: Schemas.Number, rare: Schemas.Boolean, spawnedAt: Schemas.Int64 }),
  seedGathered:     Schemas.Map({ seedId: Schemas.String, by: Schemas.String, byAddress: Schemas.String, rare: Schemas.Boolean }),
  gatherSeed:       Schemas.Map({ seedId: Schemas.String }),
  /** Test-panel only: spawn one seed near x,z through the real seedSpawned path. */
  adminSpawnSeed:   Schemas.Map({ x: Schemas.Number, z: Schemas.Number, rare: Schemas.Boolean }),
  /** Server → gatherer: the player's live seed pouch (after each gather, and on join). */
  pouchUpdate:      Schemas.Map({ normal: Schemas.Number, rare: Schemas.Number }),

  // ── v2: seed boxes ───────────────────────────────────────
  /** Player taps an empty box to plant a seed from their pouch (rare = which kind). */
  plantSeed:        Schemas.Map({ boxId: Schemas.String, rare: Schemas.Boolean }),
  /** One box's state — broadcast on change, sent per box to a joining/resyncing player.
   *  serverNow lets the client derive the countdown without trusting clockSync.
   *  owner '' = empty box. flower '' = not opened yet. Timestamps are epoch ms (Int64). */
  boxState:         Schemas.Map({
    boxId: Schemas.String, owner: Schemas.String, ownerName: Schemas.String, rare: Schemas.Boolean,
    plantedAt: Schemas.Int64, opensAt: Schemas.Int64, serverNow: Schemas.Int64,
    opened: Schemas.Boolean, flower: Schemas.String,
    waters: Schemas.Number, lastWaterer: Schemas.String,
  }),

  // ── v2 Phase 4: harvest / water / gift ───────────────────
  /** Owner taps their OPENED box: flower → their collection, box freed. */
  harvestBox:       Schemas.Map({ boxId: Schemas.String }),
  /** Visitor taps someone else's GROWING box: shaves BOX_WATER_SHAVE_MS (capped, once per visitor). */
  waterBox:         Schemas.Map({ boxId: Schemas.String }),
  /** Tap a nearby player: give them one flower from your collection (by index). */
  giftFlower:       Schemas.Map({ toAddress: Schemas.String, flowerIndex: Schemas.Number }),
  /** Server → player: their keepsake collection + box cap (after harvest/gift, and on join). */
  collectionUpdate: Schemas.Map({ flowersJson: Schemas.String, boxCap: Schemas.Number }),
  /** Server → receiver of a gift. */
  giftReceived:     Schemas.Map({ from: Schemas.String, flower: Schemas.String, rare: Schemas.Boolean }),
  /** Server → player: short feedback toast (rejections and confirmations). */
  notice:           Schemas.Map({ text: Schemas.String }),

  // ── Client → Server ───────────────────────────────────────
  /** Player requests to water a plant. Server validates and updates PlantSync. */
  waterPlant:       Schemas.Map({ plantId: Schemas.String }),
  /** Sent on join so the server can map address → display name for the leaderboard. */
  registerPlayer:   Schemas.Map({ displayName: Schemas.String }),
  /** Sent on room.onReady so the server re-sends full state even after a client reload. */
  requestFullSync:  Schemas.Map({}),

  // ── Server → all clients ─────────────────────────────────
  /** Periodic heartbeat so clients can maintain a clock-offset via clockSync. */
  // Int64, not Number: a 13-digit epoch-ms in float32 rounds by up to ~131 s and
  // made clockSync reject every heartbeat as an "outlier" (±60 s offsets).
  notifyServerTime: Schemas.Map({ sentAt: Schemas.Int64 }),

  // ── Server → specific client ──────────────────────────────
  /** Sent on player join and after each successful watering.
   *  sentAt: server timestamp when message was created (for clockSync).
   *  bloomTime: absolute server timestamp of the next bloom window. */
  playerDailyState: Schemas.Map({ sentAt: Schemas.Int64, bloomTime: Schemas.Int64 }),
  /** Sent when server rejects a water attempt. */
  waterRejected:    Schemas.Map({ plantId: Schemas.String, reason: Schemas.String }),

  // ── Server → all clients ──────────────────────────────────
  /** Broadcast when a plant's watered state changes (water or expiry).
   *  expiresInMs: server-computed time until this plant dries (0 when not watered) —
   *  decay scales with gardeners present, so the client must not guess it. */
  plantStateUpdate: Schemas.Map({ plantId: Schemas.String, isWatered: Schemas.Boolean, wateredAt: Schemas.Int64, wateredBy: Schemas.String, expiresInMs: Schemas.Number }),
  /** Broadcast when the bloom threshold is reached.
   *  scale: thresholdAtFire / BLOOM_THRESHOLD (0–1] — 1 = full-garden bloom,
   *  below 1 = the smaller, quieter scaled bloom (v2). */
  bloomTriggered:   Schemas.Map({ scale: Schemas.Number }),
  /** v2 — bloom threshold (flat 80% since the decay-rate rework) + gardeners present.
   *  Sent to a joining player, on full sync, and broadcast when the gardener count changes. */
  thresholdUpdate:  Schemas.Map({ threshold: Schemas.Number, gardeners: Schemas.Number }),
  /** Broadcast when the server resets all plants after bloom. */
  bloomReset:       Schemas.Map({}),
  /** Top-10 all-time leaderboard — sent to all on water, to joining player on join. */
  leaderboardUpdate: Schemas.Map({ entriesJson: Schemas.String }),
  // (v2 seed messages registered at the FRONT — see top of registry)

  // ── Test-panel only — parked at the tail (see header note) ──
  // Expected casualties of the position cap; verify with the test panel.
  /** Test-panel only — tells the server to bypass the daily limit for this player. */
  setTestOverride:  Schemas.Map({ enabled: Schemas.Boolean }),
  /** Test-panel only — triggers bloom on the server so all clients sync correctly. */
  forceBloom:       Schemas.Map({}),
  /** Test-panel only — waters exactly enough plants to reach the 80% bloom threshold. */
  forceWater80:     Schemas.Map({}),
})
