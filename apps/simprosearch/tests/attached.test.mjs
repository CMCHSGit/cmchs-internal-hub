// Run: npm test --prefix apps/simprosearch   (a pretend Simpro with invented jobs and assets: nothing real)
import test from 'node:test'
import assert from 'node:assert/strict'
import { SITE_JOBS, assetJobsByTerm, batchMany, findAttachedJobs, scanAssets, siteJobsPath } from '../src/attached.js'
import { makeBatchGet } from '../src/bulk.js'
import { assetFacts, searchAssets, searchJobs } from '../src/search.js'
import { makeCall } from '../../testbench/src/simpro-api.js'

const cf = (serial, chs, model = 'A9') => [
  { CustomField: { Name: 'Serial Number' }, Value: serial },
  { CustomField: { Name: 'CHS Asset Number' }, Value: chs },
  { CustomField: { Name: 'Customer Asset Number' }, Value: '' },
  { CustomField: { Name: 'Device Model' }, Value: model },
]
const ASSETS = [
  { ID: 24105, Site: { ID: 7, Name: 'Waitemata Clinic' }, AssetType: { ID: 9, Name: 'Mindray' }, Archived: false, CustomFields: cf('AG4-34001182', '6540') },
  { ID: 24106, Site: { ID: 7, Name: 'Waitemata Clinic' }, AssetType: { ID: 9, Name: 'Mindray' }, Archived: false, CustomFields: cf('AG4-34001183', '6544') },
  { ID: 30581, Site: { ID: 8, Name: 'Other Hospital' }, AssetType: { ID: 9, Name: 'Mindray' }, Archived: false, CustomFields: cf('AG4C4C006098', '7633', 'A9 Desflurane') },
]
const JOB = (id, site = 7, extra = {}) => ({ ID: id, Name: 'Job ' + id, Description: 'd', Notes: 'n', Stage: 'Complete', Site: { ID: site, Name: site === 7 ? 'Waitemata Clinic' : 'Other Hospital' }, Customer: { CompanyName: 'Example' }, ...extra })

/** jobs: rows; attach: { jobId: [assetIds] } (one section, one cost centre). opts.refuseSiteId, opts.ignoreAssetFilter. */
function fakeSimpro({ jobs, attach, ...opts }) {
  const seen = []
  const run = (method, path) => {
    seen.push({ method, path })
    const [p, query = ''] = path.split('?')
    const params = Object.fromEntries(query.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] }))
    let m
    if (/\/jobs\/$/.test(p)) {
      if (params['Site.ID'] && opts.refuseSiteId) return { status: 400, data: {} }
      let rows = jobs
      if (params['Site.ID']) rows = rows.filter((j) => j.Site.ID === +params['Site.ID'])
      if (params['Site.Name']) { const t = params['Site.Name'].replace(/^%|%$/g, '').toLowerCase(); rows = rows.filter((j) => j.Site.Name.toLowerCase().includes(t)) }
      const f = Object.keys(params).find((k) => ['Description', 'Notes', 'Name', 'Customer.CompanyName'].includes(k))
      if (f) { const t = params[f].replace(/^%|%$/g, '').toLowerCase(); rows = rows.filter((j) => String(f.split('.').reduce((o, k) => o?.[k], j)).toLowerCase().includes(t)) }
      if (params.Stage) rows = rows.filter((j) => j.Stage === params.Stage)
      const size = +params.pageSize, page = +params.page || 1
      return { status: 200, data: rows.slice((page - 1) * size, page * size) }
    }
    if ((m = p.match(/\/jobs\/(\d+)\/sections\/$/))) return { status: 200, data: attach[m[1]] ? [{ ID: 1, Name: 'S' }] : [] }
    if ((m = p.match(/\/jobs\/(\d+)\/sections\/1\/costCenters\/$/))) return { status: 200, data: [{ ID: 5, Name: 'Service' }] }
    if ((m = p.match(/\/jobs\/(\d+)\/sections\/1\/costCenters\/5\/assets\/$/))) return { status: 200, data: (attach[m[1]] || []).map((id) => ({ ID: 900000 + id, Asset: { ID: id } })) }
    if (/\/customerAssets\/$/.test(p)) {
      const field = Object.keys(params).find((k) => !['columns', 'pageSize', 'page'].includes(k))
      let rows = ASSETS
      if (field) {
        const t = params[field].replace(/^%|%$/g, '').toLowerCase()
        rows = opts.ignoreAssetFilter ? ASSETS : ASSETS.filter((a) => a.CustomFields.some((c) => c.Value.toLowerCase().includes(t)))
      } else {
        const size = +params.pageSize, page = +params.page || 1
        rows = ASSETS.slice((page - 1) * size, page * size)
      }
      return { status: 200, data: rows }
    }
    return { status: 404, data: {} }
  }
  const fetchFn = async (_u, init) => {
    const { requests } = JSON.parse(init.body)
    return { status: 200, json: async () => ({ success: true, results: requests.map((r) => run(r.method, r.path)) }) }
  }
  const t = { getToken: async () => 't', proxyUrl: 'http://proxy.test/exec', fetchFn }
  return { call: makeCall(t), batchGet: makeBatchGet(t), seen }
}

const facts = (a) => assetFacts(a)

test('an asset is found by its serial and by its CHS asset number, and carries both', async () => {
  const { call } = fakeSimpro({ jobs: [], attach: {} })
  const bySerial = await searchAssets(call, 3, 'AG4-34001182')
  assert.deepEqual(bySerial.assets.map((a) => a.id), [24105])
  assert.equal(bySerial.assets[0].assetNumber, '6540')
  const byNumber = await searchAssets(call, 3, '6544')
  assert.deepEqual(byNumber.assets.map((a) => a.id), [24106])
})

test('the job an asset is attached to is found, through the jobs at its site', async () => {
  const jobs = [JOB(206775), JOB(206000), JOB(150000, 8)]
  const attach = { 206775: [24105, 24106, 30581], 206000: [24106], 150000: [30581] }
  const s = fakeSimpro({ jobs, attach })
  const { assets } = await searchAssets(s.call, 3, 'AG4-34001182')
  const r = await findAttachedJobs({ ...s, companyId: 3, assets })
  assert.deepEqual((r.byAsset.get('24105') || []).map((j) => j.ID), [206775])
  assert.equal(r.scanned, 2) // only the jobs at that asset's site were looked into
  assert.ok(s.seen.every((x) => x.method === 'GET'))
  // Whole lists are asked for, not the first 30.
  assert.ok(s.seen.filter((x) => /sections|costCenters/.test(x.path)).every((x) => x.path.includes('pageSize=250')))
})

test('searching a serial number puts the job it is attached to in the results', async () => {
  const jobs = [JOB(206775), JOB(206000)]
  const attach = { 206775: [24105, 24106], 206000: [24106] }
  const s = fakeSimpro({ jobs, attach })
  const text = 'AG4-34001182'
  const { assets } = await searchAssets(s.call, 3, text)
  const attached = await findAttachedJobs({ ...s, companyId: 3, assets })
  const extra = assetJobsByTerm([text], assets, attached.byAsset)
  const r = await searchJobs(s.call, 3, text, { groups: ['text', 'names'], extra })
  assert.deepEqual(r.jobs.map((j) => j.job.ID), [206775])
  assert.deepEqual(r.jobs[0].found, ['Attached asset'])
  assert.deepEqual(r.jobs[0].assets, ['AG4-34001182 · A9'])
})

test('with only assets asked for, the attached jobs still come back', async () => {
  const s = fakeSimpro({ jobs: [JOB(206775)], attach: { 206775: [24105] } })
  const { assets } = await searchAssets(s.call, 3, '6540')
  const attached = await findAttachedJobs({ ...s, companyId: 3, assets })
  const r = await searchJobs(s.call, 3, '6540', { groups: [], extra: assetJobsByTerm(['6540'], assets, attached.byAsset) })
  assert.deepEqual(r.jobs.map((j) => j.job.ID), [206775])
})

test('a serial plus a site: the other word may be the asset’s own site, and a word that is nowhere rules it out', async () => {
  const s = fakeSimpro({ jobs: [JOB(206775)], attach: { 206775: [24105] } })
  const run = async (text) => {
    const { assets } = await searchAssets(s.call, 3, text)
    const attached = assets.length ? await findAttachedJobs({ ...s, companyId: 3, assets }) : { byAsset: new Map() }
    return searchJobs(s.call, 3, text, { groups: ['text', 'names'], extra: assetJobsByTerm(['AG4-34001182', 'Waitemata'].filter((t) => text.includes(t)), assets, attached.byAsset) })
  }
  assert.deepEqual((await run('AG4-34001182 Waitemata')).jobs.map((j) => j.job.ID), [206775])
  assert.deepEqual((await run('AG4-34001182 nowhere')).jobs, [])
})

test('a job text hit and an asset hit on the same word are one result, not two', async () => {
  const jobs = [JOB(206775, 7, { Notes: 'serial AG4-34001182 checked' })]
  const s = fakeSimpro({ jobs, attach: { 206775: [24105] } })
  const { assets } = await searchAssets(s.call, 3, 'AG4-34001182')
  const attached = await findAttachedJobs({ ...s, companyId: 3, assets })
  const r = await searchJobs(s.call, 3, 'AG4-34001182', { groups: ['text'], extra: assetJobsByTerm(['AG4-34001182'], assets, attached.byAsset) })
  assert.equal(r.jobs.length, 1)
  assert.deepEqual(r.jobs[0].found.sort(), ['Attached asset', 'Notes'])
})

test('if Simpro won’t filter jobs by site number, the site’s name is used', async () => {
  const s = fakeSimpro({ jobs: [JOB(206775)], attach: { 206775: [24105] }, refuseSiteId: true })
  const { assets } = await searchAssets(s.call, 3, 'AG4-34001182')
  const r = await findAttachedJobs({ ...s, companyId: 3, assets })
  assert.deepEqual((r.byAsset.get('24105') || []).map((j) => j.ID), [206775])
  assert.equal(r.refused, false)
})

test('a stage narrows the jobs looked through', async () => {
  const jobs = [JOB(1, 7, { Stage: 'Complete' }), JOB(2, 7, { Stage: 'Progress' })]
  const s = fakeSimpro({ jobs, attach: { 1: [24105], 2: [24105] } })
  const { assets } = await searchAssets(s.call, 3, 'AG4-34001182')
  const r = await findAttachedJobs({ ...s, companyId: 3, assets, stage: 'Progress' })
  assert.deepEqual(r.byAsset.get('24105').map((j) => j.ID), [2])
})

test('a very busy site is looked through newest first, up to a limit, and says so', async () => {
  const jobs = Array.from({ length: SITE_JOBS + 50 }, (_, i) => JOB(1000 + i))
  const newest = jobs.at(-1).ID, oldest = jobs[0].ID
  const s = fakeSimpro({ jobs, attach: { [newest]: [24105], [oldest]: [24105] } })
  const { assets } = await searchAssets(s.call, 3, 'AG4-34001182')
  const r = await findAttachedJobs({ ...s, companyId: 3, assets })
  assert.equal(r.scanned, SITE_JOBS)
  assert.equal(r.capped, true)
  assert.deepEqual(r.byAsset.get('24105').map((j) => j.ID), [newest]) // the oldest one fell outside the limit
})

test('stopping stops', async () => {
  const jobs = Array.from({ length: 200 }, (_, i) => JOB(1000 + i))
  const s = fakeSimpro({ jobs, attach: {} })
  let stop = false
  const r = await findAttachedJobs({ ...s, companyId: 3, assets: [facts(ASSETS[0])], onProgress: ({ what }) => { if (what === 'jobs') stop = true }, isCancelled: () => stop })
  assert.equal(r.cancelled, true)
  assert.ok(s.seen.filter((x) => /sections/.test(x.path)).length < 200)
})

test('when Simpro ignores the asset filters, a full scan still finds the asset', async () => {
  const s = fakeSimpro({ jobs: [], attach: {}, ignoreAssetFilter: true })
  const viaFilters = await searchAssets(s.call, 3, 'AG4-34001182')
  assert.equal(viaFilters.assets.length, 1) // rows are checked, so an ignored filter can't flood it
  const scan = await scanAssets({ batchGet: s.batchGet, companyId: 3, terms: ['AG4C4C006098'] })
  assert.deepEqual(scan.assets.map((a) => a.id), [30581])
  assert.equal(scan.capped, false)
  assert.ok(s.seen.every((x) => x.method === 'GET'))
})

test('batchMany keeps the order, retries a lost trip and can be stopped', async () => {
  const paths = Array.from({ length: 60 }, (_, i) => '/p/' + i)
  let calls = 0
  const batchGet = async (part) => {
    if (++calls === 1) { const e = new Error('lost'); e.retry = true; throw e }
    return part.map((p) => ({ status: 200, data: p }))
  }
  const res = await batchMany(batchGet, paths)
  assert.deepEqual(res.map((r) => r.data), paths)
  let stop = false
  const part = await batchMany(async (p) => { stop = true; return p.map((x) => ({ status: 200, data: x })) }, paths, { isCancelled: () => stop })
  assert.ok(part.some((r) => r === null || r.data) && part.some((r) => r === null)) // some were never asked
})

test('the site address is exact and safe for the relay', () => {
  const p = siteJobsPath(3, 7, { stage: 'Complete', page: 2 })
  assert.match(p.split('?')[1], /^[A-Za-z0-9=&%+,.()\-_: ]*$/)
  assert.ok(p.includes('Site.ID=7') && p.includes('Stage=Complete') && p.includes('page=2'))
  assert.throws(() => siteJobsPath(3, 7, { stage: 'Nope' }))
})
