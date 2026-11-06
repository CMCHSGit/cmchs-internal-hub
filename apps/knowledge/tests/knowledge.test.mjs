import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildRecord, canEditKb, richBlocks, compact, countBy, groupFields, mentioning, parseCsv, queryWords, recordId, relatedParts, rowsToRecords, searchRecords } from '../src/model.js'

const dev = (o) => buildRecord('device', o)
const DEVICES = [
  dev({ site: 'Waikato', dept: 'CCU', model: 'N17', serial: 'A1', version: '02.40', extra: { 'SpO2 type': 'Masimo', WiFi: 'Yes' } }),
  dev({ site: 'Waikato', dept: 'CCU', model: 'N17', serial: 'A2', extra: { 'SpO2 type': 'Masimo', WiFi: 'No' } }),
  dev({ site: 'Waikato', dept: 'ED', model: 'N17', serial: 'A3', extra: { 'SpO2 type': 'Nellcor' } }),
  dev({ site: 'Waikato', dept: 'ED', model: 'N12', serial: 'B1' }),
  dev({ site: 'Hutt', dept: 'CCU', model: 'N17', serial: 'C1' }),
]

test('a question of site, model and department finds the devices, and the count is the length', () => {
  assert.equal(searchRecords('device', DEVICES, 'N17 waikato ccu').length, 2)
  assert.equal(searchRecords('device', DEVICES, 'how many N17 in Waikato').length, 3)
})

test('imported extra columns are searchable and groupable', () => {
  assert.equal(searchRecords('device', DEVICES, 'waikato masimo').length, 2)
  assert.deepEqual(countBy(DEVICES.filter((d) => d.site === 'Waikato'), 'SpO2 type'), [{ value: 'Masimo', n: 2 }, { value: '(blank)', n: 1 }, { value: 'Nellcor', n: 1 }])
  assert.deepEqual(countBy(DEVICES, 'site'), [{ value: 'Waikato', n: 4 }, { value: 'Hutt', n: 1 }])
  assert.deepEqual(groupFields(DEVICES), ['site', 'dept', 'model', 'version', 'SpO2 type', 'WiFi'])
})

test('filler words are dropped, but a question made only of them still searches', () => {
  assert.deepEqual(queryWords('What SpO2 type are they using in Waikato?'), ['spo2', 'type', 'waikato'])
  assert.deepEqual(queryWords('the'), ['the'])
})

test('a part number is found however it is typed, and by any of its names', () => {
  const parts = [
    buildRecord('part', { partNo: 'AB-123/4', name: 'Power supply board', aliases: 'PSU, power board', fits: 'N17, N12' }),
    buildRecord('part', { partNo: 'ZZ-900', name: 'Battery' }),
  ]
  for (const q of ['AB-123/4', 'ab1234', 'ab 123 4', 'psu', 'power board', 'power supply']) assert.equal(searchRecords('part', parts, q).length, 1, q)
  assert.equal(searchRecords('part', parts, 'battery')[0].partNo, 'ZZ-900')
  assert.equal(compact('AB-123/4'), 'ab1234')
})

test('an exact part number comes before a record that only mentions it', () => {
  const recs = [
    buildRecord('part', { partNo: 'X100', name: 'x1 cable' }),
    buildRecord('part', { partNo: 'Y9', name: 'Fits near X1', notes: 'see X1' }),
    buildRecord('part', { partNo: 'X1', name: 'Exact' }),
  ]
  assert.equal(searchRecords('part', recs, 'x1')[0].name, 'Exact')
})

test('an article names parts; those parts and the articles mentioning a part are linked', () => {
  const part = buildRecord('part', { partNo: 'AB-123', name: 'PSU', aliases: 'Power board' })
  const article = buildRecord('article', { title: 'N17 will not power on', body: 'Replace the supply.\nCheck the fuse.', parts: 'AB123, QQ-1' })
  assert.deepEqual(relatedParts(article, [part]).map((p) => p.partNo), ['AB-123'])
  assert.equal(mentioning(part, [article]).length, 1)
  assert.equal(article.body, 'Replace the supply.\nCheck the fuse.')
})

test('records are trimmed, capped and carry only their own fields', () => {
  const r = buildRecord('part', { partNo: '  P1 ', name: 'x'.repeat(500), junk: 'no', aliases: ['a', 'a', ' b '] })
  assert.equal(r.partNo, 'P1')
  assert.equal(r.name.length, 200)
  assert.deepEqual(r.aliases, ['a', 'b'])
  assert.equal('junk' in r, false)
  assert.ok(r.search.length < 9001)
})

test('CSV: quotes, doubled quotes, commas and line breaks inside a field, a BOM', () => {
  const rows = parseCsv('﻿Part,Name\r\n"AB-1","Board, main"\n"X","say ""hi""\nthere"\n\n')
  assert.deepEqual(rows, [['Part', 'Name'], ['AB-1', 'Board, main'], ['X', 'say "hi"\nthere']])
})

test('importing a parts list: headings found under a title row, names and aliases read, empty rows skipped', () => {
  const rows = [['Parts for N-series'], [], ['Part Number', 'Description', 'Also called', 'Models'], ['AB-1', 'Board', 'PSU; power board', 'N17, N12'], ['', '', '', ''], ['CD-2', 'Cable']]
  const { records, skipped } = rowsToRecords('part', rows)
  assert.equal(records.length, 2)
  assert.equal(skipped, 1)
  assert.deepEqual(records[0].aliases, ['PSU', 'power board'])
  assert.deepEqual(records[0].fits, ['N17', 'N12'])
})

test('importing devices: other columns are kept as extra, and the same file twice gives the same ids', () => {
  const rows = [['Site', 'Ward', 'Device Model', 'Serial Number', 'WiFi', 'SpO2'], ['Waikato', 'CCU', 'N17', 'A1', 'Yes', 'Masimo'], ['Waikato', 'CCU', 'N17', '', '', '']]
  const a = rowsToRecords('device', rows), b = rowsToRecords('device', rows)
  assert.deepEqual(a.records[0].extra, { WiFi: 'Yes', SpO2: 'Masimo' })
  assert.deepEqual(a.records.map((r) => recordId('device', r)), b.records.map((r) => recordId('device', r)))
  assert.notEqual(recordId('device', a.records[0]), recordId('device', a.records[1]))
})

test('a file with no recognisable headings says so instead of importing nothing silently', () => {
  assert.match(rowsToRecords('job', [['a', 'b'], ['1', '2']]).error, /heading row/)
})

test('who can edit: admins and anyone with the editor switch, nobody else', () => {
  assert.equal(canEditKb({ role: 'admin' }), true)
  assert.equal(canEditKb({ role: 'user', kbEditor: true }), true)
  assert.equal(canEditKb({ role: 'user', kbEditor: 'yes' }), false)
  assert.equal(canEditKb({ role: 'user' }), false)
  assert.equal(canEditKb(null), false)
})

test('an article body becomes blocks: bold, links and bullets; markup stays text', () => {
  const blocks = richBlocks('Do **this** first: https://example.com/x.\n\n- one\n- <b>two</b>\njavascript:alert(1)')
  assert.deepEqual(blocks.map((b) => b.type), ['p', 'gap', 'li', 'li', 'p'])
  assert.deepEqual(blocks[0].parts, [{ t: 'text', text: 'Do ' }, { t: 'bold', text: 'this' }, { t: 'text', text: ' first: ' }, { t: 'link', text: 'https://example.com/x', href: 'https://example.com/x' }, { t: 'text', text: '.' }])
  assert.deepEqual(blocks[3].parts, [{ t: 'text', text: '<b>two</b>' }])
  assert.equal(JSON.stringify(blocks).includes('"href":"javascript'), false)
})

test('a workbook with no Site column takes the file as the site and the sheet as a column', () => {
  const rows = [['Ward', 'Device Model', 'Serial Number'], ['CCU', 'N17', 'A1']]
  const { records } = rowsToRecords('device', rows, { site: 'Waikato', extra: { Sheet: 'Main' } })
  assert.equal(records[0].site, 'Waikato')
  assert.deepEqual(records[0].extra, { Sheet: 'Main' })
  assert.equal(searchRecords('device', records, 'waikato ccu n17').length, 1)
})
