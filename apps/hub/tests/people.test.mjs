// npm test -w apps/hub — the People page's pure helpers (people.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildDirectory, cleanEmployment, cleanPrivate, completeness, isHR, placeholderId, profileKey, searchPeople, tenure,
} from '../src/people.js'

const users = [
  { uid: 'a', displayName: 'Karen Smith', team: 'Admin', email: 'Karen.Smith@cass.co.nz', workMobile: '021 555 1234' },
  { uid: 'b', displayName: 'Bryan David', team: 'Engineers', email: 'bryan.david@cass.co.nz', role: 'admin' },
  { uid: 'pending-jo-bloggs', displayName: 'Jo Bloggs', team: 'Sales', pending: true },
]

test('profileKey lower-cases the work email, and is null without one', () => {
  assert.equal(profileKey(' Karen.Smith@Cass.co.nz '), 'karen.smith@cass.co.nz')
  assert.equal(profileKey(''), null)
  assert.equal(profileKey(undefined), null)
})

test('HR is admins and people flagged hr', () => {
  assert.equal(isHR({ role: 'admin' }), true)
  assert.equal(isHR({ role: 'user', hr: true }), true)
  assert.equal(isHR({ role: 'user' }), false)
  assert.equal(isHR(null), false)
})

test('buildDirectory joins pictures by email and today by uid, sorted by name', () => {
  const dir = buildDirectory({
    users,
    photos: { 'karen.smith@cass.co.nz': 'data:image/jpeg;base64,xx' },
    today: { people: [{ uid: 'b', where: 'Remote Support', swatch: '#fff', onCall: true }] },
  })
  assert.deepEqual(dir.map(p => p.name), ['Bryan David', 'Jo Bloggs', 'Karen Smith'])
  const karen = dir.find(p => p.uid === 'a')
  assert.equal(karen.key, 'karen.smith@cass.co.nz')
  assert.equal(karen.photo, 'data:image/jpeg;base64,xx')
  assert.equal(karen.teamName, 'Admin')
  const bryan = dir.find(p => p.uid === 'b')
  assert.equal(bryan.onCall, true)
  assert.equal(bryan.where, 'Remote Support')
  assert.equal(bryan.shortName, 'Bryan')
  const jo = dir.find(p => p.uid === 'pending-jo-bloggs')
  assert.equal(jo.key, null)
  assert.equal(jo.pending, true)
})

test('buildDirectory copes with the schedule being unreadable', () => {
  const dir = buildDirectory({ users, today: null })
  assert.equal(dir.length, 3)
  assert.ok(dir.every(p => p.where === '' && !p.onCall))
})

test('search matches name, team, email and mobile digits, within chosen teams', () => {
  const dir = buildDirectory({ users })
  assert.deepEqual(searchPeople(dir, 'kar').map(p => p.uid), ['a'])
  assert.deepEqual(searchPeople(dir, 'engineers').map(p => p.uid), ['b'])
  assert.deepEqual(searchPeople(dir, 'bryan.david@').map(p => p.uid), ['b'])
  assert.deepEqual(searchPeople(dir, '5551234').map(p => p.uid), ['a'])
  assert.deepEqual(searchPeople(dir, '').map(p => p.uid).length, 3)
  assert.deepEqual(searchPeople(dir, '', ['Sales']).map(p => p.uid), ['pending-jo-bloggs'])
})

test('cleanPrivate trims, caps, drops unknown keys and empty emergency contacts', () => {
  const p = cleanPrivate({
    dateOfBirth: 'not a date', personalPhone: '  027  111 2222 ', secret: 'x',
    address: { street: ' 1  Main St ', city: 'Auckland', extra: 1 },
    emergency: [{ name: 'A', relationship: 'Partner', phone: '1' }, { name: '', phone: '' }, { name: 'C' }],
  })
  assert.equal(p.dateOfBirth, '')
  assert.equal(p.personalPhone, '027 111 2222')
  assert.equal('secret' in p, false)
  assert.deepEqual(p.address, { street: '1 Main St', suburb: '', city: 'Auckland', postcode: '' })
  assert.deepEqual(p.emergency, [{ name: 'A', relationship: 'Partner', phone: '1' }])
})

test('cleanEmployment keeps only known types and real dates', () => {
  assert.deepEqual(cleanEmployment({ jobTitle: ' Engineer ', startDate: '2020-02-03', employmentType: 'Boss', other: 1 }),
    { jobTitle: 'Engineer', startDate: '2020-02-03', employmentType: '', managerUid: '' })
})

test('tenure', () => {
  const now = new Date(2026, 9, 15) // 15 Oct 2026
  assert.equal(tenure('2023-08-01', now), '3 years 2 months')
  assert.equal(tenure('2025-10-15', now), '1 year')
  assert.equal(tenure('2026-10-01', now), 'Started this month')
  assert.equal(tenure('2026-11-01', now), '')
  assert.equal(tenure('', now), '')
})

test('completeness counts what a person fills in themselves', () => {
  assert.deepEqual(completeness({}), {
    percent: 0, missing: ['a profile picture', 'your work mobile', 'a personal phone', 'your home address', 'an emergency contact'],
  })
  const full = completeness({
    user: { workMobile: '1' }, photo: 'x',
    priv: { personalPhone: '2', address: { street: 's', city: 'c' }, emergency: [{ name: 'n', phone: 'p' }] },
  })
  assert.deepEqual(full, { percent: 100, missing: [] })
})

test('placeholder ids match the schedule Admin and Excel import', () => {
  assert.equal(placeholderId('Jo  Bloggs-Smith'), 'pending-jo-bloggs-smith')
})
