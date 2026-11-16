// Filtering jobs by the technician assigned, against a pretend Simpro that can honour the filter, ignore it, refuse it, or not list technicians
// at all. Invented jobs and people only. Run: cd apps/simprojobs && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { TECH_PAGE, findJobs, loadJobsByTechnician, technicianIds } from '../src/manage.js'
import { makeCall } from '../../testbench/src/simpro-api.js'

const T5 = { ID: 5, Name: 'Peter Lin', Type: 'employee', TypeId: 5 }
const T6 = { ID: 6, Name: 'Alex Admin', Type: 'employee', TypeId: 6 }
const job = (ID, extra) => ({ ID, Name: 'Job ' + ID, Description: 'Unit fault ' + ID, Notes: '', Customer: { ID: 1, CompanyName: 'Example Hospital' }, Site: { ID: 7, Name: 'Ward 4' }, Stage: 'Progress', Status: { ID: 4, Name: 'Job : In progress' }, ...extra })
const JOBS = [
  job(301, { Technicians: [T5] }), job(302, { Technicians: [T6] }), job(303, { Technicians: [T5, T6] }), job(304, { Technicians: [] }),
  job(305, { Technicians: [T5], Stage: 'Complete' }), job(306, { Technicians: [5] }), // a bare number is read too
  job(307, { Technicians: [T6], Name: 'Quiet', Description: 'Nothing', Notes: 'unit fault in the notes' }),
]

/** opts.mode: 'honour' (default) | 'ignore' (accepts Technicians.ID and returns everything) | 'refuse' (400) | 'nocolumn' (rows have no Technicians). */
function fakeSimpro(opts = {}) {
  const mode = opts.mode || 'honour'
  const seen = []
  const fetchFn = async (_u, init) => {
    const { requests } = JSON.parse(init.body)
    const { method, path } = requests[0]
    seen.push({ method, path })
    const reply = (status, data) => ({ status: 200, json: async () => ({ success: true, results: [{ status, data }] }) })
    if (method !== 'GET') throw new Error('a write was attempted')
    const [p, query = ''] = path.split('?')
    if (!/^\/companies\/\d+\/jobs\/$/.test(p)) return reply(404, {})
    const params = Object.fromEntries(query.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] }))
    let rows = [...JOBS]
    if ('Technicians.ID' in params) {
      if (mode === 'refuse') return reply(400, { errors: [{ message: 'cannot filter on Technicians.ID' }] })
      if (mode !== 'ignore') rows = rows.filter((j) => technicianIds(j).includes(+params['Technicians.ID']))
    }
    if (params.Stage) rows = rows.filter((j) => j.Stage === params.Stage)
    const field = Object.keys(params).find((k) => !['columns', 'pageSize', 'page', 'orderby', 'Stage', 'Technicians.ID'].includes(k))
    if (field) {
      const needle = params[field].replace(/%/g, '').toLowerCase()
      const read = (j) => (field === 'Site.Name' ? j.Site?.Name : field === 'Customer.CompanyName' ? j.Customer?.CompanyName : j[field]) || ''
      rows = rows.filter((j) => String(read(j)).toLowerCase().includes(needle))
    }
    if (params.orderby === '-ID') rows = rows.sort((a, b) => b.ID - a.ID)
    const size = +params.pageSize || 30
    const page = +params.page || 1
    rows = rows.slice((page - 1) * size, page * size).map((j) => (mode === 'nocolumn' ? { ...j, Technicians: undefined } : j)).map((j) => { const c = { ...j }; if (mode === 'nocolumn') delete c.Technicians; return c })
    return reply(200, rows)
  }
  return { call: makeCall({ getToken: async () => 't', proxyUrl: 'x', fetchFn }), seen }
}

test('technician ids are read from objects and bare numbers alike, and from nothing', () => {
  assert.deepEqual(technicianIds({ Technicians: [T5, T6] }), [5, 6])
  assert.deepEqual(technicianIds({ Technicians: [5, '6'] }), [5, 6])
  assert.deepEqual(technicianIds({ Technicians: T5 }), [5])
  assert.deepEqual(technicianIds({ Technicians: [] }), [])
  assert.deepEqual(technicianIds({}), [])
  assert.deepEqual(technicianIds(null), [])
})

test('with nothing typed: the jobs a technician is on, newest first, asked of Simpro and verified row by row', async () => {
  const { call, seen } = fakeSimpro()
  const r = await loadJobsByTechnician(call, 3, 5)
  assert.equal(r.via, 'simpro')
  assert.deepEqual(r.rows.map((x) => x.id), [306, 305, 303, 301])   // 302, 304 and 307 are not on it; a job with two technicians counts for each
  assert.equal(r.more, false)
  assert.equal(seen.length, 1)
  assert.match(seen[0].path, /Technicians\.ID=5/)
  assert.match(seen[0].path, /orderby=-ID/)
  assert.equal(r.rows.find((x) => x.id === 303).title, 'Job 303')
  assert.deepEqual((await loadJobsByTechnician(call, 3, 6)).rows.map((x) => x.id), [307, 303, 302])
  assert.deepEqual((await loadJobsByTechnician(call, 3, 5, { stage: 'Complete' })).rows.map((x) => x.id), [305])
  assert.match(seen[seen.length - 1].path, /Stage=Complete/)
  assert.deepEqual((await loadJobsByTechnician(call, 3, 99)).rows, [])
})

test('a filter Simpro ignores is caught, because not every row lists that technician: the newest jobs are filtered here instead', async () => {
  const { call, seen } = fakeSimpro({ mode: 'ignore' })
  const r = await loadJobsByTechnician(call, 3, 5)
  assert.equal(r.via, 'scan')
  assert.deepEqual(r.rows.map((x) => x.id), [306, 305, 303, 301])
  assert.equal(r.scanned, JOBS.length)
  assert.equal(seen.length, 2) // the filtered ask, then one page of newest jobs
})

test('a filter Simpro refuses falls back to the same scan', async () => {
  const { call, seen } = fakeSimpro({ mode: 'refuse' })
  const r = await loadJobsByTechnician(call, 3, 6)
  assert.equal(r.via, 'scan')
  assert.deepEqual(r.rows.map((x) => x.id), [307, 303, 302])
  assert.equal(seen.length, 2)
  assert.doesNotMatch(seen[1].path, /Technicians\.ID/)
})

test('a Simpro whose job list does not say who is assigned cannot be filtered, and it says so', async () => {
  await assert.rejects(() => loadJobsByTechnician(fakeSimpro({ mode: 'nocolumn' }).call, 3, 5), /doesn’t list a job’s technicians in the job list/)
  await assert.rejects(() => loadJobsByTechnician(fakeSimpro().call, 3, 'x'), /Choose a technician/)
  await assert.rejects(() => loadJobsByTechnician(fakeSimpro().call, 3, 0), /Choose a technician/)
  await assert.rejects(() => loadJobsByTechnician(fakeSimpro().call, 3, ''), /Choose a technician/)
})

test('a full page says there may be more', async () => {
  const many = Array.from({ length: TECH_PAGE + 20 }, (_, i) => job(1000 + i, { Technicians: [T5] }))
  const before = JOBS.length
  JOBS.push(...many)
  try {
    const r = await loadJobsByTechnician(fakeSimpro().call, 3, 5)
    assert.equal(r.rows.length, TECH_PAGE)
    assert.equal(r.more, true)
  } finally { JOBS.length = before }
})

test('a search with a technician keeps only that technician’s jobs, in the same three sections', async () => {
  const { call } = fakeSimpro()
  const all = await findJobs(call, 3, 'fault')
  assert.deepEqual([...all.groups.names, ...all.groups.description, ...all.groups.notes].map((g) => g.row.id).sort(), [301, 302, 303, 304, 305, 306, 307])
  const mine = await findJobs(call, 3, 'fault', { technician: { id: 5 } })
  assert.deepEqual(mine.groups.description.map((g) => g.row.id), [306, 305, 303, 301])
  assert.deepEqual(mine.groups.notes, [])                       // 307 (notes only) is Alex's
  assert.equal(mine.total, 4)
  assert.deepEqual(mine.technician, { via: 'simpro', capped: false, scanned: 0 })
  const alex = await findJobs(call, 3, 'fault', { technician: { id: 6 } })
  assert.deepEqual(alex.groups.description.map((g) => g.row.id), [303, 302])
  assert.deepEqual(alex.groups.notes.map((g) => g.row.id), [307])
  assert.equal(alex.total, 3)
  assert.equal((await findJobs(call, 3, 'zzz-nothing', { technician: { id: 5 } })).total, 0)
  const scanned = await findJobs(fakeSimpro({ mode: 'refuse' }).call, 3, 'fault', { technician: { id: 5 } })
  assert.equal(scanned.technician.via, 'scan')
  assert.equal(scanned.total, 4)
  await assert.rejects(() => findJobs(fakeSimpro({ mode: 'nocolumn' }).call, 3, 'fault', { technician: { id: 5 } }), /can’t be filtered by technician/)
})

const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
const ctx = vm.createContext({ console, Logger: { log() {} } })
vm.runInContext(source, ctx)

test('the relay already lets these reads through (the job list takes the search policy), and still no writes', () => {
  const allowed = (m, p) => vm.runInContext(`simproSyncAllowed_(${JSON.stringify(m)}, ${JSON.stringify(p)})`, ctx)
  assert.equal(allowed('get', '/companies/3/jobs/?columns=ID,Name,Description,Customer,Site,Stage,Status,Technicians&Technicians.ID=5&pageSize=100&orderby=-ID&Stage=Pending&page=2'), true)
  assert.equal(allowed('get', '/companies/3/jobs/?columns=ID,Technicians&Technicians.ID=5&pageSize=250&orderby=-ID'), true)
  assert.equal(allowed('delete', '/companies/3/jobs/?Technicians.ID=5'), false)
  assert.equal(allowed('post', '/companies/3/jobs/?Technicians.ID=5'), false)
})

test('Check Simpro says how the technician filter is done, with counts only', async () => {
  const { runChecks } = await import('../src/lookups.js')
  // A pretend Simpro with jobs and staff; the other lines fail for want of customers and setup, so the technician line is read on its own.
  const withStaff = (mode) => {
    const inner = fakeSimpro({ mode })
    const call = async (method, path, body) => {
      if (/\/staff\//.test(path)) return { status: 200, data: [{ ID: 5, Name: 'Peter Lin', Type: 'employee' }, { ID: 6, Name: 'Alex Admin', Type: 'employee' }] }
      return inner.call(method, path, body)
    }
    return call
  }
  const line = async (mode, who) => (await runChecks(withStaff(mode), 3, who)).find((l) => l.label === 'Jobs by technician')
  const honoured = await line('honour', { name: 'Peter Lin' })
  assert.equal(honoured.state, 'ok')
  assert.match(honoured.detail, /Simpro filters by technician itself \(4 jobs found for one employee\)/)
  const scanned = await line('refuse', { name: 'Peter Lin' })
  assert.match(scanned.detail, /Simpro can’t filter by technician, so the newest 7 jobs are read and filtered instead \(4 found for one employee\)/)
  const none = await line('nocolumn', { name: 'Peter Lin' })
  assert.equal(none.state, 'fail')
  assert.match(none.detail, /doesn’t list a job’s technicians/)
  assert.ok(!/Peter|Lin|Alex/.test(honoured.detail + scanned.detail + none.detail))
})
