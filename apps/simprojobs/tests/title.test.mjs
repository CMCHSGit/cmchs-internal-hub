// A job's title (Simpro's "Name"): made with the job, changed later, and what the relay accepts for it.
// Run: cd apps/simprojobs && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { buildEditPlan, normaliseJob } from '../src/manage.js'
import { buildPlan, jobBody, runPlan } from '../src/plan.js'
import { makeCall } from '../../testbench/src/simpro-api.js'

const FORM = {
  customer: { ID: 12, kind: 'companies', name: 'Example Hospital' }, site: { id: 34, name: 'Theatre 1' }, costCentre: { id: 15, name: 'Service' },
  jobType: { id: 'Repair', name: 'Repair' }, chargeCategory: { id: 'Warranty', name: 'Warranty' }, priority: { id: 'Standard', name: 'Standard' },
  title: 'Monitor will not power on', description: 'Fault', notes: '',
}
const SETUP = { jobType: { field: { id: 44, name: 'Job Type' } }, chargeCategory: { field: { id: 45, name: 'Charge category - CHS' } }, priority: { field: { id: 46, name: 'Priority' } } }

const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
const J = JSON.stringify
function relay(jobs = {}) {
  const answer = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) })
  const sandbox = vm.createContext({
    console, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'k' }) },
    CacheService: { getScriptCache: () => ({ get: () => null, put() {} }) },
    UrlFetchApp: { fetch(url) { const m = url.match(/\/jobs\/(\d+)$/); return m && jobs[m[1]] ? answer(200, jobs[m[1]]) : answer(404, {}) } },
  })
  vm.runInContext(source, sandbox)
  return {
    create: (body) => vm.runInContext(`simproSyncJobWriteError_('post', '/companies/3/jobs/', ${J(body)}, 1)`, sandbox),
    patch: (body) => vm.runInContext(`simproSyncJobPatchError_(${J(body)})`, sandbox),
    scope: (id, body) => vm.runInContext(`simproJobsScopeError_('patch', '/companies/3/jobs/${id}', {uid:'u'}, ${J(body)})`, sandbox),
  }
}

test('a new job carries its title as the job’s Name, cleaned, and the review shows it', () => {
  assert.equal(jobBody({ ...FORM, title: '  Monitor   will\nnot power on ' }).Name, 'Monitor will not power on')
  const plan = buildPlan(FORM, SETUP, 3)
  assert.deepEqual(plan[0].facts[2], ['Title', 'Monitor will not power on'])
  assert.equal(plan[0].request().body.Name, 'Monitor will not power on')
  assert.throws(() => buildPlan({ ...FORM, title: '' }, SETUP, 3), /Still to fill in: Title/)
  assert.throws(() => buildPlan({ ...FORM, title: 'a <b> c' }, SETUP, 3), /can’t contain < or >/)
  assert.throws(() => buildPlan({ ...FORM, title: 'x'.repeat(101) }, SETUP, 3), /up to 100 characters/)
})

test('the relay takes a plain one-line title on a new job, and refuses anything else', () => {
  const r = relay()
  const good = { Type: 'Service', Customer: 12, Site: 34, Description: '<p>Fault</p>' }
  assert.equal(r.create({ ...good, Name: 'Monitor will not power on' }), '')
  assert.equal(r.create({ ...good, Name: 'Défibrillateur — Māori Health & Co. "x"' }), '')
  assert.equal(r.create({ ...good, Name: 'x'.repeat(100) }), '')
  assert.equal(r.create(good), '')   // a title is not forced by the relay: the page requires it
  for (const bad of ['', '   ', '<b>x</b>', 'a > b', 'a\nb', 'a\tb', 'a\u0000b', 'x'.repeat(101), 5, null, {}, ['x']]) assert.match(r.create({ ...good, Name: bad }), /title that is not one line of plain text/, J(bad))
})

test('an existing job’s title can be set by the job update, as plain text only', () => {
  const r = relay()
  assert.equal(r.patch({ Name: 'New title' }), '')
  assert.equal(r.patch({ Name: 'New title', Notes: 'n' }), '')
  for (const bad of ['', ' ', '<i>x</i>', 'a\nb', 'x'.repeat(101), 5, null, {}]) assert.match(r.patch({ Name: bad }), /title that is not one line of plain text/, J(bad))
  assert.notEqual(r.patch({ Name: 'x', Customer: 5 }), '')   // nothing else new
})

test('a title is only changed on a job that is not yet invoiced or archived', () => {
  const r = relay({ 1: { Stage: 'Pending' }, 2: { Stage: 'Progress' }, 3: { Stage: 'Complete' }, 4: { Stage: 'Invoiced' }, 5: { Stage: 'Archived' } })
  for (const id of [1, 2, 3]) assert.equal(r.scope(id, { Name: 'New title' }), '', 'job ' + id)
  for (const id of [4, 5]) assert.match(r.scope(id, { Name: 'New title' }), /description or title can no longer be changed here/, 'job ' + id)
  assert.match(r.scope(9, { Name: 'x' }), /could not show \(404\)/)
  // A title together with a description is held to the description rule too.
  const jobs = relay({ 1: { Stage: 'Pending', Description: '<p>old</p>' } })
  assert.equal(jobs.scope(1, { Name: 'T', Description: '<p>old</p><p>more</p>' }), '')
  assert.match(jobs.scope(1, { Name: 'T', Description: '<p>replaced</p>' }), /other than by adding to the end/)
})

test('editing: a changed title is its own step, shown from → to; an unchanged or unusable title is not', async () => {
  const job = normaliseJob({ ID: 102, Name: 'Defib repair', Description: 'x', Notes: '', Stage: 'Pending', Customer: { ID: 1 }, Status: { ID: 3, Name: 'Job : New' } })
  const plan = buildEditPlan({ job, changes: { title: '  Defib   repair - ward 4 ' }, setup: SETUP, companyId: 3 })
  assert.deepEqual(plan.map((s) => s.id), ['title'])
  assert.deepEqual(plan[0].facts, [['Title', 'Defib repair → Defib repair - ward 4']])
  const writes = []
  const fetchFn = async (_u, init) => { const { requests } = JSON.parse(init.body); writes.push(requests[0]); return { status: 200, json: async () => ({ success: true, results: [{ status: 204, data: null }] }) } }
  const run = await runPlan(makeCall({ getToken: async () => 't', proxyUrl: 'x', fetchFn }), plan, {}, () => {}, {})
  assert.equal(run.failed, null)
  assert.deepEqual(writes.map((w) => [w.method, w.path, w.body]), [['PATCH', '/companies/3/jobs/102', { Name: 'Defib repair - ward 4' }]])
  assert.equal(relay({ 102: { Stage: 'Pending' } }).scope(102, writes[0].body), '')
  // The same title (spacing aside) is no change; a cleared one, or one with markup or too long, is refused in words.
  assert.throws(() => buildEditPlan({ job, changes: { title: ' Defib  repair ' }, setup: SETUP, companyId: 3 }), /Nothing to change yet/)
  assert.throws(() => buildEditPlan({ job, changes: { title: '   ' }, setup: SETUP, companyId: 3 }), /title can’t be empty/)
  assert.throws(() => buildEditPlan({ job, changes: { title: '<b>x</b>' }, setup: SETUP, companyId: 3 }), /can’t contain < or >/)
  assert.throws(() => buildEditPlan({ job, changes: { title: 'x'.repeat(101) }, setup: SETUP, companyId: 3 }), /up to 100 characters/)
  // A job with no title yet can be given one.
  const bare = normaliseJob({ ID: 7, Name: '', Description: 'x', Stage: 'Progress', Customer: { ID: 1 } })
  assert.deepEqual(buildEditPlan({ job: bare, changes: { title: 'Pump check' }, setup: SETUP, companyId: 3 })[0].facts, [['Title', 'none → Pump check']])
})

test('a title with hidden direction marks or line separators is refused by the relay, and the page says why', () => {
  const r = relay()
  const good = { Type: 'Service', Customer: 12, Site: 34, Description: '<p>Fault</p>' }
  for (const bad of ['a\u2028b', 'a\u2029b', 'a\u202eb', 'a\u200fb', 'a\u200eb', 'a\u2066b', 'a\u2069b']) {
    assert.match(r.create({ ...good, Name: bad }), /title that is not one line of plain text/, JSON.stringify(bad))
    assert.match(r.patch({ Name: bad }), /title that is not one line of plain text/, JSON.stringify(bad))
  }
  assert.equal(r.create({ ...good, Name: 'Māori — Défibrillateur 日本語' }), '') // ordinary unicode is fine
})

test('the page refuses hidden text-direction characters in a title and says why, and still takes ordinary unicode', async () => {
  const { titleProblem, cleanTitle } = await import('../src/draft.js')
  const rtl = String.fromCharCode(0x202e)
  const sep = String.fromCharCode(0x2028)
  assert.match(titleProblem('abc' + rtl + 'def'), /hidden text-direction characters/)
  assert.equal(titleProblem('Māori Health — 日本語'), '')
  assert.equal(cleanTitle('a' + sep + 'b'), 'a b') // a line separator is just a space once cleaned
})
