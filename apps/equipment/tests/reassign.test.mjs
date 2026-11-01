// npm test -w apps/equipment — a started loan waiting on devices that are out on other loans: which loans hold them,
// where each "Still on loan to…" line goes, and the Transfer dialog's order and search (model.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decodeQueue, linkTarget, loanSections, matchLoan, reassignGroups, reassignParams, transferTargets } from '../src/model.js'

const today = '2026-10-16'
const dev = (id, o = {}) => ({ id, CHSAssetNo: 'A' + id, Model: 'D30', Returned: 'No', OnLoanTo: 'Hutt', Location: 'ED', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'b1', ...o })
const equipment = [
  dev('W1', { OnLoanTo: 'Waitakere', BatchID: 'w1', LoanStartDate: '2026-09-28', LoanEndDate: '2026-11-30' }),
  dev('P1'), dev('P2'),                                                    // held by Hutt (b1)
  dev('P3', { OnLoanTo: 'Nelson', BatchID: 'b2' }),                         // held by Nelson (b2)
  dev('P4', { OnLoanTo: 'Taupo', BatchID: 'b3', LoanStartDate: '2026-12-15', LoanEndDate: '2026-12-20' }), // booked from after Waitakere ends: no hold-up
  dev('P5', { Returned: 'Yes', OnLoanTo: '' }),                             // free
]
const upcoming = [{ id: 'w1', loanTo: 'Waitakere', location: 'ICU', startDate: '2026-09-28', endDate: '2026-11-30',
  items: ['P1', 'P2', 'P3', 'P4', 'P5'].map((id) => ({ id, CHSAssetNo: 'A' + id })) }]
const loanMeta = { b1: { accountManager: 'Sam' }, b2: { accountManager: 'Theresa' }, w1: { accountManager: 'Theresa' } }
const sections = loanSections({ equipment, upcoming, loanMeta, today })
const all = [...sections.needsReassign, ...sections.upcoming, ...sections.current, ...sections.longTerm]
const waitakere = sections.needsReassign.find((g) => g.batchId === 'w1')

test('the loan is under Needs reassigning, and its holders are grouped, in the order listed', () => {
  assert.ok(waitakere)
  const groups = reassignGroups(waitakere, all, equipment, today)
  assert.deepEqual(groups.map((x) => [x.key, x.nos]), [['loan:b1', ['AP1', 'AP2']], ['loan:b2', ['AP3']]])
})

test('reassign params open the clicked holder with all its devices ticked, the rest queued', () => {
  const groups = reassignGroups(waitakere, all, equipment, today)
  const first = reassignParams(waitakere, groups, 0)
  assert.deepEqual([first.open, first.act, first.to, first.nos], ['loan:b1', 'transfer', 'loan:w1', 'AP1,AP2'])
  assert.deepEqual(decodeQueue(first.queue), [{ key: 'loan:b2', nos: 'AP3' }])
  const second = reassignParams(waitakere, groups, 1) // clicked the Nelson line: Nelson first, Hutt after
  assert.deepEqual([second.open, second.nos], ['loan:b2', 'AP3'])
  assert.deepEqual(decodeQueue(second.queue), [{ key: 'loan:b1', nos: 'AP1,AP2' }])
  assert.equal(reassignParams(waitakere, [groups[0]], 0).queue, undefined) // nothing after the last
})

test('a queue that is empty, mangled or not a list is nothing', () => {
  assert.deepEqual(decodeQueue(''), [])
  assert.deepEqual(decodeQueue(undefined), [])
  assert.deepEqual(decodeQueue('not json'), [])
  assert.deepEqual(decodeQueue('{"a":1}'), [])
  assert.deepEqual(decodeQueue('[["loan:b2",""],[1,"x"],["loan:b3","A9"]]'), [{ key: 'loan:b3', nos: 'A9' }])
})

test('the ?reassign= link (Overview, the Reassign / transfer button) carries the later holders too', () => {
  const t = linkTarget('?reassign=w1', sections, upcoming, equipment)
  assert.equal(t.params.open, 'loan:b1')
  assert.equal(t.params.to, 'loan:w1')
  assert.deepEqual(decodeQueue(t.params.queue), [{ key: 'loan:b2', nos: 'AP3' }])
})

test('transfer targets: the account manager’s loans first, then the rest, each A to Z', () => {
  const t = (loanTo, am, startDate = '2026-10-01') => ({ loanTo, am, startDate })
  const list = [t('Zeta', 'Sam'), t('alpha', 'Theresa'), t('Bay', 'Sam'), t('Waitakere – Resus', 'Theresa'), t('Napier', ''), t('Alpha', 'Theresa', '2026-09-01')]
  const out = transferTargets(list, { am: 'theresa ' })
  assert.deepEqual(out.map((o) => [o.x.loanTo, o.mine]), [['Alpha', true], ['alpha', true], ['Waitakere – Resus', true], ['Bay', false], ['Napier', false], ['Zeta', false]])
  assert.ok(transferTargets(list, {}).every((o) => !o.mine)) // no manager known: just A to Z
  assert.deepEqual(transferTargets(list, {}).map((o) => o.x.loanTo).slice(0, 3), ['Alpha', 'alpha', 'Bay'])
})

test('the search matches every word in customer, location, account manager or job number', () => {
  const x = { loanTo: 'Waitakere Hospital Resus Team', location: 'Henderson', am: 'Theresa Fogarty', doc: { simproJobId: 209677 } }
  assert.ok(matchLoan(x, ''))
  assert.ok(matchLoan(x, 'waitakere resus'))
  assert.ok(matchLoan(x, 'theresa'))
  assert.ok(matchLoan(x, 'henderson 2096'))
  assert.ok(!matchLoan(x, 'waitakere nelson'))
  assert.ok(!matchLoan({ loanTo: 'Hutt', doc: { simproJobId: 'pending' } }, 'pending')) // not a job number
})
