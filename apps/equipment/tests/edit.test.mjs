// npm test -w apps/equipment — editing and deleting a loan (model.js), as the old tracker's.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { deleteLoanEquipment, demoTypeOptions, editBooking, editEquipment, editProblem } from '../src/model.js'

const out = (id, o) => ({ id, CHSAssetNo: 'A' + id, Model: 'M', Returned: 'No', OnLoanTo: 'Waikato', Location: 'ICU', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'b1', ...o })
const g = { kind: 'loan', loanTo: 'Waikato', startDate: '2026-10-01', endDate: '2026-10-30', items: [out('1'), out('2')] }

test('edit: only what is filled in changes, on this loan’s devices only', () => {
  const eq = editEquipment([out('1'), out('2'), out('3', { BatchID: 'b2' })], g, { loanTo: 'Waikato DHB', location: '', endDate: '2026-11-15', email: '' })
  assert.deepEqual(eq.slice(0, 2).map((e) => [e.OnLoanTo, e.Location, e.LoanEndDate]), [['Waikato DHB', 'ICU', '2026-11-15'], ['Waikato DHB', 'ICU', '2026-11-15']])
  assert.equal(eq[2].OnLoanTo, 'Waikato')
  const u = editBooking({ id: 'u1', loanTo: 'Napier', location: 'CCU', startDate: '2026-11-01', accountManager: 'Sam' }, { loanTo: '', startDate: '2026-11-03', am: 'Tama' })
  assert.deepEqual([u.loanTo, u.location, u.startDate, u.accountManager], ['Napier', 'CCU', '2026-11-03', 'Tama'])
})

test('edit: an end before the start is refused', () => {
  assert.match(editProblem(g, { endDate: '2026-09-01' }), /before/)
  assert.equal(editProblem(g, { endDate: '2026-11-01' }), '')
})

test('delete: devices cleared as returned, each with a Return entry saying an admin deleted it', () => {
  const r = deleteLoanEquipment([out('1'), out('2'), out('3', { BatchID: 'b2' })], [{ id: 'old' }], g, { ts: 'T', operator: 'Ann' })
  assert.deepEqual(r.equipment.map((e) => [e.OnLoanTo, e.Returned, e.BatchID]), [['', 'Yes', ''], ['', 'Yes', ''], ['Waikato', 'No', 'b2']])
  assert.deepEqual(r.history.map((h) => h.chsAssetNo || h.id), ['A2', 'A1', 'old'])
  assert.deepEqual([r.history[0].notes, r.history[0].operator], ['Loan deleted by admin', 'Ann'])
  assert.equal(deleteLoanEquipment([out('1')], [], { ...g, kind: 'scheduled', items: [out('1')] }).history[0].notes, 'Scheduled loan deleted by admin')
})

test('demo types: fixed, then added ones, then the current one if it is neither', () => {
  assert.deepEqual(demoTypeOptions(['Evaluation', 'Hotswap'], 'Trade show'), ['Conference/Presentation', 'Clinical Trial', 'Hotswap', 'Evaluation', 'Trade show'])
})
