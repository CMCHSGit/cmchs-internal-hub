// npm test -w apps/equipment — the search forgives spacing, accents and a slip or two (model.js searchEquipment, matchLoan, searchAll).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchLoan, searchAll, searchEquipment } from '../src/model.js'

const eq = (id, no, Model, extra = {}) => ({ id, CHSAssetNo: no, Model, Description: Model, SerialNo: 'AC9-0400' + id, ...extra })
const equipment = [
  eq('1', '100048', 'ePM 12M'),
  eq('2', '100148', 'ePM 12M', { OnLoanTo: 'HINZ' }),
  eq('3', '100185', 'ePM 12M Vet'),
  eq('4', '100239', 'ePM C10'),
  eq('5', '100244', 'TV80', { Description: 'TV80 Ventilator' }),
  eq('6', '100438', 'BeneHeart D60', { Description: 'BeneHeart D60, 2 x Battery, 12 Lead ECG, CO2' }),
  eq('7', '100500', 'TEX20 Ultrasound', { OnLoanTo: 'Whangārei Hospital', Location: 'Ward 3' }),
  eq('8', 'MRYPULLUP', 'Mindray Pull Up'),
]
const ids = (r) => r.map((e) => e.id)

test('spaces and punctuation are ignored: "epm12" finds "ePM 12M", model matches first', () => {
  assert.deepEqual(ids(searchEquipment(equipment, 'epm12')), ['1', '2', '3'])
  assert.deepEqual(ids(searchEquipment(equipment, 'epm 12')), ['1', '2', '3'], 'as before')
  assert.deepEqual(ids(searchEquipment(equipment, 'ac90400')), ['1', '2', '3', '4', '5', '6', '7', '8'], 'a serial typed without its dash')
})

test('accents are ignored both ways', () => {
  assert.deepEqual(ids(searchEquipment(equipment, 'whangarei')), ['7'])
  assert.deepEqual(ids(searchEquipment(equipment, 'whāngārei')), ['7'])
})

test('a slip of a letter still finds it: wrong, missing, extra, swapped', () => {
  assert.deepEqual(ids(searchEquipment(equipment, 'benehert')), ['6'], 'missing a letter')
  assert.deepEqual(ids(searchEquipment(equipment, 'beneheart')), ['6'], 'exact')
  assert.deepEqual(ids(searchEquipment(equipment, 'benneheart')), ['6'], 'extra letter')
  assert.deepEqual(ids(searchEquipment(equipment, 'beneheat')), ['6'], 'missing')
  assert.deepEqual(ids(searchEquipment(equipment, 'ventilater')), ['5'], 'wrong letter (in the description)')
  assert.deepEqual(ids(searchEquipment(equipment, 'ultrasuond')), ['7'], 'swapped letters')
  assert.deepEqual(ids(searchEquipment(equipment, 'pullup')), ['8'], 'spaces ignored on a model')
})

test('close matches come after exact ones', () => {
  const list = [eq('a', '1', 'Surgical bed'), eq('b', '2', 'Surgicle bed'), eq('c', '3', 'Surgical bed', { Description: 'x' })]
  assert.deepEqual(ids(searchEquipment(list, 'surgical')), ['a', 'c', 'b'])
})

test('every word must still match, and one slip is the most a short word gets', () => {
  assert.deepEqual(ids(searchEquipment(equipment, 'benehert ventilator')), [], 'both words, in the same item')
  assert.deepEqual(ids(searchEquipment(equipment, 'epm 12 vat')), [], 'a three-letter word is never guessed')
  assert.deepEqual(ids(searchEquipment(equipment, 'tv88')), [], 'a word with a digit is never guessed')
  assert.deepEqual(ids(searchEquipment(equipment, 'epn12')), [], 'nor is a model with a digit in it')
  assert.deepEqual(ids(searchEquipment(equipment, 'qqqqqq')), [])
})

test('numbers are exact: a wrong digit is a different device', () => {
  assert.deepEqual(ids(searchEquipment(equipment, '100149')), [])
  assert.deepEqual(ids(searchEquipment(equipment, '100148')), ['2'])
})

test('loans forgive a slip in the customer, place and account manager, but not the job number', () => {
  const g = { key: 'a', loanTo: 'Waikato Hospital', location: 'Hamilton Depot', am: 'Jessica Broughan', doc: { simproJobId: 209677 } }
  assert.ok(matchLoan(g, 'waikatu'))
  assert.ok(matchLoan(g, 'hamiltn'))
  assert.ok(matchLoan(g, 'jesica'))
  assert.ok(matchLoan(g, 'waikato hosptial'))
  assert.ok(!matchLoan(g, '209678'))
  assert.ok(!matchLoan(g, 'napier'))
  assert.ok(matchLoan(g, ''), 'nothing typed matches everything, as before')
})

test('searchAll: exact loans before close ones, and says how many were close', () => {
  const loans = [
    { key: 'x', kind: 'loan', loanTo: 'Waikato Hospital', location: '', am: '', startDate: '2026-01-01' },
    { key: 'y', kind: 'loan', loanTo: 'Waikatu Hospital', location: '', am: '', startDate: '2026-12-01' },
  ]
  const r = searchAll('waikato', { equipment, loans })
  assert.deepEqual(r.loans.map((g) => g.key), ['x', 'y'], 'the exact one first although it started earlier')
  assert.deepEqual(r.close, { equipment: 0, loans: 1 })
  assert.equal(searchAll('epm12', { equipment, loans }).close, undefined, 'no close note when everything was exact')
  const typo = searchAll('benehert', { equipment, loans })
  assert.deepEqual(ids(typo.equipment), ['6'])
  assert.deepEqual(typo.close, { equipment: 1, loans: 0 })
  assert.deepEqual(searchAll('zzzzzz', { equipment, loans }), { equipment: [], loans: [] })
})
