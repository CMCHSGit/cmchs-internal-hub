// npm test -w apps/equipment — the overdue demos export (model.js overdueRows, OVERDUE_COLUMNS) and its button.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { OVERDUE_COLUMNS, loanSections, overdueRows, toCsv } from '../src/model.js'

const today = '2026-11-26'
const out = (id, no, loan) => ({ id, CHSAssetNo: no, Model: 'TV80', Description: 'TV80 Ventilator', SerialNo: 'S' + id, Returned: 'No', OnLoanTo: loan.to, Location: loan.where,
  LoanStartDate: loan.start, LoanEndDate: loan.end, BatchID: loan.batch })
const equipment = [
  out('1', '100244', { to: 'Hutt Hospital', where: 'ED', start: '2026-11-01', end: '2026-11-20', batch: 'b1' }),
  out('2', '100438', { to: 'Hutt Hospital', where: 'ED', start: '2026-11-01', end: '2026-11-20', batch: 'b1' }),
  out('3', '100018', { to: 'Waikato', where: 'ICU', start: '2026-10-01', end: '2026-11-10', batch: 'b2' }),
  out('4', '100021', { to: 'Napier', where: 'Ward', start: '2026-11-20', end: '2026-12-10', batch: 'b3' }), // not due yet
  out('5', '100022', { to: 'Dunedin', where: 'Theatre', start: '2026-10-01', end: '2026-11-25', batch: 'b4' }), // no account manager
  out('6', '100023', { to: 'Long', where: 'Ward', start: '2026-05-01', end: '', batch: 'b5' }), // long term
  out('7', '100024', { to: 'Soon', where: 'Ward', start: '2026-12-05', end: '2026-12-09', batch: 'b6' }), // not started
  { id: '8', CHSAssetNo: '100025', Returned: 'Yes' },
]
const loanMeta = { b1: { accountManager: 'Sam Lee' }, b2: { accountManager: 'Alex Kim' }, b3: { accountManager: 'Sam Lee' }, b5: { accountManager: 'Sam Lee', longTerm: true }, b6: { accountManager: 'Sam Lee' } }
const loanDocs = { b1: { contactNumber: '021 111' } }
const team = [{ name: 'Sam Lee', email: 'sam@example.com' }, { name: 'Alex Kim', email: 'alex@example.com' }]
const sections = loanSections({ equipment, upcoming: [], loanMeta, loanDocs, today })
const rows = overdueRows(sections, { today, team })

test('one row per device on a started loan past its end date: not due, not started and long-term ones are left out', () => {
  assert.deepEqual(rows.map((r) => r.CHSAssetNo), ['100018', '100244', '100438', '100022'], 'by account manager, then longest overdue')
  assert.ok(!rows.some((r) => ['100021', '100024', '100023', '100025'].includes(r.CHSAssetNo)))
})

test('each row has its account manager, their email, the loan and the days overdue', () => {
  assert.deepEqual(rows[0], { am: 'Alex Kim', amEmail: 'alex@example.com', loanTo: 'Waikato', location: 'ICU', contact: '', CHSAssetNo: '100018', Model: 'TV80', Description: 'TV80 Ventilator', SerialNo: 'S3',
    start: '1-Oct-2026', end: '10-Nov-2026', daysOver: 16, _end: '2026-11-10' }, 'sorted by account manager, so Alex first')
  const sam = rows.filter((r) => r.am === 'Sam Lee')
  assert.deepEqual(sam.map((r) => [r.CHSAssetNo, r.daysOver, r.amEmail, r.contact]), [['100244', 6, 'sam@example.com', '021 111'], ['100438', 6, 'sam@example.com', '021 111']])
})

test('sorted by account manager, longest overdue first; no account manager last', () => {
  assert.deepEqual(rows.map((r) => r.am), ['Alex Kim', 'Sam Lee', 'Sam Lee', ''])
  assert.equal(rows[3].amEmail, '')
})

test('nothing overdue, nothing listed', () => {
  assert.deepEqual(overdueRows(loanSections({ equipment: [equipment[3]], upcoming: [], loanMeta, loanDocs, today }), { today, team }), [])
  assert.deepEqual(overdueRows({}, { today }), [])
})

test('as a CSV: a header with the columns, then the rows', () => {
  const lines = toCsv(rows, OVERDUE_COLUMNS).split('\n')
  assert.equal(lines.length, 1 + rows.length)
  assert.equal(lines[0], OVERDUE_COLUMNS.map(([, h]) => h).join(','))
  assert.match(lines[1], /^"Alex Kim","alex@example.com","Waikato","ICU"/)
})

test('the Loans screen has the export button, and Return items is green', () => {
  const loans = readFileSync(new URL('../src/Loans.jsx', import.meta.url), 'utf8')
  assert.match(loans, /Export overdue/)
  assert.match(loans, /overdueRows\(sections/)
  const actions = readFileSync(new URL('../src/LoanActions.jsx', import.meta.url), 'utf8')
  assert.match(actions, /key="return"[^>]*className="eq-return-btn"/)
  const css = readFileSync(new URL('../src/equipment.css', import.meta.url), 'utf8')
  assert.match(css, /\.btn\.eq-return-btn\s*\{[^}]*#5b8801/)
})
