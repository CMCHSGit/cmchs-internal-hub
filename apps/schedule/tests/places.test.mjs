// Run with `npm test`. Covers Who's where by place: each place with its people and days, from the same entries Team week reads.
// Names and places are made up or public place names; never put real staff data in this repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { filterPlaces, placesInWeek } from '../src/utils/places.js'

const weekStart = '2026-10-12' // a Monday, no public holiday that week
const users = [{ uid: 'a', displayName: 'Ana', team: 'Engineers' }, { uid: 'b', displayName: 'Ben', team: 'Sales' }, { uid: 'c', displayName: 'Cat', team: 'Engineers' }]
const names = new Map(users.map(u => [u.uid, u.displayName]))
const week = (...places) => ({ days: places.map(location => ({ location })) })
const schedules = {
  a: week('Waikato Hospital', 'Waikato Hospital', 'Cass Office', 'Annual Leave', 'Starship / Cass Office'),
  b: week('waikato  hospital', 'Remote Support', 'Work from Home', 'Starship', 'Starship'),
  c: week('Cass Office', 'Cass Office', 'Cass Office', 'EAS training', 'Non-Working Day'),
}
const at = (places, name) => places.find(p => p.place.toLowerCase().replace(/\s+/g, ' ') === name)

test('places away from the office, biggest first, with the days each person is there', () => {
  const places = placesInWeek({ weekStart, users, schedules, names })
  assert.deepEqual(places.map(p => p.key), ['starship', 'waikato hospital', 'eas training'])
  assert.deepEqual(at(places, 'waikato hospital').people.map(p => [p.name, p.days]), [['Ana', [0, 1]], ['Ben', [0]]])
  assert.deepEqual(at(places, 'starship').people.map(p => [p.name, p.days]), [['Ana', [4]], ['Ben', [3, 4]]], 'a day with two places counts for each')
  assert.equal(at(places, 'eas training').away, true)
})

test('"every place" adds the office, remote support and working from home, never leave or non-working days', () => {
  const places = placesInWeek({ weekStart, users, schedules, names, all: true })
  const keys = places.map(p => p.key)
  assert.ok(keys.includes('cass office') && keys.includes('remote support') && keys.includes('work from home'))
  assert.ok(!keys.some(k => /leave|non-working/.test(k)))
  assert.equal(at(places, 'cass office').away, false)
  assert.deepEqual(at(places, 'cass office').people.map(p => p.name), ['Ana', 'Cat'])
})

test('customer calls and a public holiday are not places', () => {
  const oncall = { calls: ['a', 'a', '', '', ''] }
  const holiday = placesInWeek({ weekStart: '2026-10-26', users, names, schedules: { a: week('Labour Day', 'Waikato Hospital', '', '', '') }, oncall, all: true })
  assert.deepEqual(holiday.map(p => p.key), ['waikato hospital'])
})

test('the filter matches every typed word against the place name', () => {
  const places = placesInWeek({ weekStart, users, schedules, names })
  assert.deepEqual(filterPlaces(places, 'waik').map(p => p.key), ['waikato hospital'])
  assert.deepEqual(filterPlaces(places, 'hospital waikato').map(p => p.key), ['waikato hospital'])
  assert.deepEqual(filterPlaces(places, '  '), places)
  assert.deepEqual(filterPlaces(places, 'nowhere'), [])
})
