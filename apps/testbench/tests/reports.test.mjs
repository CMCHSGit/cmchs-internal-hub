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
  assert.deepEqual(describeFile('FS6-47000856 - A9 02.11.2026.pdf'), { base: 'FS6-47000856 - A9 02.11.2026', ext: 'pdf', kind: 'Report', serial: 'FS6-47000856', model: 'A9', date: '02.11.2026', rerun: 0 })
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

test('a file the browser refuses to write into the chosen folder ("Aborted due to security policy") does not stop the rest: it is downloaded instead and the reason is shown', () => {
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('if (why) failed.push({ f, why })') && ui.includes('couldn’t be written there'), 'Saved reports: per file, with the reason')
  assert.ok(ui.includes('const toDownload = dir ? failed.map((x) => x.f) : list'), 'what failed is downloaded (one file, or one zip)')
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes('downloaded instead'), 'the bench does the same for Download')
  assert.ok(html.includes('download(name, blob); fell++'))
})

test('saving to a folder leaves a file that is already there unchanged alone, tries a refused one again, and a zip is always on offer', () => {
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('async function sameFile(dir, f)') && ui.includes('if (await sameFile(to, f)) { same++;'), 'identical files are not rewritten (it only makes OneDrive upload them again)')
  assert.ok(ui.includes('1200 * attempt') && ui.includes('await writeFile(to, f)') && ui.includes('where(f, attempt > 0)'), 'a refused file is tried once more')
  assert.ok(ui.includes('download(true)') && ui.includes('Download as zip') && ui.includes('onClick={() => download()}'), 'a zip button beside Save to a folder')
})

test('a rerun the same day keeps the first test: its files have their own names, and both tests are listed', async () => {
  const { describeFile, groupReports } = await import('../src/reports.js')
  const d = describeFile('FP5-6A036789 - BeneHeart D30 05.11.2026 (rerun 2).pdf')
  assert.deepEqual([d.serial, d.model, d.date, d.rerun, d.ext], ['FP5-6A036789', 'BeneHeart D30', '05.11.2026', 2, 'pdf'])
  assert.equal(describeFile('FP5-6A036789 - BeneHeart D30 05.11.2026.pdf').rerun, 0)
  const rec = (name, testedAt) => ({ id: name, name, mime: '', buffer: new ArrayBuffer(3), size: 3, savedAt: Date.parse(testedAt) + 1000, sent: [], meta: { serial: 'FP5-6A036789', model: 'BeneHeart D30', customer: 'Waitemata', testedAt, template: 'T' } })
  const groups = groupReports([rec('FP5-6A036789 - BeneHeart D30 05.11.2026.pdf', '2026-11-04T20:00:00Z'), rec('FP5-6A036789 - BeneHeart D30 05.11.2026.mtr', '2026-11-04T20:00:00Z'),
    rec('FP5-6A036789 - BeneHeart D30 05.11.2026 (rerun 2).pdf', '2026-11-04T21:00:00Z'), rec('FP5-6A036789 - BeneHeart D30 05.11.2026 (rerun 2).mtr', '2026-11-04T21:00:00Z')])
  assert.equal(groups.length, 2, 'two tests, neither replaced')
  assert.deepEqual(groups.map((g) => [g.rerun, g.files.length]).sort(), [[0, 2], [2, 2]])
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes("${run.attempt > 1 ? ` (rerun ${run.attempt})` : ''}.${ext}"), 'the bench names a rerun\'s files that way')
  assert.ok(html.includes('Runner.start(t, clone(prev.dut), prev.model, (prev.attempt || 1) + 1)'))
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(!ui.includes('rerun ${g.rerun}'), 'Saved reports does not label a rerun')
})

/* ---- files someone adds themselves ---- */
const MTR = (customer, serial, when = 'Year="2026" Month="11" Day="03" Hour="9" Min="30" Sec="0"') => `<?xml version="1.0" encoding="utf-8"?>
<FLUKEFile><Template Name="Mindray A9.mtt"></Template><Setup><DUT>
<Item Name="Serial number" Caption="Serial number">${serial}</Item><Item Name="Model" Caption="Model">A9 &amp; co</Item><Item Name="Customer" Caption="Customer">${customer}</Item><Item Name="Location" Caption="Location"/>
</DUT></Setup><Record><TestData><Status>Passed</Status><Date ${when}/></TestData></Record></FLUKEFile>`
const bytes = (s) => new TextEncoder().encode(s).buffer

test('an Ansur record is read for its serial, model, customer, template and date', async () => {
  const { mtrMeta } = await import('../src/reports.js')
  const m = mtrMeta(MTR('Hutt Hospital', 'FS6-9'))
  assert.deepEqual([m.customer, m.serial, m.model, m.template], ['Hutt Hospital', 'FS6-9', 'A9 & co', 'Mindray A9'])
  assert.equal(new Date(m.testedAt).getFullYear(), 2026)
  assert.equal(mtrMeta('<html></html>'), null, 'not an Ansur record')
})

test('adding your own files: an .mtr is filed by what it says, a PDF by its name, and it never deletes what the bench saved', async () => {
  const { saveUpload } = await import('../src/reports.js')
  const store = memoryReports()
  await saveReport(store, { name: 'FS6-9 - A9 03.11.2026.mtr', mime: 'application/xml', buffer: bytes(MTR('Hutt Hospital', 'FS6-9')), meta: { customer: 'Hutt Hospital', serial: 'FS6-9', model: 'A9', template: 'Mindray A9', testedAt: new Date(2026, 10, 3, 9, 30, 0).toISOString() } }, 1000)
  const up = await saveUpload(store, { name: 'copy of record.mtr', buffer: bytes(MTR('Hutt Hospital', 'FS6-9')) }, 2000)
  assert.equal(up.meta.uploaded, true); assert.equal(up.meta.serial, 'FS6-9'); assert.equal(up.meta.customer, 'Hutt Hospital')
  assert.equal((await store.all()).length, 2, 'the bench’s own copy is still there')
  await saveUpload(store, { name: 'AB12 - D30 01.11.2026.pdf', buffer: bytes('%PDF-1.4 x') }, 3000)
  const g = groupReports(await store.all()).find((x) => x.serial === 'AB12')
  assert.deepEqual([g.model, g.uploaded, g.files[0].mime], ['D30', true, 'application/pdf'])
  assert.equal(groupReports(await store.all()).find((x) => x.serial === 'FS6-9').uploaded, true)
  await assert.rejects(() => saveUpload(store, { name: 'notes.txt', buffer: bytes('hi') }), /only Ansur records/)
  await assert.rejects(() => saveUpload(store, { name: 'x.mtr', buffer: bytes('<html/>') }), /isn’t an Ansur record/)
  await assert.rejects(() => saveUpload(store, { name: 'x.pdf', buffer: bytes('hello') }), /isn’t a PDF/)
  await assert.rejects(() => saveUpload(store, { name: 'x.pdf', buffer: new ArrayBuffer(0) }), /empty/)
})

/* ---- by device model, tested totals, downloaded ---- */
async function modelLibrary() {
  const store = memoryReports()
  const put = (name, customer, model, serial, at, t) => saveReport(store, { name, mime: 'application/pdf', buffer: buf(100), meta: { customer, serial, model, template: 'T', testedAt: at } }, t)
  await put('S1 - D30 02.11.2026.pdf', 'Hutt Hospital', 'D30', 'S1', '2026-11-02T09:00:00+13:00', 1000)
  await put('S1 - D30 03.11.2026.pdf', 'Hutt Hospital', 'D30', 'S1', '2026-11-03T09:00:00+13:00', 2000)   // the same device tested again
  await put('S2 - D30 02.11.2026.pdf', 'Hutt Hospital', 'D30', 'S2', '2026-11-02T10:00:00+13:00', 3000)
  await put('S3 - A9 02.11.2026.pdf', 'Hutt Hospital', 'A9', 'S3', '2026-11-02T11:00:00+13:00', 4000)
  await put('S4 - D30 02.11.2026.pdf', 'Wellington Hospital', 'D30', 'S4', '2026-11-02T12:00:00+13:00', 5000)
  await put('S5 02.11.2026.pdf', 'Wellington Hospital', '', 'S5', '2026-11-02T13:00:00+13:00', 6000)
  return store
}

test('sort by device model: A to Z, "no model" last', async () => {
  const { categorise: cat, NO_MODEL } = await import('../src/reports.js')
  const groups = groupReports(await (await modelLibrary()).all())
  assert.deepEqual(cat(groups, 'model').map((s) => [s.title, s.groups.length]), [['A9', 1], ['D30', 4], [NO_MODEL, 1]])
})

test('tested totals per customer and model: devices (different serials) and tests, downloaded and sent', async () => {
  const { modelTotals, markDownloaded, markSent } = await import('../src/reports.js')
  const store = await modelLibrary()
  await markDownloaded(store, ['S1 - D30 02.11.2026.pdf', 'S3 - A9 02.11.2026.pdf'], 9000)
  await markSent(store, 'S2 - D30 02.11.2026.pdf', '1234')
  const t = modelTotals(groupReports(await store.all()))
  assert.deepEqual(t.map((c) => [c.customer, c.devices, c.tests]), [['Hutt Hospital', 3, 4], ['Wellington Hospital', 2, 2]])
  assert.deepEqual(t[0].rows, [{ model: 'A9', devices: 1, tests: 1, downloaded: 1, sent: 0 }, { model: 'D30', devices: 2, tests: 3, downloaded: 1, sent: 1 }])
  assert.deepEqual(t[1].rows.map((r) => [r.model, r.devices]), [['D30', 1], ['No model recorded', 1]])
})

test('downloaded is remembered per test, a new copy of a file is not downloaded, and "not yet downloaded" filters', async () => {
  const { markDownloaded } = await import('../src/reports.js')
  const store = await modelLibrary()
  await markDownloaded(store, ['S3 - A9 02.11.2026.pdf'], 5000)
  let groups = groupReports(await store.all())
  assert.equal(groups.find((g) => g.serial === 'S3').downloadedAt, 5000)
  assert.deepEqual(filterGroups(groups, { notDownloaded: true }).map((g) => g.serial).sort(), ['S1', 'S1', 'S2', 'S4', 'S5'])
  await saveReport(store, { name: 'S3 - A9 02.11.2026.pdf', mime: 'application/pdf', buffer: buf(100), meta: { customer: 'Hutt Hospital', serial: 'S3', model: 'A9', template: 'T', testedAt: '2026-11-02T11:00:00+13:00' } }, 6000)
  groups = groupReports(await store.all())
  assert.equal(groups.find((g) => g.serial === 'S3').downloadedAt, 0, 'saved again: not downloaded')
})

test('saving shows how many are done and how many are left', () => {
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('<progress max={progress.total || 1} value={progress.done} />') && ui.includes('{progress.done} of {progress.total}') && ui.includes('left'))
  assert.ok(ui.includes('setProgress({ done: ++n, total: list.length'), 'advances after every file')
})

test('Remove takes every file of the ticked tests, so a test with only a results file can be removed', async () => {
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('const removable = useMemo(() => visible.filter((g) => chosen.has(g.base)).flatMap((g) => g.files), [visible, chosen])'), 'all files, not just the included kinds')
  assert.ok(ui.includes('disabled={busy || !(removable.length || sharedPicked.length)}') && ui.includes('remove([...removable, ...stale]'), 'the button and the removal use it')
  // the case from the bug: a test with only a results file, with the default Include (PDF and Ansur record)
  const { memoryReports, saveReport, groupReports, pickFiles } = await import('../src/reports.js')
  const store = memoryReports()
  await saveReport(store, { name: 'FP5-6A036791 - BeneHeart D30 03.11.2026.json', mime: 'application/json', buffer: new ArrayBuffer(100), meta: { customer: 'Waitemata', serial: 'FP5-6A036791', testedAt: '2026-11-03T08:58:00+13:00' } })
  const groups = groupReports(await store.all())
  assert.equal(pickFiles(groups, [groups[0].base], ['pdf', 'mtr']).length, 0, 'nothing is included by default, which is why Remove was greyed out')
  assert.equal(groups.flatMap((g) => g.files).length, 1, 'but the test has a file to remove')
})

test('tests other engineers finished are listed in Saved reports too, unless this laptop already has them', async () => {
  const { sharedGroups, sharedFileBase, memoryReports: mem, saveReport: save, groupReports: group, filterGroups: filt, nzDmy } = await import('../src/reports.js')
  const shared = [
    { id: 'a', by: 'peter@cass.co.nz', byName: 'Peter', serial: 'FP5-1', model: 'BeneHeart D30', customer: 'Waitemata', template: 'D30', overall: 'pass', started: '2026-11-09T08:00:00.000Z', finished: '2026-11-09T08:30:00.000Z' },
    { id: 'b', by: 'jonathan@cass.co.nz', byName: 'Jonathan', serial: 'FP5-2', model: 'BeneHeart D30', customer: 'Waitemata', template: 'D30', overall: 'fail', started: '2026-11-09T09:00:00.000Z', finished: '2026-11-09T09:30:00.000Z' },
  ]
  const store = mem()
  await save(store, { name: 'FP5-2 - BeneHeart D30 10.11.2026.pdf', mime: 'application/pdf', buffer: new ArrayBuffer(10), meta: { testedAt: '2026-11-09T09:00:00.000Z', serial: 'FP5-2' } })   // this laptop ran test b
  const g = sharedGroups(await store.all(), shared)
  assert.deepEqual(g.map((x) => x.sharedId), ['a'], 'only the one this laptop has no files for')
  assert.deepEqual([g[0].shared, g[0].sharedBy, g[0].serial, g[0].model, g[0].customer, g[0].files.length, g[0].day, g[0].unsent], [true, 'Peter', 'FP5-1', 'BeneHeart D30', 'Waitemata', 0, '2026-11-09', true])
  assert.equal(sharedFileBase(shared[0]), 'FP5-1 - BeneHeart D30 09.11.2026', 'named as the bench names its own, by the New Zealand day')
  assert.equal(nzDmy('2026-11-09T12:30:00Z'), '10.11.2026')
  assert.equal(filt([...group(await store.all()), ...g], { customer: 'Waitemata', text: 'fp5-1' }).length, 1, 'they filter and search like the others')
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('sharedGroups(reports, sharedTests.filter((t) => !hidden.has(t.id)))') && ui.includes('onFetchShared(g)') && ui.includes('made when needed') && ui.includes('Tested by {g.sharedBy'), 'listed, fetched when needed, and says who tested it')
  assert.match(ui, /for \(const g of sharedPicked\) \{ try \{ const json = await onFetchShared\(g\); made\.push\(await makePdf/, 'attaching sends their PDFs too')
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.ok(section.includes('sharedTests={testsList} onFetchShared={fetchShared}') && section.includes("format: 'chs-test-bench-results'") && section.includes('loadTest(g.sharedId)'))
})

test('a test someone shared can be removed from this list (hidden on this laptop only), and removing a test here hides its shared copy so it does not come back', () => {
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes("const HIDDEN_KEY = 'chsBench.hiddenShared'") && ui.includes('sharedTests.filter((t) => !hidden.has(t.id))'), 'hidden ids are kept on this laptop and left out of the list')
  assert.ok(ui.includes('disabled={busy || !(removable.length || sharedPicked.length)}') && ui.includes('stay under Previous tests and in Orders'), 'Remove works on shared tests, and says they are only hidden')
  assert.ok(ui.includes('sharedTests.filter((t) => started.has(t.started)).map((t) => t.id)'), 'removing a test that was also shared hides the shared copy')
  assert.ok(ui.includes('again</button>') && ui.includes('setHidden(new Set()); putHidden(new Set())'), 'and they can be shown again')
  assert.ok(!ui.includes('removeTest') && !ui.includes('deleteDoc'), 'nothing is deleted from the shared tests')
})
