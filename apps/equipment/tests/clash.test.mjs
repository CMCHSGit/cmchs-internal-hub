// npm test -w apps/equipment — clashes: one device wanted by two loans or bookings on overlapping dates (model.js clashesFor).
// The case from 16 Nov 2026: HINZ (17–20 Nov) and NZCCOF Hui (19–23 Nov) were both waiting for one free TV80, and NZCCOF
// was waiting for an N1 that HINZ has until the 20th, with nothing on either card saying they clash.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetStatus, clashesFor, dateRange, loanSections } from '../src/model.js'

const today = '2026-11-16'
const eq = (id, no, o = {}) => ({ id, CHSAssetNo: no, Model: no, Returned: 'No', OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', BatchID: '', ...o })
const equipment = [
  eq('tv80', '100244'), // free, on the shelf
  eq('n1', '100018', { OnLoanTo: 'HINZ', LoanStartDate: '2026-11-17', LoanEndDate: '2026-11-20', BatchID: 'batch_hinz' }),
  eq('cms', '100094', { OnLoanTo: 'NZIHE', LoanStartDate: '2026-11-01', LoanEndDate: '2026-11-13', BatchID: 'batch_nzihe' }),
  eq('d60', '100438', { OnLoanTo: 'NZCCOF Hui', LoanStartDate: '2026-11-19', LoanEndDate: '2026-11-23', BatchID: 'batch_nzccof' }),
]
const upcoming = [
  { id: 'batch_hinz', loanTo: 'HINZ', startDate: '2026-11-17', endDate: '2026-11-20', items: [{ id: 'tv80', CHSAssetNo: '100244' }, { id: 'cms', CHSAssetNo: '100094' }] },
  { id: 'batch_nzccof', loanTo: 'NZCCOF Hui', startDate: '2026-11-19', endDate: '2026-11-23', items: [{ id: 'tv80', CHSAssetNo: '100244' }, { id: 'n1', CHSAssetNo: '100018' }] },
  { id: 'batch_later', loanTo: 'Whanganui', startDate: '2026-11-30', endDate: '2026-12-11', items: [{ id: 'n1', CHSAssetNo: '100018' }] },
  { id: 'testbatch_1', loanTo: 'Test', startDate: '2026-11-18', endDate: '2026-11-19', items: [{ id: 'tv80', CHSAssetNo: '100244' }] },
]
const ctx = { equipment, upcoming }
const sections = loanSections({ equipment, upcoming, today })
const loan = (name) => Object.values(sections).flat().find((g) => g.loanTo === name)
const who = (list) => list.map((c) => `${c.kind}:${c.loanTo}`)

test('two bookings waiting for one free device on overlapping dates each see the other', () => {
  assert.deepEqual(who(clashesFor('100244', loan('HINZ'), ctx)), ['waiting:NZCCOF Hui'])
  assert.deepEqual(who(clashesFor('100244', loan('NZCCOF Hui'), ctx)), ['waiting:HINZ'])
})

test('a loan holding a device clashes with a booking that wants it before the loan ends; a later one does not', () => {
  assert.deepEqual(who(clashesFor('100018', loan('HINZ'), ctx)), ['waiting:NZCCOF Hui']) // not Whanganui: from 30 Nov
  assert.deepEqual(who(clashesFor('100018', loan('NZCCOF Hui'), ctx)), ['holding:HINZ'])
})

test('a device due back before a booking starts is not a clash; test bookings are left out unless in test mode', () => {
  assert.deepEqual(clashesFor('100094', loan('HINZ'), ctx), []) // due back 13 Nov, HINZ starts 17 Nov
  assert.deepEqual(who(clashesFor('100244', loan('HINZ'), { ...ctx, testMode: true })), ['waiting:Test', 'waiting:NZCCOF Hui'])
  assert.deepEqual(clashesFor('', loan('HINZ'), ctx), [])
})

test('the device picker for a new loan names the bookings it would clash with', () => {
  const st = assetStatus(equipment, upcoming, '100244', { startDate: '2026-11-18', endDate: '2026-11-19', loanTo: 'Hamilton', today })
  assert.deepEqual(st.waiting.map((c) => c.loanTo), ['HINZ', 'NZCCOF Hui'])
  assert.deepEqual(assetStatus(equipment, upcoming, '100244', { startDate: '2026-12-01', endDate: '2026-12-02', loanTo: 'Later', today }).waiting, [])
})

test('dateRange', () => {
  assert.equal(dateRange('2026-11-17', '2026-11-20'), '17-Nov-2026 – 20-Nov-2026')
  assert.equal(dateRange('2026-11-17', ''), '17-Nov-2026 on')
})
