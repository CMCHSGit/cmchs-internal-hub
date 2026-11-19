// npm test --prefix apps/testbench — Previous tests as one list (src/reports.js: localGroups, withResult). Invented serials and customers only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupReports, localGroups, sharedGroups, withResult, NO_CUSTOMER } from '../src/reports.js'

const T1 = '2026-11-05T01:00:00.000Z', T2 = '2026-11-06T01:00:00.000Z', T3 = '2026-11-07T01:00:00.000Z', T4 = '2026-11-08T01:00:00.000Z'
const run = (id, started, over = {}) => ({ id, started, finished: started, overall: 'pass', inProgress: false, imported: false, template: 'Mindray TM80', serial: 'EX1-' + id, model: 'TM80', customer: 'Example Hospital', ...over })
const file = (name, testedAt, serial) => ({ id: name, name, mime: '', buffer: new ArrayBuffer(1), size: 1, savedAt: 1, sent: [], meta: { customer: 'Example Hospital', serial, model: 'TM80', template: 'Mindray TM80', testedAt } })

test('a test only on this laptop is listed; one with a saved file or already shared is not listed twice', () => {
  const reports = [file('EX1-a - TM80 05.11.2026.pdf', T1, 'EX1-a')]
  const shared = [{ id: 'sh1', started: T2, finished: T2, overall: 'fail', serial: 'EX1-b', template: 'Mindray TM80', customer: 'Example Hospital', by: 'x@example.com', byName: 'X', size: 5 }]
  const runs = [run('a', T1), run('sh1', T2), run('c', T3), run('d', T4, { inProgress: true, overall: 'pass', finished: '', customer: '' })]
  const got = localGroups(runs, reports, shared)
  assert.deepEqual(got.map((g) => g.runId), ['c', 'd'])
  const d = got[1]
  assert.equal(d.base, 'local:d')
  assert.equal(d.local, true)
  assert.equal(d.inProgress, true)
  assert.equal(d.overall, 'incomplete', 'a test in progress is not a pass')
  assert.equal(d.customer, NO_CUSTOMER)
  assert.deepEqual(d.files, [])
})

test('every test shows how it came out, and which test the bench can open', () => {
  const reports = [file('EX1-a - TM80 05.11.2026.pdf', T1, 'EX1-a'), file('Added - by hand.pdf', '', 'Z9')]
  const shared = [{ id: 'sh1', started: T2, finished: T2, overall: 'fail', serial: 'EX1-b', template: 'T', customer: 'Example Hospital', by: 'x@example.com', byName: 'X', size: 5 }]
  const runs = [run('a', T1, { overall: 'pass' }), run('c', T3, { imported: true })]
  const groups = [...groupReports(reports), ...sharedGroups(reports, shared), ...localGroups(runs, reports, shared)]
  const by = Object.fromEntries(withResult(groups, runs, shared).map((g) => [g.serial, g]))
  assert.equal(by['EX1-a'].overall, 'pass')
  assert.equal(by['EX1-a'].openId, 'a', 'a file made by a test the bench has: it opens that test')
  assert.equal(by['EX1-b'].overall, 'fail')
  assert.equal(by['EX1-b'].openId, 'sh1', 'a shared test: the bench fetches it')
  assert.equal(by['EX1-c'].openId, 'c')
  assert.equal(by['EX1-c'].imported, true, 'an Ansur record has no new record to make')
  assert.equal(by.Z9.openId, '', 'a file added by hand has no test to open')
  assert.equal(by.Z9.overall, '')
})
