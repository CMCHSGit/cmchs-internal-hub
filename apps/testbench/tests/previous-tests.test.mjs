// npm test --prefix apps/testbench — the bar under the bench speaks of a test by its start time (src/reports.js: startedOf, statusByStart). Invented serials only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { groupReports, sharedGroups, startedOf, statusByStart } from '../src/reports.js'

const T1 = '2026-11-05T01:00:00.000Z', T2 = '2026-11-06T01:00:00.000Z'
const file = (name, testedAt, serial, sent = []) => ({ id: name, name, mime: '', buffer: new ArrayBuffer(1), size: 1, savedAt: 1, sent, meta: { customer: 'Example Hospital', serial, model: 'TM80', template: 'Mindray TM80', testedAt } })

test('a test is told apart by its start time, in a saved file and in a shared test alike', () => {
  const reports = [file('EX1-a - TM80 05.11.2026.pdf', T1, 'EX1-a')]
  const shared = [{ id: 'sh1', started: T2, finished: T2, overall: 'pass', serial: 'EX1-b', template: 'T', customer: 'Example Hospital', by: 'x@example.com', byName: 'X', size: 5 }]
  const groups = [...groupReports(reports), ...sharedGroups(reports, shared)]
  assert.deepEqual(groups.map(startedOf).sort(), [T1, T2])
  assert.equal(startedOf({ files: [] }), '')
})

test('what the bench shows beside each test: sent to which job, or downloaded', () => {
  const reports = [file('EX1-a - TM80 05.11.2026.pdf', T1, 'EX1-a', [{ job: '20871', at: 1 }]), file('EX1-c - TM80 06.11.2026.pdf', T2, 'EX1-c')]
  const map = statusByStart(groupReports(reports))
  assert.deepEqual(map[T1], { sent: ['20871'], downloaded: false })
  assert.deepEqual(map[T2], { sent: [], downloaded: false })
})
