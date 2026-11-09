// npm test --prefix apps/testbench — assets recorded on the new-equipment page (src/newequip/pending.js). Invented serials only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FIELD_KEYS, cleanPending, clashes, editClashes, changedFields, rowOf, mapHeaders, toTsv, toCsv, testLink, MAX_VALUE } from '../src/newequip/pending.js'
import { deviceFromSearch } from '../src/device-link.js'

const row = (over = {}) => ({ ...cleanPending({ serial: 'EX3-000519', model: 'D30', manufacturer: 'Mindray', site: '2350', ward: 'ED', asset: 'CHS-0415', ...over }).row })

test('a form becomes a row of exactly the known fields, one line each; the serial number is needed', () => {
  const { row: r, errors } = cleanPending({ serial: '  EX3-000519 ', model: 'D30\n\tx', bogus: 'dropped', ward: 'a'.repeat(500) })
  assert.deepEqual(errors, [])
  assert.deepEqual(Object.keys(r), FIELD_KEYS)
  assert.equal(r.serial, 'EX3-000519')
  assert.equal(r.model, 'D30 x')
  assert.equal(r.ward.length, MAX_VALUE)
  assert.equal(r.bogus, undefined)
  assert.deepEqual(cleanPending({ model: 'D30' }).errors, ['The serial number is needed.'])
})

test('a serial number already on the asset list, or already pending, is not added twice', () => {
  assert.deepEqual(clashes(row(), [], []), [])
  assert.match(clashes(row({ serial: 'ex3-000519' }), [{ key: 'EX3-000519' }], [])[0], /already on the asset list/)
  assert.match(clashes(row(), [], [{ serial: 'ex3-000519' }])[0], /already waiting/)
  assert.deepEqual(clashes({ serial: '' }, [{ key: '' }], []), [])
})

test('a stored row comes back with the known fields only, as text', () => {
  const r = rowOf({ serial: 'S', model: 5, customerId: 'c1', by: 'x@y.z' })
  assert.deepEqual(Object.keys(r), FIELD_KEYS)
  assert.equal(r.model, '5')
  assert.equal(r.customerId, undefined)
})

test('a sheet\'s headings are matched to the fields, each field once, unknown columns left alone', () => {
  const m = mapHeaders(['Site ID', 'Notes', 'Device Model', 'Serial Number', 'Ward / Location', 'Warranty Expiry Date', 'Model number', 'CHS Asset Number', ''])
  assert.deepEqual(m, ['site', null, 'model', 'serial', 'ward', 'warranty', null, 'asset', null])
})

test('rows are laid out in the sheet\'s own column order, blank where the page records nothing, and tab-safe', () => {
  const headers = ['Serial Number', 'Comments', 'Device Model', 'Site ID']
  assert.equal(toTsv([row({ model: 'D30' })], headers), 'EX3-000519\t\tD30\t2350')
  assert.equal(toTsv([row()], headers, true).split('\n')[0], 'Serial Number\tComments\tDevice Model\tSite ID')
  const usual = toTsv([row()]).split('\t')
  assert.equal(usual.length, FIELD_KEYS.length)
  assert.equal(usual[FIELD_KEYS.indexOf('serial')], 'EX3-000519')
  assert.equal(toTsv([row({ ward: 'a\tb' })], ['Ward']).includes('\t'), false)
})

test('the .csv has headings, quotes what needs it and defuses formulas', () => {
  const csv = toCsv([row({ description: 'Defib, "adult"', ward: '=1+1' })], ['Description', 'Ward', 'Serial Number'])
  assert.equal(csv, 'Description,Ward,Serial Number\r\n"Defib, ""adult""",\'=1+1,EX3-000519\r\n')
})

test('a Test this device link opens the bench on the device, in the form the bench already reads', () => {
  const link = testLink({ model: 'D30', serial: 'EX3-000519', manufacturer: 'Mindray', site: '2350', asset: 'CHS-0415', ward: 'ED' }, 'Example Hospital')
  assert.ok(link.startsWith('/testbench/?'))
  const { device } = deviceFromSearch(link.slice(link.indexOf('?')))
  assert.deepEqual(device, { model: 'D30', serial: 'EX3-000519', manufacturer: 'Mindray', customer: 'Example Hospital', site: '2350', asset: 'CHS-0415', ward: 'ED' })
  const l2 = testLink({ description: 'A9 Anaesthetic', serial: 'S' })
  assert.equal(deviceFromSearch(l2.slice(l2.indexOf('?'))).device.model, 'A9 Anaesthetic')
})

// ---- the hand-over to Simpro Asset Sync ----
import { memoryHandoff, putHandoff, takeHandoff, handoffUrl, wantsHandoff, MAX_AGE_MS } from '../src/newequip/handoff.js'
import { missingSite } from '../src/newequip/pending.js'

test('a file left for Asset Sync is taken once, and never after ten minutes', async () => {
  const s = memoryHandoff()
  assert.equal(await takeHandoff(s), null)
  await putHandoff(s, { name: 'a.xlsx', mime: 'x', buffer: new ArrayBuffer(3) }, 1000)
  const got = await takeHandoff(s, 1000 + 5000)
  assert.equal(got.name, 'a.xlsx')
  assert.equal(got.buffer.byteLength, 3)
  assert.equal(await takeHandoff(s, 1000 + 5000), null, 'taken once')
  await putHandoff(s, { name: 'b.xlsx', buffer: new ArrayBuffer(1) }, 1000)
  assert.equal(await takeHandoff(s, 1000 + MAX_AGE_MS + 1), null, 'too old')
  assert.equal(await takeHandoff(s, 1000 + MAX_AGE_MS + 1), null, 'and cleared')
})

test('Asset Sync is opened with the hand-over address, and recognises it', () => {
  assert.equal(wantsHandoff(handoffUrl().slice(handoffUrl().indexOf('?'))), true)
  assert.equal(wantsHandoff(''), false)
  assert.equal(wantsHandoff('?from=elsewhere'), false)
})

test('pending rows with no Site ID cannot be placed in Simpro: they are named', () => {
  assert.deepEqual(missingSite([row(), row({ serial: 'B', site: '' }), row({ serial: 'C', site: ' ' })]), ['B', 'C'])
  assert.deepEqual(missingSite([row()]), [])
})

test('correcting a recorded asset: it never clashes with itself, and an unchanged serial never clashes', () => {
  const me = { id: 'a', ...row() }, other = { id: 'b', ...row({ serial: 'EX3-000777' }) }
  assert.deepEqual(editClashes(row({ model: 'D3' }), me, [], [me, other]), [])
  assert.deepEqual(editClashes(row({ serial: 'ex3-000519 ' }), me, [{ key: 'EX3-000519' }], [me]), [], 'same serial, even if it is in the workbook by now')
  assert.match(editClashes(row({ serial: 'EX3-000777' }), me, [], [me, other])[0], /already waiting/)
  assert.match(editClashes(row({ serial: 'EX3-000888' }), me, [{ key: 'EX3-000888' }], [me])[0], /already on the asset list/)
  assert.deepEqual(editClashes(row({ serial: 'EX3-000999' }), me, [], [me, other]), [])
})

test('an edit names the fields it changed, by heading', () => {
  assert.deepEqual(changedFields(row(), row()), [])
  assert.deepEqual(changedFields(row(), row({ model: 'D3', ward: 'ICU' })), ['Device Model', 'Ward/Location'])
})
