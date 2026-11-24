// npm test -w apps/equipment — the tracker showing an out-of-date copy after it opens (24-Nov-2026), and a save
// from such a copy putting back what someone else had saved since (live.js watchWhenKnown; model.js
// formOverStored, mergeAccessories, formFromDoc).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { watchWhenKnown } from '../src/live.js'
import { formDoc, formFromDoc, formOverStored, mergeAccessories } from '../src/model.js'

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms))
const lines = (n, from = 100) => Array.from({ length: n }, (_, i) => ({ code: 'ACC-' + (from + i), name: 'Accessory ' + (from + i), qty: 1 }))

/*
 * The tracker opening, as db.js and store.jsx do it. db.js's switch says the old database until it has been read
 * (it is Firestore since the cutover); watch() picks its database when it starts; the old database never changes
 * (frozen); Firestore gives the copy kept on the device first, then the server's. store.jsx reads the switch, then
 * the data, and reads again when the change marker moves past the one it read. `startWatch` is how the store's
 * watch of data/_v gets going: straight away (as it did) or through db.js's watch (now).
 */
function opening(startWatch) {
  const db = { source: 'rtdb', listeners: { rtdb: new Set(), firestore: new Set() }, form: { loanTo: 'Grace Hospital', accessories: [] } }
  let switchRead = null, n = 0
  const loadCutover = () => { const p = tick(5).then(() => { db.source = 'firestore' }); if (!switchRead) switchRead = p; return p }
  const watchNow = (cb) => { const l = db.listeners[db.source]; l.add(cb); return () => l.delete(cb) }
  const store = { version: null, shown: null, loads: 0 }
  const load = async () => { await loadCutover(); store.shown = structuredClone(db.form); store.version = 'fs'; store.loads++ }
  load() // store.jsx: the first effect
  const stop = startWatch({ watchNow, known: () => switchRead || loadCutover() }, (v) => { if (v && store.version && v !== store.version) load() })
  const serverSaid = (form) => { db.form = form; for (const l of db.listeners.firestore) l('fs-' + (++n)) }
  return { db, store, serverSaid, stop }
}
const straightAway = ({ watchNow }, cb) => watchNow(cb)
const dbWatch = ({ watchNow, known }, cb) => watchWhenKnown(known(), () => watchNow(cb)) // db.js watch()

test('the stale case: watched before the switch was read, the old database was watched and the newer copy never showed', async () => {
  const t = opening(straightAway)
  await tick(20)
  assert.equal(t.db.listeners.rtdb.size, 1, 'watching the old database')
  assert.equal(t.db.listeners.firestore.size, 0)
  t.serverSaid({ loanTo: 'Grace Hospital', accessories: lines(29) })
  await tick(20)
  assert.deepEqual(t.store.shown.accessories, [], 'still the copy it opened with: the 29 lines never showed')
  assert.equal(t.store.loads, 1)
  t.stop()
})

test('watched once the switch is read: what the server says after the first read shows', async () => {
  const t = opening(dbWatch)
  await tick(20)
  assert.equal(t.db.listeners.firestore.size, 1, 'watching Firestore')
  assert.equal(t.db.listeners.rtdb.size, 0)
  assert.deepEqual(t.store.shown.accessories, [], 'first, the copy kept on the device')
  t.serverSaid({ loanTo: 'Grace Hospital', accessories: lines(29) })
  await tick(20)
  assert.equal(t.store.shown.accessories.length, 29)
  t.stop()
  assert.equal(t.db.listeners.firestore.size, 0, 'stop() stops it')
})

test('stopped before the switch is read, nothing is watched', async () => {
  const t = opening(dbWatch)
  t.stop()
  await tick(20)
  assert.equal(t.db.listeners.firestore.size + t.db.listeners.rtdb.size, 0)
})

test('a switch that could not be read still starts the watch', async () => {
  let started = 0
  watchWhenKnown(Promise.reject(new Error('offline')), () => { started++; return () => {} })
  await tick()
  assert.equal(started, 1)
})

/* Saving the loan form from an out-of-date copy. */
const items = [{ CHSAssetNo: '100176', Model: 'A9', Description: 'A9 Anaesthesia System', SerialNo: 'FX7' }]
const info = { loanTo: 'Grace Hospital', location: 'Tauranga', startDate: '2026-11-30', endDate: '2026-12-11', accountManager: 'Sam Lee' }
const old = { ...info, contactNumber: '07 555 0100', items, savedRows: [['100176', 'A9', 'A9 Anaesthesia System', 'FX7', '']], notesCell: 'Bring the BIS module', authCell: 'Truck delivery', demoType: 'Evaluation' }
const newer = { ...old, accessories: lines(29), notesCell: 'Bring the BIS module and the spare circuit', demoType: 'Tender' } // someone else's save
// LoanForm: what it shows when it opens from the out-of-date copy, and what it sends (accessories [] when the box is unticked).
const opened = formFromDoc(old, info, items, [], '2026-11-24')
const sent = (o = {}) => ({ ...opened, accessories: [], items, longTerm: false, ...o })
const save = (form, stored, open = opened) => {
  const use = formOverStored(form, open, stored, { info: { ...info, demoType: old.demoType }, equipment: [], today: '2026-11-24' })
  return formDoc(use.form, stored || {}, use.info)
}

test('the 29 accessories someone else saved are kept by a save from a copy that had none', () => {
  const doc = save(sent(), newer)
  assert.equal(doc.accessories.length, 29)
  assert.equal(doc.notesCell, newer.notesCell, 'their notes too')
  assert.equal(doc.demoType, 'Tender', 'and what the form does not show')
})

test('what the person changed is theirs; everything else is as stored now', () => {
  const doc = save(sent({ shipping: 'Courier', accessories: [{ code: 'ACC-900', name: 'BIS sensor', qty: 2 }] }), newer)
  assert.equal(doc.authCell, 'Courier')
  assert.equal(doc.notesCell, newer.notesCell)
  assert.equal(doc.accessories.length, 30, 'their line added to the 29')
  assert.deepEqual(doc.accessories.at(-1), { code: 'ACC-900', name: 'BIS sensor', qty: 2 })
  assert.equal(save(sent({ notes: 'Mine' }), newer).notesCell, 'Mine', 'a field they changed wins')
})

test('nothing changed meanwhile: the save is what the form says, removals included', () => {
  const stored = { ...old, accessories: lines(3) }
  const open = formFromDoc(stored, info, items, [], '2026-11-24')
  assert.deepEqual(save({ ...open, accessories: [], items }, stored, open).accessories, undefined, 'unticked: none')
  assert.equal(save({ ...open, accessories: lines(2), items }, stored, open).accessories.length, 2, 'one taken off')
  assert.equal(save({ ...open, notes: 'Changed', items }, stored, open).notesCell, 'Changed')
})

test('with nothing opened (adding items) or nothing stored, the form is saved as it is', () => {
  const form = sent({ notes: 'From add items' })
  assert.deepEqual(formOverStored(form, null, newer, { info }).form, form)
  assert.deepEqual(formOverStored(form, opened, null, { info }).form, form)
})

test('accessory lines merge: theirs applied to what is stored now', () => {
  const [a, b, c] = lines(3)
  assert.deepEqual(mergeAccessories([a, b], [a, b], [a, b, c]), [a, b, c], 'someone else added c')
  assert.deepEqual(mergeAccessories([a], [a, b], [a, b, c]), [a, c], 'they took b off')
  assert.deepEqual(mergeAccessories([a, { ...b, qty: 4 }], [a, b], [a, b, c]), [a, { ...b, qty: 4 }, c], 'they changed b')
  assert.deepEqual(mergeAccessories([a, b], [a, b], [a]), [a], 'someone else took b off')
  assert.deepEqual(mergeAccessories([a, { ...b, qty: 4 }], [a, b], [a]), [a, { ...b, qty: 4 }], 'but they changed it, so it stays')
  assert.deepEqual(mergeAccessories([c], [a], [a]), [c], 'nothing changed meanwhile: simply theirs')
})
