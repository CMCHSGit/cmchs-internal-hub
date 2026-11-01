// npm test -w apps/equipment — adding ticked devices to an existing loan (model.js addedText, loanLabel).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { addedText, loanLabel } from '../src/model.js'

test('the message after adding says what happened to each kind', () => {
  const g = { loanTo: 'Hutt' }
  assert.equal(addedText(g, { added: [{}], booked: [], moved: [], reclaimed: [] }), '1 item added to Hutt.')
  assert.equal(addedText(g, { added: [{}, {}, {}], booked: [{}], moved: [], reclaimed: [] }), '3 items added to Hutt; 1 still out elsewhere, booked to follow.')
  assert.match(addedText(g, { added: [{}], booked: [], moved: [{ OnLoanTo: 'Nelson' }, { OnLoanTo: 'Nelson' }], reclaimed: ['Napier'] }),
    /taken off Nelson: their loan form and Simpro job still list them; taken from bookings for Napier: make sure they’re back in time\.$/)
  assert.equal(addedText(g, { added: [{}] }), '1 item added to Hutt.') // a result without the optional lists
})

test('a loan in the picker: kind, customer, when, job, and its manager unless it is the sorting one\'s', () => {
  const loan = { kind: 'loan', loanTo: 'Hutt', endDate: '2026-11-15', am: 'Sam Lee', doc: { simproJobId: 209677 } }
  assert.match(loanLabel(loan, 'Sam Lee'), /^Active: Hutt \(due 15-Nov-2026\) · .*209677$/)
  assert.ok(!loanLabel(loan, 'Sam Lee').includes('Sam Lee'))
  assert.ok(loanLabel(loan, 'Theresa').endsWith(' · Sam Lee'))
  assert.equal(loanLabel({ kind: 'loan', loanTo: 'Long', am: '' }, ''), 'Active: Long (no end date)')
  assert.equal(loanLabel({ kind: 'booking', loanTo: 'Napier', startDate: '2026-11-20', am: '' }, ''), 'Booking: Napier (starts 20-Nov-2026)')
  assert.equal(loanLabel({ kind: 'scheduled', loanTo: 'Nelson', startDate: '2026-11-20', am: '', doc: { simproJobId: { pending: true } } }, ''), 'Scheduled: Nelson (starts 20-Nov-2026)')
})
