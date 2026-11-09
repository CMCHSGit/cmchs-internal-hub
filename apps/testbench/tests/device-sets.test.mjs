// npm test --prefix apps/testbench — a set of devices tested together (a monitor with its dock and handle): one test, one report,
// every serial number counted. Invented serial numbers only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { splitSerials, serialsOf, summaryOf } from '../src/bench-tests.js'
import { benchByUnit, reportsByUnit } from '../src/newequip/assetlist.js'
import { filterGroups, sharedFileBase } from '../src/reports.js'

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
const run = { id: 'r1', dut: { 'Serial number': 'N1A-0001', Model: 'N1' }, devices: [{ serial: 'TDS-0002', model: 'TDS' }, { serial: ' HDL-0003 ', model: 'Handle', asset: 'CHS9' }, { serial: '', model: '' }], template: { name: 'N1 TDS and Handle', steps: [] }, overall: 'pass' }

test('every serial number of a set goes in the one serial field, the main device first', () => {
  assert.equal(serialsOf(run), 'N1A-0001 + TDS-0002 + HDL-0003')
  assert.equal(summaryOf(run, { email: 'a@b.c' }).serial, 'N1A-0001 + TDS-0002 + HDL-0003')
  assert.equal(serialsOf({ dut: { 'Serial number': 'ONE-1' } }), 'ONE-1', 'one device: as before')
  assert.deepEqual(splitSerials('N1A-0001 + TDS-0002 + HDL-0003'), ['N1A-0001', 'TDS-0002', 'HDL-0003'])
  assert.deepEqual(splitSerials('AB+12'), ['AB+12'], 'a + inside a serial number is not a join')
  assert.deepEqual(splitSerials(''), [])
})

test('New equipment counts a set’s test and report for each of its devices', () => {
  const units = ['N1A-0001', 'TDS-0002', 'HDL-0003', 'OTHER-9'].map((s) => ({ key: s }))
  const b = benchByUnit(units, [{ serial: 'N1A-0001 + tds-0002 + HDL-0003', overall: 'pass', finished: '2026-11-09T01:00:00Z' }])
  assert.deepEqual([...b.keys()].sort(), ['HDL-0003', 'N1A-0001', 'TDS-0002'])
  assert.equal(b.get('TDS-0002').overall, 'pass')
  const r = reportsByUnit(units, [{ serial: 'N1A-0001 + TDS-0002', unsent: true, sentTo: [] }])
  assert.equal(r.get('TDS-0002').tests, 1)
  assert.equal(r.has('HDL-0003'), false)
})

test('Saved reports finds a set’s report by any of its serials; its files are named by the main device', () => {
  const groups = [{ serial: 'N1A-0001 + TDS-0002', model: 'N1', customer: 'X', date: '', template: '', day: '2026-11-09' }, { serial: 'SOLO-5', model: '', customer: 'X', date: '', template: '', day: '2026-11-09' }]
  assert.equal(filterGroups(groups, { serials: ['tds-0002'] }).length, 1)
  assert.equal(filterGroups(groups, { text: 'tds-0002' }).length, 1)
  assert.equal(sharedFileBase({ serial: 'N1A-0001 + TDS-0002', model: 'N1', finished: '2026-11-09T01:00:00Z' }), 'N1A-0001 - N1 09.11.2026')
})

test('the bench: other devices on the start screen, the report header and the Ansur record', () => {
  const a = html.indexOf('function otherDevices('), b = html.indexOf('const Extras = {')
  const L = vm.runInNewContext(html.slice(a, b) + '; ({ otherDevices, deviceLine, allSerials })')
  assert.deepEqual(JSON.parse(JSON.stringify(L.otherDevices(run))), [{ serial: 'TDS-0002', model: 'TDS', asset: '' }, { serial: 'HDL-0003', model: 'Handle', asset: 'CHS9' }], 'empty rows dropped')
  assert.equal(L.deviceLine({ serial: 'HDL-0003', model: 'Handle', asset: 'CHS9' }), 'Handle · S/N HDL-0003 · Asset # CHS9')
  assert.equal(L.allSerials(run), 'N1A-0001 + TDS-0002 + HDL-0003', 'the same join as the hub')
  assert.match(html, /<div class="xd" id="extraDevs"><\/div>/)
  assert.match(html, /Another device in this test/)
  assert.match(html, /Runner\.run\.devices = devices/, 'kept on the test')
  assert.match(html, /\[`Device \$\{i \+ 2\}`, deviceLine\(d\)\]/, 'listed in the report header')
  assert.match(html, /\.\.\.others\.map\(\(\[k, v\], j\) => `\$\{ind\(3\)\}<Item Name=/, 'and in the Ansur record')
  assert.match(html, /serial: allSerials\(run\)/, 'Saved reports get every serial')
  assert.match(html, /if \(prev\.devices\) r\.devices = clone\(prev\.devices\)/, 'a rerun keeps them')
  assert.match(html, /devices: Extras\.collect\(\)/, 'the draft keeps them')
  assert.match(html, /Sheet\.addPending\(\{ serial:/, 'a device not found can be added as a pending row')
})

test('the Model boxes drop down the template’s models, then the asset list’s, and still take anything typed', () => {
  const a = html.indexOf('function modelOptions('), b = html.indexOf('function refreshModelOptions(')
  const { modelOptions } = vm.runInNewContext('const tplModels = (t) => (t && Array.isArray(t.models) ? t.models.filter(Boolean) : []);' + html.slice(a, b) + '; ({ modelOptions })')
  const rows = [{ 'Device Model': 'TDS' }, { 'Device Model': ' N1 ' }, { 'Device Model': '-' }, { 'Device Model': 'Handle' }, {}]
  assert.deepEqual([...modelOptions({ models: ['N1', 'N17'] }, rows)], ['N1', 'N17', 'Handle', 'TDS'], 'template first, no repeats or blanks')
  assert.deepEqual([...modelOptions(null, [])], [])
  assert.match(html, /<datalist id="modelOptions"><\/datalist>/)
  assert.match(html, /i\.setAttribute\('list', 'modelOptions'\)/, 'the template’s Model box')
  assert.match(html, /f === 'model' \? ' list="modelOptions"' : ''/, 'the other devices’ Model boxes')
})
