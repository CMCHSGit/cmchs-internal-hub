// npm test -w apps/equipment — the calendar, history and audit filters (model.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { calendarRows, dayList, filterAudit, filterHistory } from '../src/model.js'

const g = (o) => ({ kind: 'loan', key: o.loanTo, loanTo: 'X', startDate: '2026-10-01', endDate: '2026-10-30', items: [{}], pending: [], longTerm: false, ...o })
const sections = {
  needsReassign: [],
  current: [g({ loanTo: 'Late', endDate: '2026-10-10' }), g({ loanTo: 'Now' }), g({ loanTo: 'Past', endDate: '2026-09-01' })],
  longTerm: [g({ loanTo: 'Forever', longTerm: true, endDate: '' })],
  upcoming: [g({ kind: 'scheduled', loanTo: 'Soon', startDate: '2026-10-20' }), g({ kind: 'booking', loanTo: 'Booked', startDate: '2026-11-02', endDate: '2026-11-20', items: [], pending: [{}] }),
    g({ kind: 'booking', loanTo: 'Empty', startDate: '2026-11-02', items: [], pending: [] }), g({ kind: 'scheduled', loanTo: 'Far', startDate: '2027-03-01', endDate: '2027-03-10' })],
}

test('calendar: what touches the window, long term and empty bookings left out, with a state each', () => {
  const r = calendarRows(sections, { from: '2026-10-05', to: '2026-11-29', today: '2026-10-16' })
  assert.deepEqual(r.map((x) => [x.loanTo, x.state]), [['Late', 'overdue'], ['Now', 'active'], ['Soon', 'scheduled'], ['Booked', 'booking']])
  assert.deepEqual(calendarRows(sections, { from: '2026-10-05', to: '2026-11-29', sort: 'name-asc' }).map((x) => x.loanTo), ['Booked', 'Late', 'Now', 'Soon'])
  assert.deepEqual(dayList('2026-12-30', 3), ['2026-12-30', '2026-12-31', '2027-01-01'])
})

test('history and audit search', () => {
  const h = [{ chsAssetNo: '100201', action: 'Loan', loanTo: 'Waikato' }, { chsAssetNo: '100202', action: 'Return', notes: 'Returned', operator: 'Sam' }]
  assert.equal(filterHistory(h, { q: 'waik' }).length, 1)
  assert.equal(filterHistory(h, { action: 'Return' })[0].chsAssetNo, '100202')
  assert.equal(filterHistory(h, { q: 'sam' }).length, 1)
  const a = [{ type: 'loan_created', summary: '2 items loaned to Hutt', detail: { items: ['100201'] } }, { type: 'simpro_closed', summary: 'Simpro job #1 closed' }]
  assert.equal(filterAudit(a, { kind: 'simpro' }).length, 1)
  assert.equal(filterAudit(a, { q: '100201' }).length, 1)
})
