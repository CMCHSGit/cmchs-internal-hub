// npm test -w apps/testbench — "Reports to add": what Simpro Asset Sync says about the saved test reports of an asset list's devices,
// the link that opens Saved reports on them, and the filter that link asks for (src/reports.js). Made-up devices only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { memoryReports, saveReport, markSent, groupReports, filterGroups, reportsToAdd, reportsLink, reportsFromSearch, LINK_SERIALS_MAX } from '../src/reports.js'

const buf = (n) => new Uint8Array(n).fill(1).buffer
const pdf = (store, serial, day, customer = 'Test Customer') =>
  saveReport(store, { name: `${serial} - A9 ${day}.pdf`, mime: 'application/pdf', buffer: buf(100), meta: { customer, serial, model: 'A9', template: 'Mindray A9', testedAt: '' } })

async function library() {
  const store = memoryReports()
  await pdf(store, 'FS6-1', '02.11.2026')
  await pdf(store, 'FS6-2', '02.11.2026')
  await pdf(store, 'ab-3', '03.11.2026')
  await pdf(store, 'ZZ-9', '03.11.2026', 'Another Customer')   // not in the list
  await markSent(store, 'FS6-2 - A9 02.11.2026.pdf', '#501')   // already attached to a job
  return groupReports(await store.all())
}

test('counts the devices with a saved report, those still to attach, and those with none', async () => {
  const r = reportsToAdd(await library(), ['FS6-1', 'FS6-2', 'AB-3', 'NOPE-4', 'NOPE-5'])
  assert.equal(r.devices, 5)
  assert.equal(r.withReport, 3)
  assert.equal(r.toAdd, 2)                                  // FS6-2 is already sent
  assert.deepEqual(r.toAddSerials.sort(), ['AB-3', 'FS6-1'])
  assert.deepEqual(r.missing, ['NOPE-4', 'NOPE-5'])
})

test('serials match whatever the case or spacing, and a repeat in the list counts once', async () => {
  const r = reportsToAdd(await library(), [' fs6-1 ', 'FS6-1', 'Ab-3', '', null])
  assert.equal(r.devices, 2)
  assert.equal(r.toAdd, 2)
  assert.deepEqual(r.missing, [])
})

test('nothing saved: every device is missing, nothing to add', () => {
  const r = reportsToAdd([], ['A', 'B'])
  assert.deepEqual([r.devices, r.withReport, r.toAdd, r.missing.length], [2, 0, 0, 2])
})

test('a device with a test that is partly sent still has something to add', async () => {
  const store = memoryReports()
  await pdf(store, 'P-1', '02.11.2026')
  await saveReport(store, { name: 'P-1 - A9 02.11.2026.mtr', mime: 'application/xml', buffer: buf(50), meta: { customer: 'C', serial: 'P-1', model: 'A9', template: '', testedAt: '' } })
  await markSent(store, 'P-1 - A9 02.11.2026.pdf', '#7')
  assert.equal(reportsToAdd(groupReports(await store.all()), ['P-1']).toAdd, 1)
})

test('filtering by serials shows only those devices, and combines with "not yet sent"', async () => {
  const groups = await library()
  assert.deepEqual(filterGroups(groups, { serials: ['fs6-1', 'FS6-2', 'AB-3'] }).map((g) => g.serial.toUpperCase()).sort(), ['AB-3', 'FS6-1', 'FS6-2'])
  assert.equal(filterGroups(groups, { serials: ['fs6-1', 'FS6-2', 'ab-3'] }).length, 3)
  assert.equal(filterGroups(groups, { serials: ['fs6-1', 'FS6-2', 'ab-3'], unsentOnly: true }).length, 2)
  assert.equal(filterGroups(groups, { serials: [] }).length, 4)          // an empty list is no filter
  assert.equal(filterGroups(groups, { serials: null }).length, 4)
})

test('the link opens Saved reports on the devices, not yet sent; an address reads back the same', () => {
  const link = reportsLink(['fs6-1', 'AB-3', 'fs6-1'])
  assert.match(link, /^\/testbench\/\?/)
  const back = reportsFromSearch(link.slice(link.indexOf('?')))
  assert.deepEqual(back, { open: true, serials: ['FS6-1', 'AB-3'], unsent: true })
})

test('serials with odd characters survive the address', () => {
  const s = ['FP5-6A036796', 'A/B 1', 'C&D=2', 'éü1']
  const link = reportsLink(s)
  assert.deepEqual(reportsFromSearch(link.slice(link.indexOf('?'))).serials, s.map((x) => x.toUpperCase()))
})

test('a very long list opens Saved reports on everything not yet sent, rather than a huge address', () => {
  const many = Array.from({ length: LINK_SERIALS_MAX + 1 }, (_, i) => 'S' + i)
  const link = reportsLink(many)
  assert.ok(link.length < 300)
  assert.deepEqual(reportsFromSearch(link.slice(link.indexOf('?'))), { open: true, serials: [], unsent: true })
})

test('an ordinary Test Bench address asks for nothing special', () => {
  assert.deepEqual(reportsFromSearch(''), { open: false, serials: [], unsent: false })
  assert.deepEqual(reportsFromSearch('?model=D30&serial=X1'), { open: false, serials: [], unsent: false })
})
