// npm test -w apps/equipment — the loan actions' rules (model.js), as the old tracker's.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { canExtend, extendEquipment, extendedForm, extendProblem, formDoc, formFromDoc, loanDocKey, nzNow, readinessButtons, withReadiness } from '../src/model.js'

const today = '2026-10-16'
const loan = (o) => ({ kind: 'loan', key: 'b1', batchId: 'b1', loanTo: 'Waikato', startDate: '2026-10-12', endDate: '2026-10-30', items: [{ id: 'a', CHSAssetNo: '1' }], pending: [], longTerm: false, ...o })

test('testing and dispatch: offered for upcoming loans, and a started one in its first 7 days', () => {
  const none = readinessButtons(loan(), { today })
  assert.equal(none.skip, true)
  assert.deepEqual(none.tested, { on: false, at: '' })
  assert.deepEqual(none.dispatched, { on: false, at: '' })
  assert.equal(none.noTestRequired, null)

  const old = readinessButtons(loan({ startDate: '2026-10-01' }), { today })
  assert.deepEqual([old.skip, old.tested, old.dispatched], [false, null, null])

  const set = readinessButtons(loan({ startDate: '2026-10-01' }), { today, loanMeta: { b1: { tested: true, testedAt: 'T' } } })
  assert.deepEqual(set.tested, { on: true, at: 'T' }) // still shown, so it can be undone
  assert.equal(set.skip, false)

  const later = readinessButtons(loan({ kind: 'booking', startDate: '2026-12-01' }), { today })
  assert.equal(later.skip, true)

  const skipped = readinessButtons(loan(), { today, loanMeta: { b1: { noTestRequired: true } } })
  assert.deepEqual([skipped.skip, skipped.tested, !!skipped.noTestRequired], [false, null, true])
})

test('withReadiness sets the field and when, and clears both', () => {
  assert.deepEqual(withReadiness({ dispatched: true }, 'tested', true, 'X'), { dispatched: true, tested: true, testedAt: 'X' })
  assert.deepEqual(withReadiness({ tested: true, testedAt: 'X' }, 'tested', false), { tested: false, testedAt: '' })
  assert.equal(nzNow(new Date('2026-10-16T00:00:00Z')), '2026-10-16T13:00:00+13:00') // NZDT: clock time and its real offset (nz-time.test.mjs)
})

test('extend: not for long-term loans; the new date after the old; only this loan’s devices change', () => {
  assert.equal(canExtend(loan()), true)
  assert.equal(canExtend(loan({ longTerm: true })), false)
  assert.equal(canExtend(loan({ kind: 'booking', items: [] })), true)
  assert.equal(extendProblem(loan(), ''), 'Choose the new end date.')
  assert.match(extendProblem(loan(), '2026-10-30'), /after/)
  assert.equal(extendProblem(loan(), '2026-11-02'), '')
  const eq = [{ id: 'a', LoanEndDate: '2026-10-30' }, { id: 'z', LoanEndDate: '2026-10-30' }]
  assert.deepEqual(extendEquipment(eq, loan(), '2026-11-02').map((e) => e.LoanEndDate), ['2026-11-02', '2026-10-30'])
})

test('a loan form’s key: the BatchID, else the old key with the end date in it', () => {
  assert.equal(loanDocKey(loan()), 'b1')
  assert.equal(loanDocKey(loan({ batchId: '' }), '2026-11-02'), 'loandoc_Waikato%7C%7C%7C2026-11-02')
})

test('extend: a loan form under its BatchID gets the new end date, so a later Save doesn’t put the old one back', () => {
  const doc = { loanTo: 'Waikato', startDate: '2026-10-12', endDate: '2026-10-30', simproJobId: 4321, notesCell: 'n', savedRows: [['1', 'M', 'D', 'S', '']] }
  const next = extendedForm(doc, '2026-11-02')
  assert.deepEqual(next, { ...doc, endDate: '2026-11-02' }) // everything else kept, Simpro job included
  assert.equal(doc.endDate, '2026-10-30') // not changed in place
  assert.equal(extendedForm({ ...doc, endDate: '30/10/2026' }, '2026-11-02').endDate, '2026-11-02') // an old DD/MM/YYYY one too

  // Nothing to save: no form, a long-term one, one already on that date (as YYYY-MM-DD or DD/MM/YYYY), no date.
  assert.equal(extendedForm(null, '2026-11-02'), null)
  const lt = { ...doc, longTerm: true, endDate: '' }
  assert.equal(extendedForm(lt, '2026-11-02'), lt)
  const done = { ...doc, endDate: '2026-11-02' }
  assert.equal(extendedForm(done, '2026-11-02'), done)
  const oldStyle = { ...doc, endDate: '02/11/2026' }
  assert.equal(extendedForm(oldStyle, '2026-11-02'), oldStyle)
  assert.equal(extendedForm(doc, ''), doc)

  // What the form then shows, and what its Save then puts on the devices and the Simpro job: the new date.
  const info = { loanTo: 'Waikato', startDate: '2026-10-12', endDate: '2026-11-02' } // the loan's own details, after Extend
  assert.equal(formFromDoc(doc, info).endDate, '2026-10-30') // before this fix: the old date
  const shown = formFromDoc(next, info)
  assert.equal(shown.endDate, '2026-11-02')
  assert.equal(formDoc({ ...shown, items: [] }, next, info).endDate, '2026-11-02')
})

test('fmtWhen shows the old tracker’s +12:00 timestamps at the clock time written, others in NZ time', async () => {
  const { fmtWhen } = await import('../src/model.js')
  assert.equal(fmtWhen('2026-10-19T07:27:00+12:00'), '19 Oct, 07:27')
  assert.equal(fmtWhen('2026-10-18T18:27:00Z'), '19 Oct, 07:27') // NZDT, +13
  assert.equal(fmtWhen(''), '')
})
