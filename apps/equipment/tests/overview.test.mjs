// npm test -w apps/equipment — Overview's rules (the phone's Today and Overview), model.js.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { loanSections, memberFor, overviewOf, roleOf, yoursOf } from '../src/model.js'

const today = '2026-10-16'
const out = (id, o) => ({ id, CHSAssetNo: id, Returned: 'No', OnLoanTo: 'Waikato', Location: 'ICU', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'b1', ...o })
const team = [{ name: 'Sam Lee', email: 'sam@x.nz', role: 'am' }, { name: 'Peter Lin', email: 'peter@x.nz' }, { name: 'Tama Brown', email: 'tama@x.nz' }]

test('who you are: by name, else by email; role from the record, else the service team list', () => {
  assert.equal(memberFor({ displayName: ' sam lee ', email: '' }, team).name, 'Sam Lee')
  assert.equal(memberFor({ displayName: 'Samuel Lee', email: 'SAM@x.nz' }, team).name, 'Sam Lee')
  assert.equal(memberFor({ displayName: 'Someone', email: 'no@x.nz' }, team), null)
  assert.equal(memberFor(null, team), null)
  assert.equal(roleOf(team[0]), 'am')
  assert.equal(roleOf(team[1]), 'service')
  assert.equal(roleOf(team[2]), 'am')
})

test('overview: active, overdue, due today, upcoming, transfers due, needs testing, by account manager', () => {
  const equipment = [
    out('a'), out('b'),                                                                       // b1: current, Sam
    out('c', { BatchID: 'b2', OnLoanTo: 'Napier', LoanEndDate: '2026-10-10' }),               // overdue, Tama
    out('d', { BatchID: 'b3', OnLoanTo: 'Hutt', LoanEndDate: today }),                       // due back today, Sam
    out('e', { BatchID: 'b4', OnLoanTo: 'Tauranga', LoanStartDate: '2026-10-20' }),           // scheduled, untested
    out('f', { BatchID: 'b5', OnLoanTo: 'Nelson', LoanStartDate: '2026-10-21' }),             // scheduled, tested
    out('g', { BatchID: 'b6', OnLoanTo: 'Middlemore', LoanEndDate: '2026-01-01' }),           // long term: never overdue
    out('h', { BatchID: 'testbatch_1' }),                                                     // hidden test loan
    { id: 'i', CHSAssetNo: 'i', Returned: 'No', OnLoanTo: '' },                                // on the shelf
  ]
  const upcoming = [
    { id: 'u1', loanTo: 'Dunedin', startDate: '2026-11-02', accountManager: 'Sam Lee', items: [{ id: 'i' }] }, // a booking ahead
    { id: 'u2', loanTo: 'Hutt 2', startDate: '2026-10-15', accountManager: 'Sam Lee', items: [{ id: 'c' }] },  // start come, device still out
    { id: 'u3', loanTo: 'Empty', startDate: '2026-11-05', accountManager: 'Sam Lee', items: [] },              // no devices: not counted ahead
    { id: 'testbatch_2', loanTo: 'Test', startDate: '2026-10-01', items: [{ id: 'a' }] },
  ]
  const loanMeta = { b1: { accountManager: 'Sam Lee' }, b2: { accountManager: 'Tama Brown' }, b3: { accountManager: 'Sam Lee' }, b5: { tested: true }, b6: { longTerm: true } }
  const sections = loanSections({ equipment, upcoming, loanMeta, today })
  const ov = overviewOf(sections, { equipment, upcoming, loanMeta, today })
  assert.equal(ov.total, 8)
  assert.deepEqual(ov.active.map((g) => g.loanTo).sort(), ['Hutt', 'Middlemore', 'Napier', 'Waikato'])
  assert.deepEqual(ov.overdue.map((g) => g.loanTo), ['Napier'])
  assert.deepEqual([ov.out, ov.dueTodayOut, ov.overdueOut], [5, 1, 1])
  assert.deepEqual(ov.ahead.map((g) => g.loanTo).sort(), ['Dunedin', 'Nelson', 'Tauranga'])
  assert.deepEqual(ov.stuck.map((u) => u.id), ['u2'])
  assert.deepEqual(ov.needsTesting.map((g) => g.loanTo), ['Tauranga'])
  assert.deepEqual(ov.byAM, [{ am: 'Sam Lee', n: 2, overdue: 0 }, { am: 'Tama Brown', n: 1, overdue: 1 }, { am: 'Unassigned', n: 1, overdue: 0 }])

  const sam = yoursOf(ov, 'Sam Lee')
  assert.deepEqual(sam.active.map((g) => g.loanTo).sort(), ['Hutt', 'Waikato'])
  assert.deepEqual(sam.ahead.map((g) => g.loanTo), ['Dunedin'])
  assert.deepEqual(sam.stuck.map((u) => u.id), ['u2'])
  assert.equal(yoursOf(ov, 'Tama Brown').overdue.length, 1)
})
