// Run: npm test --prefix apps/simprosearch   (a pretend Simpro with invented assets: nothing real)
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PAGES, PAGE, assetTable, assetsPagePath, bySite, csvCell, exportAssets, toCsv } from '../src/assets.js'

const cf = (pairs) => Object.entries(pairs).map(([Name, Value], i) => ({ CustomField: { ID: i + 1, Name }, Value }))
const asset = (id, site, type = 9, extra = {}) => ({
  ID: id, Site: { ID: site, Name: 'Site ' + site }, AssetType: { ID: type, Name: type === 9 ? 'Monitor' : 'Ultrasound' }, Archived: false,
  Customer: { CompanyName: 'Example Vets ' + site }, CustomFields: cf({ 'Serial Number': 'SN' + id, 'Device Model': 'M' + type }), ...extra,
})

/** A pretend relay: answers /customerAssets/ pages from `all`. opts.noCustomer: refuses the Customer column. opts.ignorePage: always page 1. */
function fakeRelay(all, opts = {}) {
  const asked = []
  const one = (path) => {
    asked.push(path)
    const [p, query = ''] = path.split('?')
    const q = Object.fromEntries(query.split('&').map((kv) => kv.split('=')))
    if (!/^\/companies\/3\/customerAssets\/$/.test(p)) return { status: 404, data: null }
    if (opts.noCustomer && q.columns.split(',').includes('Customer')) return { status: 422, data: { errors: [] } }
    let rows = all
    if (q['AssetType.ID'] && !opts.ignoreType) rows = rows.filter((a) => String(a.AssetType.ID) === q['AssetType.ID'])
    const page = opts.ignorePage ? 1 : +q.page
    return { status: 200, data: rows.slice((page - 1) * +q.pageSize, page * +q.pageSize) }
  }
  return { asked, batchGet: async (paths) => paths.map(one) }
}

const many = (n, start = 1) => Array.from({ length: n }, (_, i) => asset(start + i, 1 + (i % 7)))

test('reads every page, four to a trip, and stops at the first short page', async () => {
  const all = many(PAGE * 6 + 10)
  const r = fakeRelay(all)
  const out = await exportAssets({ batchGet: r.batchGet, companyId: 3 })
  assert.equal(out.assets.length, all.length)
  assert.equal(out.pages, 7)
  assert.equal(out.customers, true)
  assert.equal(out.cancelled, false)
  assert.equal(out.capped, false)
  assert.ok(r.asked.every((p) => p.includes('columns=ID,Site,AssetType,Archived,CustomFields,Customer')))
})

test('one asset type only, and archived assets left out unless asked for', async () => {
  const all = [asset(1, 1), asset(2, 1, 12), asset(3, 2, 9, { Archived: true })]
  const r = fakeRelay(all)
  assert.deepEqual((await exportAssets({ batchGet: r.batchGet, companyId: 3, typeId: 9 })).assets.map((a) => a.ID), [1])
  assert.deepEqual((await exportAssets({ batchGet: r.batchGet, companyId: 3, typeId: 9, includeArchived: true })).assets.map((a) => a.ID), [1, 3])
  assert.ok(r.asked[0].includes('AssetType.ID=9'))
  // Simpro ignoring the type filter still gives only that type
  const loose = fakeRelay(all, { ignoreType: true })
  assert.deepEqual((await exportAssets({ batchGet: loose.batchGet, companyId: 3, typeId: 12 })).assets.map((a) => a.ID), [2])
})

test('if Simpro refuses the Customer column it asks again without it, and says so', async () => {
  const r = fakeRelay(many(300), { noCustomer: true })
  const out = await exportAssets({ batchGet: r.batchGet, companyId: 3 })
  assert.equal(out.customers, false)
  assert.equal(out.assets.length, 300)
  const t = assetTable(out.assets, { customers: out.customers })
  assert.ok(!t.headers.includes('Customer'))
})

test('a page Simpro repeats ends the read instead of looping', async () => {
  const r = fakeRelay(many(PAGE * 3), { ignorePage: true })
  const out = await exportAssets({ batchGet: r.batchGet, companyId: 3 })
  assert.equal(out.assets.length, PAGE)
  assert.ok(r.asked.length < 10)
})

test('Stop keeps what was read so far', async () => {
  let trips = 0
  const r = fakeRelay(many(PAGE * 12))
  const out = await exportAssets({ batchGet: async (p) => { trips++; return r.batchGet(p) }, companyId: 3, isCancelled: () => trips >= 2 })
  assert.equal(out.cancelled, true)
  assert.equal(out.assets.length, PAGE * 5) // the first page, then one trip of four
})

test('a refused first page is an error, not an empty file', async () => {
  await assert.rejects(exportAssets({ batchGet: async () => [{ status: 500, data: null }], companyId: 3 }), /wouldn’t list the customer assets \(500\)/)
  assert.equal(MAX_PAGES > 100, true)
})

test('Simpro failing part-way keeps the assets read before then, and says what happened', async () => {
  const r = fakeRelay(many(PAGE * 12))
  let trips = 0
  const out = await exportAssets({ batchGet: async (p) => (++trips === 3 ? p.map(() => ({ status: 503, data: null })) : r.batchGet(p)), companyId: 3 })
  assert.equal(out.assets.length, PAGE * 5)
  assert.match(out.error, /stopped answering after 1250 assets \(page 6: 503\)/)
  assert.equal(out.capped, false)
})

test('the table: fixed columns, then every custom field once, by name', () => {
  const a = asset(5, 2, 9, { CustomFields: cf({ 'Serial Number': 'AB-1', 'Device Model': 'X3', 'IP Address': '10.0.0.9' }) })
  const b = asset(6, 3, 12, { Customer: null, CustomFields: cf({ 'serial number ': 'CD-2', 'device model': 'Y1', 'AE Title': 'US1' }) })
  const t = assetTable([a, b])
  assert.deepEqual(t.headers, ['Simpro Asset ID', 'Site ID', 'Site', 'Customer', 'Asset Type', 'Archived', 'Serial Number', 'AE Title', 'Device Model', 'IP Address'])
  assert.deepEqual(t.rows[0], ['5', '2', 'Site 2', 'Example Vets 2', 'Monitor', '', 'AB-1', '', 'X3', '10.0.0.9'])
  assert.deepEqual(t.rows[1], ['6', '3', 'Site 3', '', 'Ultrasound', '', 'CD-2', 'US1', 'Y1', ''])
})

test('CSV: Excel-safe text, quotes where needed, formulas kept as text', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
  assert.equal(csvCell('-12'), '-12')
  assert.equal(csvCell(null), '')
  const csv = toCsv({ headers: ['A', 'B'], rows: [['1', 'x\ny']] })
  assert.ok(csv.startsWith('﻿A,B\r\n1,"x\ny"'))
})

test('the address only ever carries a numeric type', () => {
  assert.equal(assetsPagePath(3, { typeId: 9, page: 2 }), '/companies/3/customerAssets/?AssetType.ID=9&columns=ID,Site,AssetType,Archived,CustomFields&pageSize=250&page=2')
  assert.throws(() => assetsPagePath(3, { typeId: '9&x=1' }))
})

test('assets per site, most first', () => {
  const s = bySite([asset(1, 4), asset(2, 4), asset(3, 2)])
  assert.deepEqual(s.map((x) => [x.siteId, x.count]), [['4', 2], ['2', 1]])
})
