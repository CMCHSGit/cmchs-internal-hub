// npm test -w apps/equipment — links in from outside (model.js linkTarget), the old tracker's addresses.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { linkTarget, loanSections, loanToken } from '../src/model.js'

const today = '2026-10-16'
const out = (id, o) => ({ id, CHSAssetNo: 'A' + id, Returned: 'No', OnLoanTo: 'Hutt', Location: 'ED', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'b1', ...o })
const equipment = [out('1'), out('2'), { id: '3', CHSAssetNo: 'A3', Returned: 'Yes', OnLoanTo: '' }]
const upcoming = [{ id: 'u1', loanTo: 'Nelson', startDate: '2026-10-15', endDate: '2026-10-29', items: [{ id: '2', CHSAssetNo: 'A2' }, { id: '3', CHSAssetNo: 'A3' }] }]
const sections = loanSections({ equipment, upcoming, today })

test('return and extend tokens open that loan with the action', () => {
  assert.deepEqual(linkTarget('?return=' + loanToken('Hutt', '2026-10-30'), sections, upcoming, equipment), { view: 'loans', params: { open: 'loan:b1', act: 'return' } })
  assert.deepEqual(linkTarget('?extend=' + loanToken('Hutt', '2026-10-30'), sections, upcoming, equipment).params.act, 'extend')
  assert.match(linkTarget('?return=' + loanToken('Gone', ''), sections, upcoming, equipment).note, /isn’t out any more/)
  assert.match(linkTarget('?return=!!!', sections, upcoming, equipment).note, /couldn’t be read/)
})

test('reassign opens the loan holding the booking’s devices, Transfer ready', () => {
  assert.deepEqual(linkTarget('?reassign=u1', sections, upcoming, equipment), { view: 'loans', params: { open: 'loan:b1', act: 'transfer', to: 'booking:u1', nos: 'A2' } })
  assert.match(linkTarget('?reassign=nope', sections, upcoming, equipment).note, /gone/)
})

test('a reminder’s ?open=<BatchID> opens that loan', () => {
  assert.deepEqual(linkTarget('?open=b1', sections, upcoming, equipment), { view: 'loans', params: { open: 'loan:b1' } })
  assert.deepEqual(linkTarget('?open=u1', sections, upcoming, equipment).params, { open: 'booking:u1' })
  assert.match(linkTarget('?open=gone', sections, upcoming, equipment).note, /isn’t out/)
})

test('the project tracker’s new loan, and tabs', () => {
  assert.deepEqual(linkTarget('?newLoan=1&ref=job7&loanTo=Waikato&start=2026-10-20&end=', sections), { view: 'new', params: { ref: 'job7', loanTo: 'Waikato', start: '2026-10-20' } })
  assert.deepEqual(linkTarget('?tab=loans', sections), { view: 'loans', params: {} })
  assert.equal(linkTarget('', sections), null)
})
