// npm test -w apps/hub — checks the home page reads the schedule the
// same way the schedule does. buildToday() is pure, so no Firestore needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildToday } from '../src/today.js'

const users = [
  { uid: 'a', displayName: 'Karen Smith', team: 'Admin' },
  { uid: 'b', displayName: 'Bryan David', team: 'Engineers' },
  { uid: 'c', displayName: 'Theresa Lee', team: 'Sales' },
  { uid: 'd', displayName: 'Paul Ng', team: 'Application' },
  { uid: 'e', displayName: 'Jan Brown', team: 'Admin' },
  { uid: 'f', displayName: 'Fiona Gray', team: 'Admin' },
  { uid: 'g', displayName: 'Nobody Yet', team: 'Sales' },
]
const week = loc => ({ days: [0, 1, 2, 3, 4].map(() => ({ location: loc })) })
const schedules = {
  a: week('Cass Office'), b: week('Remote Support'), c: week('Tauranga'),
  d: week('Work from Home'), e: week('Annual Leave'), f: week('Non-Working Days'),
}
const WED = new Date(2026, 9, 14) // Wednesday 14 Oct 2026

test('groups people the way the schedule reads their entries', () => {
  const t = buildToday({ users, schedules, oncall: { uid: 'b', displayName: 'Bryan David', calls: ['', '', 'a', '', ''] }, now: WED })
  const g = Object.fromEntries(t.glance.map(x => [x.key, x.people.map(p => p.name).sort()]))
  assert.deepEqual(g.office, ['Karen'])              // customer calls cover still counts as in the office
  assert.deepEqual(g.site, ['Theresa'])
  assert.deepEqual(g.remote, ['Bryan', 'Paul'])
  assert.deepEqual(g.out, ['Fiona', 'Jan'])
  assert.equal(t.onCallName, 'Bryan')
  assert.equal(t.weekend, false)
  assert.equal(t.people.find(p => p.name === 'Karen').swatch, '#FFFF00') // customer calls colour
  assert.equal(t.people.find(p => p.name === 'Nobody').where, 'No entry')
  assert.equal(t.people.find(p => p.name === 'Theresa').where, 'Tauranga')
  assert.equal(t.people.find(p => p.name === 'Paul').deptName, 'Applications')
})

test('on a weekend it shows Monday', () => {
  const t = buildToday({ users, schedules, oncall: null, now: new Date(2026, 9, 17) }) // Saturday
  assert.equal(t.weekend, true)
  assert.equal(t.dayName, 'Monday')
  assert.equal(t.weekStart, '2026-10-19')
  assert.equal(t.onCallName, '')
})

test('a public holiday with no entry reads as the holiday, not "No entry"', () => {
  const t = buildToday({ users, schedules: {}, oncall: null, now: new Date(2026, 9, 26) }) // Labour Day
  assert.equal(t.holiday, 'Labour Day')
  assert.equal(t.people[0].where, 'Labour Day')
})
