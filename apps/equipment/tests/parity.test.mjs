// npm test -w apps/equipment — rules brought back in line with the old tracker (21 Oct parity check).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { importRetiredRows, linkTarget, loanFormRtf, loanAM, loanSections, loansMissingJobs, metaKey, overviewOf, searchEquipment } from '../src/model.js'

const today = '2026-10-21'
const shelf = (id, o = {}) => ({ id, CHSAssetNo: 'A' + id, Model: 'M' + id, Returned: 'Yes', OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', BatchID: '', ...o })
const out = (id, o) => shelf(id, { Returned: 'No', OnLoanTo: 'Hutt', Location: 'ED', LoanStartDate: '2026-10-01', LoanEndDate: '2026-10-30', BatchID: 'b9', ...o })

test('search covers every field, as the old one (MACs, device IDs)', () => {
  const eq = [shelf('1', { LanMAC: 'AA:BB:CC', DeviceID: 'DEV-77' }), shelf('2')]
  assert.deepEqual(searchEquipment(eq, 'aa:bb').map((e) => e.id), ['1'])
  assert.deepEqual(searchEquipment(eq, 'dev-77').map((e) => e.id), ['1'])
})

test('a loanMeta key never holds . # $ [ ] /; the account manager is found under it', () => {
  assert.equal(metaKey('loandoc_St. John|||2026-10-30'), 'loandoc_St_ John|||2026-10-30')
  const k = 'loandoc_' + encodeURIComponent('St. John|||2026-10-30')
  assert.equal(loanAM({ loanTo: 'St. John', endDate: '2026-10-30' }, { loanMeta: { [metaKey(k)]: { accountManager: 'Sam' } } }), 'Sam')
})

test('old ?tab= links land on Manage’s parts', () => {
  const sections = { needsReassign: [], current: [], longTerm: [], upcoming: [] }
  assert.deepEqual(linkTarget('?tab=retired', sections), { view: 'manage', params: { part: 'retired' } })
  assert.deepEqual(linkTarget('?tab=import', sections), { view: 'manage', params: {} })
  assert.deepEqual(linkTarget('?tab=database', sections), { view: 'equipment', params: {} })
})

test('transfers due: a booking held up only by long-term loans is left out (old: checkStuckLoansForAM)', () => {
  const equipment = [out('1', { BatchID: 'lt' }), out('2', { BatchID: 'b9' })]
  const upcoming = [
    { id: 'u1', loanTo: 'Nelson', startDate: '2026-10-20', endDate: '2026-10-25', items: [{ id: '1', CHSAssetNo: 'A1' }] },
    { id: 'u2', loanTo: 'Taupo', startDate: '2026-10-20', endDate: '2026-10-25', items: [{ id: '2', CHSAssetNo: 'A2' }] },
  ]
  const loanMeta = { lt: { longTerm: true } }
  const sections = loanSections({ equipment, upcoming, loanMeta, today })
  assert.deepEqual(overviewOf(sections, { equipment, upcoming, loanMeta, today }).stuck.map((u) => u.id), ['u2'])
})

test('loans with no Simpro job include bookings (Upcoming), soonest first', () => {
  const equipment = [out('1', { BatchID: 'b1', LoanStartDate: '2026-10-10' }), shelf('2')]
  const upcoming = [{ id: 'u1', loanTo: 'Nelson', location: 'ICU', startDate: '2026-10-05', endDate: '2026-11-01', items: [{ id: '2', CHSAssetNo: 'A2' }] }]
  const sections = loanSections({ equipment, upcoming, today })
  const rows = loansMissingJobs(sections, {}, { createJobs: true }, today, equipment)
  assert.deepEqual(rows.map((g) => [g.loanTo, g.type]), [['Nelson', 'Upcoming'], ['Hutt', 'Active']])
  assert.equal(rows[0].items[0].Model, 'M2', 'a booking’s devices from the equipment list')
})

test('retired import: its own headings; no date is today, no reason "Imported"; a known asset number is updated', () => {
  let n = 0
  const r = importRetiredRows([{ id: 'r1', CHSAssetNo: '100001', Model: 'Old', RetiredReason: 'Sold' }],
    [{ 'CHS Asset No.': '100001', Reason: 'Lost' }, { 'chs asset number': ' 100002 ', Model: 'X9', 'NZ$ Price': '12.5' }, { Notes: 'no number or model' }],
    { today, makeId: () => 'new' + ++n })
  assert.deepEqual([r.added, r.updated], [1, 1])
  assert.deepEqual(r.retired.map((e) => [e.id, e.CHSAssetNo, e.RetiredReason, e.RetiredDate || '']), [['new1', '100002', 'Imported', today], ['r1', '100001', 'Lost', today]])
  assert.equal(r.retired[0].NZPrice, '12.5')
})
test('the loan form as RTF (old: Export RTF): bold labels, the rows, escaped text, the old file name', () => {
  const { name, rtf } = loanFormRtf({ loanTo: 'St. Mary’s {ED}', location: 'Ward 2', startDate: '2026-10-21', endDate: '2026-11-04', accountManager: 'Sam', rows: [['100201', 'A9', 'Anaesthesia', 'SN1', ''], ['', '', '', '', '']], notes: 'Line one\nLine two' })
  assert.equal(name, 'CHS_Loan_St_Marys_ED_2026-10-21.rtf')
  assert.ok(rtf.startsWith('{\\rtf1'))
  assert.match(rtf, /\{\\b Customer:\}  St\. Mary\\u8217\?s \\\{ED\\\}/)
  assert.match(rtf, /21\/10\/2026/)
  assert.match(rtf, /100201 {6}  A9 /, 'the asset number padded to 12, then two spaces')
  assert.equal((rtf.match(/Line (one|two)/g) || []).length, 2)
})