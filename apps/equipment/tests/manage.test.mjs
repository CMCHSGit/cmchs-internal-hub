// npm test -w apps/equipment — equipment records, retired items, import/export, kits, Simpro job health (model.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { applyImport, filterRetired, importRow, itemProblem, kitFor, loansMissingJobs, restoreRetired, retireEquipment, saveItemEquipment, toCsv } from '../src/model.js'

const item = (id, o) => ({ id, CHSAssetNo: 'A' + id, Model: 'M', Returned: 'Yes', OnLoanTo: '', ...o })

test('items: an asset number is needed and can’t be someone else’s; an edit to loan fields is recorded', () => {
  const eq = [item('1'), item('2')]
  assert.match(itemProblem(eq, { CHSAssetNo: ' ' }), /needed/)
  assert.match(itemProblem(eq, { CHSAssetNo: 'a2' }), /already/)
  assert.equal(itemProblem(eq, { CHSAssetNo: 'A2' }, '2'), '', 'editing itself')
  const add = saveItemEquipment(eq, [], { CHSAssetNo: ' A3 ', Model: 'X' })
  assert.deepEqual([add.equipment.length, add.equipment[0].CHSAssetNo], [3, 'A3'])
  const ed = saveItemEquipment(eq, [], { CHSAssetNo: 'A1', Model: 'M2', OnLoanTo: 'Hutt' }, { editingId: '1', ts: 'T', operator: 'Ann' })
  assert.deepEqual([ed.equipment[0].Model, ed.history[0].action, ed.history[0].notes], ['M2', 'Edited', "On Loan To: '—' → 'Hutt'"])
  assert.equal(saveItemEquipment(eq, [], { CHSAssetNo: 'A1', Model: 'M3' }, { editingId: '1' }).history.length, 0, 'no loan field changed, no entry')
})

test('retire and bring back', () => {
  const r = retireEquipment([item('1'), item('2')], '1', { reason: 'Sold', notes: 'n', today: '2026-10-16' })
  assert.deepEqual([r.equipment.length, r.retired.RetiredDate, r.retired.RetiredReason], [1, '2026-10-16', 'Sold'])
  const b = restoreRetired([r.retired, item('9', { RetiredDate: 'x' })], ['1'])
  assert.deepEqual([b.retired.length, b.back[0].CHSAssetNo, 'RetiredDate' in b.back[0]], [1, 'A1', false])
  assert.deepEqual(filterRetired([item('1', { RetiredDate: '2026-01-01' }), item('2', { RetiredDate: '2026-05-01' })]).map((x) => x.id), ['2', '1'])
})

test('import: column names, dates, update or add; export as quoted CSV', () => {
  assert.deepEqual(importRow({ 'CHS Asset Number': 'A1', 'Serial No': 'S', 'Purchase date': '5/3/2026', 'Mfg Date': '45580', Junk: 'x' }), { CHSAssetNo: 'A1', SerialNo: 'S', PurchaseDate: '2026-03-05', MfgDate: '2024-10-14' })
  const r = applyImport([item('1')], [{ 'asset no': 'a1', model: 'New' }, { 'asset no': 'B7' }, { model: 'no number' }])
  assert.deepEqual([r.added, r.updated, r.equipment.find((e) => e.id === '1').Model, r.equipment[0].CHSAssetNo], [1, 1, 'New', 'B7'])
  assert.equal(toCsv([{ a: 'x"y', b: 1 }], [['a', 'A'], ['b', 'B']]), 'A,B\n"x""y","1"')
})

test('kits: a trigger offers its accessories, each with its state', () => {
  const kits = { k: { label: 'Kit', triggers: [' A1 '], accessories: [{ assetNo: 'A2' }, { assetNo: 'A3' }, { assetNo: 'A9' }] } }
  const eq = [item('1'), item('2'), item('3', { OnLoanTo: 'Hutt', Returned: 'No' })]
  const k = kitFor(kits, eq, 'A1', ['A1'])
  assert.deepEqual(k.accessories.map((a) => [a.assetNo, a.free, a.out, !!a.item]), [['A2', true, false, true], ['A3', false, true, true], ['A9', false, false, false]])
  assert.equal(kitFor(kits, eq, 'A2'), null)
})

test('Simpro job health: loans with no job, only ones before job creation stopped (unless it’s on)', () => {
  const g = (o) => ({ kind: 'loan', key: o.batchId, loanTo: 'X', startDate: '2026-09-01', endDate: '2026-10-30', items: [], longTerm: false, ...o })
  const sections = { needsReassign: [], longTerm: [], upcoming: [], current: [
    g({ batchId: 'batch_' + Date.parse('2026-09-01') }), g({ batchId: 'batch_' + Date.parse('2026-10-10') }), g({ batchId: 'b_job' }), g({ batchId: 'b_lt', longTerm: true }),
  ] }
  const docs = { b_job: { simproJobId: 1 } }
  assert.equal(loansMissingJobs(sections, docs, { createJobs: false, windDownFrom: '2026-10-01' }).length, 1)
  assert.equal(loansMissingJobs(sections, docs, { createJobs: true }).length, 2)
})
