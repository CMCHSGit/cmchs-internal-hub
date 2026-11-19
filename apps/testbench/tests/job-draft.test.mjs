// npm test --prefix apps/testbench — "No job for these tests yet?" (src/jobDraft.js). Invented customers and serials only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildJobDraft, mergeDraft, serialsOf, startJobFor, readReturn, clearReturn, returnHref, DRAFT_KEY, RETURN_KEY, RETURN_MAX_AGE_MS } from '../src/jobDraft.js'
import { NO_CUSTOMER } from '../src/reports.js'

const g = (serial, model = 'TM80', customer = 'Example Hospital') => ({ serial, model, customer })
const store = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m } }

test('the title and description come from the ticked tests: one customer is named, devices are listed, plain text only', () => {
  const d = buildJobDraft([g('EX1-000101'), g('EX1-000102', 'VS9')])
  assert.equal(d.title, 'Testing of new equipment - Example Hospital')
  assert.match(d.description, /^Electrical safety and function testing of new equipment/)
  assert.match(d.description, /Devices \(2\):\nEX1-000101 - TM80\nEX1-000102 - VS9$/)
  assert.equal(buildJobDraft([g('A', 'M', 'One Hospital'), g('B', 'M', 'Two Hospital')]).title, 'Testing of new equipment', 'two customers: none named')
  assert.equal(buildJobDraft([g('A', 'M', NO_CUSTOMER)]).title, 'Testing of new equipment')
  const rough = buildJobDraft([g('A<b>', 'M\n1', 'X <y> Hospital')])
  assert.ok(!/[<>]/.test(rough.title + rough.description), 'nothing that looks like markup')
  assert.ok(buildJobDraft([g('A', 'M', 'x'.repeat(300))]).title.length <= 100, 'the title fits Simpro Jobs')
})

test('a long list is cut with a count, not sent whole', () => {
  const many = Array.from({ length: 55 }, (_, i) => g('EX-' + i))
  const d = buildJobDraft(many)
  assert.match(d.description, /Devices \(55\):/)
  assert.equal(d.description.split('\n').filter((l) => /^EX-/.test(l)).length, 40)
  assert.match(d.description, /and 15 more$/)
})

test('what is already typed is kept, a finished job starts a fresh form, an unfinished run is never touched', () => {
  const built = { title: 'T', description: 'D' }
  assert.deepEqual(mergeDraft(null, built), { draft: { form: { title: 'T', description: 'D' }, run: null }, wrote: true })
  const kept = mergeDraft({ form: { title: 'Mine', customer: { ID: 5 }, notes: 'n' } }, built)
  assert.deepEqual(kept.draft.form, { title: 'Mine', customer: { ID: 5 }, notes: 'n', description: 'D' }, 'typed title and the pickers stay; the empty description is filled in')
  const after = mergeDraft({ form: { title: 'Old', customer: { ID: 5 } }, run: { jobId: 123, done: ['job'] } }, built)
  assert.deepEqual(after.draft, { form: { title: 'T', description: 'D' }, run: null }, 'a job made earlier this session: a new form')
  const partial = { form: { title: 'Old' }, run: { jobId: 123, failed: { step: 'section' } } }
  assert.deepEqual(mergeDraft(partial, built), { draft: partial, wrote: false })
  const unsure = { form: {}, run: { inflight: 'job' } }
  assert.equal(mergeDraft(unsure, built).wrote, false)
})

test('opening the form leaves a way back that expires and is used once', () => {
  const s = store()
  const groups = [g('EX1-000101'), g('EX1-000102 + EX1-000103')]
  assert.deepEqual(serialsOf(groups), ['EX1-000101', 'EX1-000102', 'EX1-000103'], 'a set of devices is each device')
  assert.deepEqual(startJobFor(groups, s, 1000), { wrote: true })
  assert.equal(JSON.parse(s.getItem(DRAFT_KEY)).form.title, 'Testing of new equipment - Example Hospital')
  assert.deepEqual(readReturn(s, 1000 + 5000), { serials: ['EX1-000101', 'EX1-000102', 'EX1-000103'] })
  assert.equal(readReturn(s, 1000 + RETURN_MAX_AGE_MS + 1), null, 'too old')
  const href = returnHref(readReturn(s, 2000), '20871')
  assert.match(href, /^\/testbench\/\?tab=reports&serials=EX1-000101%2CEX1-000102%2CEX1-000103&unsent=1&job=20871$/)
  clearReturn(s)
  assert.equal(readReturn(s, 2000), null)
  assert.equal(s.map.has(RETURN_KEY), false)
})

test('no storage, or an unfinished run, never throws and never overwrites', () => {
  assert.deepEqual(startJobFor([g('A')], { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } }), { wrote: false })
  const s = store({ [DRAFT_KEY]: JSON.stringify({ form: { title: 'Old' }, run: { inflight: 'job' } }) })
  assert.deepEqual(startJobFor([g('A')], s), { wrote: false })
  assert.equal(JSON.parse(s.getItem(DRAFT_KEY)).form.title, 'Old')
  assert.equal(readReturn(store({ [RETURN_KEY]: 'not json' })), null)
})

import { readFileSync } from 'node:fs'
test('the draft key is the one Simpro Jobs reads; the bar offers the link and the review screen offers the way back', () => {
  const app = readFileSync(new URL('../../simprojobs/src/App.jsx', import.meta.url), 'utf8')
  const review = readFileSync(new URL('../../simprojobs/src/Review.jsx', import.meta.url), 'utf8')
  const bar = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.ok(app.includes(`const DRAFT_KEY = '${DRAFT_KEY}'`), 'the same sessionStorage key as Simpro Jobs')
  assert.ok(bar.includes('startJobFor(visible.filter((g) => chosen.has(g.base)))') && bar.includes('href="/simprojobs/"') && bar.includes('Nothing is created before that.') && bar.includes('canSimpro && picked > 0 && !job'), 'the link is only offered with Simpro access, ticked tests and no job chosen')
  assert.ok(review.includes('readReturn()') && review.includes('returnHref(back, run.jobId)') && review.includes("outcome?.state === 'done'"), 'the way back appears only once the job is made')
  assert.ok(!bar.includes('createJob') && !/POST/.test(readFileSync(new URL('../src/jobDraft.js', import.meta.url), 'utf8')), 'nothing here creates a job: it only fills in a form')
})
