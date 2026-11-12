import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planImport, nameKey, daysSignature } from '../src/utils/excelPlan.js'

const users = [{ uid: 'u1', displayName: 'Ana Smith', team: 'Engineers' }, { uid: 'u2', displayName: 'Bo Jones', team: 'Engineers' }]
const mapping = new Map([[nameKey('Ana Smith'), { kind: 'user', uid: 'u1' }], [nameKey('Bo Jones'), { kind: 'user', uid: 'u2' }]])
const person = (name, days, comment = '') => ({ name, team: 'Engineers', onCall: false, days, comment })
const week = (...people) => people
const plan = (weeks, extra = {}) => planImport({
  weeks: new Map(Object.entries(weeks)), selected: Object.keys(weeks), mapping, users,
  existing: new Map(), existingOnCall: new Map(), skipCopiesFrom: '2026-11-09', ...extra,
})
const ids = p => p.schedules.map(s => s.id).sort()

test('a later week that is the same as the current week for that person is a pasted copy and is left out', () => {
  const p = plan({
    '2026-11-09': week(person('Ana Smith', ['Wellington', 'Wellington', '', 'Leave', 'Leave']), person('Bo Jones', ['Cass Office', '', '', '', ''])),
    '2026-11-16': week(person('Ana Smith', ['Wellington', 'Wellington', '', 'Leave', 'Leave']), person('Bo Jones', ['Auckland', '', '', '', ''])),
  })
  assert.deepEqual(ids(p), ['2026-11-09_u1', '2026-11-09_u2', '2026-11-16_u2']) // Ana's copy left out; Bo's different week comes in
  assert.equal(p.stats.copies, 1)
})

test('a copy of a copy (the week before that, not the current one) is still a copy', () => {
  const same = ['Wellington', '', '', '', '']
  const p = plan({
    '2026-11-09': week(person('Ana Smith', same)),
    '2026-11-16': week(person('Ana Smith', ['', 'Auckland', '', '', ''])),
    '2026-11-23': week(person('Ana Smith', ['', 'Auckland', '', '', ''])),
  })
  assert.deepEqual(ids(p), ['2026-11-09_u1', '2026-11-16_u1'])
  assert.equal(p.stats.copies, 1)
})

test('the current week and earlier weeks are always imported, even when they repeat', () => {
  const days = ['Cass Office', 'Cass Office', 'Cass Office', 'Cass Office', 'Cass Office']
  const p = plan({ '2026-11-02': week(person('Ana Smith', days)), '2026-11-09': week(person('Ana Smith', days)) })
  assert.deepEqual(ids(p), ['2026-11-02_u1', '2026-11-09_u1'])
  assert.equal(p.stats.copies, 0)
})

test('a blank week, a week that differs in one day, and a week for another person are not copies; case and spacing do not matter', () => {
  const p = plan({
    '2026-11-09': week(person('Ana Smith', ['Wellington', '', '', '', '']), person('Bo Jones', ['Starship', '', '', '', ''])),
    '2026-11-16': week(person('Ana Smith', ['wellington ', '', '', '', 'Leave']), person('Bo Jones', ['  STARSHIP', '', '', '', ''])),
  })
  assert.deepEqual(ids(p), ['2026-11-09_u1', '2026-11-09_u2', '2026-11-16_u1']) // Bo's is the same up to case: a copy
  assert.equal(p.stats.copies, 1)
  assert.equal(daysSignature(['', ' ', '', '', '']), '')
})

test('without a current week the guard is off (the Admin screen\'s own import)', () => {
  const days = ['Wellington', '', '', '', '']
  const p = plan({ '2026-11-09': week(person('Ana Smith', days)), '2026-11-16': week(person('Ana Smith', days)) }, { skipCopiesFrom: null })
  assert.equal(p.schedules.length, 2)
})

test('what the app already holds for a copied week is not touched', () => {
  const days = ['Wellington', '', '', '', '']
  const existing = new Map([['2026-11-16_u1', { uid: 'u1', days: [{ location: 'Hamilton' }, { location: '' }, { location: '' }, { location: '' }, { location: '' }], excelBase: { days: ['Hamilton', '', '', '', ''], comments: '' } }]])
  const p = plan({ '2026-11-09': week(person('Ana Smith', days)), '2026-11-16': week(person('Ana Smith', days)) }, { existing })
  assert.deepEqual(ids(p), ['2026-11-09_u1']) // the app's own 16 Nov entry stays as it is
})

test('a week that is all leave or training is not a copy, even when it repeats: long leave runs for more than a week', () => {
  const p = plan({
    '2026-11-09': week(person('Ana Smith', ['leave', 'leave', 'leave', 'leave', 'leave']), person('Bo Jones', ['Annual Leave', 'Annual Leave', 'Training', '', ''])),
    '2026-11-16': week(person('Ana Smith', ['Leave', 'Leave', 'Leave', 'Leave', 'Leave']), person('Bo Jones', ['Annual Leave', 'Annual Leave', 'Training', '', ''])),
  })
  assert.deepEqual(ids(p), ['2026-11-09_u1', '2026-11-09_u2', '2026-11-16_u1', '2026-11-16_u2'])
  assert.equal(p.stats.copies, 0)
})

test('a repeated week that mixes leave with work is still a copy', () => {
  const days = ['Leave', 'Leave', 'Wellington', '', '']
  const p = plan({ '2026-11-09': week(person('Ana Smith', days)), '2026-11-16': week(person('Ana Smith', days)) })
  assert.deepEqual(ids(p), ['2026-11-09_u1'])
  assert.equal(p.stats.copies, 1)
})
