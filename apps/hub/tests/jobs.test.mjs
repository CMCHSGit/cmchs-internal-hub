// The background-jobs list and how a job's last report is read (shared/jobs.js),
// and what a job is allowed to write about its run (shared/jobReport.mjs).
import test from 'node:test'
import assert from 'node:assert/strict'
import { JOBS, JOB_GROUPS, ago, jobHealth, jobById } from '../../../shared/jobs.js'
import { cleanMessage, reportJob } from '../../../shared/jobReport.mjs'

const MIN = 60000
const job = { id: 'x', staleMin: 30 }

test('every job has a group, a name and a time it may be quiet for, and ids are unique', () => {
  const groups = new Set(JOB_GROUPS.map(g => g.id))
  for (const j of JOBS) {
    assert.ok(groups.has(j.group), j.id)
    assert.ok(j.name && j.does && j.when, j.id)
    assert.ok(j.staleMin > 0, j.id)
  }
  assert.equal(new Set(JOBS.map(j => j.id)).size, JOBS.length)
  assert.equal(jobById('deploy').group, 'github')
})

test('health: never, ok, overdue, failing', () => {
  const now = 1_000_000_000
  assert.equal(jobHealth(job, undefined, now), 'never')
  assert.equal(jobHealth(job, {}, now), 'never')
  assert.equal(jobHealth(job, { lastRunMs: now - 5 * MIN, lastOk: true }, now), 'ok')
  assert.equal(jobHealth(job, { lastRunMs: now - 31 * MIN, lastOk: true }, now), 'overdue')
  assert.equal(jobHealth(job, { lastRunMs: now - 1 * MIN, lastOk: false }, now), 'failing')
  // a failure is shown as a failure even when it is old
  assert.equal(jobHealth(job, { lastRunMs: now - 999 * MIN, lastOk: false }, now), 'failing')
})

test('ago reads naturally', () => {
  const now = 1_000_000_000
  assert.equal(ago(0, now), 'never')
  assert.equal(ago(now - 20_000, now), 'just now')
  assert.equal(ago(now - 7 * MIN, now), '7 min ago')
  assert.equal(ago(now - 3 * 60 * MIN, now), '3 h ago')
  assert.equal(ago(now - 4 * 24 * 60 * MIN, now), '4 days ago')
})

test('a message loses the user folder in a path, extra spaces and anything past 300 characters', () => {
  assert.equal(cleanMessage('cannot open C:\\Users\\Jane Smith\\Documents\\a.xlsx'), 'cannot open C:\\Users\\…\\Documents\\a.xlsx')
  assert.equal(cleanMessage('  a   b \n c '), 'a b c')
  assert.equal(cleanMessage('x'.repeat(500)).length, 300)
  assert.equal(cleanMessage(undefined), '')
})

// A tiny stand-in for the firebase-admin Firestore: one collection, transactions run straight through.
function fakeDb() {
  const docs = new Map()
  return {
    docs,
    collection: () => ({ doc: id => ({ id }) }),
    runTransaction: async fn => fn({
      get: async ref => ({ data: () => docs.get(ref.id) }),
      set: (ref, data, opts) => docs.set(ref.id, opts?.merge ? { ...docs.get(ref.id), ...data } : data),
    }),
  }
}

test('a run is recorded: success clears the failure count, failures count up and keep the last success', async () => {
  const db = fakeDb()
  await reportJob(db, 'a', false, 'broke', 100)
  await reportJob(db, 'a', false, 'broke again', 200)
  assert.equal(db.docs.get('a').failuresInARow, 2)
  assert.equal(db.docs.get('a').lastFailureMessage, 'broke again')
  await reportJob(db, 'a', true, 'Worked', 300)
  const d = db.docs.get('a')
  assert.equal(d.failuresInARow, 0)
  assert.equal(d.lastOk, true)
  assert.equal(d.lastSuccessMs, 300)
  assert.equal(d.lastFailureMs, 200) // kept: the page still says when it last failed
})

test('reporting never throws, even when the database does', async () => {
  const db = { collection: () => ({ doc: () => ({}) }), runTransaction: async () => { throw Object.assign(new Error('nope'), { code: 'unavailable' }) } }
  const origError = console.error
  console.error = () => {}
  try { assert.equal(await reportJob(db, 'a', true, ''), false) } finally { console.error = origError }
})
