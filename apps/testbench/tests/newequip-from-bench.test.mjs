// npm test --prefix apps/testbench — a device the bench didn't find, added as a pending row (src/newequip/from-bench.js). Invented names only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileStem, matchCustomer, rowFromBench, workbookFor } from '../src/newequip/from-bench.js'
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

test('Open workbook: the customer\'s asset list link, found the way Add to the asset list finds the customer; the person chooses when it can\'t tell', () => {
  const link = (url) => ({ subs: [{ name: 'Equipment list', link: url }] })
  const cs = [{ id: 'c1', name: 'Grace Hospital', ...link('https://example.sharepoint.com/grace.xlsx') }, { id: 'c2', name: 'Southern Cross North Harbour', ...link('https://example.sharepoint.com/nh.xlsx') }, { id: 'c3', name: 'Southern Cross Brightside' }, { id: 'c4', name: 'Sth X', ...link('not a web address') }]
  assert.deepEqual(workbookFor(cs, { customer: 'Grace Hospital', file: 'Other.xlsx' }), { url: 'https://example.sharepoint.com/grace.xlsx', customer: 'Grace Hospital', customerId: 'c1' }, 'known by the customer on the report')
  assert.equal(workbookFor(cs, { file: 'Grace Hospital Asset List 13.03.2026.xlsx' }).url, 'https://example.sharepoint.com/grace.xlsx', 'or by the file name')
  assert.equal(workbookFor(cs, { customer: 'Nobody', file: 'x.xlsx' }, { 'x.xlsx': 'c2' }).url, 'https://example.sharepoint.com/nh.xlsx', 'or the customer this file was matched to before')
  assert.match(workbookFor(cs, { customer: 'Southern Cross Brightside' }).error, /no link to its asset list/, 'a customer with no link says so')
  assert.match(workbookFor(cs, { customer: 'Sth X' }).error, /no link/, 'a link that is not a web address is no link')
  const ask = workbookFor(cs, { customer: 'Southern Cross', file: '' })
  assert.equal(ask.pick, ''); assert.deepEqual(ask.list.map((c) => [c.name, c.link]), [['Grace Hospital', true], ['Southern Cross Brightside', false], ['Southern Cross North Harbour', true], ['Sth X', false]], 'two customers fit: the list, marked with who has a link')
  assert.equal(workbookFor(cs, { customer: 'Southern Cross', customerId: 'c2' }).url, 'https://example.sharepoint.com/nh.xlsx', 'once chosen')
  assert.match(workbookFor(cs, { customerId: 'zz' }).error, /Choose the customer/)
})

test('the bench has Open workbook next to Read again (inside the hub only) and asks the hub for the link', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.match(html, /data-sheet="reload">Read again<\/button>\$\{window\.parent !== window \? '<button type="button" class="btn quiet sm" data-sheet="open"/, 'beside Read again, not in the standalone or offline copy')
  assert.match(html, /type: 'chs-bench:open-workbook'/)
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.match(section, /chs-bench:open-workbook/); assert.match(section, /workbookFor\(list, \{ customer: m\.customer, file: m\.file, customerId: m\.customerId \}/)
})
