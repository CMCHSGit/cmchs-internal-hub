// npm test -w apps/equipment — a new loan, add items, transfer and the loan form (model.js), as the old tracker's.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  addToBooking, assetStatus, existingLoanMatch, formDoc, formRows, loanFormHtml, newLoanProblem, planAddItems, planNewLoan, planTransfer, rowsWithAdded, rowsWithout,
} from '../src/model.js'

const today = '2026-10-16', ts = 'T'
const shelf = (id) => ({ id, CHSAssetNo: 'A' + id, Model: 'M' + id, Returned: 'Yes', OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', BatchID: '' })
const out = (id, o) => ({ ...shelf(id), Returned: 'No', OnLoanTo: 'Hutt', Location: 'ED', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-20', BatchID: 'b9', ...o })
const f = { loanTo: 'Nelson', location: 'ICU', startDate: '2026-10-16', endDate: '2026-10-30', longTerm: false, am: 'Sam Lee', email: 'sam@x.nz', jobType: 'Demo', demoType: 'Evaluation', island: 'South', notes: 'Note' }

test('new loan: the old checks, in order', () => {
  assert.match(newLoanProblem({ ...f, loanTo: '' }), /on loan to/)
  assert.match(newLoanProblem({ ...f, endDate: '2026-10-01' }), /before/)
  assert.match(newLoanProblem({ ...f, email: 'sam' }), /email/)
  assert.match(newLoanProblem({ ...f, demoType: '' }), /demo type/)
  assert.match(newLoanProblem({ ...f, island: '' }), /island/)
  assert.equal(newLoanProblem({ ...f, longTerm: true, endDate: '', demoType: '', island: '' }), '')
  assert.equal(newLoanProblem({ ...f, jobType: 'Repair', demoType: '' }), '')
  assert.equal(newLoanProblem(f), '')
})

test('new loan: a free device goes on it; one still out is booked to follow; one on a later, non-clashing booking keeps that claim', () => {
  const eq = [shelf('1'), out('2'), out('3', { OnLoanTo: 'Later', BatchID: 'b8', LoanStartDate: '2026-11-05', LoanEndDate: '2026-11-20' })]
  const p = planNewLoan({ equipment: eq, history: [], upcoming: [], loanMeta: { b8: { accountManager: 'Tama' } } }, f, ['a1', ' A2 ', 'A3', 'A1', 'nope'], { batchId: 'b1', today, ts, operator: 'Ann' })
  assert.deepEqual(p.equipment.map((e) => [e.OnLoanTo, e.BatchID]), [['Nelson', 'b1'], ['Hutt', 'b9'], ['Nelson', 'b1']])
  assert.deepEqual(p.loaned.map((e) => e.CHSAssetNo), ['A1', 'A3', 'A2'])
  assert.deepEqual(p.booked.map((e) => e.CHSAssetNo), ['A2'])
  const mine = p.upcoming.find((u) => u.id === 'b1'), theirs = p.upcoming.find((u) => u.id === 'b8')
  assert.deepEqual([mine.loanTo, mine.accountManager, mine.items.map((i) => i.CHSAssetNo)], ['Nelson', 'Sam Lee', ['A2']])
  assert.deepEqual([theirs.loanTo, theirs.accountManager, theirs.items.map((i) => i.CHSAssetNo)], ['Later', 'Tama', ['A3']])
  assert.deepEqual(p.changed.sort(), ['b1', 'b8'])
  assert.deepEqual(p.reclaimed, ['Later'])
  assert.ok(p.history.some((h) => h.action === 'Converted' && h.chsAssetNo === 'A3'))
  assert.match(p.history.find((h) => h.chsAssetNo === 'A2').notes, /Booked as upcoming \(currently on loan to Hutt\)/)
  assert.equal(p.history.find((h) => h.chsAssetNo === 'A1' && h.action === 'Loan')._pdfKey, 'b1')
})

test('new loan: long term has no end date; a duplicate is spotted', () => {
  const p = planNewLoan({ equipment: [shelf('1')], history: [], upcoming: [] }, { ...f, longTerm: true }, ['A1'], { batchId: 'b1', today, ts })
  assert.equal(p.equipment[0].LoanEndDate, '')
  assert.equal(existingLoanMatch([out('1', { OnLoanTo: 'nelson ', Location: 'icu', LoanEndDate: '2026-10-30' })], [], f), true)
  assert.equal(existingLoanMatch([], [{ id: 'u', loanTo: 'Nelson', location: 'ICU', endDate: '2026-10-30' }], f), true)
  assert.equal(existingLoanMatch([], [{ id: 'testbatch_1', loanTo: 'Nelson', location: 'ICU', endDate: '2026-10-30' }], f), false, 'a hidden test booking')
})

test('asset status says what the new loan would do with it', () => {
  const eq = [shelf('1'), out('2'), out('3', { OnLoanTo: 'Later', BatchID: 'b8', LoanStartDate: '2026-11-05', LoanEndDate: '2026-11-20' })]
  const w = { startDate: f.startDate, endDate: f.endDate, loanTo: 'Nelson', today }
  assert.deepEqual(['A1', 'A2', 'A3', 'X'].map((no) => assetStatus(eq, [], no, w).will || 'missing'), ['now', 'follow', 'reclaim', 'missing'])
})

test('add items: a clash is left out, one without moves across, one already on it is skipped', () => {
  const g = { kind: 'loan', loanTo: 'Nelson', location: 'ICU', startDate: '2026-10-10', endDate: '2026-10-30', items: [out('5', { OnLoanTo: 'Nelson', BatchID: 'b1', BorrowerEmail: 'sam@x.nz' })] }
  const eq = [g.items[0], shelf('1'), out('2'), out('3', { OnLoanTo: 'Early', BatchID: 'b7', LoanStartDate: '2026-09-01', LoanEndDate: '2026-10-05' })]
  const p = planAddItems({ equipment: eq, history: [], upcoming: [] }, g, ['A5', 'A1', 'A2', 'A3'], { batchId: 'b1', today, ts })
  assert.deepEqual(p.added.map((e) => e.CHSAssetNo), ['A1', 'A3'])
  assert.deepEqual(p.skipped.map((e) => e.CHSAssetNo), ['A2'])
  assert.deepEqual([p.equipment[1].BatchID, p.equipment[1].BorrowerEmail, p.equipment[1].LoanEndDate], ['b1', 'sam@x.nz', '2026-10-30'])
  assert.equal(p.history[0].notes, 'Added to existing loan')
  const b = addToBooking([shelf('1'), shelf('2')], { id: 'u1', items: [{ id: '1', CHSAssetNo: 'A1' }] }, ['A1', 'A2'])
  assert.deepEqual([b.booking.items.map((i) => i.CHSAssetNo), b.added.length, b.equipment[1]._upcomingLoanId], [['A1', 'A2'], 1, 'u1'])
})

test('transfer: moved devices take the target’s details and BatchID (one minted and backfilled if it had none)', () => {
  const g = { kind: 'loan', loanTo: 'Hutt', location: 'ED', items: [out('1'), out('2')] }
  const target = { kind: 'loan', loanTo: 'Nelson', location: 'ICU', startDate: '2026-10-10', endDate: '2026-10-30', batchId: '', items: [out('7', { OnLoanTo: 'Nelson', BatchID: '' })] }
  const p = planTransfer({ equipment: [out('1'), out('2'), target.items[0]], history: [] }, g, ['A1'], target, { targetBatchId: 'bN', ts })
  assert.deepEqual(p.equipment.map((e) => [e.OnLoanTo, e.BatchID]), [['Nelson', 'bN'], ['Hutt', 'b9'], ['Nelson', 'bN']])
  assert.deepEqual([p.moved.length, p.remaining.length], [1, 1])
  assert.deepEqual([p.history[0].action, p.history[0].notes], ['Transfer', 'Reassigned from Hutt (ED) to Nelson (ICU)'])
})

test('the loan form: rows, saving without wiping what it doesn’t show, the printed copy escaped', () => {
  assert.equal(formRows(null, [shelf('1')]).length, 4, 'the devices and 3 spare rows')
  assert.deepEqual(formRows({ savedRows: [['A1', 'M', '', '', ''], ['', '', '', '', '']] }, [])[0], ['A1', 'M', '', '', ''])
  assert.deepEqual(rowsWithAdded({ savedRows: [['A1']] }, [shelf('2')]).map((r) => r[0]), ['A1', 'A2'])
  assert.equal(rowsWithAdded({}, [shelf('2')]), null)
  assert.deepEqual(rowsWithout([['A1'], [' a2 ']], ['A2']), [['A1']])
  const d = formDoc({ loanTo: 'Nelson', startDate: '16/10/2026', rows: [['A1', '', '', '', ''], ['', '', '', '', '']], items: [shelf('1')], notes: 'n', shipping: 's' },
    { simproJobId: 209677, demoType: 'Evaluation', island: 'North', longTerm: false, simproClosedAt: 'x' }, { endDate: '2026-10-30' })
  assert.deepEqual([d.startDate, d.endDate, d.simproJobId, d.demoType, d.island, d.savedRows.length, d.notesCell, d.authCell, d.simproClosedAt], ['2026-10-16', '2026-10-30', 209677, 'Evaluation', 'North', 1, 'n', 's', 'x'])
  assert.equal(formDoc({ rows: [] }, { simproJobId: { status: 'pending' } }).simproJobId, undefined, 'a job being made is not frozen into the form')
  const html = loanFormHtml({ loanTo: '<b>Hutt</b>', rows: [['A1', '', '', '', '']], notes: 'a\nb' })
  assert.ok(html.includes('&lt;b&gt;Hutt&lt;/b&gt;') && html.includes('a<br>b'))
})
