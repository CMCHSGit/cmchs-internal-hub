// npm test --prefix apps/testbench — a device the bench didn't find, added as a pending row (src/newequip/from-bench.js). Invented names only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileStem, matchCustomer, rowFromBench } from '../src/newequip/from-bench.js'
import { FIELD_KEYS } from '../src/newequip/pending.js'

const customers = [
  { id: 'c1', name: 'Grace Hospital' },
  { id: 'c2', name: 'Southern Cross North Harbour' },
  { id: 'c3', name: 'Southern Cross Brightside' },
  { id: 'c4', name: 'Sth X' },
  { id: '', name: 'No id' },
]

test('the asset list file name, without "Asset List", a date or the extension', () => {
  assert.equal(fileStem('Sth X Asset List 13.03.2025.xlsx'), 'Sth X')
  assert.equal(fileStem('Waitemata asset list.xlsm'), 'Waitemata')
  assert.equal(fileStem('Grace Hospital 01-02-2026.xlsx'), 'Grace Hospital')
  assert.equal(fileStem('Asset List.xlsx'), 'Asset List', 'nothing left: keeps the name')
  assert.equal(fileStem(''), '')
})

test('the customer is picked only when there is no doubt', () => {
  const m = matchCustomer(customers, { customer: 'Grace Hospital', file: 'Sth X Asset List 13.03.2025.xlsx' })
  assert.equal(m.pick, 'c1', 'the customer on the report, by its exact name')
  assert.deepEqual(m.list.map((c) => c.name), ['Grace Hospital', 'Southern Cross Brightside', 'Southern Cross North Harbour', 'Sth X'], 'by name; one with no id left out')
  assert.equal(matchCustomer(customers, { customer: '', file: 'Sth X Asset List.xlsx' }).pick, 'c4', 'else the file name')
  assert.equal(matchCustomer(customers, { customer: 'Southern Cross', file: '' }).pick, '', 'two customers match: the person chooses')
  assert.equal(matchCustomer(customers, { customer: 'Nobody', file: 'Other.xlsx' }).pick, '')
  assert.equal(matchCustomer(customers, { customer: 'Grace', file: '' }).pick, 'c1', 'a name inside the customer\'s name')
})

test('the customer this file went to before wins, while it still exists', () => {
  const file = 'Sth X Asset List 13.03.2025.xlsx'
  assert.equal(matchCustomer(customers, { customer: 'Grace Hospital', file }, { [file]: 'c2' }).pick, 'c2')
  assert.equal(matchCustomer(customers, { customer: 'Grace Hospital', file }, { [file]: 'gone' }).pick, 'c1')
  assert.equal(matchCustomer([], { customer: 'Grace Hospital', file }).pick, '')
})

test('the bench form becomes a pending row of the known fields only; a serial number is needed', () => {
  const { row, errors } = rowFromBench({ serial: ' TP1-00000001 ', model: 'BeneVision R700', site: '2350', customerAsset: 'dropped', ward: 'ICU\nBed 3' })
  assert.deepEqual(errors, [])
  assert.deepEqual(Object.keys(row), FIELD_KEYS)
  assert.equal(row.serial, 'TP1-00000001')
  assert.equal(row.ward, 'ICU Bed 3')
  assert.equal(rowFromBench({ model: 'x' }).errors.length, 1)
  assert.equal(rowFromBench(null).errors.length, 1)
})

test('the bench offers "Add to the asset list…" on Not found and asks the hub, which writes the pending row', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.match(html, /id="sheetAddPending"/)
  assert.match(html, /type: 'chs-bench:pending-customers'/)
  assert.match(html, /type: 'chs-bench:add-pending'/)
  assert.match(html, /m\.type === 'chs-bench:pending-reply'/)
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.match(section, /chs-bench:pending-customers/)
  assert.match(section, /addPendingQueued\(c\.id, row\)/)
  assert.match(section, /clashes\(row, \[\], waiting\)/, 'a serial already waiting is not added twice')
  assert.match(section, /logActivity\(null, 'Added a device to a customer.{1,2}s pending asset rows/, 'one activity line, no names')
})

test('the model and type boxes drop down what the list already has; a known model fills in its type and description', async () => {
  const { choicesFor, fillFromModel } = await import('../src/newequip/pending.js')
  const units = [{ model: 'BeneVision N1', type: 'Patient Monitor', description: 'Transport monitor', manufacturer: 'Mindray' }, { model: 'TDS', type: 'Docking station' }, { model: ' benevision n1 ' }, { model: '-' }]
  assert.deepEqual(choicesFor('model', units, [{ model: 'Handle' }]), ['BeneVision N1', 'Handle', 'TDS'], 'no repeats (whatever the case), no "-"')
  assert.deepEqual(choicesFor('type', units), ['Docking station', 'Patient Monitor'])
  assert.deepEqual(fillFromModel({ model: 'benevision n1', serial: 'X1', type: '' }, units), { model: 'benevision n1', serial: 'X1', type: 'Patient Monitor', description: 'Transport monitor', manufacturer: 'Mindray' })
  assert.equal(fillFromModel({ model: 'TDS', type: 'Mine' }, units).type, 'Mine', 'what was typed stays')
  assert.deepEqual(fillFromModel({ model: 'Unknown' }, units), { model: 'Unknown' })
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.match(html, /lists = \{ model: listOf\('Device Model'\), type: listOf\('Device Type'\) \}/, 'the bench’s Add to the asset list form too')
  assert.match(html, /\$\('#pa_model', ov\)\?\.addEventListener\('change'/)
})
