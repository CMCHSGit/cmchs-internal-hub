// npm test -w apps/schedule — the hub's activity log's plain parts (shared/activity-core.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appOfPath, appLabel, buildEntry, filterEntries, peopleIn, nzStamp, entriesToCsv, atMs, MAX_SUMMARY } from '../../../shared/activity-core.js'

test('the tool is read from the page address; the hub and anything unknown are the hub', () => {
  assert.equal(appOfPath('/equipment/'), 'equipment')
  assert.equal(appOfPath('/service-orders/#/x'), 'service-orders')
  assert.equal(appOfPath('/projects/?job=1'), 'projects')
  assert.equal(appOfPath('/'), 'hub')
  assert.equal(appOfPath('/index.html'), 'hub')
  assert.equal(appOfPath('/something-new/'), 'hub')
  assert.equal(appLabel('oncall'), 'On call')
  assert.equal(appLabel('odd'), 'odd')
})

test('an entry is the signed-in person, one line of words, and a tool; nothing without both', () => {
  const user = { uid: 'u1', displayName: 'Bob Sales', email: 'bob@cass.co.nz' }
  assert.deepEqual(buildEntry(user, null, '  Moved   a job\nlater ', {}, '/projects/'), { uid: 'u1', name: 'Bob Sales', email: 'bob@cass.co.nz', summary: 'Moved a job later', app: 'projects' })
  assert.equal(buildEntry(user, null, 'x', { app: 'asks' }, '/projects/').app, 'asks', 'an explicit tool wins')
  assert.equal(buildEntry(user, { displayName: 'Ann A', email: 'ann@cass.co.nz' }, 'x').name, 'Ann A', 'a name given for the line')
  assert.equal(buildEntry(user, 'a string', 'x').name, 'Bob Sales', 'a string is not a person')
  assert.equal(buildEntry(null, null, 'x'), null, 'nobody signed in')
  assert.equal(buildEntry(user, null, '   '), null, 'no words')
  const long = buildEntry(user, null, 'x'.repeat(900))
  assert.equal(long.summary.length, MAX_SUMMARY)
  assert.ok(long.summary.endsWith('…'))
  assert.ok(MAX_SUMMARY <= 500, 'inside what the rules allow')
})

const rows = [
  { id: '1', name: 'Bob Sales', email: 'bob@cass.co.nz', app: 'projects', summary: 'Waikato: moved the job later', at: new Date('2026-10-30T01:05:00Z') },
  { id: '2', name: 'Ann Admin', email: 'ann@cass.co.nz', app: 'equipment', summary: 'Loan for Hutt extended' },
  { id: '3', name: 'Ann Admin', email: 'ann@cass.co.nz', summary: 'Saved her week' }, // from before tools were recorded
]
test('filter by tool, person and words; old lines count as the schedule', () => {
  assert.deepEqual(filterEntries(rows, {}).map((e) => e.id), ['1', '2', '3'])
  assert.deepEqual(filterEntries(rows, { app: 'projects' }).map((e) => e.id), ['1'])
  assert.deepEqual(filterEntries(rows, { app: 'schedule' }).map((e) => e.id), ['3'])
  assert.deepEqual(filterEntries(rows, { who: 'ann@cass.co.nz' }).map((e) => e.id), ['2', '3'])
  assert.deepEqual(filterEntries(rows, { text: ' HUTT ' }).map((e) => e.id), ['2'])
  assert.deepEqual(filterEntries(rows, { text: 'bob' }).map((e) => e.id), ['1'], 'the name is searched too')
  assert.deepEqual(peopleIn(rows), [{ id: 'ann@cass.co.nz', name: 'Ann Admin' }, { id: 'bob@cass.co.nz', name: 'Bob Sales' }])
})

test('times are New Zealand time, from a Firestore timestamp or a date', () => {
  assert.equal(atMs({ at: { toMillis: () => 5 } }), 5)
  assert.equal(atMs({ at: new Date('2026-10-30T01:05:00Z').getTime() }), Date.parse('2026-10-30T01:05:00Z'))
  assert.equal(atMs({}), 0)
  assert.equal(nzStamp(Date.parse('2026-10-30T01:05:00Z')), '2026-10-30 14:05', 'NZDT is UTC+13')
  assert.equal(nzStamp(Date.parse('2026-07-01T00:00:00Z')), '2026-07-01 12:00', 'NZST is UTC+12')
  assert.equal(nzStamp(0), '')
})

test('the CSV: a header, quoted commas and quotes, and no cell Excel would run as a formula', () => {
  const csv = entriesToCsv([
    { name: 'Bob', email: 'b@cass.co.nz', app: 'projects', summary: 'Said "hi", then left', at: { toMillis: () => Date.parse('2026-10-30T01:05:00Z') } },
    { name: 'Eve', email: '', app: 'asks', summary: '=HYPERLINK("http://evil")' },
  ])
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n')
  assert.equal(lines[0], 'When (NZ),Who,Email,Tool,What')
  assert.equal(lines[1], '2026-10-30 14:05,Bob,b@cass.co.nz,Projects,"Said ""hi"", then left"')
  assert.ok(lines[2].includes(`'=HYPERLINK`), 'neutralised')
  assert.ok(csv.startsWith('﻿'), 'a byte-order mark so Excel reads the dashes and macrons')
})
