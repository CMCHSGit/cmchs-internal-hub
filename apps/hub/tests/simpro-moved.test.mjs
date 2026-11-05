// npm test -w apps/hub — Simpro Asset Sync: a row whose serial is already in Simpro on another site is not "to create" (apps/simprosync/core.js splitMoved).
// Made-up serials and site numbers.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SyncCore as C } from '../../simprosync/core.js'

const header = ['Site ID', 'Serial Number']
const rowsOf = (list) => C.toRecords([header, ...list]).recs
const inSimpro = (list) => new Map(list.map(([site, ser, id]) => [`${site}|${ser}`, { id, values: {} }]))

test('a serial the sheet puts on the wrong site is not a create, and is no longer "in Simpro only"', () => {
  const res = C.compare(rowsOf([['2033', 'A1'], ['2460', 'B1'], ['2460', 'B2'], ['2033', 'NEW9']]), {}, inSimpro([['2033', 'A1', 11], ['2033', 'B1', 12], ['2033', 'B2', 13], ['2033', 'OTHER', 14]]), null)
  assert.equal(res.creates.length, 3)        // B1, B2 (wrong site) and NEW9 (really new)
  assert.equal(res.simproOnly.length, 3)     // B1, B2, OTHER
  const sp = C.splitMoved(res.creates, res.simproOnly)
  assert.deepEqual(sp.creates.map((c) => c.ser), ['NEW9'])
  assert.deepEqual(sp.moved.map((m) => [m.ser, m.site, m.found]), [['B1', '2460', [{ site: '2033', id: 12 }]], ['B2', '2460', [{ site: '2033', id: 13 }]]])
  assert.deepEqual(sp.simproOnly.map((s) => s.ser), ['OTHER'])   // only what no row claimed
})

test('nothing moved: creates and simproOnly come back as they were', () => {
  const res = C.compare(rowsOf([['2033', 'NEW1']]), {}, inSimpro([['2033', 'OLD', 5]]), null)
  const sp = C.splitMoved(res.creates, res.simproOnly)
  assert.equal(sp.moved.length, 0)
  assert.equal(sp.creates.length, 1)
  assert.equal(sp.simproOnly.length, 1)
})

test('a serial found on two other sites lists both', () => {
  const sp = C.splitMoved([{ rownum: 2, site: '1', ser: 'D1' }], [{ ser: 'D1', site: '2', id: 21 }, { ser: 'D1', site: '3', id: 22 }])
  assert.deepEqual(sp.moved[0].found, [{ site: '2', id: 21 }, { site: '3', id: 22 }])
  assert.equal(sp.simproOnly.length, 0)
})
