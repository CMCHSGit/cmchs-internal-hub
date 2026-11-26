// npm test -w apps/equipment — Stock removal (Form 39): part numbers read from a bag label's text, the form's rows, the screen's wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STOCK_COLUMNS, addStockItems, readLabelText, stockItemFrom, stockProblems, stockRows, toCsv } from '../src/model.js'

const CUFF = `Mindray
NIBP Cuff, Bladderless, Infant
Model: CM1301
P/N: 040-000973-00
Qty: 1
LOT 2305A12
Shenzhen Mindray Bio-Medical Electronics Co., Ltd.`

test('the part number is the one next to P/N, never the model code', () => {
  const r = readLabelText(CUFF)
  assert.equal(r.patient, false)
  assert.equal(r.items.length, 1)
  assert.equal(r.items[0].pn, '040-000973-00')
  assert.equal(r.items[0].model, 'CM1301')
  assert.equal(r.items[0].lot, '2305A12')
  assert.equal(r.items[0].desc, 'Mindray NIBP Cuff, Bladderless, Infant (CM1301)')
})

test('"Qty: 1" on the label is the pack size and is not read as anything', () => {
  assert.ok(!JSON.stringify(readLabelText(CUFF)).includes('Qty'))
})

test('look-alike characters in the part number are put right and the row says to check', () => {
  const r = readLabelText('Model: MR420B\nP/N: O40-OO1235-OO').items[0]
  assert.equal(r.pn, '040-001235-00')
  assert.equal(r.fixed, true)
  const row = stockItemFrom(r, 1, [])
  assert.equal(row.check, true)
  assert.match(row.note, /look-alike/)
})

test('the label’s P/N is read when OCR garbles the slash', () => {
  assert.equal(readLabelText('PIN: 040-001235-00').items[0].pn, '040-001235-00')
  assert.equal(readLabelText('PN 040-001235-00').items[0].pn, '040-001235-00')
})

test('a part number in another format is copied as printed and noted for checking against SimPro', () => {
  const r = readLabelText('Sensor lead set\nP/N: TCN21-F03-007').items[0]
  assert.equal(r.pn, 'TCN21-F03-007')
  assert.match(r.formatNote, /Different format/)
  assert.match(stockItemFrom(r, 1, []).note, /Different format/)
})

test('a standard number with no P/N line is still found, and says so', () => {
  const r = readLabelText('ECG trunk cable\n040-001235-00').items[0]
  assert.equal(r.pn, '040-001235-00')
  assert.equal(r.labelled, false)
  assert.match(stockItemFrom(r, 1, []).note, /No P\/N line/)
})

test('two labels in one photo give two items, each with its own model and lot', () => {
  const text = `NIBP Cuff, Infant\nModel: CM1301\nP/N: 040-000973-00\nLOT AAA111\nSpO2 Sensor, Adult\nModel: MR420B\nP/N: 040-001235-00\nLOT BBB222`
  const r = readLabelText(text).items
  assert.deepEqual(r.map((x) => [x.pn, x.model, x.lot]), [['040-000973-00', 'CM1301', 'AAA111'], ['040-001235-00', 'MR420B', 'BBB222']])
})

test('the same number twice in the text is one item', () => {
  assert.equal(readLabelText('P/N: 040-000973-00\nP/N: 040-000973-00').items.length, 1)
})

test('text with no part number gives nothing, and patient details stop the read (QP33)', () => {
  assert.deepEqual(readLabelText('hello there').items, [])
  assert.deepEqual(readLabelText(''), { patient: false, items: [] })
  const p = readLabelText('NHI ABC1234\nP/N: 040-000973-00')
  assert.equal(p.patient, true)
  assert.deepEqual(p.items, [])
})

test('the accessory list describes a part it knows, with nothing to check', () => {
  const list = [{ code: '040-000973-00', name: 'NIBP cuff, bladderless, infant', group: 'NIBP', models: [] }]
  const row = stockItemFrom(readLabelText(CUFF).items[0], 2, list, 'x')
  assert.equal(row.desc, 'NIBP cuff, bladderless, infant')
  assert.equal(row.qty, 2)
  assert.equal(row.check, false)
})

test('adding photos: new numbers are added; more of one already there is added to it or asked about', () => {
  const read = (pn, lot) => ({ pn, lot, desc: 'Mindray x', titled: true, fixed: false, formatNote: '', labelled: true, model: '' })
  let r = addStockItems([], [read('040-000973-00', 'AAA'), read('040-001235-00', '')], 1, [], () => 'id')
  assert.equal(r.items.length, 2)
  // a different lot: more of the same
  r = addStockItems(r.items, [read('040-000973-00', 'BBB')], 2, [], () => 'id')
  assert.deepEqual(r.bumped, [{ pn: '040-000973-00', qty: 3 }])
  assert.equal(r.items[0].qty, 3)
  // the same lot, or no lot either time: ask, change nothing
  const again = addStockItems(r.items, [read('040-000973-00', 'AAA'), read('040-001235-00', '')], 1, [], () => 'id')
  assert.deepEqual(again.ask.map((a) => [a.pn, a.total]), [['040-000973-00', 4], ['040-001235-00', 2]])
  assert.deepEqual(again.items.map((i) => i.qty), [3, 1])
  assert.deepEqual(again.added, [])
  // the form passed in is not changed
  assert.equal(r.items[0].qty, 3)
})

test('the rows have the form’s columns, the date as dd-mmm-yyyy and the shared fields on each', () => {
  const form = { reason: 'Wanganui trial', date: '2026-11-27', by: 'Sam Lee', job: '12345', items: [{ pn: '040-000973-00', desc: 'NIBP cuff', qty: 2 }, { pn: '', desc: '', qty: 1 }] }
  const rows = stockRows(form)
  assert.equal(rows.length, 1, 'a blank row is left out')
  assert.deepEqual(rows[0], { date: '27-Nov-2026', pn: '040-000973-00', desc: 'NIBP cuff', qty: 2, reason: 'Wanganui trial', job: '12345', by: 'Sam Lee' })
  const lines = toCsv(rows, STOCK_COLUMNS).split('\n')
  assert.equal(lines[0], 'Date taken,Item’s part number,Item description,Quantity taken,Reason for taking,SimPro Job Number,Taken by')
  assert.equal(lines[1], '"27-Nov-2026","040-000973-00","NIBP cuff","2","Wanganui trial","12345","Sam Lee"')
})

test('what is left to do before the form is handed in', () => {
  assert.deepEqual(stockProblems({ reason: '', by: '', job: '', items: [] }), ['No items yet.', 'Add the reason for taking them.', 'Add who took them.', 'The SimPro job number is still blank.'])
  assert.deepEqual(stockProblems({ reason: 'Trial', by: 'Sam', job: '1', items: [{ pn: 'a', desc: 'b', qty: 1 }] }), [])
  assert.ok(stockProblems({ reason: 'Trial', by: 'Sam', job: '1', items: [{ pn: 'a', qty: 1, check: true }] }).includes('Some items are marked to check.'))
})

test('the screen is wired in, reads photos on the device, and sends nothing anywhere', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const screen = read('../src/StockRemoval.jsx')
  assert.match(screen, /from '\.\.\/\.\.\/\.\.\/shared\/ocr\.js'/, 'reads with the shared on-device reader')
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(screen.replace(/\/\*[\s\S]*?\*\//g, '')), 'the photo goes nowhere')
  assert.match(read('../src/App.jsx'), /'stock'/)
})
