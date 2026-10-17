// npm test -w apps/equipment — the Loans tab's rules, ported from the old tracker (model.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { daysBetween, filterLoans, isStartingSoon, loanAM, loanSections } from '../src/model.js'

const today = '2026-10-16' // a Friday
const out = (id, o) => ({ id, CHSAssetNo: id, Returned: 'No', OnLoanTo: 'Waikato', Location: 'ICU', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'batch_1', ...o })

test('isStartingSoon: 3 business days in the North Island, 5 elsewhere, weekends not counted', () => {
  assert.equal(isStartingSoon(today, '2026-10-16'), true)          // today
  assert.equal(isStartingSoon(today, '2026-10-21', 'North'), true)  // Mon, Tue, Wed = 3
  assert.equal(isStartingSoon(today, '2026-10-22', 'North'), false) // 4
  assert.equal(isStartingSoon(today, '2026-10-23', 'South'), true)  // 5
  assert.equal(isStartingSoon(today, '2026-10-26', ''), false)      // 6
  assert.equal(isStartingSoon(today, ''), false)
  assert.equal(daysBetween('2026-10-16', '2026-10-23'), 7)
})

test('grouping: by BatchID, else customer + location + end date; returned and hidden test loans left out', () => {
  const s = loanSections({ today, equipment: [
    out('a'), out('b'),
    out('c', { BatchID: '', OnLoanTo: 'Napier', LoanEndDate: '2026-11-01' }), out('d', { BatchID: '', OnLoanTo: 'Napier', LoanEndDate: '2026-11-01' }),
    out('e', { Returned: 'Yes' }), out('f', { BatchID: 'testbatch_9' }),
  ] })
  assert.deepEqual(s.current.map((g) => [g.loanTo, g.items.length]), [['Waikato', 2], ['Napier', 2]])
  assert.equal(loanSections({ today, testMode: true, equipment: [out('f', { BatchID: 'testbatch_9' })] }).current.length, 1)
})

test('sections: scheduled, long term, overdue, and a started loan still waiting on items needs reassigning', () => {
  const s = loanSections({
    today,
    equipment: [
      out('a', { BatchID: 'b_sched', LoanStartDate: '2026-10-20' }),
      out('b', { BatchID: 'b_lt' }),
      out('c', { BatchID: 'b_late', LoanEndDate: '2026-10-10' }),
      out('d', { BatchID: 'b_stuck' }),
      out('e', { BatchID: 'b_fine' }),
    ],
    upcoming: [
      { id: 'b_stuck', loanTo: 'Waikato', startDate: '2026-10-01', items: [{ id: 'x' }] },
      { id: 'b_new', loanTo: 'Tauranga', startDate: '2026-11-02', items: [{ id: 'y' }] },
      { id: 'testbatch_2', loanTo: 'Test', startDate: '2026-11-02', items: [{ id: 'z' }] },
    ],
    loanMeta: { b_lt: { longTerm: true } },
  })
  assert.deepEqual(s.needsReassign.map((g) => g.key), ['b_stuck'])
  assert.deepEqual(s.upcoming.map((g) => [g.key, g.kind]), [['b_sched', 'scheduled'], ['b_new', 'booking']])
  assert.deepEqual(s.current.map((g) => g.key), ['b_late', 'b_fine'])
  assert.equal(s.current[0].overdue, true)
  assert.deepEqual(s.longTerm.map((g) => g.key), ['b_lt'])
  assert.equal(s.longTerm[0].overdue, false)
})

test('account manager: loanMeta by BatchID, else the old loandoc keys, else the booking own', () => {
  assert.equal(loanAM({ batchId: 'b1' }, { loanMeta: { b1: { accountManager: 'Sam' } } }), 'Sam')
  const enc = 'loandoc_' + encodeURIComponent('Napier|||2026-11-01')
  assert.equal(loanAM({ loanTo: 'Napier', endDate: '2026-11-01' }, { loanDocs: { [enc]: { accountManager: 'Tama' } } }), 'Tama')
  assert.equal(loanAM({ loanTo: 'Napier', endDate: '2026-11-01' }, { loanMeta: { 'loandoc_Napier|||2026-11-01': { accountManager: 'Kiri' } } }), 'Kiri')
  assert.equal(loanAM({ batchId: 'b9', accountManager: 'From booking' }), 'From booking')
})

test('transferred items stay on the loan they left, as ghosts', () => {
  const s = loanSections({ today, equipment: [out('a'), out('t', { BatchID: 'b_new', OnLoanTo: 'Tauranga', _transferNote: { fromBatchId: 'batch_1' } })] })
  const from = s.current.find((g) => g.key === 'batch_1')
  assert.deepEqual(from.ghosts.map((e) => e.id), ['t'])
})

test('filterLoans: search, account manager, overdue only and the sorts', () => {
  const list = [
    { loanTo: 'Waikato', location: 'ICU', am: 'Sam', startDate: '2026-10-01', endDate: '2026-10-30' },
    { loanTo: 'Auckland', location: 'ED', am: 'Tama', startDate: '2026-10-05', endDate: '2026-10-10' },
    { loanTo: 'Napier', location: 'CCU', am: '', startDate: '2026-09-01', endDate: '' },
  ]
  assert.deepEqual(filterLoans(list, { q: 'icu' }).map((g) => g.loanTo), ['Waikato'])
  assert.deepEqual(filterLoans(list, { am: 'Tama' }).map((g) => g.loanTo), ['Auckland'])
  assert.deepEqual(filterLoans(list, { overdueOnly: true }, today).map((g) => g.loanTo), ['Auckland'])
  assert.deepEqual(filterLoans([...list], { sort: 'alpha' }).map((g) => g.loanTo), ['Auckland', 'Napier', 'Waikato'])
  assert.deepEqual(filterLoans([...list], { sort: 'expiry' }).map((g) => g.loanTo), ['Auckland', 'Waikato', 'Napier'])
  assert.deepEqual(filterLoans([...list], { sort: 'manager' }).map((g) => g.am), ['Sam', 'Tama', ''])
  assert.deepEqual(filterLoans([...list], { sort: 'recent' }).map((g) => g.loanTo), ['Auckland', 'Waikato', 'Napier'])
})

import { fmtWhen, jobOf, readinessKey, readinessOf } from '../src/model.js'

test('readiness key: the BatchID, else the old loandoc key with Firebase-forbidden characters made _', () => {
  assert.equal(readinessKey({ batchId: 'batch_1' }), 'batch_1')
  assert.equal(readinessKey({ loanTo: 'A.B', endDate: '2026-10-01' }), 'loandoc_A_B%7C%7C%7C2026-10-01')
})

test('readiness: no test required, not tested in the first week, tested and dispatched with when', () => {
  const meta = { b1: { noTestRequired: true }, b2: { tested: true, testedAt: '2026-10-15T04:40:00Z', dispatched: true } }
  assert.equal(readinessOf({ batchId: 'b1', startDate: '2026-10-14' }, { loanMeta: meta, today }).noTestRequired, true)
  assert.equal(readinessOf({ batchId: 'b1', startDate: '2026-10-14' }, { loanMeta: meta, today }).notTested, false)
  assert.equal(readinessOf({ batchId: 'b3', startDate: '2026-10-14' }, { loanMeta: meta, today }).notTested, true)  // started 2 days ago
  assert.equal(readinessOf({ batchId: 'b3', startDate: '2026-09-01' }, { loanMeta: meta, today }).notTested, false) // over a week
  assert.equal(readinessOf({ batchId: 'b3', startDate: '2026-10-20' }, { loanMeta: meta, today }).notTested, false) // not started
  const r = readinessOf({ batchId: 'b2', startDate: '2026-10-14' }, { loanMeta: meta, today })
  assert.equal(r.notTested, false)
  assert.equal(fmtWhen(r.tested), '15 Oct, 17:40')
  assert.equal(r.dispatched, true)
})

test('job: number, closed, test, or still being made', () => {
  assert.deepEqual(jobOf({ simproJobId: 209677 }), { label: 'Job #209677', closed: false, test: false })
  assert.equal(jobOf({ simproJobId: 209067, simproClosedAt: '2026-06-18' }).closed, true)
  assert.equal(jobOf({ simproJobId: 'TEST-123456' }).test, true)
  assert.equal(jobOf({ simproJobId: { status: 'pending' } }).pending, true)
  assert.equal(jobOf({}), null)
})
