// npm test -w apps/equipment — a loan's accessories by code and quantity (model.js; Accessories.jsx draws them).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessoryCatalogue, cleanAccessories, formDoc, lastAccessoriesFor, loanFormHtml, loanFormRtf, searchAccessories } from '../src/model.js'

const loanDocs = {
  batch_1: { loanTo: 'Waikato', startDate: '2026-10-01', items: [{ Model: 'ePM 12M' }], accessories: [{ code: '115-002481-00', name: 'NIBP cuff, adult', qty: 3 }, { code: '0010-30-42726', name: 'SpO2 sensor', qty: 2 }] },
  batch_2: { loanTo: 'Hutt', startDate: '2026-11-10', items: [{ Model: 'ePM 12M' }, { Model: 'D60' }], accessories: [{ code: '115-002481-00', name: 'NIBP cuff, adult 25-35 cm', qty: 2 }] },
  batch_3: { loanTo: 'Tauranga', startDate: '2026-11-15', items: [{ Model: 'N17' }] },
}

test('a list is tidied: code or name needed, whole quantities 1–999, the same code once with quantities added', () => {
  assert.deepEqual(cleanAccessories([
    { code: ' 115-002481-00 ', name: 'Cuff', qty: 2 }, { code: '115 002481 00', qty: '3' }, { name: 'Test lung' },
    { code: '', name: '' }, { code: 'X', qty: 0 }, { code: 'Y', qty: 5000 }, null,
  ]), [
    { code: '115-002481-00', name: 'Cuff', qty: 5 }, { code: '', name: 'Test lung', qty: 1 }, { code: 'X', name: '', qty: 1 }, { code: 'Y', name: '', qty: 999 },
  ])
  assert.deepEqual(cleanAccessories(undefined), [])
})

test('suggestions: the catalogue and every code used on a loan, with the latest name and how often used', () => {
  const cat = accessoryCatalogue(loanDocs, [{ code: '0010-30-42732', name: 'ECG lead set, 5-lead', models: ['N17'], group: 'ECG' }])
  const by = Object.fromEntries(cat.map((a) => [a.code, a]))
  assert.equal(by['115-002481-00'].uses, 2)
  assert.equal(by['115-002481-00'].name, 'NIBP cuff, adult 25-35 cm')
  assert.equal(by['0010-30-42732'].uses, 0)
  assert.deepEqual(searchAccessories(cat, 'cuff').map((a) => a.code), ['115-002481-00'])
  assert.deepEqual(searchAccessories(cat, '11500248').map((a) => a.code), ['115-002481-00']) // dashes don't matter
  assert.deepEqual(searchAccessories(cat, 'ecg lead').map((a) => a.code), ['0010-30-42732'])
  assert.deepEqual(searchAccessories(cat, '0010', { models: ['N17'] }).map((a) => a.code), ['0010-30-42732', '0010-30-42726']) // suits the loan's monitor first
  assert.deepEqual(searchAccessories(cat, ''), [])
})

test('"as the last loan": the newest loan with that model that had accessories', () => {
  assert.equal(lastAccessoriesFor('epm 12m', loanDocs).loanTo, 'Hutt')
  assert.equal(lastAccessoriesFor('ePM 12M', loanDocs, { not: 'batch_2' }).loanTo, 'Waikato')
  assert.equal(lastAccessoriesFor('N17', loanDocs), null) // its loan had none
  assert.equal(lastAccessoriesFor('', loanDocs), null)
})

test('optional on the form: printed and emailed only when there are some; kept by saves that do not know about them', () => {
  const base = { loanTo: 'Waikato', rows: [], items: [] }
  assert.doesNotMatch(loanFormHtml(base), /Accessory code/)
  const html = loanFormHtml({ ...base, accessories: [{ code: '115-002481-00', name: 'NIBP cuff <adult>', qty: 3 }] })
  assert.match(html, /Accessory code/)
  assert.match(html, /NIBP cuff &lt;adult&gt;/)
  assert.match(loanFormRtf({ ...base, accessories: [{ code: 'A', name: 'B', qty: 1 }] }).rtf, /ACCESSORIES/)
  assert.doesNotMatch(loanFormRtf(base).rtf, /ACCESSORIES/)
  const stored = { accessories: [{ code: 'K', name: 'Kept', qty: 2 }] }
  assert.deepEqual(formDoc(base, stored).accessories, [{ code: 'K', name: 'Kept', qty: 2 }]) // a save without the list keeps it
  assert.equal(formDoc({ ...base, accessories: [] }, stored).accessories, undefined) // unticked: none
})
