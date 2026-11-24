// npm test -w apps/equipment — a loan form save says what it changed (for the audit and activity logs), and a
// device typed into the form's table that isn't on the loan is pointed out (model.js formChanges, formAssetsNotOnLoan).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formAssetsNotOnLoan, formChanges, formDoc } from '../src/model.js'

const items = [{ CHSAssetNo: '100176', Model: 'A9', Description: 'A9 Anaesthesia System', SerialNo: 'FX7' }, { CHSAssetNo: '100178', Model: 'A9 V90 Sevoflurane', Description: 'Vaporiser', SerialNo: 'AG4' }]
const form = (o = {}) => ({ loanTo: 'Grace Hospital', location: 'Tauranga', startDate: '2026-11-30', endDate: '2026-12-11', accountManager: 'Sam Lee', contactNumber: '',
  rows: items.map((e) => [e.CHSAssetNo, e.Model, e.Description, e.SerialNo, '']), notes: 'A9 accessories', shipping: 'Truck delivery', items, ...o })

test('a save that changes nothing says nothing; each part changed is named, never its text', () => {
  const stored = formDoc(form(), {})
  assert.deepEqual(formChanges(stored, formDoc(form(), stored)), [])
  assert.deepEqual(formChanges(stored, formDoc(form({ endDate: '2026-12-18', notes: 'A9 accessories, BIS puck' }), stored)), ['dates', 'notes'])
  const moreRows = form({ rows: [...form().rows, ['100177', 'A9 V90 Vaporiser Des', '', '', '']] })
  assert.deepEqual(formChanges(stored, formDoc(moreRows, stored)), ['device rows'])
  assert.deepEqual(formChanges(stored, formDoc(form({ loanTo: 'Grace Hospital Theatre', accessories: [{ code: '0010-30-42726', qty: 2 }] }), stored)), ['customer', 'accessories'])
})

test('a new loan finished: its rows written for the first time are not a change', () => {
  const made = { loanTo: 'Grace Hospital', location: 'Tauranga', startDate: '2026-11-30', endDate: '2026-12-11', accountManager: 'Sam Lee', items, notesCell: 'A9 accessories', authCell: 'Truck delivery' }
  const pendingNote = form({ rows: form().rows.map((r, i) => (i === 1 ? [...r.slice(0, 4), 'Awaiting return'] : r)) })
  assert.deepEqual(formChanges(made, formDoc(pendingNote, made)), [])
  assert.deepEqual(formChanges(made, formDoc(form({ notes: 'Changed at finish' }), made)), ['notes'])
  assert.deepEqual(formChanges(null, formDoc(form(), {})).slice(0, 2), ['customer', 'address'], 'nothing stored: everything is new')
})

test('a device typed into the table that is not on the loan is pointed out; free text and its own devices are not', () => {
  const equipment = [...items, { CHSAssetNo: '100177', Model: 'A9 V90 Vaporiser Des' }, { CHSAssetNo: '100403', Model: 'BeneVision V700' }]
  const rows = [...form().rows, [' 100177 ', '', '', '', ''], ['Cable kit', '', '', '', ''], ['100403', '', '', '', ''], ['100177', '', '', '', ''], ['', '', '', '', '']]
  assert.deepEqual(formAssetsNotOnLoan(rows, items, equipment), ['100177', '100403'])
  assert.deepEqual(formAssetsNotOnLoan(form().rows, items, equipment), [])
})

test('a device taken off the loan (or off the devices it waits for) is warned about on the form until its row goes', async () => {
  const { formAssetsNotOnLoan, rowsWithout } = await import('../src/model.js')
  const equipment = [{ CHSAssetNo: '100148', Model: 'ePM 12M' }, { CHSAssetNo: '100089', Model: 'N1' }]
  const items = [equipment[1]] // 100148 came off the waiting list; its row stayed
  const rows = [['100148', 'ePM 12M', 'ePM 12M', 'AC9-1', ''], ['100089', 'N1', 'N1', 'AA3-1', ''], ['', 'Rollstand', 'Rollstand', '', '']]
  const warned = formAssetsNotOnLoan(rows, items, equipment)
  assert.deepEqual(warned, ['100148'])
  // "Take it off the form" (and store.jsx's takeOffForm): only that row goes; typed rows stay.
  const after = rowsWithout(rows, warned)
  assert.deepEqual(after.map((r) => r[0] || r[1]), ['100089', 'Rollstand'])
  assert.deepEqual(formAssetsNotOnLoan(after, items, equipment), [])
})
