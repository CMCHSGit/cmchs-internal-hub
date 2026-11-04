// npm test -w apps/hub — reading a site's assets with their custom fields in a few calls (apps/simprosync/fast-assets.js),
// against a made-up Simpro. The point of every case: a wrong read must never reach the sync's plan.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fastSiteAssets } from '../../simprosync/fast-assets.js'

const SERIAL = 7, MODEL = 8
/** A pretend Simpro: assets with custom fields; answers the list call and the per-asset call, and counts them. */
function simpro({ assets, refuse = false, tamper = null, noFields = false, noFieldIds = false }) {
  const calls = { list: 0, perAsset: 0, paths: [] }
  const fieldsOf = (a) => [{ CustomField: { ID: SERIAL, Name: 'Serial Number' }, Value: a.serial }, { CustomField: { ID: MODEL, Name: 'Device Model' }, Value: a.model }]
  const listed = (a) => ({
    ID: a.id, Site: { ID: a.site, Name: 'S' + a.site }, AssetType: { ID: a.type }, Archived: !!a.archived,
    ...(noFields ? {} : { CustomFields: fieldsOf(a).map((c) => (noFieldIds ? { CustomField: { Name: c.CustomField.Name }, Value: c.Value } : c)) }),
  })
  const handle = (method, path) => {
    calls.paths.push(path)
    let m
    if ((m = /\/customerAssets\/\?(.*)$/.exec(path))) {
      if (refuse) throw new Error('Request 0 (GET ' + path + ') is not allowed')
      calls.list++
      const q = new URLSearchParams(m[1].replace(/&columns=[^&]*/, ''))
      const tid = q.get('AssetType.ID'); const sites = (/in\(([^)]*)\)/.exec(m[1])?.[1] || '').split(',')
      const page = +q.get('page')
      const hit = assets.filter((a) => String(a.type) === tid && sites.includes(String(a.site)))
      return { status: 200, data: hit.slice((page - 1) * 250, page * 250).map(listed) }
    }
    if ((m = /\/sites\/(\d+)\/assets\/(\d+)\/customFields\//.exec(path))) {
      calls.perAsset++
      const a = assets.find((x) => String(x.id) === m[2])
      const f = fieldsOf(a)
      if (tamper) tamper(a, f)
      return { status: 200, data: f }
    }
    return { status: 404, data: null }
  }
  return { calls, transport: async (method, path) => handle(method, path), call: async (method, path) => handle(method, path) }
}
const many = (n, site = 100, type = 114) => Array.from({ length: n }, (_, i) => ({ id: 1000 + i, site, type, serial: 'SN' + i, model: 'M' + (i % 5) }))
const run = (s, over = {}) => fastSiteAssets({ transport: s.transport, call: s.call, cid: 3, tid: 114, sites: [100], ...over })

test('a big site is read in a few calls, not one per asset, and agrees with the old way', async () => {
  const s = simpro({ assets: many(1200) })
  const out = await run(s)
  assert.equal(out.get('100').length, 1200)
  assert.equal(s.calls.list, 5, '1200 assets at 250 a call is 5 calls')
  assert.ok(s.calls.perAsset <= 3, 'only a sample is read the old way, to check')
  const a = out.get('100')[0]
  assert.deepEqual(a.CustomFields.map((c) => [c.CustomField.ID, c.Value]), [[SERIAL, 'SN0'], [MODEL, 'M0']], 'in the shape the per-asset call gives')
})

test('only this type, only the sites asked for, and not archived', async () => {
  const assets = [...many(3), { id: 5001, site: 100, type: 999, serial: 'OTHER', model: 'x' }, { id: 5002, site: 200, type: 114, serial: 'ELSEWHERE', model: 'x' }, { id: 5003, site: 100, type: 114, serial: 'GONE', model: 'x', archived: true }]
  const out = await run(simpro({ assets }))
  assert.deepEqual(out.get('100').map((a) => a.CustomFields[0].Value), ['SN0', 'SN1', 'SN2'])
  assert.equal(out.has('200'), false)
})

test('a site with no assets is an empty list, not missing', async () => {
  const out = await run(simpro({ assets: many(2) }), { sites: [100, 300] })
  assert.deepEqual(out.get('300'), [])
})

test('sites go in groups of forty, so the address stays short', async () => {
  const s = simpro({ assets: many(2) })
  await run(s, { sites: Array.from({ length: 95 }, (_, i) => 100 + i) })
  const listCalls = s.calls.paths.filter((p) => p.includes('/customerAssets/') && p.includes('page=1'))
  assert.equal(listCalls.length, 3)
  assert.ok(listCalls.every((p) => p.length < 900))
})

test('if the proxy does not allow the list call, it says so (null) and the old way is used', async () => {
  assert.equal(await run(simpro({ assets: many(5), refuse: true })), null)
})

test('a list without custom fields, or without their ids, is not trusted', async () => {
  assert.equal(await run(simpro({ assets: many(5), noFields: true })), null)
  assert.equal(await run(simpro({ assets: many(5), noFieldIds: true })), null)
})

test('if the quick read disagrees with the old way on any field, it is not trusted', async () => {
  const wrong = simpro({ assets: many(50), tamper: (a, f) => { f[0].Value = a.serial + 'X' } })
  assert.equal(await run(wrong), null, 'a different serial number')
  const missing = simpro({ assets: many(50), tamper: (a, f) => { f[1].Value = 'something else' } })
  assert.equal(await run(missing), null, 'a different model')
})

test('values are compared ignoring spaces and null against blank', async () => {
  const s = simpro({ assets: many(10).map((a) => ({ ...a, model: null })), tamper: (a, f) => { f[0].Value = '  ' + a.serial + ' '; f[1].Value = '' } })
  assert.ok(await run(s))
})

test('nothing to check against is not trusted either', async () => {
  const s = simpro({ assets: many(10) })
  const broken = { ...s, call: async (m, p) => (p.includes('/customFields/') ? { status: 500, data: 'x' } : s.call(m, p)) }
  assert.equal(await run(broken), null)
})

test('no sites, no work', async () => {
  const s = simpro({ assets: many(3) })
  assert.equal((await run(s, { sites: [] })).size, 0)
  assert.equal(s.calls.list, 0)
})
