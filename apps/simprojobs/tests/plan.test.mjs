// Run: cd apps/simprojobs && npm test
// Making a job, against a pretend Simpro that records every write. Invented data only; nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { JOB_TYPE, buildPlan, describeRun, jobBody, planSignature, runPlan, settleRun } from '../src/plan.js'
import { SendError, makeCall } from '../../testbench/src/simpro-api.js'

// The real relay, so every request the plan builds is checked by the rules that will check it live.
const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
const ctx = vm.createContext({ console, Logger: { log() {} } })
vm.runInContext(source, ctx)
const relayAllows = (method, path, body, count = 1) => vm.runInContext(
  `simproSyncAllowed_(${JSON.stringify(method)}, ${JSON.stringify(path)}) ? simproSyncJobWriteError_(${JSON.stringify(method.toLowerCase())}, ${JSON.stringify(path.split('?')[0])}, ${JSON.stringify(body)}, ${count}) : 'NOT ALLOWED'`, ctx)

const FORM = {
  customer: { ID: 12, kind: 'companies', name: 'Example Hospital', individual: false },
  site: { id: 34, name: 'Theatre 1' },
  costCentre: { id: 15, name: 'Service' },
  jobType: { id: 'Repair', name: 'Repair' },
  chargeCategory: { id: 'Warranty', name: 'Warranty' },
  priority: { id: 1, name: 'Standard' },
  description: 'Monitor will not power on & shows <E12>.\n\nCustomer rang at 9am.',
  notes: 'Ask for Pat\nSerial AB-1234',
}
const SETUP = { jobType: { field: { id: 44, name: 'Job Type' } }, chargeCategory: { field: { id: 45, name: 'Charge Category' } } }

/** opts.status: { stepWord: status } Simpro answers instead; opts.lost: step words whose answer never arrives; opts.refuse: relay refusals. */
function fakeSimpro(opts = {}) {
  const writes = []
  const fetchFn = async (_url, init) => {
    const { requests } = JSON.parse(init.body)
    const { method, path, body } = requests[0]
    const word = /customFields/.test(path) ? 'field' : /costCenters/.test(path) ? 'centre' : /sections/.test(path) ? 'section' : 'job'
    writes.push({ method, path, body, word })
    if (opts.lost?.includes(word)) throw new Error('network down')
    if (opts.refuse?.includes(word)) return { status: 200, json: async () => ({ success: false, error: `Request 0 (${method} ${path}) is not allowed` }) }
    const status = opts.status?.[word] ?? (method === 'PATCH' ? 204 : 201)
    const data = status >= 400 ? { errors: [{ message: 'invalid' }] } : word === 'job' ? { ID: 5001 } : word === 'section' ? { ID: 77 } : null
    return { status: 200, json: async () => ({ success: true, results: [{ status, data }] }) }
  }
  return { call: makeCall({ getToken: async () => 't', proxyUrl: 'https://proxy.invalid/', fetchFn }), writes }
}

test('jobBody holds only what the form holds; typed text is escaped, notes are left out when empty', () => {
  const body = jobBody(FORM)
  assert.deepEqual(Object.keys(body).sort(), ['Customer', 'Description', 'Notes', 'ResponseTime', 'Site', 'Stage', 'Type'])
  assert.equal(body.Type, JOB_TYPE)
  assert.equal(body.Type, 'Service')
  assert.equal(body.Customer, 12)
  assert.equal(body.Site, 34)
  assert.equal(body.ResponseTime, 1)
  assert.equal(body.Description, '<p>Monitor will not power on &amp; shows &lt;E12&gt;.</p><p>Customer rang at 9am.</p>')
  assert.equal(body.Notes, '<p>Ask for Pat<br>Serial AB-1234</p>')
  assert.equal('Notes' in jobBody({ ...FORM, notes: '  \n ' }), false)
})

test('buildPlan refuses an unfinished form and missing Simpro fields, in words', () => {
  assert.throws(() => buildPlan({}, SETUP, 3), /Still to fill in: Customer, Site/)
  assert.throws(() => buildPlan({ ...FORM, description: ' ' }, SETUP, 3), /Description/)
  assert.throws(() => buildPlan(FORM, { ...SETUP, jobType: { field: null } }, 3), /Job type field was not found/)
  assert.throws(() => buildPlan(FORM, { ...SETUP, chargeCategory: {} }, 3), /Charge category field was not found/)
})

test('the plan is five steps in the demo tracker’s order, and its review facts are what will be sent', () => {
  const plan = buildPlan(FORM, SETUP, 3)
  assert.deepEqual(plan.map((s) => s.id), ['job', 'section', 'costCentre', 'jobType', 'chargeCategory'])
  const facts = Object.fromEntries(plan.flatMap((s) => s.facts))
  assert.deepEqual(facts, {
    Type: 'Service', Stage: 'Pending', Customer: 'Example Hospital', Site: 'Theatre 1', Priority: 'Standard',
    Description: 'Monitor will not power on & shows <E12>.\n\nCustomer rang at 9am.', Notes: 'Ask for Pat\nSerial AB-1234',
    'Cost centre': 'Service', 'Job Type': 'Repair', 'Charge Category': 'Warranty',
  })
  const reqs = plan.map((s) => s.request({ jobId: 5001, sectionId: 77 }))
  assert.deepEqual(reqs.map((r) => r.method + ' ' + r.path), [
    'POST /companies/3/jobs/', 'POST /companies/3/jobs/5001/sections/', 'POST /companies/3/jobs/5001/sections/77/costCenters/',
    'PATCH /companies/3/jobs/5001/customFields/44', 'PATCH /companies/3/jobs/5001/customFields/45',
  ])
  assert.deepEqual(reqs.slice(1).map((r) => r.body), [{}, { CostCenter: 15 }, { Value: 'Repair' }, { Value: 'Warranty' }])
})

test('every request the plan builds is allowed by the real relay, body checks included', () => {
  const plan = buildPlan(FORM, SETUP, 3)
  for (const s of plan) {
    const r = s.request({ jobId: 5001, sectionId: 77 })
    assert.equal(relayAllows(r.method, r.path, r.body), '', s.id)
  }
  // And with the longest text the page allows, escaped into HTML (every character an &, the worst case).
  const big = buildPlan({ ...FORM, description: '&'.repeat(20000), notes: '"'.repeat(20000) }, SETUP, 3)[0].request({})
  assert.equal(relayAllows(big.method, big.path, big.body), '')
})

test('running the plan: five writes in order, ids carried forward, nothing but the five', async () => {
  const { call, writes } = fakeSimpro()
  const seen = []
  const run = await runPlan(call, buildPlan(FORM, SETUP, 3), {}, (r) => seen.push([r.done.length, r.inflight || null]))
  assert.deepEqual(run, { jobId: 5001, sectionId: 77, done: ['job', 'section', 'costCentre', 'jobType', 'chargeCategory'], failed: null })
  // Told before each step goes (which step is in flight) and after it (done), and once more at the end.
  assert.deepEqual(seen, [[0, 'job'], [1, null], [1, 'section'], [2, null], [2, 'costCentre'], [3, null], [3, 'jobType'], [4, null], [4, 'chargeCategory'], [5, null], [5, null]])
  assert.deepEqual(writes.map((w) => w.method + ' ' + w.path), [
    'POST /companies/3/jobs/', 'POST /companies/3/jobs/5001/sections/', 'POST /companies/3/jobs/5001/sections/77/costCenters/',
    'PATCH /companies/3/jobs/5001/customFields/44', 'PATCH /companies/3/jobs/5001/customFields/45',
  ])
  assert.equal(describeRun(buildPlan(FORM, SETUP, 3), run).state, 'done')
  assert.match(describeRun(buildPlan(FORM, SETUP, 3), run).text, /Job 5001 was created/)
})

test('a step Simpro refuses stops the run, and resuming never makes a second job', async () => {
  const plan = buildPlan(FORM, SETUP, 3)
  const first = fakeSimpro({ status: { centre: 422 } })
  const run = await runPlan(first.call, plan, {})
  assert.equal(run.jobId, 5001)
  assert.deepEqual(run.done, ['job', 'section'])
  assert.equal(run.failed.step, 'costCentre')
  assert.equal(run.failed.unknown, false)
  assert.match(run.failed.message, /Simpro said 422/)
  assert.equal(first.writes.length, 3) // it stopped there: the two field steps were not tried
  const d = describeRun(plan, run)
  assert.equal(d.state, 'partial')
  assert.match(d.text, /Job 5001 was created, but “Add the cost centre” did not finish/)

  const second = fakeSimpro()
  const resumed = await runPlan(second.call, plan, run)
  assert.equal(resumed.failed, null)
  assert.deepEqual(resumed.done, ['job', 'section', 'costCentre', 'jobType', 'chargeCategory'])
  assert.deepEqual(second.writes.map((w) => w.word), ['centre', 'field', 'field']) // no job, no section
  assert.ok(second.writes.every((w) => w.path.includes('/jobs/5001/')))
  assert.ok(second.writes[0].path.includes('/sections/77/'))
})

test('the first step refused (a mandatory field Simpro wants): nothing was created, and it says so', async () => {
  const plan = buildPlan(FORM, SETUP, 3)
  const { call, writes } = fakeSimpro({ status: { job: 422 } })
  const run = await runPlan(call, plan, {})
  assert.equal(run.jobId, null)
  assert.equal(writes.length, 1)
  assert.equal(describeRun(plan, run).state, 'refused')
  assert.match(describeRun(plan, run).text, /^Nothing was created: Simpro said 422/)
})

test('a lost answer or a Simpro fault is "unknown", a refusal by the relay or a 4xx is not', async () => {
  const plan = buildPlan(FORM, SETUP, 3)
  const lostJob = await runPlan(fakeSimpro({ lost: ['job'] }).call, plan, {})
  assert.equal(lostJob.failed.unknown, true)
  assert.equal(lostJob.jobId, null)
  assert.equal(describeRun(plan, lostJob).state, 'unsure')
  assert.match(describeRun(plan, lostJob).text, /may or may not have been created: look for it in Simpro/)
  const fault = await runPlan(fakeSimpro({ status: { section: 503 } }).call, plan, {})
  assert.equal(fault.failed.unknown, true)
  assert.equal(fault.jobId, 5001)
  const refused = await runPlan(fakeSimpro({ refuse: ['job'] }).call, plan, {})
  assert.equal(refused.failed.unknown, false)
  assert.equal(describeRun(plan, refused).state, 'refused')
  assert.match(refused.failed.message, /not allowed/)
})

test('an answer without the new job’s number is not taken as success', async () => {
  const plan = buildPlan(FORM, SETUP, 3)
  const fetchFn = async () => ({ status: 200, json: async () => ({ success: true, results: [{ status: 201, data: {} }] }) })
  const run = await runPlan(makeCall({ getToken: async () => 't', proxyUrl: 'x', fetchFn }), plan, {})
  assert.equal(run.failed.unknown, true)
  assert.equal(run.jobId, null)
  assert.ok(new SendError('x', false) instanceof Error)
})

test('planSignature is the same for the same form and changes with anything the job would hold', () => {
  const a = planSignature(buildPlan(FORM, SETUP, 3))
  assert.equal(a, planSignature(buildPlan({ ...FORM }, SETUP, 3)))
  for (const change of [{ description: FORM.description + '!' }, { notes: '' }, { site: { id: 35, name: 'x' } }, { priority: { id: 2, name: 'x' } }, { jobType: { id: 'Demo', name: 'Demo' } }]) {
    assert.notEqual(a, planSignature(buildPlan({ ...FORM, ...change }, SETUP, 3)), JSON.stringify(Object.keys(change)))
  }
  assert.notEqual(a, planSignature(buildPlan(FORM, SETUP, 4)))
})

test('a run read back with a step in flight stops there as unknown, and sends nothing', async () => {
  const plan = buildPlan(FORM, SETUP, 3)
  const mid = settleRun({ jobId: 5001, sectionId: 77, done: ['job', 'section'], inflight: 'costCentre', failed: null })
  assert.deepEqual(mid.failed, { step: 'costCentre', message: mid.failed.message, unknown: true })
  assert.match(mid.failed.message, /page was closed/)
  assert.equal('inflight' in mid, false)
  assert.equal(describeRun(plan, mid).state, 'partial')
  const never = settleRun({ jobId: null, sectionId: null, done: [], inflight: 'job', failed: null })
  assert.equal(describeRun(plan, never).state, 'unsure')
  assert.deepEqual(settleRun({ jobId: 1, done: ['job'], failed: null }), { jobId: 1, done: ['job'], failed: null })
  assert.equal(settleRun(null), null)
})
