// npm test -w apps/equipment — the accessory list (Manage, Accessories): a spreadsheet read whatever its
// headings, imported into the list or replacing it, and what the loan picker offers from it
// (model.js accessoryListFromRows, mergeAccessoryList, cleanAccessoryList, accessoryCatalogue, accessoryChoices).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { accessoryCatalogue, accessoryChoices, accessoryListFromRows, accessoryWordsIn, cleanAccessoryItem, cleanAccessoryList, listedAccessory, mergeAccessoryList } from '../src/model.js'

const cuff = { code: '0010-30-12257', name: 'NIBP cuff, adult, reusable', group: 'NIBP', models: ['N17', 'ePM 12M'] }
const spo2 = { code: '0010-10-12202', name: 'SpO2 sensor, adult finger', group: 'SpO2', models: ['N17'] }
const ecg = { code: '0010-30-42722', name: '5-lead ECG cable', group: 'ECG', models: ['ePM 12M'] }

test('a spreadsheet read whatever its headings say; prices and other columns left out; blank rows skipped', () => {
  const rows = [
    { 'Part No.': ' 0010-30-12257 ', Description: 'NIBP cuff, adult, reusable', Category: 'NIBP', 'Compatible with': 'N17; ePM 12M', 'Price NZD': 120 },
    { 'Part No.': '', Description: '', Category: '', 'Compatible with': '', 'Price NZD': '' },
    { 'Part No.': '0010-10-12202', Description: 'SpO2 sensor, adult finger', Category: 'SpO2', 'Compatible with': 'N17', 'Price NZD': 300 },
  ]
  const r = accessoryListFromRows(rows)
  assert.deepEqual(r.items, [cuff, spo2])
  assert.equal(r.skipped, 1)
  assert.deepEqual(r.columns, { code: 'Part No.', name: 'Description', group: 'Category', models: 'Compatible with' })
  assert.ok(!JSON.stringify(r.items).includes('120'), 'no price kept')
  // Both a Name and a Description: the name.
  assert.equal(accessoryListFromRows([{ Code: 'X1', Name: 'Short', Description: 'Long words' }]).items[0].name, 'Short')
  assert.match(accessoryListFromRows([{ Price: 1, Stock: 2 }]).problem, /No Code or Name column/)
})

test('an item tidied: code or name needed, spaces squeezed, models from a comma list, each once', () => {
  assert.equal(cleanAccessoryItem({ code: ' ', name: '' }), null)
  assert.deepEqual(cleanAccessoryItem({ name: '  Temp   probe ', models: 'N17, N17 ,ePM 12M' }), { code: '', name: 'Temp probe', group: '', models: ['N17', 'ePM 12M'] })
  assert.deepEqual(cleanAccessoryList([ecg, spo2, cuff, { ...cuff, name: 'Cuff (newer name)' }]).map((a) => a.name), ['5-lead ECG cable', 'Cuff (newer name)', 'SpO2 sensor, adult finger'], 'by group, the same code once, the later wins')
})

test('an import is added to the list (same code updated) or replaces it', () => {
  const list = [cuff, ecg]
  const add = mergeAccessoryList(list, [{ ...cuff, name: 'NIBP cuff, adult' }, spo2, ecg])
  assert.deepEqual([add.added, add.updated, add.unchanged, add.removed, add.items.length], [1, 1, 1, 0, 3])
  assert.equal(add.items.find((a) => a.code === cuff.code).name, 'NIBP cuff, adult')
  const rep = mergeAccessoryList(list, [spo2], { replace: true })
  assert.deepEqual([rep.added, rep.removed, rep.items.map((a) => a.code)], [1, 2, [spo2.code]])
  // Codes match however they're typed.
  assert.equal(mergeAccessoryList([cuff], [{ code: '0010 30 12257', name: 'x' }]).updated, 1)
})

test('the picker: the list first by what fits the loan, then by group; typed codes from earlier loans last', () => {
  const loanDocs = { b1: { startDate: '2026-10-01', accessories: [{ code: 'OLD-1', name: 'Old lead', qty: 1 }, { code: cuff.code, name: 'typed name', qty: 2 }] } }
  const cat = accessoryCatalogue(loanDocs, [cuff, spo2, ecg])
  assert.equal(cat.find((a) => a.code === cuff.code).name, cuff.name, 'the list\'s name wins over one typed on a loan')
  assert.equal(cat.find((a) => a.code === cuff.code).uses, 1)
  const secs = accessoryChoices(cat, '', { models: ['N17'] })
  assert.deepEqual(secs.map((s) => [s.title, s.items.map((a) => a.code)]), [
    ['Fits the N17', [cuff.code, spo2.code]],
    ['ECG', [ecg.code]],
    ['Used on earlier loans (not in the list)', ['OLD-1']],
  ])
  assert.deepEqual(accessoryChoices(cat, 'cuff').flatMap((s) => s.items.map((a) => a.code)), [cuff.code])
  assert.deepEqual(accessoryChoices(cat, '001030-12257').flatMap((s) => s.items.map((a) => a.code)), [cuff.code], 'a code however it is typed')
  assert.deepEqual(accessoryChoices(cat, 'epm').flatMap((s) => s.items.map((a) => a.code)).sort(), [cuff.code, ecg.code].sort(), 'by the models it fits')
})

test('a loan line from the list is known by its code (or its name when it has none)', () => {
  assert.equal(listedAccessory({ code: '0010 30 12257', name: '', qty: 1 }, [cuff]).name, cuff.name)
  assert.equal(listedAccessory({ code: '', name: 'Temp probe' }, [{ name: 'temp probe' }]).name, 'temp probe')
  assert.equal(listedAccessory({ code: 'X9', name: 'Something' }, [cuff]), null)
})

test('accessories written in the notes are found, each once, so the notes box can point to Accessories', () => {
  const notes = 'A9 accessories - 3-Lead ECG/5-Lead ECG, new Masimo Spo2, NIBP, all cuff sizes, IBP, y-type IBP cable, temp cable, NMT, BIS puk'
  assert.deepEqual(accessoryWordsIn(notes), ['3-Lead', 'ECG', '5-Lead', 'Spo2', 'NIBP', 'cuff'])
  assert.deepEqual(accessoryWordsIn('Truck delivery, call before 9am'), [])
  assert.deepEqual(accessoryWordsIn('Cuffs and a cuff'), ['Cuffs'])
})

test('sets: read from a sheet with Set and Qty columns; codes alone keep the list names; one name replaces', async () => {
  const { accessoryListFromRows: read, mergeAccessoryList: merge, mergeAccessorySets: mergeSets, addSet, setLines, setSize, cleanAccessorySets } = await import('../src/model.js')
  const r = read([
    { Set: 'ED monitoring', Code: '0010-30-12257', Qty: 3 },
    { Set: 'ED monitoring', Code: '0010-10-12202', Qty: '2' },
    { Set: 'ED monitoring', Code: '0010-30-12257', Qty: 1 },
    { Set: 'SCBU', Code: '0010-10-12202', Qty: '' },
  ])
  assert.deepEqual(r.sets.map((s) => [s.name, s.lines.map((l) => `${l.code}x${l.qty}`)]), [['ED monitoring', ['0010-30-12257x4', '0010-10-12202x2']], ['SCBU', ['0010-10-12202x1']]])
  // A sheet of codes alone doesn't blank the names already on the list.
  assert.equal(merge([cuff], r.items).items.find((a) => a.code === cuff.code).name, cuff.name)
  const was = [{ id: 'set_1', name: 'ed MONITORING', lines: [{ code: 'X', qty: 1 }] }, { id: 'set_2', name: 'Theatre', lines: [{ code: 'Y', qty: 1 }] }]
  const m = mergeSets(was, r.sets)
  assert.deepEqual([m.added, m.replaced, m.sets.map((s) => s.name)], [1, 1, ['ED monitoring', 'SCBU', 'Theatre']])
  // Added to a loan: the list's names, quantities added to what's already there.
  const ed = m.sets[0]
  assert.equal(setLines(ed, [cuff])[0].name, cuff.name)
  assert.deepEqual(addSet([{ code: '0010-30-12257', name: 'x', qty: 1 }], ed, [cuff]).map((l) => [l.code, l.qty]), [['0010-30-12257', 5], ['0010-10-12202', 2]])
  assert.deepEqual(setSize(ed), { lines: 2, pieces: 6 })
  assert.deepEqual(cleanAccessorySets([{ name: ' ', lines: [] }, { name: 'B', lines: [{ code: 'Q', qty: 0 }] }]).map((s) => [s.name, s.lines[0].qty]), [['B', 1]])
})

test('accessories typed on a loan go on the list: named, not there already, not on the loan before; group from the name', async () => {
  const { newListItems, accessoryGroupFor } = await import('../src/model.js')
  const list = [cuff, { code: 'CHS4050', name: 'Masimo RD SET DCI, Adult Reuseable Finger Sensor', group: 'SpO2', models: [] }]
  const lines = [
    { code: '0010-30-12257', name: 'NIBP cuff, adult, reusable', qty: 2 }, // on the list
    { code: '040-000983-00', name: 'CM1303  Bladderless NIBP cuff, Adult reusable, 25 - 35cm', qty: 2 }, // new
    { code: '040-000983-00', name: '', qty: 1 }, // the same again
    { code: '115-0001', name: '', qty: 1 }, // a code alone: left for someone to name
    { code: '', name: 'TM80 battery charger', qty: 1 }, // a name alone: fine
    { code: '0010-30-99999', name: 'Old cable', qty: 1 }, // was on the loan before (maybe taken off the list on purpose)
  ]
  assert.deepEqual(newListItems(lines, list, [{ code: '0010 30 99999', name: 'Old cable', qty: 1 }]), [
    { code: '040-000983-00', name: 'CM1303 Bladderless NIBP cuff, Adult reusable, 25 - 35cm', group: 'NIBP', models: [] },
    { code: '', name: 'TM80 battery charger', group: '', models: [] },
  ])
  assert.deepEqual(newListItems(lines.slice(0, 1), list), [], 'nothing new, nothing to add')
  // Groups as the list spells them; the first that fits.
  assert.equal(accessoryGroupFor('Masimo RD SET SpO2 Trunk Cable'), 'SpO2')
  assert.equal(accessoryGroupFor('Masimo sensor', [{ code: 'X', name: 'x', group: 'SPO2' }]), 'SPO2')
  assert.equal(accessoryGroupFor('Y-type IBP adapter'), 'IBP')
  assert.equal(accessoryGroupFor('NIBP Tubing, Adu/Ped/Infant/Neo'), 'NIBP')
  assert.equal(accessoryGroupFor('5-Lead, Adu/Ped, Clip, 36in'), 'ECG')
  assert.equal(accessoryGroupFor('ECG trunk cable - 3 lead Ped/Neo'), 'ECG')
  assert.equal(accessoryGroupFor('Temp extension cable for disposable probes'), 'Temp')
  assert.equal(accessoryGroupFor('Microstream CO2 sampling line'), 'CO2')
  assert.equal(accessoryGroupFor('Rollstand'), '')
})
