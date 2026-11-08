// Run: npm test -w apps/simprosearch   (invented jobs only)
import test from 'node:test'
import assert from 'node:assert/strict'
import { PER_FILE, ZIP_ABOVE, buildFiles, recordOf, toCsv, toMarkdown } from '../src/export.js'
import { completeJobs } from '../src/search.js'
import { makeCall } from '../../testbench/src/simpro-api.js'

const JOB = {
  ID: 101, Name: 'Monitor  check', Stage: 'Complete', Status: { ID: 3, Name: 'Job : Completed' }, DateIssued: '2026-10-07T00:00:00+13:00',
  Description: '<p>Check unit <b>XX-1001</b></p><script>alert(1)</script><ul><li>Part 115-000123-00</li></ul>',
  Notes: '<div>Replaced battery.<br>## not a heading</div>',
  Customer: { CompanyName: 'Example Hospital' }, Site: { ID: 7, Name: 'Ward 4' },
}

test('a job becomes plain text: title, description and notes, no markup and no customer by default', () => {
  const r = recordOf(JOB)
  assert.deepEqual(Object.keys(r), ['job', 'title', 'stage', 'status', 'issued', 'description', 'notes'])
  assert.equal(r.description, 'Check unit XX-1001\nPart 115-000123-00')
  assert.equal(r.notes, 'Replaced battery.\n## not a heading')
  assert.equal(r.issued, '2026-10-07')
  assert.ok(!JSON.stringify(r).includes('Example Hospital') && !JSON.stringify(r).includes('Ward 4'))
  assert.ok(!JSON.stringify(r).includes('alert'))
})

test('customer and site are added only when asked for', () => {
  const r = recordOf(JOB, { people: true })
  assert.equal(r.customer, 'Example Hospital')
  assert.equal(r.site, 'Ward 4')
})

test('markdown has one section per job and a job’s own headings can’t break it', () => {
  const md = toMarkdown([recordOf(JOB)], { stamp: '2026-11-10', searched: 'A9' })
  assert.ok(md.startsWith('# Simpro jobs export\n\nJobs: 1\nExported: 2026-11-10\nSearch: A9\n'))
  assert.ok(md.includes('## Job 101: Monitor check\nStage: Complete | Status: Job : Completed | Issued: 2026-10-07\n\n### Description\nCheck unit XX-1001'))
  assert.ok(md.includes('\\## not a heading'))
  assert.equal((md.match(/^## Job /gm) || []).length, 1)
  assert.ok(!md.includes('Customer:'))
  assert.ok(toMarkdown([recordOf(JOB, { people: true })]).includes('Customer: Example Hospital | Site: Ward 4'))
})

test('a job with nothing written says so', () => {
  const md = toMarkdown([recordOf({ ID: 5 })])
  assert.ok(md.includes('### Description\n(none)') && md.includes('### Notes\n(none)'))
})

test('csv quotes commas, quotes and lines, and stops formulas', () => {
  const csv = toCsv([{ job: 1, title: '=SUM(A1)', description: 'a, "b"\nc', notes: '' }])
  assert.ok(csv.startsWith('﻿job,title,description,notes\r\n'))
  assert.ok(csv.includes("1,'=SUM(A1),\"a, \"\"b\"\"\nc\","))
})

test('json carries every job', () => {
  const [f] = buildFiles([recordOf(JOB)], { format: 'json', stamp: '2026-11-10' })
  const parsed = JSON.parse(f.text)
  assert.equal(parsed.count, 1)
  assert.equal(parsed.jobs[0].job, 101)
  assert.equal(f.name, 'simpro-jobs-2026-11-10.json')
})

test('a long list is split into files of a readable size', () => {
  const many = Array.from({ length: ZIP_ABOVE + 1 }, (_, i) => ({ job: i + 1, title: 't', stage: '', status: '', issued: '', description: 'd', notes: 'n' }))
  const files = buildFiles(many, { format: 'md', stamp: '2026-11-10' })
  assert.equal(files.length, Math.ceil(many.length / PER_FILE))
  assert.equal(files[0].name, 'simpro-jobs-2026-11-10-part-1.md')
  assert.ok(files[0].text.includes('(part 1 of 2)'))
  assert.equal(buildFiles(many.slice(0, ZIP_ABOVE), { format: 'md' }).length, 1)
})

// A pretend Simpro that holds the whole job.
function fake(opts = {}) {
  const seen = []
  const fetchFn = async (_u, init) => {
    const { method, path } = JSON.parse(init.body).requests[0]
    seen.push({ method, path })
    const id = +path.split('/').pop()
    const status = opts.fail?.includes(id) ? 500 : 200
    return { status: 200, json: async () => ({ success: true, results: [{ status, data: { ID: id, Description: 'full ' + id, Notes: 'notes ' + id } }] }) }
  }
  return { call: makeCall({ getToken: async () => 't', proxyUrl: 'http://proxy.test/exec', fetchFn }), seen }
}

test('only jobs missing their notes are read again, with a progress count', async () => {
  const { call, seen } = fake()
  const progress = []
  const rows = [{ ID: 1, Description: 'a', Notes: 'b' }, { ID: 2, Description: 'a' }, { ID: 3, Name: 'x' }]
  const { jobs, failed } = await completeJobs(call, 3, rows, { onProgress: (d, t) => progress.push([d, t]) })
  assert.deepEqual(seen.map((s) => s.path).sort(), ['/companies/3/jobs/2', '/companies/3/jobs/3'])
  assert.ok(seen.every((s) => s.method === 'GET'))
  assert.equal(jobs[0].Notes, 'b')
  assert.equal(jobs[1].Notes, 'notes 2')
  assert.equal(jobs[2].Name, 'x') // what the row had is kept
  assert.equal(failed, 0)
  assert.deepEqual(progress.at(-1), [2, 2])
})

test('a job Simpro won’t give is counted, not fatal; stopping stops', async () => {
  const { call } = fake({ fail: [2] })
  const r = await completeJobs(call, 3, [{ ID: 2 }, { ID: 3 }])
  assert.equal(r.failed, 1)
  assert.equal(r.jobs[1].Notes, 'notes 3')
  const { call: c2, seen } = fake()
  let stop = false
  const out = await completeJobs(c2, 3, [{ ID: 1 }, { ID: 2 }, { ID: 3 }, { ID: 4 }, { ID: 5 }, { ID: 6 }], { concurrency: 1, onProgress: (d) => { if (d >= 2) stop = true }, isCancelled: () => stop })
  assert.equal(out.cancelled, true)
  assert.ok(seen.length < 6)
})
