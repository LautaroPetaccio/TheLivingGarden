// =============================================================
// The Living Garden — Shared Message Definitions
// Imported by both server and client.
// =============================================================

import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const room = registerMessages({
  // ── Client → Server ───────────────────────────────────────
  /** Player requests to water a plant. Server validates and updates PlantSync. */
  waterPlant:       Schemas.Map({ plantId: Schemas.String }),
  /** Sent on join so the server can map address → display name for the leaderboard. */
  registerPlayer:   Schemas.Map({ displayName: Schemas.String }),
  /** Test-panel only — triggers bloom on the server so all clients sync correctly. */
  forceBloom:       Schemas.Map({}),
  /** Test-panel only — waters exactly enough plants to reach the 80% bloom threshold. */
  forceWater80:     Schemas.Map({}),
  /** Test-panel only — tells the server to bypass the daily limit for this player. */
  setTestOverride:  Schemas.Map({ enabled: Schemas.Boolean }),
  /** Sent on room.onReady so the server re-sends full state even after a client reload. */
  requestFullSync:  Schemas.Map({}),
  /** v2 — player walked into a falling/landed seed; server validates and awards it. */
  gatherSeed:       Schemas.Map({ seedId: Schemas.String }),

  // ── Server → all clients ─────────────────────────────────
  /** Periodic heartbeat so clients can maintain a clock-offset via clockSync. */
  notifyServerTime: Schemas.Map({ sentAt: Schemas.Number }),

  // ── Server → specific client ──────────────────────────────
  /** Sent on player join and after each successful watering.
   *  sentAt: server timestamp when message was created (for clockSync).
   *  bloomTime: absolute server timestamp of the next bloom window. */
  playerDailyState: Schemas.Map({ sentAt: Schemas.Number, bloomTime: Schemas.Number }),
  /** Sent when server rejects a water attempt. */
  waterRejected:    Schemas.Map({ plantId: Schemas.String, reason: Schemas.String }),

  // ── Server → all clients ──────────────────────────────────
  /** Broadcast when a plant's watered state changes (water or expiry). */
  plantStateUpdate: Schemas.Map({ plantId: Schemas.String, isWatered: Schemas.Boolean, wateredAt: Schemas.Number, wateredBy: Schemas.String }),
  /** Broadcast when the bloom threshold is reached.
   *  scale: thresholdAtFire / BLOOM_THRESHOLD (0–1] — 1 = full-garden bloom,
   *  below 1 = the smaller, quieter scaled bloom (v2). */
  bloomTriggered:   Schemas.Map({ scale: Schemas.Number }),
  /** v2 — current scaled bloom threshold. Sent to a joining player, on full sync,
   *  and broadcast whenever the gardener count (and so the threshold) changes. */
  thresholdUpdate:  Schemas.Map({ threshold: Schemas.Number, gardeners: Schemas.Number }),
  /** Broadcast when the server resets all plants after bloom. */
  bloomReset:       Schemas.Map({}),
  /** Top-10 all-time leaderboard — sent to all on water, to joining player on join. */
  leaderboardUpdate: Schemas.Map({ entriesJson: Schemas.String }),

  // ── v2: bloom seeds ──────────────────────────────────────
  /** Seeds spawned by a bloom (broadcast), or the still-gatherable remainder
   *  (targeted, on join/fullSync). seedsJson: [{id,x,z,rare,spawnedAt}] */
  seedsSpawned:     Schemas.Map({ seedsJson: Schemas.String }),
  /** A seed was claimed — all clients despawn it; the gatherer shows a toast. */
  seedGathered:     Schemas.Map({ seedId: Schemas.String, by: Schemas.String, byAddress: Schemas.String, rare: Schemas.Boolean }),
})
