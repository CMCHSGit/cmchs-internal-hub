// Run: cd apps/simprojobs && npm test
// Finding, changing and closing an existing job, against a pretend Simpro with invented jobs. Nothing real, nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { CLOSABLE_STAGES, MAX_ADD, buildClosePlan, buildEditPlan, canClose, canEdit, describeChange, fieldValue, findJobs, groupResults, jobTitle, loadCompletedStatus, loadJobDetail, loadRecentJobs, normaliseJob, recentJobsPath } from '../src/manage.js'
import { runPlan } from '../src/plan.js'
import { SendError, makeCall } from '../../testbench/src/simpro-api.js'

const RICH = '<p>Unit <b>XX-1001</b> is <i>dead</i></p><table><tr><td>Serial</td><td>XX-1001</td></tr></table>'
const JOBS = {
  101: { ID: 101, Name: 'Monitor check', Description: '<p>Check unit XX-1001 on the ward</p>', Notes: '', Customer: { ID: 1, CompanyName: 'Example Hospital' }, Site: { ID: 7, Name: 'Ward 4' }, Stage: 'Progress', Status: { ID: 4, Name: 'Job : In progress' }, DateModified: '2026-11-01T09:00:00+13:00' },
  102: { ID: 102, Name: 'Defib repair', Description: RICH, Notes: 'Nothing', Customer: { ID: 2, CompanyName: 'Example Aged Care' }, Site: { ID: 8, Name: 'Main site' }, Stage: 'Pending', Status: { ID: 3, Name: 'Job : New' }, DateModified: '2026-11-02T09:00:00+13:00',
    CustomFields: [{ CustomField: { ID: 44, Name: 'Job Type' }, Value: 'Repair' }, { CustomField: { ID: 46, Name: 'Priority (incl callouts) - CHS' }, Value: 'Standard' }] },
  103: { ID: 103, Name: 'Annual service', Description: 'Routine', Notes: '<div>Serial XX-1001 confirmed</div>', Customer: { ID: 1, CompanyName: 'Example Hospital' }, Site: { ID: 7, Name: 'Ward 4' }, Stage: 'Complete', Status: { ID: 66, Name: 'Job : Completed' } },
  104: { ID: 104, Name: 'XX-1001 swap', Description: 'Swap the unit', Notes: '', Customer: { ID: 3, CompanyName: 'Another Clinic' }, Site: { ID: 9, Name: 'Clinic' }, Stage: 'Pending', Status: { ID: 3, Name: 'Job : New' } },
  105: { ID: 105, Name: '', Description: '<p>   </p><p>Leaking pump in plant room</p>', Notes: '', Customer: { ID: 3 }, Stage: 'Invoiced', Status: { ID: 70, Name: 'Job : Invoiced' } },
  106: { ID: 106, Name: 'Old one', Description: 'x', Notes: 'x', Customer: { ID: 3, CompanyName: 'Another Clinic' }, Site: { ID: 9, Name: 'Clinic' }, Stage: 'Archived', Status: { ID: 71, Name: 'Archived' } },
}
const SETUP = { jobType: { field: { id: 44, name: 'Job Type' } }, chargeCategory: { field: { id: 45, name: 'Charge category - CHS' } }, priority: { field: { id: 46, name: 'Priority (incl callouts) - CHS' } } }

/** opts.refuseOrder: Simpro answers 400 to orderby. opts.notesRefused: filtering on Notes answers 400. opts.status: { word: status } for a write. opts.noCompleted: no such status. */
function fakeSimpro(opts = {}) {
  const seen = []
  const writes = []
  const fetchFn = async (_url, init) => {
    const { requests } = JSON.parse(init.body)
    const { method, path, body } = requests[0]
    seen.push({ method, path })
    const reply = (status, data) => ({ status: 200, json: async () => ({ success: true, results: [{ status, data }] }) })
    const [p, query = ''] = path.split('?')
    const params = Object.fromEntries(query.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] }))
    let m
    if (method !== 'GET') {
      const word = /customFields/.test(p) ? 'field' : 'job'
      writes.push({ method, path: p, body, word })
      const st = opts.status?.[word]
      if (st) return reply(st, { errors: [{ message: 'refused by the pretend Simpro' }] })
      return reply(method === 'PATCH' ? 204 : 201, null)
    }
    if ((m = p.match(/^\/companies\/\d+\/jobs\/(\d+)$/))) return JOBS[m[1]] ? reply(200, opts.fresh?.[m[1]] || JOBS[m[1]]) : reply(404, {})
    if (/^\/companies\/\d+\/jobs\/$/.test(p)) {
      if (opts.refuseOrder && params.orderby) return reply(400, { errors: [{ message: 'cannot order' }] })
      const field = Object.keys(params).find((k) => !['columns', 'pageSize', 'page', 'orderby', 'Stage'].includes(k))
      let rows = Object.values(JOBS)
      if (field) {
        if (opts.notesRefused && field === 'Notes') return reply(400, { errors: [{ message: 'cannot filter' }] })
        const needle = params[field].replace(/%/g, '').toLowerCase()
        const read = (j) => (field === 'Site.Name' ? j.Site?.Name : field === 'Customer.CompanyName' ? j.Customer?.CompanyName : j[field]) || ''
        rows = rows.filter((j) => String(read(j)).toLowerCase().includes(needle))
      }
      if (params.Stage) rows = rows.filter((j) => j.Stage === params.Stage)
      if (params.orderby === '-ID') rows = [...rows].sort((a, b) => b.ID - a.ID)
      return reply(200, rows.slice(0, +params.pageSize || 30))
    }
    if (/setup\/statusCodes\/projects\/$/.test(p)) return reply(200, opts.noCompleted ? [{ ID: 3, Name: 'Job : New' }] : [{ ID: 3, Name: 'Job : New' }, { ID: 66, Name: ' Job : Completed ' }])
    return reply(404, {})
  }
  return { call: makeCall({ getToken: async () => 't', proxyUrl: 'https://proxy.invalid/', fetchFn }), seen, writes }
}

// The real relay, for the rules a request must pass: its job PATCH check, and its scope check against the pretend job.
const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
function relay(jobs = JOBS) {
  const answer = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) })
  const sandbox = vm.createContext({
    console, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'k' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    UrlFetchApp: { fetch(url) { const m = url.match(/\/jobs\/(\d+)$/); const f = url.match(/customFields\/projects\/(\d+)$/); return m && jobs[m[1]] ? answer(200, jobs[m[1]]) : f ? answer(200, { Name: { 44: 'Job Type', 45: 'Charge category - CHS', 46: 'Priority (incl callouts) - CHS' }[f[1]] }) : answer(404, {}) } },
  })
  vm.runInContext(source, sandbox)
  const J = JSON.stringify
  return {
    // '' when the relay would send it: allowed path, body check, scope check.
    verdict: (r) => vm.runInContext(`(function(){ var m = ${J(r.method.toLowerCase())}, p = ${J(r.path)}, b = ${J(r.body)};
      if (!simproSyncAllowed_(m, p)) return 'PATH NOT ALLOWED';
      if (/^\\/companies\\/\\d+\\/jobs\\/\\d+$/.test(p) && m === 'patch') { var w = simproSyncJobPatchError_(b); if (w) return w; }
      return simproSyncJobWriteError_(m, p, b, 1) || simproJobsScopeError_(m, p, { uid: 'u' }, b); })()`, sandbox),
  }
}

test('titles: the name, else the first line of the description, else the number', () => {
  assert.equal(jobTitle(JOBS[101]), 'Monitor check')
  assert.equal(jobTitle(JOBS[105]), 'Leaking pump in plant room')
  assert.equal(jobTitle({ ID: 9, Name: '  ', Description: '' }), 'Job 9')
  assert.equal(jobTitle({ ID: 9, Description: 'x'.repeat(300) }).length, 90)
})

test('recent jobs: newest first, a stage if chosen, more only when a full page came back; a refused ordering is dropped', async () => {
  assert.equal(recentJobsPath(3, { stage: 'Pending', page: 2 }), '/companies/3/jobs/?columns=ID,Name,Description,Customer,Site,Stage,Status&pageSize=30&orderby=-ID&Stage=Pending&page=2')
  const { call } = fakeSimpro()
  const all = await loadRecentJobs(call, 3)
  assert.deepEqual(all.rows.map((r) => r.id), [106, 105, 104, 103, 102, 101])
  assert.equal(all.more, false)
  assert.deepEqual((await loadRecentJobs(call, 3, { stage: 'Pending' })).rows.map((r) => r.id), [104, 102])
  const { call: noOrder, seen } = fakeSimpro({ refuseOrder: true })
  const r = await loadRecentJobs(noOrder, 3)
  assert.equal(r.rows.length, 6)
  assert.equal(seen.length, 2)
  assert.doesNotMatch(seen[1].path, /orderby/)
  assert.deepEqual(all.rows.find((x) => x.id === 101), { id: 101, title: 'Monitor check', customer: 'Example Hospital', site: 'Ward 4', stage: 'Progress', status: 'Job : In progress' })
})

test('search: job number and title first, then jobs found only by their description, then only by their notes, newest first', async () => {
  const { call } = fakeSimpro()
  const r = await findJobs(call, 3, 'XX-1001')
  assert.deepEqual(r.groups.names.map((x) => x.row.id), [104])                 // the title has it
  assert.deepEqual(r.groups.description.map((x) => x.row.id), [102, 101])      // only the description
  assert.deepEqual(r.groups.notes.map((x) => x.row.id), [103])                 // only the notes
  assert.equal(r.total, 4)
  assert.ok(r.groups.names[0].places.includes('Job name'))
  const snip = r.groups.description[0].snippets[0]
  assert.equal(snip.label, 'Description')
  assert.match(snip.snip.hit, /XX-1001/i)
  assert.equal(r.groups.notes[0].snippets[0].label, 'Notes')
  assert.deepEqual(r.groups.names[0].snippets, [])
})

test('search: a job number is found as a title match; customer and site names go with the first section; every word is needed', async () => {
  const { call } = fakeSimpro()
  assert.deepEqual((await findJobs(call, 3, '103')).groups.names.map((x) => x.row.id), [103])
  const byCustomer = await findJobs(call, 3, 'Example Hospital')
  assert.deepEqual(byCustomer.groups.names.map((x) => x.row.id), [103, 101])
  const both = await findJobs(call, 3, 'XX-1001 Hospital')
  assert.deepEqual([...both.groups.names, ...both.groups.description, ...both.groups.notes].map((x) => x.row.id).sort(), [101, 103])
  assert.deepEqual((await findJobs(call, 3, 'zzz-nothing')).total, 0)
  assert.equal((await findJobs(call, 3, '   ')).total, 0)
})

test('search: a stage narrows it, and a place Simpro won’t search is reported, not hidden', async () => {
  const { call } = fakeSimpro({ notesRefused: true })
  const r = await findJobs(call, 3, 'XX-1001')
  assert.deepEqual(r.groups.notes, [])
  assert.ok(r.notSearched.includes('Notes'))
  const pending = await findJobs(fakeSimpro().call, 3, 'XX-1001', { stage: 'Pending' })
  assert.deepEqual([...pending.groups.names, ...pending.groups.description, ...pending.groups.notes].map((x) => x.row.id).sort(), [102, 104])
})

test('groupResults puts a job in the first section it belongs to, and sorts each newest first', () => {
  const g = groupResults({
    jobs: [{ job: JOBS[101], found: ['Description', 'Notes'] }, { job: JOBS[103], found: ['Notes'] }, { job: JOBS[102], found: ['Notes', 'Description'] }, { job: JOBS[104], found: ['Description', 'Job name'] }], terms: ['x'],
  })
  assert.deepEqual(g.groups.names.map((x) => x.row.id), [104])
  assert.deepEqual(g.groups.description.map((x) => x.row.id), [102, 101])
  assert.deepEqual(g.groups.notes.map((x) => x.row.id), [103])
})

test('reading a job: its facts and custom field values; a missing job is said so', async () => {
  const { call } = fakeSimpro()
  const j = await loadJobDetail(call, 3, 102)
  assert.equal(j.title, 'Defib repair')
  assert.equal(j.stage, 'Pending')
  assert.equal(j.statusId, 3)
  assert.equal(j.description, RICH)
  assert.equal(fieldValue(j, 44), 'Repair')
  assert.equal(fieldValue(j, 46), 'Standard')
  assert.equal(fieldValue(j, 45), '')
  assert.equal(fieldValue(normaliseJob(JOBS[101]), 44), '')
  await assert.rejects(() => loadJobDetail(call, 3, 999), (e) => e instanceof SendError && /Job 999 was not found/.test(e.message))
})

test('who can be changed: Pending, Progress and Complete; closed from Pending and Progress only', () => {
  for (const [id, edit, close] of [[101, true, true], [102, true, true], [103, true, false], [105, false, false], [106, false, false]]) {
    const j = normaliseJob(JOBS[id])
    assert.equal(canEdit(j), edit, 'edit ' + id)
    assert.equal(canClose(j), close, 'close ' + id)
  }
  assert.deepEqual(CLOSABLE_STAGES, ['Pending', 'Progress'])
})

test('an edit adds to the end of the text as it is when the change is made, keeps rich text, and the relay accepts it', async () => {
  const job = normaliseJob(JOBS[102])
  const plan = buildEditPlan({ job, changes: { addDescription: 'Customer rang back & says <E12>', addNotes: 'Ask for Pat\nSerial AB-1' }, setup: SETUP, companyId: 3 })
  assert.deepEqual(plan.map((s) => s.id), ['text'])
  assert.deepEqual(plan[0].facts, [['Added to the end of the description', 'Customer rang back & says <E12>'], ['Added to the end of the notes', 'Ask for Pat\nSerial AB-1']])
  // Someone added to the job in Simpro after this page loaded it: their text is kept, ours goes after it.
  const fresh = { ...JOBS[102], Description: RICH + '<p>Added by someone else</p>', Notes: 'Nothing<br>and more' }
  const { call, writes } = fakeSimpro({ fresh: { 102: fresh } })
  const run = await runPlan(call, plan, {}, () => {}, {})
  assert.equal(run.failed, null)
  assert.equal(writes.length, 1)
  assert.deepEqual(writes[0].body, {
    Description: RICH + '<p>Added by someone else</p><p>Customer rang back &amp; says &lt;E12&gt;</p>',
    Notes: 'Nothing<br>and more<p>Ask for Pat<br>Serial AB-1</p>',
  })
  assert.equal(writes[0].path, '/companies/3/jobs/102')
  // The real relay agrees: a pure addition to the end of what Simpro holds.
  assert.equal(relay({ 102: fresh }).verdict(writes[0]), '')
  // ...and refuses the same text if it would REPLACE the description, or if the job moved on to Invoiced.
  assert.match(relay({ 102: { ...fresh, Description: 'something else' } }).verdict(writes[0]), /other than by adding to the end/)
  assert.match(relay({ 102: { ...fresh, Stage: 'Invoiced' } }).verdict(writes[0]), /Invoiced, so its description can no longer be changed/)
})

test('an edit that can’t read the job first writes nothing', async () => {
  const plan = buildEditPlan({ job: normaliseJob(JOBS[102]), changes: { addNotes: 'x' }, setup: SETUP, companyId: 3 })
  const { call, writes } = fakeSimpro({ fresh: { 102: { ...JOBS[102], Stage: 'Invoiced' } } })
  const run = await runPlan(call, plan, {}, () => {}, {})
  assert.equal(writes.length, 0)
  assert.match(run.failed.message, /Invoiced now/)
  assert.equal(run.failed.unknown, false)
  assert.equal(describeChange(plan, run).state, 'refused')
})

test('custom fields: only those that differ are changed, each its own step, and the relay accepts them', async () => {
  const job = normaliseJob(JOBS[102])
  const plan = buildEditPlan({ job, changes: { jobType: { name: 'Repair' }, chargeCategory: { name: 'Warranty' }, priority: { name: ' urgent ' } }, setup: SETUP, companyId: 3 })
  assert.deepEqual(plan.map((s) => s.id), ['chargeCategory', 'priority']) // Job Type is already Repair
  assert.deepEqual(plan.map((s) => s.facts[0]), [['Charge category - CHS', 'not set → Warranty'], ['Priority (incl callouts) - CHS', 'Standard →  urgent ']])
  const { call, writes } = fakeSimpro()
  const run = await runPlan(call, plan, {}, () => {}, {})
  assert.equal(run.failed, null)
  assert.deepEqual(writes.map((w) => w.method + ' ' + w.path + ' ' + JSON.stringify(w.body)), [
    'PATCH /companies/3/jobs/102/customFields/45 {"Value":"Warranty"}', 'PATCH /companies/3/jobs/102/customFields/46 {"Value":" urgent "}',
  ])
  const r = relay()
  for (const w of writes) assert.equal(r.verdict(w), '', w.path)
  // An invoiced or archived job's fields are not changed by the relay.
  assert.match(relay({ 102: { ...JOBS[102], Stage: 'Invoiced' } }).verdict(writes[0]), /can no longer be changed here/)
})

test('an edit says why it can’t be built, in words', () => {
  const ok = normaliseJob(JOBS[102])
  assert.throws(() => buildEditPlan({ job: ok, changes: {}, setup: SETUP, companyId: 3 }), /Nothing to change yet/)
  assert.throws(() => buildEditPlan({ job: ok, changes: { addNotes: '   \n ' }, setup: SETUP, companyId: 3 }), /Nothing to change yet/)
  assert.throws(() => buildEditPlan({ job: ok, changes: { jobType: { name: 'Repair' } }, setup: SETUP, companyId: 3 }), /Nothing to change yet/) // already Repair
  assert.throws(() => buildEditPlan({ job: normaliseJob(JOBS[105]), changes: { addNotes: 'x' }, setup: SETUP, companyId: 3 }), /Job 105 is Invoiced, so it can’t be changed here/)
  assert.throws(() => buildEditPlan({ job: ok, changes: { addNotes: 'x'.repeat(MAX_ADD + 1) }, setup: SETUP, companyId: 3 }), /up to 5000 characters/)
  assert.throws(() => buildEditPlan({ job: ok, changes: { priority: { name: 'Urgent' } }, setup: { priority: { field: null } }, companyId: 3 }), /Priority field was not found/)
})

test('closing: Stage Complete then Status "Job : Completed" as a bare number, accepted by the relay', async () => {
  const { call, writes } = fakeSimpro()
  const status = await loadCompletedStatus(call, 3)
  assert.deepEqual(status, { id: 66, name: 'Job : Completed' })
  const job = normaliseJob(JOBS[101])
  const plan = buildClosePlan({ job, statusCode: status, companyId: 3 })
  assert.deepEqual(plan.map((s) => s.facts[0]), [['Stage', 'Progress → Complete'], ['Status', 'Job : In progress → Job : Completed']])
  const run = await runPlan(call, plan, {}, () => {}, {})
  assert.equal(run.failed, null)
  assert.deepEqual(writes.map((w) => JSON.stringify(w.body)), ['{"Stage":"Complete"}', '{"Status":66}'])
  const r = relay()
  for (const w of writes) assert.equal(r.verdict(w), '')
  assert.equal(describeChange(plan, run).state, 'done')
})

test('closing refuses what is already closed, and a Simpro with no "Job : Completed" status', async () => {
  const st = { id: 66, name: 'Job : Completed' }
  for (const id of [103, 105, 106]) assert.throws(() => buildClosePlan({ job: normaliseJob(JOBS[id]), statusCode: st, companyId: 3 }), /nothing to close/)
  assert.throws(() => buildClosePlan({ job: normaliseJob(JOBS[101]), statusCode: null, companyId: 3 }), /no “Job : Completed” status/)
  assert.equal(await loadCompletedStatus(fakeSimpro({ noCompleted: true }).call, 3), null)
})

test('closing: a refused stage stops before the status, and the state says what was and wasn’t done', async () => {
  const plan = buildClosePlan({ job: normaliseJob(JOBS[101]), statusCode: { id: 66, name: 'Job : Completed' }, companyId: 3 })
  const refused = fakeSimpro({ status: { job: 422 } })
  const run = await runPlan(refused.call, plan, {}, () => {}, {})
  assert.equal(refused.writes.length, 1)
  assert.equal(describeChange(plan, run).state, 'refused')
  assert.match(describeChange(plan, run).text, /^Nothing was changed: Simpro said 422/)
  const partial = { done: ['stage'], failed: { step: 'status', message: 'Simpro said 422', unknown: false } }
  assert.equal(describeChange(plan, partial).state, 'partial')
  assert.match(describeChange(plan, partial).text, /Part of the change was made, but “Set the status to “Job : Completed”” did not finish/)
  assert.equal(describeChange(plan, { done: [], failed: { step: 'stage', message: 'no answer', unknown: true } }).state, 'unsure')
})
