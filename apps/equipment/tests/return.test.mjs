// npm test -w apps/equipment — Return items, the bookings it starts, and long term (model.js), as the old tracker's.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { activateBookings, jobNumber, returnEquipment, returnFollowUps, returnToActiveProblem, suggestedReturnDate, toISO } from '../src/model.js'

const today = '2026-10-16', ts = '2026-10-16T10:00:00+12:00'
const out = (id, o) => ({ id, CHSAssetNo: 'A' + id, Model: 'M', Returned: 'No', OnLoanTo: 'Waikato', Location: 'ICU', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'b1', ...o })
const shelf = (id) => ({ id, CHSAssetNo: 'A' + id, Model: 'M', Returned: 'Yes', OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', BatchID: '' })

test('return: the loan cleared, marked returned, a Return entry each, newest first', () => {
  const r = returnEquipment([out('1'), out('2'), out('3', { BatchID: 'b2' })], [{ id: 'old' }], ['1', '2'], { today, ts, operator: 'Sam Lee' })
  assert.deepEqual(r.equipment.slice(0, 2).map((e) => [e.OnLoanTo, e.Returned, e.BatchID, e.LoanEndDate, e._transferNote]), [['', 'Yes', '', '', null], ['', 'Yes', '', '', null]])
  assert.equal(r.equipment[2].OnLoanTo, 'Waikato')
  assert.deepEqual(r.history.map((h) => h.chsAssetNo || h.id), ['A2', 'A1', 'old'])
  assert.deepEqual([r.history[0].action, r.history[0].loanTo, r.history[0].notes, r.history[0].operator], ['Return', 'Waikato', 'Returned 16/10/2026', 'Sam Lee'])
  assert.deepEqual(r.returned.map((x) => [x.id, x.batchId]), [['1', 'b1'], ['2', 'b1']])
  assert.equal(returnEquipment([shelf('9')], [], ['9']).returned.length, 0, 'already back')
})

test('after a return: an empty loan is closed, a part-returned one has its form trimmed, a legacy one closed only when empty', () => {
  const part = returnEquipment([out('1'), out('2')], [], ['1'], { today, ts })
  assert.deepEqual(returnFollowUps(part.equipment, part.returned), { close: [], prune: [{ key: 'b1', assetNos: ['A1'] }] })
  const all = returnEquipment([out('1'), out('2')], [], ['1', '2'], { today, ts })
  assert.deepEqual(returnFollowUps(all.equipment, all.returned), { close: [{ key: 'b1', loanTo: 'Waikato' }], prune: [] })
  const legacy = returnEquipment([out('1', { BatchID: '', OnLoanTo: 'Napier', LoanEndDate: '2026-11-01' })], [], ['1'], { today, ts })
  assert.deepEqual(returnFollowUps(legacy.equipment, legacy.returned).close, [{ key: 'loandoc_Napier%7C%7C%7C2026-11-01', loanTo: 'Napier' }])
})

test('bookings: a due one takes the devices now free, earliest first; one still out elsewhere waits; an expired one takes nothing', () => {
  const eq = [shelf('1'), out('2', { OnLoanTo: 'Hutt', BatchID: 'b9' }), shelf('3')]
  const upcoming = [
    { id: 'u2', loanTo: 'Nelson', location: 'ED', startDate: '2026-10-15', endDate: '2026-10-29', items: [{ id: '1' }, { id: '2' }] }, // 2 is still at Hutt
    { id: 'u1', loanTo: 'Tauranga', location: 'CCU', startDate: '2026-10-10', endDate: '2026-10-20', items: [{ id: '1' }] },          // earlier: gets 1
    { id: 'u3', loanTo: 'Old', startDate: '2026-09-01', endDate: '2026-09-30', items: [{ id: '3' }] },                                // ended: waits
    { id: 'u4', loanTo: 'Later', startDate: '2026-11-01', endDate: '2026-11-20', items: [{ id: '3' }] },                              // not started
  ]
  const a = activateBookings(eq, [], upcoming, { today, ts })
  assert.deepEqual([a.equipment[0].OnLoanTo, a.equipment[0].BatchID, a.equipment[0].Returned], ['Tauranga', 'u1', 'No'])
  assert.equal(a.equipment[1].OnLoanTo, 'Hutt')
  assert.equal(a.equipment[2].OnLoanTo, '')
  assert.deepEqual(a.changes, [{ id: 'u1', remove: true }], 'u2 took nothing (1 went to u1 first, 2 is out), so it is left alone')
  assert.equal(a.history.length, 0, 'from the shelf: no transfer entry')
})

test('bookings: a device moved from another loan is logged as a transfer and keeps a note; a part-filled booking keeps what it still waits on', () => {
  const eq = [out('1', { OnLoanTo: 'Hutt', BatchID: 'b9', Returned: 'Yes' }), out('2', { OnLoanTo: 'Hutt', BatchID: 'b9' })]
  const a = activateBookings(eq, [], [{ id: 'u1', loanTo: 'Nelson', location: 'ED', startDate: today, endDate: '2026-10-29', items: [{ id: '1' }, { id: '2' }] }], { today, ts })
  assert.equal(a.equipment[0].OnLoanTo, 'Nelson')
  assert.deepEqual([a.equipment[0]._transferNote.fromLoanTo, a.equipment[0]._transferNote.fromBatchId], ['Hutt', 'b9'])
  assert.deepEqual(a.changes, [{ id: 'u1', items: [{ id: '2' }] }])
  assert.deepEqual([a.history[0].action, a.history[0].operator], ['Transfer', null])
  assert.equal(a.audits[0][3], 'System (auto)')
})

test('bookings: a device pencilled in for a later loan that has not started, dates not clashing, is taken; that loan keeps it booked', () => {
  // 19 Oct: a 19–20 Oct booking waiting on devices on a 29 Oct – 9 Nov loan, which has its own booking already.
  const later = { OnLoanTo: 'North Shore', Location: 'Theatre', LoanStartDate: '2026-10-29', LoanEndDate: '2026-11-09', BatchID: 'bNS' }
  const eq = [out('1', later), out('2', later), out('3', { ...later, LoanStartDate: '2026-10-20' })] // 3's later loan starts on the booking's last day: clashes
  const upcoming = [
    { id: 'bH', loanTo: 'Hamilton', location: 'ICU', startDate: '2026-10-19', endDate: '2026-10-20', items: [{ id: '1', CHSAssetNo: 'A1' }, { id: '2', CHSAssetNo: 'A2' }, { id: '3', CHSAssetNo: 'A3' }] },
    { id: 'bNS', loanTo: 'North Shore', location: 'Theatre', startDate: '2026-10-29', endDate: '2026-11-09', items: [{ id: '9', CHSAssetNo: 'A9' }] },
  ]
  const a = activateBookings(eq, [], upcoming, { today: '2026-10-19', ts })
  assert.deepEqual(a.equipment.map((e) => [e.OnLoanTo, e.BatchID]), [['Hamilton', 'bH'], ['Hamilton', 'bH'], ['North Shore', 'bNS']])
  assert.equal(a.equipment[0]._transferNote, null, 'not a transfer out of a loan that never left')
  assert.deepEqual(a.changes, [
    { id: 'bH', items: [{ id: '3', CHSAssetNo: 'A3' }] },
    { id: 'bNS', items: [{ id: '9', CHSAssetNo: 'A9' }, { id: '1', CHSAssetNo: 'A1', Model: 'M', SerialNo: undefined }, { id: '2', CHSAssetNo: 'A2', Model: 'M', SerialNo: undefined }] },
  ], 'the later loan\'s existing booking is added to, not replaced')
  assert.deepEqual(a.history.map((h) => [h.action, h.loanTo, h.batchId]), [['Converted', 'North Shore', 'bNS'], ['Converted', 'North Shore', 'bNS']])
  assert.equal(a.audits.length, 2)
})

test('bookings: a later loan with no booking of its own gets one made, whole; `only` starts just the one booking', () => {
  const later = { OnLoanTo: 'North Shore', Location: 'Theatre', LoanStartDate: '2026-10-29', LoanEndDate: '2026-11-09', BatchID: 'bNS', BorrowerEmail: 'am@example.com' }
  const upcoming = [
    { id: 'bH', loanTo: 'Hamilton', location: 'ICU', startDate: '2026-10-19', endDate: '2026-10-20', items: [{ id: '1' }] },
    { id: 'bX', loanTo: 'Other', location: 'ED', startDate: '2026-10-18', endDate: '2026-10-25', items: [{ id: '2' }] },
  ]
  const a = activateBookings([out('1', later), shelf('2')], [], upcoming, { today: '2026-10-19', ts, only: 'bH', loanMeta: { bNS: { accountManager: 'Sam Lee' } } })
  assert.equal(a.equipment[1].OnLoanTo, '', 'bX not started: only bH was asked for')
  const made = a.changes.find((c) => c.id === 'bNS')
  assert.deepEqual([made.entry.loanTo, made.entry.startDate, made.entry.endDate, made.entry.accountManager, made.entry.items.map((i) => i.id)], ['North Shore', '2026-10-29', '2026-11-09', 'Sam Lee', ['1']])
  assert.deepEqual(a.changes.find((c) => c.id === 'bH'), { id: 'bH', remove: true })
})

test('long term back to active: the date checks, the date offered; Simpro dates and job numbers', () => {
  const g = { startDate: '2026-10-01' }
  assert.equal(returnToActiveProblem(g, '', today), 'Choose the new end date.')
  assert.match(returnToActiveProblem(g, '2026-10-15', today), /past/)
  assert.match(returnToActiveProblem({ startDate: '2026-12-01' }, '2026-11-01', today), /before/)
  assert.equal(returnToActiveProblem(g, '2026-11-01', today), '')
  assert.equal(suggestedReturnDate({ startDate: '2026-12-01' }, today), '2026-12-01')
  assert.equal(suggestedReturnDate(g, today), today)
  assert.equal(toISO('5/3/2026'), '2026-03-05')
  assert.equal(toISO('2026-03-05'), '2026-03-05')
  assert.deepEqual([jobNumber(209677), jobNumber('209677'), jobNumber({ status: 'pending' }), jobNumber('pending'), jobNumber(null)], [209677, 209677, null, null, null])
})
