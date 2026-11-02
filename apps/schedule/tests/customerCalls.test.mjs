// npm test --prefix apps/schedule — "Customer Calls" typed into the schedule is what turns a day yellow.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { describeDay, statusOf, withCalls, STATUS } from '../src/utils/status.js'
import { daysWithCalls } from '../src/utils/week.js'

test('typing "Customer Calls" into a day colours it yellow, alone or after a place, in any case', () => {
  for (const location of ['Customer Calls', 'customer calls', 'Cass Office / Customer Calls', 'Remote Support / Customer Call']) {
    const d = describeDay({ location })
    assert.equal(d.status, 'calls', location)
    assert.equal(d.bg, STATUS.calls.bg)
    assert.equal(d.text, location, 'the text is shown as typed')
  }
  assert.equal(describeDay({ location: 'Cass Office' }).status, 'office')
})

test('leave, a non-working day and a holiday still win over calls typed on the same day', () => {
  assert.equal(statusOf({ location: 'Leave / Customer Calls' }), 'leave')
  assert.equal(statusOf({ location: 'Non Working Day, Customer Calls' }), 'nwd')
})

test('older cover is written into the text: the place stays, calls are added once', () => {
  assert.deepEqual(withCalls({ location: '', onCall: true }), { location: 'Customer Calls', onCall: false })
  assert.deepEqual(withCalls({ location: ' Cass Office ', onCall: false }), { location: 'Cass Office / Customer Calls', onCall: false })
  assert.equal(withCalls({ location: 'Cass Office / Customer Calls' }).location, 'Cass Office / Customer Calls')
  const folded = withCalls({ location: 'Hutt Hospital', onCall: true })
  assert.equal(describeDay(folded).text, describeDay({ location: 'Hutt Hospital', onCall: true }).text, 'reads the same as the flag did')
  assert.equal(describeDay(folded).status, 'calls')
})

test('weeks that still hold cover on the roster read the same until it is moved', () => {
  const days = daysWithCalls([{ location: '' }, { location: 'Cass Office' }], { calls: ['', 'u1', '', '', ''] }, 'u1')
  assert.equal(describeDay(days[1]).text, 'Cass Office / Customer Calls')
  assert.equal(describeDay(days[0]).status, null)
})
