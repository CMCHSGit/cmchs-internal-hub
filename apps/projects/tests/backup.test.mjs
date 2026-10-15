import { test } from 'node:test'
import assert from 'node:assert/strict'
import { makeBackup, readBackup, restorePlan, stable, backupFileName } from '../src/backup.js'
import { SAMPLE_JOBS, SAMPLE_ASSIGNMENTS, SAMPLE_COMMENTS } from '../src/sample.js'

const now = () => ({
  jobs: SAMPLE_JOBS.map((j) => ({ ...j })),
  assignments: SAMPLE_ASSIGNMENTS.map((a) => ({ ...a })),
  comments: SAMPLE_COMMENTS.map((c) => ({ ...c })),
  history: [{ id: 'h1', jobId: 'sample-hinz', who: 'Someone', uid: 'u1', what: 'created this job', atMs: 1 }],
  settings: { staff: [{ id: 's1', name: 'Sam Lee', initials: 'SL' }], askOnComplete: true },
})
const snap = (data) => JSON.parse(JSON.stringify(makeBackup(data, { takenAt: '2026-10-15T14:00:00.000Z', source: 'nightly' })))

test('a backup holds every record by id, without the id inside', () => {
  const b = snap(now())
  assert.equal(b.kind, 'project-tracker-backup')
  assert.equal(Object.keys(b.collections.projectJobs).length, SAMPLE_JOBS.length)
  assert.equal(b.collections.projectJobs['sample-hinz'].name, SAMPLE_JOBS.find((j) => j.id === 'sample-hinz').name)
  assert.equal(b.collections.projectJobs['sample-hinz'].id, undefined)
  assert.deepEqual(b.collections.projectSettings.main.staff[0].initials, 'SL')
  assert.equal(backupFileName(b), 'Project-Tracker-2026-10-15.json')
  assert.equal(backupFileName({ ...b, source: 'before-restore' }), 'Project-Tracker-2026-10-15-before-restore.json')
})

test('readBackup turns away anything that is not a backup, with a reason', () => {
  assert.throws(() => readBackup({ kind: 'project-tracker-import' }), /import file/)
  assert.throws(() => readBackup({ foo: 1 }), /not a project tracker backup/)
  assert.throws(() => readBackup({ kind: 'project-tracker-backup', version: 2, collections: {} }), /newer version/)
  const r = readBackup({ kind: 'project-tracker-backup', version: 1, collections: { projectJobs: { a: { name: 'x' } } } })
  assert.deepEqual(r.collections.projectAssignments, {})
})

test('restoring the backup you just took changes nothing', () => {
  const data = now()
  const { main, append, summary } = restorePlan(readBackup(snap(data)), data, 'exact')
  assert.equal(main.length + append.length, 0)
  assert.equal(summary.changes, 0)
  assert.equal(summary.settingsChanged, false)
})

test('field order does not count as a change', () => {
  assert.equal(stable({ a: 1, b: [{ y: 2, x: 1 }] }), stable({ b: [{ x: 1, y: 2 }], a: 1 }))
  assert.notEqual(stable({ a: 1 }), stable({ a: 2 }))
})

test('put back: deleted and edited jobs come back, new ones stay', () => {
  const before = now()
  const b = readBackup(snap(before))
  const after = now()
  after.jobs = after.jobs.filter((j) => j.id !== 'sample-hinz') // deleted since
  after.jobs.find((j) => j.id === 'sample-hutt').status = 'Complete' // edited since
  after.jobs.push({ id: 'new-job', name: 'Added after the backup' }) // added since
  after.assignments = after.assignments.slice(1) // a week removed
  after.comments = [] // comments lost
  after.settings = { ...after.settings, askOnComplete: false }

  const merge = restorePlan(b, after, 'merge')
  assert.deepEqual(merge.summary.jobs, { inBackup: SAMPLE_JOBS.length, missing: 1, changed: 1, added: 1, removed: 0 })
  assert.equal(merge.summary.assignments.missing, 1)
  assert.equal(merge.summary.comments.missing, SAMPLE_COMMENTS.length)
  assert.ok(merge.summary.settingsChanged)
  assert.ok(merge.main.some((o) => o.op === 'set' && o.col === 'jobs' && o.id === 'sample-hinz'))
  assert.ok(merge.main.some((o) => o.op === 'set' && o.col === 'jobs' && o.id === 'sample-hutt' && o.data.status !== 'Complete'))
  assert.ok(merge.main.some((o) => o.col === 'settings' && o.id === 'main' && o.data.askOnComplete === true))
  assert.ok(!merge.main.some((o) => o.op === 'delete'))
  // Comments go in their own list (the rules treat them differently)
  assert.equal(merge.append.length, SAMPLE_COMMENTS.length)
  assert.ok(merge.append.every((o) => o.col === 'comments' && o.op === 'set'))

  const exact = restorePlan(b, after, 'exact')
  assert.deepEqual(exact.main.filter((o) => o.op === 'delete'), [{ op: 'delete', col: 'jobs', id: 'new-job' }])
  assert.equal(exact.summary.jobs.removed, 1)
})

test('comments and history are never removed or rewritten, even when restoring exactly', () => {
  const before = now()
  const b = readBackup(snap(before))
  const after = now()
  after.comments.push({ id: 'later', jobId: 'sample-hinz', text: 'after the backup', uid: 'u2' })
  after.history[0].what = 'edited somehow'
  after.history.push({ id: 'h2', jobId: 'sample-hinz', what: 'later', uid: 'u2' })
  const { main, append, summary } = restorePlan(b, after, 'exact')
  assert.equal(append.length, 0)
  assert.ok(!main.some((o) => o.col === 'comments' || o.col === 'history'))
  assert.equal(summary.comments.added, 1)
  assert.equal(summary.comments.removed, 0)
  assert.equal(summary.history.changed, 0)
})

test('an empty tracker gets everything back', () => {
  const b = readBackup(snap(now()))
  const { main, append, summary } = restorePlan(b, { jobs: [], assignments: [], comments: [], history: [], settings: null }, 'merge')
  assert.equal(summary.jobs.missing, SAMPLE_JOBS.length)
  assert.equal(main.filter((o) => o.col === 'jobs').length, SAMPLE_JOBS.length)
  assert.equal(append.length, SAMPLE_COMMENTS.length + 1)
  assert.ok(summary.settingsChanged)
})
