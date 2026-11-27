// npm test -w apps/hub — the page's side of section updates (shared/updates.js): which build-info.json it starts
// with, and what a later one says has changed. fetch and localStorage are stubbed; each test loads its own copy
// of the module (the ?case suffix), because it keeps its state in the module.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

const info = (shell, entry, benchHash) => ({
  v: 1, shell, entry,
  sections: { testbench: { hash: benchHash, js: `assets/section-testbench-${benchHash}.js`, css: [], preload: [] }, asks: { hash: 'a1', js: 'assets/section-asks-a1.js', css: [], preload: [] } },
})
let served, store
beforeEach(() => {
  served = null
  store = new Map()
  globalThis.fetch = async () => { if (!served) throw new TypeError('offline'); return { ok: true, json: async () => served } }
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }
})
let n = 0
const fresh = () => import(`../../../shared/updates.js?case${++n}`)

test('starts with the file for this script, and keeps a copy', async () => {
  served = info('s1', 'assets/main-1.js', 'b1')
  const u = await fresh()
  assert.deepEqual(await u.startBuildInfo('assets/main-1.js'), served)
  assert.equal(u.hasShellMismatch(), false)
  assert.ok(store.get('hub:build-info'))
})

test('a file for another script means a deploy landed mid-load: flagged, and the saved copy is used', async () => {
  const mine = info('s1', 'assets/main-1.js', 'b1')
  store.set('hub:build-info', JSON.stringify(mine))
  served = info('s2', 'assets/main-2.js', 'b2')
  const u = await fresh()
  assert.deepEqual(await u.startBuildInfo('assets/main-1.js'), mine)
  assert.equal(u.hasShellMismatch(), true)
})

test('a file for another script and nothing saved: nothing to go on', async () => {
  served = info('s2', 'assets/main-2.js', 'b2')
  const u = await fresh()
  assert.equal(await u.startBuildInfo('assets/main-1.js'), null)
  assert.equal(u.hasShellMismatch(), true)
})

test('offline: the copy saved for this script, never one saved for another', async () => {
  store.set('hub:build-info', JSON.stringify(info('s1', 'assets/main-1.js', 'b1')))
  const u = await fresh()
  assert.equal((await u.startBuildInfo('assets/main-1.js')).shell, 's1')
  const other = await fresh()
  assert.equal(await other.startBuildInfo('assets/main-9.js'), null)
})

test('a later file marks the sections that changed, tells the listeners, and stays marked', async () => {
  served = info('s1', 'assets/main-1.js', 'b1')
  const u = await fresh()
  await u.startBuildInfo('assets/main-1.js')
  const heard = []
  u.subscribe((r) => heard.push(r))
  served = info('s1', 'assets/main-1.js', 'b2')            // only the Test Bench changed
  const r = await u.refreshStale()
  assert.deepEqual(r, { known: true, shell: false, sections: ['testbench'] })
  assert.equal(u.isStale('testbench'), true)
  assert.equal(u.isStale('asks'), false)
  assert.equal(heard.length, 1)
  served = info('s1', 'assets/main-1.js', 'b1')            // even if a later file looks like the start again
  await u.refreshStale()
  assert.equal(u.isStale('testbench'), true)
})

test('a change to the shell is reported as such', async () => {
  served = info('s1', 'assets/main-1.js', 'b1')
  const u = await fresh()
  await u.startBuildInfo('assets/main-1.js')
  served = info('s2', 'assets/main-2.js', 'b1')
  assert.equal((await u.refreshStale()).shell, true)
})

test('offline, or asked again too soon: nothing known, nothing marked', async () => {
  served = info('s1', 'assets/main-1.js', 'b1')
  const u = await fresh()
  await u.startBuildInfo('assets/main-1.js')
  served = null
  assert.deepEqual(await u.refreshStale(), { known: false, shell: false, sections: [] })
  served = info('s1', 'assets/main-1.js', 'b2')
  await u.refreshStale({ minGapMs: 0 })                    // fetches
  assert.equal(u.isStale('testbench'), true)
  served = info('s1', 'assets/main-1.js', 'b3')
  assert.deepEqual(await u.refreshStale({ minGapMs: 60_000 }), { known: false, shell: false, sections: [] })
})
