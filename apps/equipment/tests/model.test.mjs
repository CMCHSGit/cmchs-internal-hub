// npm test -w apps/equipment — the rules ported from the old tracker (model.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { fmtDate, historyFor, isLoanLongTerm, mergeEquipmentAndHistory, safeKeys, searchEquipment, statusOf, upcomingFor } from '../src/model.js'

const today = '2026-10-17'
const item = (o = {}) => ({ id: 'id_1', CHSAssetNo: '100166', Model: 'TEX20', Returned: 'No', ...o })

test('status: available when not out, or out but returned', () => {
  assert.equal(statusOf(item(), { today }).key, 'available')
  assert.equal(statusOf(item({ OnLoanTo: 'Waikato', Returned: 'Yes' }), { today }).key, 'available')
})

test('status: on loan, then overdue past its end date (not on it)', () => {
  const on = item({ OnLoanTo: 'Waikato', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-17' })
  assert.equal(statusOf(on, { today }).key, 'on-loan')
  assert.equal(statusOf({ ...on, LoanEndDate: '2026-10-16' }, { today }).key, 'overdue')
  // no end date: just on loan
  assert.equal(statusOf({ ...on, LoanEndDate: '' }, { today }).key, 'on-loan')
})

test('status: a later start, or a booking in upcomingLoans, is booked, and beats on loan', () => {
  assert.equal(statusOf(item({ OnLoanTo: 'Tauranga', LoanStartDate: '2026-10-20' }), { today }).key, 'booked')
  const upcoming = [{ id: 'batch_9', loanTo: 'Napier', startDate: '2026-11-01', items: [{ id: 'id_1' }] }]
  const s = statusOf(item({ OnLoanTo: 'Waikato', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-05' }), { today, upcoming })
  assert.deepEqual([s.key, s.loanTo, s.startDate], ['booked', 'Napier', '2026-11-01'])
})

test('status: long term from loanMeta, else from the loan form; loanMeta false wins', () => {
  const on = item({ OnLoanTo: 'Waikato', LoanStartDate: '2026-01-01', LoanEndDate: '2026-02-01', BatchID: 'batch_1' })
  assert.equal(statusOf(on, { today, loanMeta: { batch_1: { longTerm: true } } }).key, 'longterm')
  assert.equal(statusOf(on, { today, loanDocs: { batch_1: { longTerm: true } } }).key, 'longterm')
  assert.equal(statusOf(on, { today, loanMeta: { batch_1: { longTerm: false } }, loanDocs: { batch_1: { longTerm: true } } }).key, 'overdue')
  assert.equal(isLoanLongTerm(null), false)
})

test('status: test loans are hidden unless test mode is on', () => {
  const t = item({ OnLoanTo: 'Test', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'testbatch_1' })
  assert.equal(statusOf(t, { today }).key, 'available')
  assert.equal(statusOf(t, { today, testMode: true }).key, 'on-loan')
  const upcoming = [{ id: 'testbatch_2', loanTo: 'Test', startDate: '2026-11-01', items: [{ id: 'id_1' }] }]
  assert.equal(upcomingFor(item(), upcoming), null)
  assert.equal(upcomingFor(item(), upcoming, true).id, 'testbatch_2')
})

test('upcomingFor: the soonest booking, matched by id or by asset number', () => {
  const upcoming = [
    { id: 'b2', startDate: '2026-12-01', items: [{ CHSAssetNo: 'id_1' }] },
    { id: 'b1', startDate: '2026-11-01', items: [{ id: 'id_1' }] },
    { id: 'b3', startDate: '2026-10-25', items: [{ id: 'other' }] },
  ]
  assert.equal(upcomingFor(item(), upcoming).id, 'b1')
})

test('merge: a newer loan or return on their side wins; a later start on ours wins', () => {
  const fresh = { equipment: [item({ OnLoanTo: 'A', LoanStartDate: '2026-10-01' }), item({ id: 'id_2', OnLoanTo: 'B', Returned: 'Yes' })], history: [] }
  const ours = { equipment: [item(), item({ id: 'id_2', OnLoanTo: 'C', LoanStartDate: '2026-10-10' })], history: [] }
  const m = mergeEquipmentAndHistory(ours, fresh)
  assert.equal(m.equipment[0].OnLoanTo, 'A')   // their loan beats our "not out"
  assert.equal(m.equipment[1].OnLoanTo, 'C')   // our loan beats their return
  const both = mergeEquipmentAndHistory(
    { equipment: [item({ OnLoanTo: 'Ours', LoanStartDate: '2026-10-09' })], history: [] },
    { equipment: [item({ OnLoanTo: 'Theirs', LoanStartDate: '2026-10-08' })], history: [] })
  assert.equal(both.equipment[0].OnLoanTo, 'Ours')
})

test('merge: new items on either side are kept, and history is a union by id', () => {
  const m = mergeEquipmentAndHistory(
    { equipment: [item({ id: 'mine' })], history: [{ id: 'h1' }, { id: 'h3' }] },
    { equipment: [item({ id: 'theirs' })], history: [{ id: 'h1' }, { id: 'h2' }] })
  assert.deepEqual(m.equipment.map((e) => e.id), ['theirs', 'mine'])
  assert.deepEqual(m.history.map((h) => h.id).sort(), ['h1', 'h2', 'h3'])
})

test('safeKeys: Firebase-forbidden characters in keys become _', () => {
  assert.deepEqual(Object.keys(safeKeys({ 'loandoc_a.b#c$d[e]f/g': 1 })), ['loandoc_a_b_c_d_e_f_g'])
})

test('search puts model matches first, then asset number, then serial number', () => {
  const e = (id, no, Model, SerialNo, Description = '') => ({ id, CHSAssetNo: no, Model, SerialNo, Description })
  const list = [e('b', '100010', 'TM80 Battery', 'DS04A9028'), e('s', '100500', 'EP30', 'XA9123'), e('n', '100A90', 'Dell', 'zz'), e('m2', '100300', 'Big A9 Thing', 'q'), e('m1', '100200', 'A9 Vaporiser', 'q'), e('d', '100005', 'ES30', 'q', 'works with A9')]
  assert.deepEqual(searchEquipment(list, 'a9').map((x) => x.id), ['m1', 'm2', 'n', 'b', 's', 'd'])
})

test('fmtDate, search and history', () => {
  assert.equal(fmtDate('2026-10-07'), '7-Oct-2026')
  assert.equal(fmtDate('Counted 01/10/2026'), 'Counted 01/10/2026')
  const list = [item(), item({ id: 'id_2', CHSAssetNo: '100200', Model: 'A9', SerialNo: 'FX7-1', OnLoanTo: 'Whanganui' })]
  assert.deepEqual(searchEquipment(list, 'a9 whanganui').map((e) => e.id), ['id_2'])
  assert.equal(searchEquipment(list, '').length, 2)
  const h = historyFor(item(), [{ chsAssetNo: '100166', ts: '2026-10-01T09:00' }, { chsAssetNo: 'x' }, { chsAssetNo: '100166', ts: '2026-10-05T09:00' }])
  assert.deepEqual(h.map((x) => x.ts), ['2026-10-05T09:00', '2026-10-01T09:00'])
})
