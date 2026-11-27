// npm test -w apps/equipment — Stock removal (Form 39): part numbers read from a bag label's text, the form's rows, the screen's wiring.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { STOCK_COLUMNS, addStockItems, cleanAccessories, labelEvidence, loanSections, matchAccessory, readLabelText, stockItemFrom, stockLoanChoices, stockOnLoan, stockProblems, stockReasonText, stockRows, toCsv } from '../src/model.js'

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

/* What the reader really returned on three photographed bags (7.jpg, 8.jpg, 9.jpg of 27-Nov-2026), turned the right way up: the P/N
   line itself is lost or cut short because the barcode is beside it. */
const BAG_SPO2 = `SpO2 Cable
Masimo SpO2 Extension Cable(8 pin)
582A
Qty. (4&2) : 1
040-000332-0
9970029517
2026-04-15
01)06944904030845
9970029517(11)260415
Rx Only
Made in China
Tel(EE): +86-755-8188 8998 Fax(fF): +86-755-2658 2680`
const BAG_ECG = `ECG LEADSET
3-Lead Leadset, Adt/Ped AHA Clip.Long
EL6303A
Qty. (4H) : 1
0-42731
9970035371
2026-07-06
035371(11)260706`
const BAG_HOSE = `NIBP HOSE
NIBP Hose. Inbuilt connector(3m)
CM1903
Qty. (2428) : 1
200-30-09688
9130053470
2026.05.07
Rx Only
Made in China`
const LIST = [
  { code: '040-000332-00', name: 'SpO2 extension cable, Masimo, 8 pin', group: 'SpO2', models: [] },
  { code: '0010-30-42731', name: '3-Lead wires, Adu/Ped, Clip, TPU, AHA, (1m)', group: 'ECG', models: [] },
  { code: '0010-30-42721', name: 'ECG trunk cable: 12-lead, 12 Pin, Defib-Proof, AHA', group: 'ECG', models: [] },
  { code: '6200-30-09688', name: 'NIBP Tubing, Adu/Ped/Infant/Neo, with air plug connectors (3m)', group: 'NIBP', models: [] },
  { code: '040-000973-00', name: 'CM1301 Bladderless cuff, Infant, reusable, 10-19 cm', group: 'NIBP', models: [] },
  { code: 'CHS4053', name: 'Masimo RD SET TCI, Reuseable Tip-Clip Ear Sensor', group: 'SpO2', models: [] },
]

test('what is left to do before the form is handed in', () => {
  const ready = { kind: 'demo', loan: { key: 'b1', label: 'Whanganui Hospital' }, by: 'Sam', job: '1', items: [{ pn: 'a', desc: 'b', qty: 1 }] }
  assert.deepEqual(stockProblems({ kind: 'demo', reason: '', by: '', job: '', items: [] }), ['No items yet.', 'Choose the loan this demo is for.', 'Add who took them.', 'The SimPro job number is still blank.'])
  assert.deepEqual(stockProblems(ready), [])
  assert.deepEqual(stockProblems({ ...ready, kind: 'other', reason: '' }), ['Say what they are being taken for.'])
  assert.deepEqual(stockProblems({ ...ready, kind: 'other', reason: 'Repair', loan: null }), [])
  assert.ok(stockProblems({ ...ready, items: [{ pn: 'a', qty: 1, check: true }] }).includes('Some items are marked to check.'))
  assert.ok(stockProblems(ready, LIST).includes('1 part number isn’t on the accessory list.'))
})

test('the reason is Demo with the loan, or what was typed; a form kept before kinds existed is read as it was', () => {
  assert.equal(stockReasonText({ kind: 'demo' }), 'Demo')
  assert.equal(stockReasonText({ kind: 'demo', loan: { key: 'b1', label: 'Whanganui Hospital' }, reason: 'ignored' }), 'Demo – Whanganui Hospital')
  assert.equal(stockReasonText({ kind: 'other', reason: ' Repair ' }), 'Repair')
  assert.equal(stockReasonText({ reason: 'Wanganui trial' }), 'Wanganui trial')
  assert.equal(stockReasonText({ reason: '' }), 'Demo')
})

test('a number the reader got right is matched to the list, a look-alike character aside', () => {
  assert.equal(matchAccessory('0010-30-42731', LIST).status, 'exact')
  assert.equal(matchAccessory('OO1O-3O-42731', LIST).item.code, '0010-30-42731')
  assert.equal(matchAccessory('chs 4053', LIST).item.code, 'CHS4053')
  assert.equal(matchAccessory('999-999999-99', LIST).status, 'none')
})

test('a number with a digit lost or wrong is the list’s one character away; a piece of one is the one that holds it', () => {
  assert.deepEqual(['200-30-09688', '040-000332-0'].map((x) => matchAccessory(x, LIST).item.code), ['6200-30-09688', '040-000332-00'])
  assert.equal(matchAccessory('200-30-09688', LIST).status, 'near')
  const piece = matchAccessory('0-42731', LIST)
  assert.equal(piece.status, 'fragment')
  assert.equal(piece.item.code, '0010-30-42731')
  assert.equal(matchAccessory('0010-30-42711', LIST).status, 'ambiguous', 'one character from two list codes: not guessed')
  assert.deepEqual(matchAccessory('0010-30-42711', LIST).candidates.map((a) => a.code).sort(), ['0010-30-42721', '0010-30-42731'])
})

test('the real bags: each is found on the list and described by it, with the label’s own wording beside', () => {
  const rows = [BAG_SPO2, BAG_ECG, BAG_HOSE].map((t) => { const r = readLabelText(t, LIST); assert.equal(r.items.length, 1, t.split('\n')[0]); return stockItemFrom(r.items[0], 1, LIST, 'x') })
  assert.deepEqual(rows.map((r) => r.pn), ['040-000332-00', '0010-30-42731', '6200-30-09688'])
  assert.equal(rows[0].desc, 'SpO2 extension cable, Masimo, 8 pin')
  assert.equal(rows[2].desc, 'NIBP Tubing, Adu/Ped/Infant/Neo, with air plug connectors (3m)')
  assert.match(rows[2].label, /NIBP Hose/)
  assert.ok(rows.every((r) => r.check && /closest accessory-list item/.test(r.note)), 'a near miss says to check it')
  assert.match(rows[2].note, /Read as “200-30-09688”/)
})

test('a bag’s lot, model and label description are read around the number', () => {
  const r = readLabelText(BAG_HOSE, LIST).items[0]
  assert.equal(r.model, 'CM1903')
  assert.equal(r.lot, '9130053470')
  assert.equal(r.desc, 'Mindray NIBP Hose. Inbuilt connector(3m) (CM1903)')
  assert.equal(readLabelText(BAG_SPO2, LIST).items[0].model, '582A')
})

test('the phone numbers, dates and barcode digits on a label are not taken for parts', () => {
  assert.equal(readLabelText(BAG_SPO2, LIST).items.length, 1)
  assert.deepEqual(readLabelText(BAG_SPO2, []).items.map((i) => i.pn), ['040-000332-0'], 'with no list: the one shaped like a part number')
})

test('a part the list hasn’t got is kept as read, and says so', () => {
  const r = readLabelText('Masimo cable\nP/N: 040-000999-00\nLOT 123456', LIST).items[0]
  assert.equal(r.match, 'none')
  const row = stockItemFrom(r, 1, LIST, 'x')
  assert.equal(row.pn, '040-000999-00')
  assert.match(row.note, /Not on the accessory list/)
  assert.equal(row.check, true)
})

test('which way up a photo was read: the label’s own words, not noise', () => {
  assert.ok(labelEvidence(BAG_SPO2) >= 2)
  assert.ok(labelEvidence(BAG_HOSE) >= 2)
  assert.equal(labelEvidence('—= | TE | a | [Al | i | | -y | he | » | #i | ERE]'), 0)
})

test('stock taken for a demo is put on the loan’s accessories: the line’s stock count, or a new line', () => {
  const loan = [{ code: '040-000973-00', name: 'CM1301 cuff', qty: 4 }, { code: '6200-30-09688', name: 'NIBP Tubing', qty: 8, stock: 1 }]
  const items = [{ pn: '6200-30-09688', desc: 'NIBP Tubing', qty: 2 }, { pn: '0010-30-42731', desc: '3-Lead wires', qty: 1 }, { pn: '040-000973-00', desc: 'cuff', qty: 6 }]
  const r = stockOnLoan(loan, items, { list: LIST })
  assert.deepEqual(r.lines, [
    { code: '040-000973-00', name: 'CM1301 cuff', qty: 6, stock: 6 },
    { code: '6200-30-09688', name: 'NIBP Tubing', qty: 8, stock: 3 },
    { code: '0010-30-42731', name: '3-Lead wires, Adu/Ped, Clip, TPU, AHA, (1m)', qty: 1, stock: 1 }])
  assert.deepEqual(r.changes.map((c) => [c.code, c.added, c.before?.stock ?? null, c.after.stock, c.after.qty]),
    [['6200-30-09688', false, 1, 3, 8], ['0010-30-42731', true, null, 1, 1], ['040-000973-00', false, 0, 6, 6]])
  assert.equal(loan[1].stock, 1, 'what was passed in is not changed')
})

test('recording the same form again counts the difference, never twice; an item taken off takes its stock back', () => {
  const loan = [{ code: '6200-30-09688', name: 'NIBP Tubing', qty: 8 }]
  const first = stockOnLoan(loan, [{ pn: '6200-30-09688', qty: 3 }], { list: LIST })
  assert.equal(first.lines[0].stock, 3)
  const again = stockOnLoan(first.lines, [{ pn: '6200-30-09688', qty: 3 }], { applied: first.applied, list: LIST })
  assert.deepEqual(again.changes, [])
  assert.equal(again.lines[0].stock, 3)
  const more = stockOnLoan(first.lines, [{ pn: '6200-30-09688', qty: 5 }], { applied: first.applied, list: LIST })
  assert.equal(more.lines[0].stock, 5)
  const gone = stockOnLoan(first.lines, [], { applied: first.applied, list: LIST })
  assert.equal(gone.lines[0].stock, undefined)
  assert.deepEqual(gone.applied, {})
})

test('a part that is neither on the accessory list nor the loan is not put on the loan', () => {
  const r = stockOnLoan([], [{ pn: '040-000999-00', qty: 1 }, { pn: '', qty: 1 }], { list: LIST })
  assert.deepEqual(r.lines, [])
  assert.deepEqual(r.problems, [{ code: '040-000999-00' }])
  assert.deepEqual(r.applied, {})
})

test('a loan’s accessory line keeps how many came from stock, and adds them when a code repeats', () => {
  assert.deepEqual(cleanAccessories([{ code: 'A1', name: 'x', qty: 2, stock: 1 }, { code: 'a-1', qty: 1, stock: 2 }, { code: 'B2', qty: 1, stock: 0 }]), [{ code: 'A1', name: 'x', qty: 3, stock: 3 }, { code: 'B2', name: '', qty: 1 }])
})

test('the loans a demo can be chosen from: every loan and booking that matches, those starting soon first', () => {
  const eq = (id, to, start, end, batch) => ({ id, CHSAssetNo: id, Model: 'TV80', Returned: 'No', OnLoanTo: to, Location: 'ED', LoanStartDate: start, LoanEndDate: end, BatchID: batch })
  const sections = loanSections({ equipment: [eq('1', 'Whanganui Hospital', '2026-11-01', '2026-12-11', 'b1'), eq('2', 'Hutt Hospital', '2026-11-01', '2026-12-01', 'b2')], upcoming: [{ id: 'bk1', loanTo: 'Whangarei Hospital', startDate: '2026-12-20', endDate: '2027-01-10', items: [] }], loanMeta: {}, loanDocs: {}, today: '2026-11-27' })
  // Not yet started first (stock is taken before a demo goes out), then the current loans
  assert.deepEqual(stockLoanChoices(sections, 'wh').map((c) => [c.key, c.label]), [['bk1', 'Whangarei Hospital'], ['b1', 'Whanganui Hospital']])
  assert.deepEqual(stockLoanChoices(sections, '').map((c) => c.key), ['bk1', 'b1', 'b2'], 'starting soon, then current, most recent start first')
  const many = loanSections({ equipment: [], upcoming: Array.from({ length: 20 }, (_, n) => ({ id: 'u' + n, loanTo: 'Customer ' + n, startDate: '2026-12-' + String(30 - n).padStart(2, '0'), endDate: '2027-02-01', items: [] })), loanMeta: {}, loanDocs: {}, today: '2026-11-27' })
  const got = stockLoanChoices(many, '')
  assert.equal(got.length, 20, 'a long list of upcoming loans is not cut short')
  assert.equal(got[0].key, 'u19', 'soonest start first')
  const lots = loanSections({ equipment: [], upcoming: Array.from({ length: 150 }, (_, n) => ({ id: 'l' + n, loanTo: 'Customer ' + n, startDate: '2026-12-01', endDate: '2027-02-01', items: [] })), loanMeta: {}, loanDocs: {}, today: '2026-11-27' })
  assert.equal(stockLoanChoices(lots, '').length, 150, 'every loan is listed, however many')
  assert.deepEqual(stockLoanChoices(sections, 'hutt').map((c) => c.key), ['b2'])
  assert.equal(stockLoanChoices(sections, '').length, 3)
})

test('the screen is wired in, reads photos on the device, and sends nothing anywhere', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  const screen = read('../src/StockRemoval.jsx')
  assert.match(screen, /from '\.\.\/\.\.\/\.\.\/shared\/ocr\.js'/, 'reads with the shared on-device reader')
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(screen.replace(/\/\*[\s\S]*?\*\//g, '')), 'the photo goes nowhere')
  assert.match(read('../src/App.jsx'), /'stock'/)
})

test('the app does not reload onto a new version while a photo is being taken or read', () => {
  // Coming back from the camera is when the app checks for an update: without this the page reloads and the photo is lost.
  const screen = readFileSync(new URL('../src/StockRemoval.jsx', import.meta.url), 'utf8')
  assert.ok(screen.includes('data-working={reading > 0 || picking'), 'the screen says it is working while reading or picking')
  assert.equal(screen.split('onClick={() => setPicking(true)}').length - 1, 2, 'both photo buttons say a picker is open')
})
