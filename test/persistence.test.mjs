// Behaviour of src/server/persistence.ts against a stubbed Storage.
// Run with `npm test` — scripts/run-tests.mjs builds test/.build/persistence.mjs first.

import { test } from 'node:test'
import assert from 'node:assert/strict'

const tick = (ms = 0) => new Promise(r => setTimeout(r, ms))

// Module state (the in-flight counter, the write chain) is global, so every case
// gets its own instance of the module — and its own stub with it.
let instance = 0
const fresh = () => import(`./.build/persistence.mjs?case=${++instance}`)

/** Writes only, ignoring reads. */
const writes = m => m.calls.filter(c => c.op === 'set')
/** The payload of a write, unwrapped from its version envelope. */
const payload = call => call.value.d

// ── reads ──────────────────────────────────────────────────────

test('read: returns the stored value', async () => {
  const m = await fresh()
  m.setHandler({ get: () => ({ v: 1, d: [{ plantId: 'Plant_1' }] }) })
  const r = await m.loadScene('plants')
  assert.deepEqual(r.value, [{ plantId: 'Plant_1' }])
  assert.equal(r.ok, true)
})

test('read: costs exactly one call and never writes', async () => {
  const m = await fresh()
  m.setHandler({ get: () => null })
  await m.loadScene('boxes')
  assert.equal(m.calls.length, 1, `expected one call, saw ${JSON.stringify(m.calls)}`)
  assert.equal(writes(m).length, 0, 'a read must not write anything')
})

test('read: null is reported as an empty key, not a failure', async () => {
  const m = await fresh()
  m.setHandler({ get: () => null })
  assert.deepEqual(await m.loadScene('boxes'), { ok: true, value: null, version: m.LEGACY_VERSION })
})

test('read: a rejected get is a failure, never an empty key', async () => {
  const m = await fresh()
  m.setHandler({ get: () => { throw new Error('Unable to retrieve realm information') } })
  assert.deepEqual(await m.loadScene('plants'), { ok: false })
})

test('read: player scope targets the right address and key', async () => {
  const m = await fresh()
  m.setHandler({ get: () => ({ v: 1, d: { normal: 3 } }) })
  const r = await m.loadPlayer('0xABC', 'seeds')
  assert.deepEqual(r.value, { normal: 3 })
  assert.equal(m.calls[0].address, '0xABC')
  assert.equal(m.calls[0].key, 'seeds')
})

test('read: a join burst stays within the fetch budget', async () => {
  const m = await fresh()
  let live = 0, peak = 0
  m.setHandler({ get: async () => { live++; peak = Math.max(peak, live); await tick(10); live--; return null } })
  await Promise.all(Array.from({ length: 40 }, (_, i) => m.loadPlayer(`0x${i}`, 'seeds')))
  assert.ok(peak <= 10, `peak in-flight ${peak} must stay well under the runtime's 32`)
})

// ── shape versions ─────────────────────────────────────────────

test('version: a write is stamped with its writer version', async () => {
  const m = await fresh()
  m.setHandler({ set: () => true })
  const w = m.createSceneWriter('plants', 3)
  w.enable(); w.save([{ plantId: 'Plant_1' }]); await w.idle()
  assert.deepEqual(writes(m)[0].value, { v: 3, d: [{ plantId: 'Plant_1' }] })
})

test('version: a stamped value reads back with its version', async () => {
  const m = await fresh()
  m.setHandler({ get: () => ({ v: 7, d: { cap: 2 } }) })
  const r = await m.loadScene('boxCap')
  assert.equal(r.version, 7)
  assert.deepEqual(r.value, { cap: 2 })
})

test('version: a value stored before versioning reads as the legacy version', async () => {
  const m = await fresh()
  m.setHandler({ get: () => [{ address: '0x1', total: 4 }] })
  const r = await m.loadScene('lifetime')
  assert.equal(r.version, m.LEGACY_VERSION)
  assert.deepEqual(r.value, [{ address: '0x1', total: 4 }])
})

test('version: an array payload is never mistaken for an envelope', async () => {
  const m = await fresh()
  m.setHandler({ get: () => ({ v: 1, d: ['a', 'b'] }) })
  const r = await m.loadScene('discovered')
  assert.deepEqual(r.value, ['a', 'b'])
  assert.equal(r.version, 1)
})

// ── writes ─────────────────────────────────────────────────────

test('write: held until enable(), then only the newest snapshot lands', async () => {
  const m = await fresh()
  m.setHandler({ set: () => true })
  const w = m.createSceneWriter('plants', 1)
  w.save({ v: 1 }); w.save({ v: 2 }); w.save({ v: 3 })
  await tick(20)
  assert.equal(writes(m).length, 0, 'nothing may be written before enable()')
  w.enable(); await w.idle()
  assert.deepEqual(writes(m).map(payload), [{ v: 3 }])
})

test('write: a successful save costs exactly one call', async () => {
  const m = await fresh()
  m.setHandler({ set: () => true })
  const w = m.createSceneWriter('boxes', 1)
  w.enable(); w.save({ a: 1 }); await w.idle()
  assert.equal(m.calls.length, 1, `expected one call, saw ${JSON.stringify(m.calls)}`)
})

test('write: a failed save is retried until it lands', async () => {
  const m = await fresh()
  let n = 0
  m.setHandler({ set: () => ++n > 2 })
  const w = m.createSceneWriter('boxes', 1)
  w.enable(); w.save({ v: 'final' })
  const start = Date.now()
  while (Date.now() - start < 8000 && writes(m).length < 3) await tick(50)
  await w.idle()
  assert.ok(writes(m).length >= 3, `expected retries, saw ${writes(m).length}`)
  assert.deepEqual(payload(writes(m).at(-1)), { v: 'final' })
})

test('write: a newer snapshot supersedes a failed one', async () => {
  const m = await fresh()
  let n = 0
  m.setHandler({ set: async () => { await tick(5); return ++n !== 1 } })
  const w = m.createPlayerWriter('0xdef', 'seeds', 1)
  w.enable(); w.save({ n: 1 }); await tick(2); w.save({ n: 2 })
  await w.idle()
  assert.deepEqual(payload(writes(m).at(-1)), { n: 2 })
})

test('write: a throwing set counts as a failure, not a success', async () => {
  const m = await fresh()
  let n = 0
  m.setHandler({ set: () => { if (++n === 1) throw new Error('boom'); return true } })
  const w = m.createPlayerWriter('0x9', 'flowers', 1)
  w.enable(); w.save({ a: 1 })
  const start = Date.now()
  while (Date.now() - start < 5000 && writes(m).length < 2) await tick(50)
  await w.idle()
  assert.ok(writes(m).length >= 2, 'a throw must be retried')
})

test('write: player writes carry the address and key', async () => {
  const m = await fresh()
  m.setHandler({ set: () => true })
  const w = m.createPlayerWriter('0xabc', 'flowers', 1)
  w.enable(); w.save([{ flower: 'Tulip' }]); await w.idle()
  const c = writes(m)[0]
  assert.equal(c.scope, 'player')
  assert.equal(c.address, '0xabc')
  assert.equal(c.key, 'flowers')
})

test('write: writes to DIFFERENT keys never overlap', async () => {
  const m = await fresh()
  let live = 0, peak = 0
  m.setHandler({ set: async () => { live++; peak = Math.max(peak, live); await tick(8); live--; return true } })
  // The preview storage service rewrites the whole file per PUT, so two writes to
  // different keys in flight at once erase each other (fixed 2026-09-17).
  const ws = ['plants', 'boxes', 'leaderboard', 'lifetimeTop', 'tributes'].map(k => m.createSceneWriter(k, 1))
  ws.forEach((w, i) => { w.enable(); w.save({ i }) })
  await Promise.all(ws.map(w => w.idle()))
  assert.equal(peak, 1, `writes must be strictly serialized across keys, peak was ${peak}`)
  assert.equal(writes(m).length, 5, 'every key must still land its write')
})

test('write: many writers stay within the fetch budget', async () => {
  const m = await fresh()
  m.setHandler({ set: async () => { await tick(5); return true } })
  const ws = Array.from({ length: 30 }, (_, i) => m.createPlayerWriter(`0x${i}`, 'seeds', 1))
  ws.forEach((w, i) => { w.enable(); w.save({ i }) })
  await Promise.all(ws.map(w => w.idle()))
  assert.equal(writes(m).length, 30)
})

test('idle(): resolves only once writing has stopped', async () => {
  const m = await fresh()
  m.setHandler({ set: async () => { await tick(5); return true } })
  const w = m.createPlayerWriter('0x1', 'flowers', 1)
  w.enable(); w.save({ a: 1 }); await w.idle()
  const after = writes(m).length
  await tick(30)
  assert.equal(writes(m).length, after, 'no writes may happen after idle() resolves')
})
