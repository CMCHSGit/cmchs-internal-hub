// npm test -w apps/equipment — Overview's search finds equipment and loans at once (model.js searchAll).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { searchAll } from '../src/model.js'

const equipment = [
  { id: '1', CHSAssetNo: '100100', Model: 'TEX20', SerialNo: 'S1', OnLoanTo: 'Waikato Hospital' },
  { id: '2', CHSAssetNo: '100200', Model: 'Surgical bed', SerialNo: 'S2' },
  null,
]
const loans = [
  { key: 'a', kind: 'loan', loanTo: 'Waikato Hospital', location: 'ICU', am: 'Sam Lee', startDate: '2026-10-01', doc: { simproJobId: 209677 } },
  { key: 'b', kind: 'loan', loanTo: 'Napier', location: 'Waikato ward', am: 'Tama Brown', startDate: '2026-10-20' },
  { key: 'c', kind: 'booking', loanTo: 'Hutt', location: 'Ward 3', am: 'Sam Lee', startDate: '2026-11-01' },
]

test('one search finds equipment and loans together', () => {
  const r = searchAll('waikato', { equipment, loans })
  assert.deepEqual(r.equipment.map((e) => e.id), ['1'], 'the item on loan to Waikato')
  assert.deepEqual(r.loans.map((g) => g.key), ['b', 'a'], 'both loans, newest start first')
})

test('loans match on account manager and job number too; every word must match', () => {
  assert.deepEqual(searchAll('sam lee', { equipment, loans }).loans.map((g) => g.key), ['c', 'a'])
  assert.deepEqual(searchAll('209677', { equipment, loans }).loans.map((g) => g.key), ['a'])
  assert.deepEqual(searchAll('waikato icu', { equipment, loans }).loans.map((g) => g.key), ['a'])
})

test('an asset number or model finds the equipment, and no loan unless it matches too', () => {
  const r = searchAll('100200', { equipment, loans })
  assert.deepEqual(r.equipment.map((e) => e.id), ['2'])
  assert.deepEqual(r.loans, [])
})

test('nothing typed finds nothing; nothing matching finds nothing', () => {
  assert.deepEqual(searchAll('  ', { equipment, loans }), { equipment: [], loans: [] })
  assert.deepEqual(searchAll('zzz', { equipment, loans }), { equipment: [], loans: [] })
  assert.deepEqual(searchAll('x'), { equipment: [], loans: [] })
})
