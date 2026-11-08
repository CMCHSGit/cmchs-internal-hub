// Run: npm test -w apps/simprosearch   (a pretend Simpro with invented jobs)
import test from 'node:test'
import assert from 'node:assert/strict'
import { BATCH, exportAllJobs, listPath, makeBatchGet } from '../src/bulk.js'
import { makeCall } from '../../testbench/src/simpro-api.js'

const mk = (id, extra = {}) => ({ ID: id, Name: 'Job ' + id, Description: `<p>desc ${id}</p>`, Notes: `notes ${id}`, Stage: id % 2 ? 'Complete' : 'Progress', DateIssued: `2026-0${(id % 9) + 1}-01`, ...extra })

/** opts.count jobs; opts.noNotesInRows; opts.refuseNotes; opts.ignorePage; opts.failDetail: ids Simpro won't give; opts.empty: ids with nothing written. */
function fakeSimpro({ count = 7, ...opts } = {}) {
  const all = Array.from({ length: count }, (_, i) => mk(i + 1, opts.empty?.includes(i + 1) ? { Description: '<p>&nbsp;</p>', Notes: '' } : {}))
  const seen = []
  const run = (method, path) => {
    seen.push({ method, path })
    const [p, query = ''] = path.split('?')
    const params = Object.fromEntries(query.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] }))
    let m
    if ((m = p.match(/\/jobs\/(\d+)$/))) {
      const id = +m[1]
      if (opts.failDetail?.includes(id)) return { status: 500, data: {} }
      const j = all.find((x) => x.ID === id)
      return j ? { status: 200, data: j } : { status: 404, data: {} }
    }
    if (/\/jobs\/$/.test(p)) {
      if (opts.refuseNotes && /Notes/.test(params.columns)) return { status: 400, data: { errors: [{ message: 'no' }] } }
      let rows = all
      if (params.Stage) rows = rows.filter((j) => j.Stage === params.Stage)
      const ge = /^ge\((.*)\)$/.exec(params.DateIssued || '')
      if (ge) rows = rows.filter((j) => j.DateIssued >= ge[1])
      const size = +params.pageSize, page = opts.ignorePage ? 1 : +params.page || 1
      rows = rows.slice((page - 1) * size, page * size)
      const noNotes = opts.noNotesInRows || !/Notes/.test(params.columns)
      return { status: 200, data: rows.map(({ Notes, ...rest }) => (noNotes ? rest : { Notes, ...rest })) }
    }
    return { status: 404, data: {} }
  }
  const fetchFn = async (_u, init) => {
    const { requests } = JSON.parse(init.body)
    return { status: 200, json: async () => ({ success: true, results: requests.map((r) => run(r.method, r.path)) }) }
  }
  const transport = { getToken: async () => 't', proxyUrl: 'http://proxy.test/exec', fetchFn }
  return { call: makeCall(transport), batchGet: makeBatchGet(transport), seen, all }
}

test('the list address: stage and date narrow it, bad ones are refused before anything is sent', () => {
  const path = listPath(3, { stage: 'Complete', issuedFrom: '2025-01-31', page: 2, pageSize: 250 })
  assert.match(path.split('?')[1], /^[A-Za-z0-9=&%+,.()\-_: ]*$/) // what the relay lets through
  assert.ok(path.includes('Stage=Complete') && path.includes('DateIssued=ge(2025-01-31)') && path.includes('pageSize=250') && path.includes('page=2'))
  assert.ok(!listPath(3).includes('page='))
  assert.throws(() => listPath(3, { stage: 'Invoiced' }))
  assert.throws(() => listPath(3, { issuedFrom: '31/1/2025' }))
})

test('every job is listed, page by page, and every request is a read', async () => {
  const s = fakeSimpro({ count: 7 })
  const progress = []
  const r = await exportAllJobs({ ...s, companyId: 3, pageSize: 3, onProgress: (p) => progress.push(p) })
  assert.deepEqual(r.jobs.map((j) => j.ID), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(r.listed, 7)
  assert.equal(r.failed, 0)
  assert.equal(s.seen.filter((x) => /jobs\/\?/.test(x.path)).length, 3) // 3 + 3 + 1: the short page ends it
  assert.ok(s.seen.every((x) => x.method === 'GET'))
  assert.equal(progress.at(-1).done, 7)
  assert.ok(r.jobs.every((j) => j.Notes))
})

test('an exact multiple of the page size costs one more look, then stops', async () => {
  const s = fakeSimpro({ count: 6 })
  const r = await exportAllJobs({ ...s, companyId: 3, pageSize: 3 })
  assert.equal(r.jobs.length, 6)
  assert.equal(s.seen.filter((x) => /jobs\/\?/.test(x.path)).length, 3) // the third page is empty
})

test('stage and date narrow what is asked for', async () => {
  const s = fakeSimpro({ count: 10 })
  const r = await exportAllJobs({ ...s, companyId: 3, pageSize: 50, stage: 'Complete', issuedFrom: '2026-05-01' })
  assert.ok(r.jobs.length > 0 && r.jobs.every((j) => j.Stage === 'Complete' && j.DateIssued >= '2026-05-01'))
})

test('if Simpro puts no notes in a row, each job is read in full, 25 to a trip', async () => {
  const s = fakeSimpro({ count: 60, noNotesInRows: true })
  let trips = 0
  const batchGet = async (paths) => { trips++; assert.ok(paths.length <= BATCH); return s.batchGet(paths) }
  const r = await exportAllJobs({ ...s, batchGet, companyId: 3, pageSize: 250 })
  assert.equal(r.jobs.length, 60)
  assert.ok(r.jobs.every((j) => j.Notes === 'notes ' + j.ID))
  assert.equal(trips, 3) // 25 + 25 + 10
  assert.ok(s.seen.every((x) => x.method === 'GET'))
})

test('if Simpro refuses Notes in the list, it asks again without and reads the jobs in full', async () => {
  const s = fakeSimpro({ count: 4, refuseNotes: true })
  const r = await exportAllJobs({ ...s, companyId: 3 })
  assert.equal(r.jobs.length, 4)
  assert.ok(r.jobs.every((j) => j.Notes === 'notes ' + j.ID))
})

test('jobs Simpro won’t give are counted and left out, not fatal', async () => {
  const s = fakeSimpro({ count: 5, noNotesInRows: true, failDetail: [2, 4] })
  const r = await exportAllJobs({ ...s, companyId: 3 })
  assert.deepEqual(r.jobs.map((j) => j.ID), [1, 3, 5])
  assert.equal(r.failed, 2)
})

test('a lost trip is tried again', async () => {
  const s = fakeSimpro({ count: 3, noNotesInRows: true })
  let calls = 0
  const batchGet = async (paths) => { if (++calls === 1) { const e = new Error('lost'); e.retry = true; throw e } return s.batchGet(paths) }
  const r = await exportAllJobs({ ...s, batchGet, companyId: 3 })
  assert.equal(r.jobs.length, 3)
  assert.equal(r.failed, 0)
})

test('jobs with nothing written are left out unless asked for', async () => {
  const s = fakeSimpro({ count: 5, empty: [2, 5] })
  const some = await exportAllJobs({ ...s, companyId: 3 })
  assert.deepEqual(some.jobs.map((j) => j.ID), [1, 3, 4])
  assert.equal(some.listed, 5)
  const all = await exportAllJobs({ ...s, companyId: 3, skipEmpty: false })
  assert.equal(all.jobs.length, 5)
})

test('stopping returns only the jobs whose text was read', async () => {
  const s = fakeSimpro({ count: 100, noNotesInRows: true })
  let stop = false
  const r = await exportAllJobs({ ...s, companyId: 3, onProgress: ({ phase, done }) => { if (phase === 'read' && done >= 25) stop = true }, isCancelled: () => stop })
  assert.equal(r.cancelled, true)
  assert.equal(r.jobs.length, 25)
  assert.ok(r.jobs.every((j) => j.Notes))
  assert.equal(r.listed, 100)
})

test('a Simpro that ignores the page number doesn’t loop for ever', async () => {
  const s = fakeSimpro({ count: 9, ignorePage: true })
  const r = await exportAllJobs({ ...s, companyId: 3, pageSize: 3 })
  assert.equal(r.jobs.length, 3)
  assert.ok(s.seen.length < 10)
})

test('a refused first page is an error that says why; a later one says how far it got', async () => {
  const call = async () => ({ status: 403, data: {} })
  await assert.rejects(() => exportAllJobs({ call, batchGet: async () => [], companyId: 3, issuedFrom: '2026-01-01' }), /wouldn’t list the jobs \(403/)
  let n = 0
  const flaky = async () => (++n === 1 ? { status: 200, data: Array.from({ length: 3 }, (_, i) => mk(i + 1)) } : { status: 500, data: {} })
  await assert.rejects(() => exportAllJobs({ call: flaky, batchGet: async () => [], companyId: 3, pageSize: 3 }), /after 3 jobs/)
})

test('the batch transport reports a short answer rather than guessing', async () => {
  const batchGet = makeBatchGet({ getToken: async () => 't', proxyUrl: 'x', fetchFn: async () => ({ status: 200, json: async () => ({ success: true, results: [{ status: 200, data: {} }] }) }) })
  await assert.rejects(() => batchGet(['/a', '/b']), /only part of the request/)
})
