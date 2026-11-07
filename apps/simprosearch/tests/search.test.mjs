// Run: npm test -w apps/simprosearch
// A pretend Simpro with invented jobs and assets: nothing here is real, and nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { ASSET_FILTERS, assetFacts, checkSearch, jobsPath, likeTerm, loadJob, searchAssets, searchJobs, whereFound } from '../src/search.js'
import { makeCall } from '../../testbench/src/simpro-api.js'

const JOBS = [
  { ID: 101, Name: 'Monitor check', Description: '<p>Check unit <b>XX-1001</b> on the ward</p>', Notes: 'Battery replaced. Serial XX-1001 confirmed.', Customer: { CompanyName: 'Example Hospital' }, Site: { ID: 7, Name: 'Ward 4' }, Stage: 'Complete', Status: { ID: 3, Name: 'Job : Completed' } },
  { ID: 102, Name: 'Defib repair', Description: 'Unit XX-1001 shuts down', Notes: '', Customer: { CompanyName: 'Example Aged Care' }, Site: { ID: 8, Name: 'Main site' }, Stage: 'Progress', Status: { ID: 4, Name: 'Job : In progress' } },
  { ID: 103, Name: 'Annual service', Description: 'Routine', Notes: '<div>Nothing to see</div>', Customer: { CompanyName: 'Example Hospital' }, Site: { ID: 7, Name: 'Ward 4' }, Stage: 'Complete', Status: { ID: 3, Name: 'Job : Completed' } },
]
const ASSETS = [
  { ID: 9001, Site: { ID: 7, Name: 'Ward 4' }, AssetType: { ID: 9, Name: 'Mindray' }, Archived: false, CustomFields: [{ CustomField: { Name: 'Serial Number' }, Value: 'XX-1001' }, { CustomField: { Name: 'Device Model' }, Value: 'Monitor A' }] },
  { ID: 9002, Site: { ID: 8, Name: 'Main site' }, AssetType: { ID: 9, Name: 'Mindray' }, Archived: false, CustomFields: [{ CustomField: { Name: 'Serial Number' }, Value: 'YY-2002' }] },
]

/** `opts.refuse`: filter names Simpro answers 400 to. `opts.ignore`: filter names Simpro accepts but ignores (returns everything). `opts.noNotesColumn`. */
function fakeSimpro(opts = {}) {
  const seen = []
  const fetchFn = async (_url, init) => {
    const { requests } = JSON.parse(init.body)
    const { method, path } = requests[0]
    seen.push({ method, path })
    const reply = (status, data) => ({ json: async () => ({ success: true, results: [{ status, data }] }), status: 200 })
    const [p, query = ''] = path.split('?')
    const params = Object.fromEntries(query.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] }))
    let m
    if ((m = p.match(/^\/companies\/\d+\/jobs\/(\d+)$/))) {
      const j = JOBS.find((x) => x.ID === +m[1])
      return j ? reply(200, j) : reply(404, { errors: [{ message: 'not found' }] })
    }
    if (/^\/companies\/\d+\/jobs\/$/.test(p)) {
      if (opts.noNotesColumn && /Notes/.test(params.columns || '')) return reply(400, { errors: [{ message: 'unknown column' }] })
      const field = Object.keys(params).find((k) => !['columns', 'pageSize', 'Stage'].includes(k))
      if (!field) return reply(200, JOBS.slice(0, +params.pageSize || 30).map((j) => (/Notes/.test(params.columns || '') ? { ID: j.ID, Notes: j.Notes } : { ID: j.ID })))
      if (opts.refuse?.includes(field)) return reply(400, { errors: [{ message: 'cannot filter' }] })
      const term = params[field].replace(/^%|%$/g, '').toLowerCase()
      const pick = (j) => opts.ignore?.includes(field) || String(field.split('.').reduce((o, k) => o?.[k], j) ?? '').replace(/<[^>]*>/g, '').toLowerCase().includes(term)
      let rows = JOBS.filter(pick).filter((j) => !params.Stage || j.Stage === params.Stage)
      const wantNotes = /Notes/.test(params.columns || '')
      rows = rows.map((j) => { const c = { ...j }; if (!wantNotes) delete c.Notes; return c })
      return reply(200, rows.slice(0, +params.pageSize || 30))
    }
    if (/^\/companies\/\d+\/customerAssets\/$/.test(p)) {
      const field = Object.keys(params).find((k) => !['columns', 'pageSize'].includes(k))
      if (opts.refuse?.includes(field)) return reply(400, {})
      const term = params[field].replace(/^%|%$/g, '').toLowerCase()
      const rows = ASSETS.filter((a) => opts.ignore?.includes(field) || a.CustomFields.some((c) => c.Value.toLowerCase().includes(term)))
      return reply(200, rows.slice(0, +params.pageSize || 30))
    }
    if ((m = p.match(/^\/companies\/\d+\/jobs\/\d+\/sections\/$/))) return reply(200, [{ ID: 1, Name: 'Section A' }])
    if ((m = p.match(/^\/companies\/\d+\/jobs\/\d+\/sections\/1\/costCenters\/$/))) return reply(200, [{ ID: 5, Name: 'Service' }])
    if ((m = p.match(/^\/companies\/\d+\/jobs\/\d+\/sections\/1\/costCenters\/5\/assets\/$/))) return reply(200, [{ ID: 9001 }])
    if ((m = p.match(/^\/companies\/\d+\/sites\/\d+\/assets\/(\d+)\/customFields\/$/))) return reply(200, ASSETS.find((a) => a.ID === +m[1])?.CustomFields || [])
    return reply(404, {})
  }
  return { call: makeCall({ getToken: async () => 'test-token', proxyUrl: 'http://proxy.test/exec', fetchFn }), seen }
}

test('the search text is wrapped in Simpro’s wildcard and made safe for the relay', () => {
  assert.equal(likeTerm('XX-1001'), '%25XX-1001%25')
  assert.equal(likeTerm('a b'), '%25a%20b%25')
  // The relay only lets [A-Za-z0-9=&%+,.()-_: ] through: characters encodeURIComponent leaves alone are escaped as well.
  const path = jobsPath(3, 'Notes', "it's (x)*!~ #1/2", { stage: 'Progress' })
  const query = path.split('?')[1]
  assert.match(query, /^[A-Za-z0-9=&%+,.()\-_: ]*$/)
  assert.ok(path.startsWith('/companies/3/jobs/?Notes='))
  assert.ok(query.includes('&Stage=Progress'))
})

test('a stage that is not one of Simpro’s four is refused before anything is sent', () => {
  assert.throws(() => jobsPath(3, 'Notes', 'x', { stage: 'Invoiced' }))
})

test('finds jobs by text in the description and in the notes, and says where', async () => {
  const { call } = fakeSimpro()
  const { jobs, fields } = await searchJobs(call, 3, 'XX-1001', { groups: ['text', 'names'] })
  assert.deepEqual(jobs.map((j) => j.job.ID), [102, 101]) // newest job number first
  const j101 = jobs.find((j) => j.job.ID === 101)
  assert.deepEqual(j101.found.sort(), ['Description', 'Notes'])
  assert.deepEqual(jobs.find((j) => j.job.ID === 102).found, ['Description'])
  assert.equal(fields.find((f) => f.key === 'Notes').status, 'ok')
  // The snippet comes from the row's own text, tags removed.
  const places = whereFound(j101.job, 'XX-1001')
  assert.deepEqual(places.map((p) => p.label), ['Description', 'Notes'])
  assert.equal(places[0].snip.hit, 'XX-1001')
  assert.ok(!places[0].snip.before.includes('<'))
})

test('only the places asked for are searched', async () => {
  const { call, seen } = fakeSimpro()
  await searchJobs(call, 3, 'ward', { groups: ['names'] })
  assert.ok(seen.every((s) => !/Notes=|Description=/.test(s.path)))
  assert.equal(seen.length, 3)
})

test('a field Simpro refuses is reported and the others still answer', async () => {
  const { call } = fakeSimpro({ refuse: ['Notes'] })
  const { jobs, fields } = await searchJobs(call, 3, 'XX-1001')
  assert.equal(fields.find((f) => f.key === 'Notes').status, 'refused')
  assert.equal(fields.find((f) => f.key === 'Description').status, 'ok')
  assert.ok(jobs.length >= 2)
})

test('everything refused is an error, not an empty list', async () => {
  const { call } = fakeSimpro({ refuse: ['Description', 'Notes', 'Name', 'Site.Name', 'Customer.CompanyName'] })
  await assert.rejects(() => searchJobs(call, 3, 'XX-1001'), /didn’t answer the search/)
})

test('if Simpro won’t list Notes in a row, the search is asked again without it', async () => {
  const { call, seen } = fakeSimpro({ noNotesColumn: true })
  const { jobs } = await searchJobs(call, 3, 'XX-1001')
  assert.ok(jobs.length >= 2)
  assert.ok(seen.some((s) => !/columns=[^&]*Notes/.test(s.path) && /jobs\/\?/.test(s.path)))
})

test('a job number is looked up as a job number, and the stage filter narrows', async () => {
  const { call } = fakeSimpro()
  const byNumber = await searchJobs(call, 3, '103', { groups: ['names'] })
  assert.equal(byNumber.jobs[0].job.ID, 103)
  assert.ok(byNumber.jobs[0].found.includes('Job number'))
  const progress = await searchJobs(call, 3, 'XX-1001', { groups: ['text'], stage: 'Progress' })
  assert.deepEqual(progress.jobs.map((j) => j.job.ID), [102])
})

test('nothing found is an empty list', async () => {
  const { call } = fakeSimpro()
  const { jobs } = await searchJobs(call, 3, 'no such text anywhere')
  assert.deepEqual(jobs, [])
  assert.deepEqual(await searchJobs(call, 3, '   '), { jobs: [], fields: [] })
})

test('every request is a read', async () => {
  const { call, seen } = fakeSimpro()
  await searchJobs(call, 3, 'XX-1001')
  await searchAssets(call, 3, 'XX-1001')
  await checkSearch(call, 3)
  await loadJob(call, 3, 101)
  assert.ok(seen.length > 10)
  assert.ok(seen.every((s) => s.method === 'GET'))
})

test('assets are found by serial; rows that don’t really contain it are dropped', async () => {
  const { call } = fakeSimpro({ ignore: ['Serial'] }) // Simpro accepts the Serial filter but returns everything
  const { assets, filters } = await searchAssets(call, 3, 'XX-1001')
  assert.deepEqual(assets.map((a) => a.id), [9001])
  assert.equal(assets[0].serial, 'XX-1001')
  assert.equal(assets[0].model, 'Monitor A')
  assert.equal(filters.length, ASSET_FILTERS.length)
})

test('assetFacts reads serial and model from custom fields', () => {
  assert.deepEqual(assetFacts(ASSETS[1]), { id: 9002, serial: 'YY-2002', model: '', type: 'Mindray', site: 'Main site', siteId: 8, archived: false })
  assert.equal(assetFacts({}).serial, '')
})

test('the check tells a real search from an ignored or refused one', async () => {
  const { call } = fakeSimpro({ ignore: ['Name'], refuse: ['Customer.CompanyName', 'SerialNumber'] })
  const { results, notesColumn } = await checkSearch(call, 3)
  const v = (key) => results.find((r) => r.key === key).verdict
  assert.equal(v('Notes'), 'works')
  assert.equal(v('Description'), 'works')
  assert.equal(v('Name'), 'ignored')
  assert.equal(v('Customer.CompanyName'), 'refused')
  assert.equal(v('SerialNumber'), 'refused')
  assert.equal(v('Serial'), 'works')
  assert.equal(notesColumn, true)
})

test('a job opened to read carries its cost centres and the assets attached, with serials', async () => {
  const { call } = fakeSimpro()
  const { job, centres, assets } = await loadJob(call, 3, 101)
  assert.equal(job.ID, 101)
  assert.deepEqual(centres.map((c) => [c.section, c.name, c.assets.length]), [['Section A', 'Service', 1]])
  assert.equal(assets[0].serial, 'XX-1001')
})

test('a job that is not there says so', async () => {
  const { call } = fakeSimpro()
  await assert.rejects(() => loadJob(call, 3, 999), /was not found/)
})
