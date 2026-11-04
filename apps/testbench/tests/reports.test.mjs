// npm test --prefix apps/testbench — the Saved reports (src/reports.js) and the zip (src/zip.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { memoryReports, saveReport, markSent, groupReports, filterGroups, categorise, customersIn, describeFile, pickFiles, nzDay, inPeriod, NO_CUSTOMER } from '../src/reports.js'
import { makeZip, crc32, uniqueNames } from '../src/zip.js'

const buf = (n, v = 1) => new Uint8Array(n).fill(v).buffer
const meta = (customer, testedAt) => ({ customer, serial: '', model: '', template: 'Mindray A9', testedAt })
const at = (day, hh) => `${day}T${hh}:00:00+13:00`

async function library() {
  const store = memoryReports()
  await saveReport(store, { name: 'FS6-1 - A9 02.11.2026.pdf', mime: 'application/pdf', buffer: buf(3000), meta: meta('Hutt Hospital', at('2026-11-02', '09')) }, 1000)
  await saveReport(store, { name: 'FS6-1 - A9 02.11.2026.json', mime: 'application/json', buffer: buf(500), meta: meta('Hutt Hospital', at('2026-11-02', '09')) }, 1001)
  await saveReport(store, { name: 'FS6-2 - A9 02.11.2026.pdf', mime: 'application/pdf', buffer: buf(3000), meta: meta('Hutt Hospital', at('2026-11-02', '11')) }, 2000)
  await saveReport(store, { name: 'AB12 - D30 01.11.2026.pdf', mime: 'application/pdf', buffer: buf(2000), meta: meta('Wellington Hospital', at('2026-11-01', '14')) }, 3000)
  await saveReport(store, { name: 'OLD - TM80 30.10.2026.pdf', mime: 'application/pdf', buffer: buf(1000) }, Date.parse('2026-10-30T10:00:00+13:00')) // saved before customers were sent
  return groupReports(await store.all())
}

test('saved files are told apart by name: serial, model, date and what kind', () => {
  assert.deepEqual(describeFile('FS6-47000856 - A9 02.11.2026.pdf'), { base: 'FS6-47000856 - A9 02.11.2026', ext: 'pdf', kind: 'Report', serial: 'FS6-47000856', model: 'A9', date: '02.11.2026' })
  assert.equal(describeFile('X 02.11.2026.mtr').kind, 'Ansur record')
  assert.equal(describeFile('weird.json').serial, 'weird')
})

test('a test is one group of its files; its customer and day come from the bench, and older files still list', async () => {
  const groups = await library()
  assert.equal(groups.length, 4)
  const g1 = groups.find((g) => g.serial === 'FS6-1')
  assert.deepEqual(g1.files.map((f) => f.ext), ['pdf', 'json'], 'report first')
  assert.deepEqual([g1.customer, g1.day, g1.template], ['Hutt Hospital', '2026-11-02', 'Mindray A9'])
  assert.equal(groups.find((g) => g.serial === 'OLD').customer, NO_CUSTOMER)
  assert.equal(groups[0].serial, 'FS6-2', 'newest test first')
})

test('categorise by customer (A to Z, "none" last) or by day (newest first); filter by customer, time and words', async () => {
  const groups = await library()
  assert.deepEqual(categorise(groups, 'customer').map((s) => [s.title, s.groups.length]), [['Hutt Hospital', 2], ['Wellington Hospital', 1], [NO_CUSTOMER, 1]])
  assert.deepEqual(customersIn(groups), ['Hutt Hospital', 'Wellington Hospital', NO_CUSTOMER])
  const days = categorise(groups, 'day')
  assert.deepEqual(days.map((s) => s.key), ['2026-11-02', '2026-11-01', '2026-10-30'])
  assert.ok(days[0].title.includes('2 Nov 2026'))
  assert.equal(categorise(groups, 'none').length, 1)
  const now = Date.parse('2026-11-02T12:00:00+13:00')
  assert.deepEqual(filterGroups(groups, { customer: 'Hutt Hospital' }, now).map((g) => g.serial).sort(), ['FS6-1', 'FS6-2'])
  assert.deepEqual(filterGroups(groups, { period: 'today' }, now).map((g) => g.serial).sort(), ['FS6-1', 'FS6-2'])
  assert.deepEqual(filterGroups(groups, { period: 'yesterday' }, now).map((g) => g.serial), ['AB12'])
  assert.deepEqual(filterGroups(groups, { period: '7' }, now).length, 4)
  assert.equal(inPeriod('2026-10-27', '7', now), true)
  assert.equal(inPeriod('2026-10-26', '7', now), false, 'the last seven days include today')
  assert.deepEqual(filterGroups(groups, { text: 'wellington' }, now).map((g) => g.serial), ['AB12'])
  assert.deepEqual(filterGroups(groups, { text: 'd30' }, now).map((g) => g.serial), ['AB12'])
  assert.equal(nzDay(Date.parse('2026-11-01T23:30:00Z')), '2026-11-02', 'the New Zealand day, not UTC')
})

test('sent is remembered per file, so "not yet sent" and bulk attach pick the right ones', async () => {
  const store = memoryReports()
  await saveReport(store, { name: 'A - M 02.11.2026.pdf', buffer: buf(10) }, 1)
  await saveReport(store, { name: 'A - M 02.11.2026.json', buffer: buf(10) }, 1)
  await saveReport(store, { name: 'B - M 02.11.2026.pdf', buffer: buf(10) }, 1)
  await markSent(store, 'A - M 02.11.2026.pdf', '#77')
  await markSent(store, 'A - M 02.11.2026.pdf', '#77')
  let groups = groupReports(await store.all())
  const a = groups.find((g) => g.serial === 'A'), b = groups.find((g) => g.serial === 'B')
  assert.deepEqual(a.sentTo, ['#77'])
  assert.equal(a.unsent, true, 'its results file has not gone')
  assert.equal(filterGroups(groups, { unsentOnly: true }).length, 2)
  assert.deepEqual(pickFiles(groups, [a.base, b.base], ['pdf']).map((f) => f.name).sort(), ['A - M 02.11.2026.pdf', 'B - M 02.11.2026.pdf'], 'only the kinds asked for')
  await saveReport(store, { name: 'A - M 02.11.2026.pdf', buffer: buf(12) }, 5) // saved again: a new file, not yet sent
  groups = groupReports(await store.all())
  assert.deepEqual(groups.find((g) => g.serial === 'A').files.find((f) => f.ext === 'pdf').sent, [])
})

test('a zip: real zip structure, every file readable and intact, clashing names numbered', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard check value')
  assert.deepEqual(uniqueNames(['a.pdf', 'b.pdf', 'a.pdf', 'a.pdf']), ['a.pdf', 'b.pdf', 'a (2).pdf', 'a (3).pdf'])
  const files = [{ name: 'FS6 - A9 02.11.2026.pdf', bytes: new Uint8Array([1, 2, 3, 4, 5]) }, { name: 'Ā results.json', bytes: new TextEncoder().encode('{"ok":true}') }, { name: 'FS6 - A9 02.11.2026.pdf', bytes: new Uint8Array(70000).fill(7) }]
  const zip = makeZip(files, new Date(2026, 10, 2, 14, 5, 6))
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const end = zip.length - 22
  assert.equal(dv.getUint32(end, true), 0x06054b50)
  assert.equal(dv.getUint16(end + 10, true), 3, 'three entries')
  let p = dv.getUint32(end + 16, true)
  const out = []
  for (let i = 0; i < 3; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50)
    const crc = dv.getUint32(p + 16, true), size = dv.getUint32(p + 24, true), nl = dv.getUint16(p + 28, true), lo = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nl))
    assert.equal(dv.getUint32(lo, true), 0x04034b50)
    const dataAt = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true)
    const bytes = zip.subarray(dataAt, dataAt + size)
    assert.equal(crc32(bytes), crc, 'crc matches ' + name)
    out.push([name, bytes])
    p += 46 + nl
  }
  assert.deepEqual(out.map((x) => x[0]), ['FS6 - A9 02.11.2026.pdf', 'Ā results.json', 'FS6 - A9 02.11.2026 (2).pdf'])
  assert.deepEqual([...out[0][1]], [1, 2, 3, 4, 5])
  assert.equal(new TextDecoder().decode(out[1][1]), '{"ok":true}')
  assert.equal(out[2][1].length, 70000)
})

test('the bench sends who and when with each file, so reports can be sorted by customer and day', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const hook = html.slice(html.indexOf('function offerToHub('), html.indexOf('const Results = {'))
  assert.ok(/customer: pick\(/.test(hook) && /testedAt: run\.started/.test(hook) && /meta \}, location\.origin/.test(hook))
  const upd = readFileSync(new URL('../../../scripts/update-bench.mjs', import.meta.url), 'utf8')
  assert.ok(upd.includes('customer: pick('), 'the update script adds the same hook')
})

test('Saved reports can give an Ansur record (.mtr) for any test that has a results file: the bench builds it on request', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes("m.type !== 'chs-bench:build-mtr'") && html.includes("type: 'chs-bench:mtr'"), 'the bench answers requests for an Ansur record')
  assert.ok(/buildMtr\(f\.run\)/.test(html), 'built from the run inside the results file')
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.ok(section.includes("'chs-bench:build-mtr'") && section.includes("'chs-bench:mtr'"), 'the hub asks, and listens for the answer')
  assert.ok(/replace\(\/\\\.json\$\/i, '\.mtr'\)/.test(section), 'the record keeps the results file name, so it groups with the test')
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('Ansur record (.mtr) · make') && ui.includes('needMtr'), 'a button per test, and one made for each ticked test in a zip or attach')
})

test('the Ansur record (.mtr) is the default: every saved PDF or results file also puts its .mtr in Saved reports, and the results file is not included by default', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const hook = html.slice(html.indexOf('function offerToHub('), html.indexOf("window.addEventListener('message'"))
  assert.ok(/replace\(\/\\\.\(pdf\|json\)\$\/i, '\.mtr'\)/.test(hook) && /buildMtr\(run\)/.test(hook), 'the hook builds the .mtr under the same name')
  assert.ok(/sentMtr\.has\(/.test(hook), 'once per test, so what was sent is not forgotten')
  assert.ok(/<button class="btn" id="sumSave"/.test(html) && /<button class="btn secondary" id="sumDownload"/.test(html) && html.indexOf('id="sumSave"') < html.indexOf('id="sumDownload"'), 'Save (purple) is the main button, then Download; both make the PDF and the Ansur record')
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes("useState(['pdf', 'mtr'])"), 'the results file is not ticked by default')
})

test('a test saved again under another name is one test; a device belongs to one customer', async () => {
  const store = memoryReports()
  const m = (customer, serial = 'FP5-6A036792') => ({ customer, serial, model: 'BeneHeart D30', template: 'D30', testedAt: '2026-11-03T02:25:00Z' })
  // the same run: its PDF and Ansur record saved, then its Ansur record again after the customer was corrected, under a name with the model spelt differently
  await saveReport(store, { name: 'FP5-6A036792 - BeneHeart D30 03.11.2026.pdf', buffer: buf(10), meta: m('Waitemata') }, 100)
  await saveReport(store, { name: 'FP5-6A036792 - BeneHeart D30 03.11.2026.mtr', buffer: buf(20), meta: m('Waitemata') }, 101)
  await saveReport(store, { name: 'FP5-6A036792 - D30 03.11.2026.mtr', buffer: buf(30), meta: m('Waitemata DHB') }, 200)
  const all = await store.all()
  assert.deepEqual(all.map((r) => r.name).sort(), ['FP5-6A036792 - BeneHeart D30 03.11.2026.pdf', 'FP5-6A036792 - D30 03.11.2026.mtr'], 'the older Ansur record of the same run is replaced')
  // a device in two places under two customers: one customer, the latest saved
  await saveReport(store, { name: 'FP5-6A036792 - BeneHeart D30 04.11.2026.pdf', buffer: buf(10), meta: { ...m('Waitemata'), testedAt: '2026-11-04T01:00:00Z' } }, 300)
  await saveReport(store, { name: 'FP5-6A036792 - BeneHeart D30 05.11.2026.pdf', buffer: buf(10), meta: { ...m('', 'fp5-6a036792'), testedAt: '2026-11-05T01:00:00Z' } }, 400)
  const groups = groupReports(await store.all())
  assert.equal(groups.length, 3, 'three tests: the 3rd, 4th and 5th')
  assert.deepEqual([...new Set(groups.map((g) => g.customer))], ['Waitemata'], 'the latest saved customer for that serial number, for every test of it (even one with none recorded, and a serial in another case)')
})

test('legacy duplicates of one run (same start time, saved under two names) show as one test, newest of each kind, the older copy marked stale', () => {
  const rec = (name, savedAt, extra = {}) => ({ id: name, name, mime: '', buffer: buf(5), size: 5, savedAt, sent: [], meta: { customer: 'C', serial: 'S1', model: 'M', template: 'T', testedAt: '2026-11-03T02:25:00Z', ...extra } })
  const groups = groupReports([rec('S1 - M 03.11.2026.mtr', 10), rec('S1 - M 03.11.2026.pdf', 11), rec('S1 - M2 03.11.2026.mtr', 20)])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].files.map((f) => f.name), ['S1 - M 03.11.2026.pdf', 'S1 - M2 03.11.2026.mtr'])
  assert.deepEqual(groups[0].stale.map((f) => f.name), ['S1 - M 03.11.2026.mtr'])
  assert.equal(groups[0].savedAt, 20)
  assert.equal(groups[0].unsent, true)
})
