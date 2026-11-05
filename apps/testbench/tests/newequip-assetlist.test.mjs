// npm test --prefix apps/testbench — the new-equipment page's asset list reading and Microsoft Graph loader (src/newequip/assetlist.js,
// graph.js). Invented serials and links only; the workbook is built here, as a stored-zip .xlsx with inline strings.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeZip } from '../src/zip.js'
import { unitsOfRows, readAssetList, duplicateSerials, benchByUnit, reportsByUnit, summary, filterUnits } from '../src/newequip/assetlist.js'
import { shareId, fetchWorkbook, GraphError, MAX_BYTES } from '../src/newequip/graph.js'

const enc = new TextEncoder()
const cell = (ref, v) => `<c r="${ref}" t="inlineStr"><is><t>${String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;')}</t></is></c>`
const sheetXml = (rows) => `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) =>
  `<row r="${i + 1}">${r.map((v, j) => (v === null || v === '' ? '' : cell(String.fromCharCode(65 + j) + (i + 1), v))).join('')}</row>`).join('')}</sheetData></worksheet>`
function workbook(sheets) {
  const files = [
    { name: '[Content_Types].xml', bytes: enc.encode('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: 'xl/workbook.xml', bytes: enc.encode(`<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: enc.encode(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`) },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, bytes: enc.encode(sheetXml(s.rows)) })),
  ]
  const z = makeZip(files)
  return z.buffer.slice(z.byteOffset, z.byteOffset + z.byteLength)
}

const HEAD = ['Site ID', 'Device Type', 'Manufacturer', 'Device Model', 'Description', 'Serial Number', 'CHS Asset Number', 'Ward/Location', 'Simpro Job']
const rows1 = [HEAD,
  ['2350', 'Monitor', 'Mindray', 'TM80', 'Telemetry', 'ex1-000101', 'CHS-0410', 'Ward 4', '20871'],
  ['2350', 'Monitor', 'Mindray', 'VS9', '', 'EX2-000377', 'CHS-0412', 'Ward 7', ''],
  [null, null, null, null, null, null, null, null, null],
  ['2350', 'Defib', 'Mindray', 'D30', '', '#REF!', '', 'ED', '']]

test('rows become units: the serial number is the key, blank rows and Excel errors are not units', () => {
  const got = unitsOfRows(rows1, 'Site A')
  assert.equal(got.found, true)
  assert.equal(got.units.length, 2)
  assert.deepEqual(got.units[0], { key: 'EX1-000101', serial: 'ex1-000101', sheet: 'Site A', row: 2, manufacturer: 'Mindray', type: 'Monitor', model: 'TM80', description: 'Telemetry', asset: 'CHS-0410', ward: 'Ward 4', site: '2350', job: '20871' })
  assert.equal(got.units[1].ward, 'Ward 7')
})

test('a sheet with no serial number column is not an asset sheet', () => {
  assert.deepEqual(unitsOfRows([['Name', 'Value'], ['a', 'b']]), { found: false, units: [] })
  assert.deepEqual(unitsOfRows([]), { found: false, units: [] })
})

test('a workbook is read sheet by sheet; sheets that are not asset lists are skipped, by name only', async () => {
  const buf = workbook([{ name: 'Site A', rows: rows1 }, { name: 'Reference', rows: [['Term', 'Meaning'], ['x', 'y']] }, { name: 'Site B', rows: [HEAD, ['2351', 'Monitor', 'Mindray', 'TM80', '', 'EX1-000999', '', 'Ward 1', '']] }])
  const got = await readAssetList(buf, 'Example Asset List.xlsx')
  assert.deepEqual(got.sheets, [{ name: 'Site A', count: 2 }, { name: 'Site B', count: 1 }])
  assert.deepEqual(got.skipped, ['Reference'])
  assert.equal(got.units.length, 3)
  assert.equal(got.units[2].sheet, 'Site B')
})

test('a file that is not a workbook is refused', async () => {
  await assert.rejects(() => readAssetList(new Uint8Array([1, 2, 3, 4]).buffer, 'x.xlsx'))
})

const units = unitsOfRows(rows1, 'S').units
test('repeated serial numbers are found', () => {
  assert.deepEqual(duplicateSerials([...units, { key: 'EX2-000377' }]), ['EX2-000377'])
  assert.deepEqual(duplicateSerials(units), [])
})

test('the latest shared bench test of each unit, matched by serial whatever the case', () => {
  const tests = [
    { serial: 'EX1-000101', overall: 'fail', finished: '2026-11-04T01:00:00Z' },
    { serial: 'ex1-000101', overall: 'pass', finished: '2026-11-05T01:00:00Z' },
    { serial: 'OTHER', overall: 'pass', finished: '2026-11-05T01:00:00Z' },
    { serial: '', overall: 'pass', finished: '2026-11-05T01:00:00Z' },
  ]
  const b = benchByUnit(units, tests)
  assert.equal(b.size, 1)
  assert.deepEqual(b.get('EX1-000101'), { overall: 'pass', finished: '2026-11-05T01:00:00Z', count: 2 })
})

test('saved reports per unit: whether anything is not yet sent, and to which jobs', () => {
  const groups = [{ serial: 'ex1-000101', unsent: false, sentTo: ['20871'] }, { serial: 'EX1-000101', unsent: true, sentTo: ['20871', '20900'] }, { serial: 'NOPE', unsent: true, sentTo: [] }]
  const r = reportsByUnit(units, groups)
  assert.deepEqual(r.get('EX1-000101'), { tests: 2, unsent: true, sentTo: ['20871', '20900'] })
  assert.equal(r.size, 1)
})

test('the counts for the cards', () => {
  const b = benchByUnit(units, [{ serial: 'EX1-000101', overall: 'pass', finished: '2026-11-05T01:00:00Z' }, { serial: 'EX2-000377', overall: 'fail', finished: '2026-11-05T01:00:00Z' }])
  const r = reportsByUnit(units, [{ serial: 'EX1-000101', unsent: false, sentTo: [] }])
  assert.deepEqual(summary(units, b, r), { units: 2, tested: 2, passed: 1, failed: 1, saved: 1 })
})

test('units are searched by any word in any field, and by sheet', () => {
  const two = [...units, { key: 'Z', serial: 'Z', sheet: 'Other', model: 'A9', ward: 'Theatre 2', type: '', manufacturer: '', description: '', asset: '', site: '', job: '' }]
  assert.deepEqual(filterUnits(two, { text: 'WARD telemetry' }).map((u) => u.key), ['EX1-000101'])
  assert.deepEqual(filterUnits(two, { text: 'a9 theatre' }).map((u) => u.key), ['Z'])
  assert.deepEqual(filterUnits(two, { sheet: 'S' }).length, 2)
  assert.equal(filterUnits(two).length, 3)
})

// ---- Microsoft Graph loader ----
test('a sharing link becomes the id Graph wants (u! and URL-safe base64, no padding)', () => {
  const id = shareId('https://example.sharepoint.com/:x:/s/example/EaAssetList?e=abc')
  assert.match(id, /^u![A-Za-z0-9_-]+$/)
  assert.equal(shareId('https://a.example/?x=~~~'), 'u!' + Buffer.from('https://a.example/?x=~~~').toString('base64url'))
})

const json = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) })
function graph(routes) {
  const calls = []
  const fn = async (url, init) => { calls.push({ url, auth: init?.headers?.Authorization }); for (const [m, r] of routes) if (url.includes(m)) return typeof r === 'function' ? r() : r; throw new Error('unexpected ' + url) }
  fn.calls = calls
  return fn
}
const tok = async () => 'TOKEN'

test('the workbook is fetched from the address Graph gives, with the token only on Graph, never on the download', async () => {
  const bytes = new Uint8Array([1, 2, 3]).buffer
  const f = graph([['/driveItem?', json({ name: 'Example Asset List.xlsx', size: 3, file: {}, lastModifiedDateTime: '2026-11-05T01:00:00Z', '@microsoft.graph.downloadUrl': 'https://download.example/abc' })], ['download.example', { ok: true, status: 200, arrayBuffer: async () => bytes }]])
  const got = await fetchWorkbook('https://example.sharepoint.com/:x:/s/e/Ea', tok, f)
  assert.equal(got.name, 'Example Asset List.xlsx')
  assert.equal(got.size, 3)
  assert.equal(got.modified, '2026-11-05T01:00:00Z')
  assert.equal(f.calls[0].auth, 'Bearer TOKEN')
  assert.equal(f.calls[1].auth, undefined)
  assert.match(f.calls[0].url, /^https:\/\/graph\.microsoft\.com\/v1\.0\/shares\/u![A-Za-z0-9_-]+\/driveItem/)
})

test('with no download address it uses the content address, with the token', async () => {
  const f = graph([['/driveItem?', json({ name: 'a.xlsx', size: 1, file: {} })], ['/driveItem/content', { ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(1) }]])
  await fetchWorkbook('https://example.sharepoint.com/x', tok, f)
  assert.equal(f.calls[1].auth, 'Bearer TOKEN')
})

test('refusals are said in words: sign in again, not allowed, not found, not a workbook, too big, no connection', async () => {
  const code = async (routes) => { try { await fetchWorkbook('https://e.example/x', tok, graph(routes)); return 'ok' } catch (e) { assert.ok(e instanceof GraphError); return e.code } }
  assert.equal(await code([['/driveItem?', json({}, 401)]]), 'token')
  assert.equal(await code([['/driveItem?', json({}, 403)]]), 'denied')
  assert.equal(await code([['/driveItem?', json({}, 404)]]), 'notfound')
  assert.equal(await code([['/driveItem?', json({}, 500)]]), 'other')
  assert.equal(await code([['/driveItem?', json({ name: 'folder' })]]), 'notbook')
  assert.equal(await code([['/driveItem?', json({ name: 'a.pdf', size: 1, file: {} })]]), 'notbook')
  assert.equal(await code([['/driveItem?', json({ name: 'a.xlsx', size: MAX_BYTES + 1, file: {} })]]), 'toobig')
  assert.equal(await code([['/driveItem?', () => { throw new Error('offline') }]]), 'network')
})
