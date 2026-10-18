// npm test -w apps/equipment — counting (model.js), as the old tracker's.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { countCategory, countEquipment, oldDate } from '../src/model.js'

const out = { id: '1', CHSAssetNo: 'A1', Model: 'M', Returned: 'No', OnLoanTo: 'Hutt', Location: 'ED', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-20', BatchID: 'b9' }

test('count categories: never, counted here (Counted DD/MM/YYYY), counted on the old spreadsheet', () => {
  assert.deepEqual([{}, { Counted: 'No' }, { Counted: 'Counted 16/10/2026' }, { Counted: 'Yes' }, { Counted: 'Counted 16-Oct-2026' }].map(countCategory), ['never', 'never', 'new', 'old', 'old'])
  assert.equal(oldDate('2026-10-16'), '16/10/2026')
})

test('count: counted and back in the office, or counted where it is', () => {
  const back = countEquipment([out], [], '1', { today: '2026-10-16', ts: 'T', operator: 'Ann' })
  assert.deepEqual([back.equipment[0].Counted, back.equipment[0].OnLoanTo, back.equipment[0].Returned, back.equipment[0].BatchID], ['Counted 16/10/2026', '', 'Yes', ''])
  assert.deepEqual([back.history[0].action, back.history[0].notes, back.history[0].loanTo], ['Count', 'Counted 16/10/2026', 'Hutt'])
  assert.deepEqual([back.was.batchId, back.was.out], ['b9', true])
  assert.equal(countCategory(back.equipment[0]), 'new', 'the old count overview still recognises it')
  const kept = countEquipment([out], [], '1', { keepOnLoan: true, today: '2026-10-16', ts: 'T' })
  assert.deepEqual([kept.equipment[0].OnLoanTo, kept.history[0].notes], ['Hutt', 'Counted 16/10/2026 (kept on loan)'])
  assert.equal(countEquipment([out], [], 'nope'), null)
})
