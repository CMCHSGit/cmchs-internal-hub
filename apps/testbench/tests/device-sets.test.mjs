// npm test --prefix apps/testbench — a set of devices tested together (a monitor with its dock and handle): one test, one report,
// every serial number counted. Invented serial numbers only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { splitSerials, serialsOf, summaryOf } from '../src/bench-tests.js'
import { benchByUnit, reportsByUnit } from '../src/newequip/assetlist.js'
import { filterGroups, sharedFileBase } from '../src/reports.js'

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')   // a Windows checkout has CRLF; the slicing below looks for "\n}\n"
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

test('Saved reports finds a set’s report by any of its serials; its files name every serial, comma separated', () => {
  const groups = [{ serial: 'N1A-0001 + TDS-0002', model: 'N1', customer: 'X', date: '', template: '', day: '2026-11-09' }, { serial: 'SOLO-5', model: '', customer: 'X', date: '', template: '', day: '2026-11-09' }]
  assert.equal(filterGroups(groups, { serials: ['tds-0002'] }).length, 1)
  assert.equal(filterGroups(groups, { text: 'tds-0002' }).length, 1)
  assert.equal(sharedFileBase({ serial: 'N1A-0001 + TDS-0002', model: 'N1', finished: '2026-11-09T01:00:00Z' }), 'N1A-0001, TDS-0002 - N1 09.11.2026')
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

test('a set’s file name lists every serial, comma separated; a long list is cut short; the hub reads it back', async () => {
  const a = html.indexOf('function otherDevices('), b = html.indexOf('const Extras = {')
  const c = html.indexOf('const safeName = '), d = html.indexOf('\n', c)
  const e = html.indexOf('function dutDefault('), f = html.indexOf('\n}\n', html.indexOf('function outName(')) + 3
  const store = new Map()
  const L = vm.runInNewContext(html.slice(a, b) + html.slice(c, d) + html.slice(e, f) + '; ({ outName, dutDefault })', { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, $$: () => [] })
  const name = L.outName({ dut: { 'Serial Number': 'AA3F46248926', Model: 'N1 Handle' }, devices: [{ serial: 'AA3D58264234', model: 'N1 TDS' }] }, 'pdf')
  assert.match(name, /^AA3F46248926, AA3D58264234 - N1 Handle \d{2}\.\d{2}\.\d{4}\.pdf$/)
  assert.match(L.outName({ dut: { 'Serial number': 'ONE-1', Model: 'X' } }, 'mtr'), /^ONE-1 - X /, 'one device: as before')
  const many = L.outName({ dut: { 'Serial number': 'S0000000000000' }, devices: Array.from({ length: 12 }, (_, i) => ({ serial: `S${String(i + 1).padStart(13, '0')}` })) }, 'pdf')
  assert.ok(many.length < 180 && / and \d+ more /.test(many), many)
  const { splitSerials } = await import('../src/bench-tests.js')
  assert.deepEqual(splitSerials('AA3F46248926, AA3D58264234'), ['AA3F46248926', 'AA3D58264234'])
  const { describeFile } = await import('../src/reports.js')
  assert.deepEqual(splitSerials(describeFile(name).serial), ['AA3F46248926', 'AA3D58264234'])
})

test('empty start-screen fields: Mindray, CHS, and the engineer signed in to the hub', () => {
  const e = html.indexOf('function dutDefault('), f = html.indexOf('function outName(')
  const store = new Map(), inputs = [{ dataset: { k: 'Testing Engineer' }, value: '' }, { dataset: { k: 'Model' }, value: '' }]
  const L = vm.runInNewContext(html.slice(e, f) + '; ({ dutDefault, setEngineer })', { localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) }, $$: () => inputs })
  assert.equal(L.dutDefault('Manufacturer'), 'Mindray')
  assert.equal(L.dutDefault('Testing Company'), 'CHS')
  assert.equal(L.dutDefault('Testing Engineer'), '', 'nobody known yet')
  assert.equal(L.dutDefault('Model'), '')
  assert.equal(L.dutDefault('Manufacturer', { manufacturer: 'Masimo' }), 'Masimo', 'a template can name its manufacturer')
  assert.match(html, /manufacturer: String\(raw\.manufacturer \|\| ''\)\.trim\(\) \|\| undefined/, 'kept when a template is loaded')
  assert.match(html, /prev\[k\] !== dutDefault\(k, was\)/, 'switching template swaps a default that was not typed')
  for (const f of readdirSync(new URL('../templates/', import.meta.url)).filter((f) => f.startsWith('Masimo '))) assert.equal(JSON.parse(readFileSync(new URL(`../templates/${f}`, import.meta.url), 'utf8')).template.manufacturer, 'Masimo', f)
  L.setEngineer('someone@example.com')
  assert.equal(inputs[0].value, '', 'an email address is not a name')
  L.setEngineer('Pat Example')
  assert.equal(inputs[0].value, 'Pat Example', 'an empty box is filled')
  assert.equal(L.dutDefault('Testing engineer'), 'Pat Example', 'and remembered for next time')
  assert.ok(!html.includes('Jonathan Nasrun'), 'no engineer’s name is built in')
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.match(section, /meName: who\.current\.name/)
})

test('a step dragged to another template is copied there, never taken as a position in that template', () => {
  const a = html.indexOf('const copyOfStep = '), b = html.indexOf('async function copyStepsDialog(')
  let n = 0
  const ctx = { TYPES: { ps_perf: {}, esa_pat: {}, check: {} }, clone: (x) => JSON.parse(JSON.stringify(x)), uid: () => `id${++n}`,
    tplModels: (t) => (t && Array.isArray(t.models) ? t.models : []),
    newStep: (type, over) => ({ id: `new${++n}`, type, images: [], ...over }) }
  const L = vm.runInNewContext(html.slice(a, b) + '; ({ copyOfStep, readStepDrag, addStepCopy, STEP_DRAG })', ctx)
  const square = { id: 's14', type: 'ps_perf', title: 'ECG: calibration square wave', instructions: 'x', params: { wave: 'SQUARE=2.0' }, images: [], models: ['D60'] }
  const dt = { getData: (k) => (k === L.STEP_DRAG ? JSON.stringify({ win: 'w1', tpl: 'n1', from: 'N1', id: 's14', step: square }) : '') }
  const d = L.readStepDrag(dt)
  assert.equal(d.step.title, 'ECG: calibration square wave', 'the drag carries the step itself')
  const target = { steps: [{ id: 'p1', title: 'Visual' }, { id: 'p2', title: 'Sidestream CO2 Test and Calibration' }] }
  const c = L.addStepCopy(target, d, 1)
  assert.deepEqual(target.steps.map((s) => s.title), ['Visual', 'ECG: calibration square wave', 'Sidestream CO2 Test and Calibration'], 'the dragged step, where it was dropped')
  assert.notEqual(c.id, 's14', 'a new id'); assert.equal(c.models, undefined, 'a model the template does not have: applies to all')
  assert.equal(L.readStepDrag({ getData: () => '3' }), null, 'an old position-only drag is ignored, not used as a position')
  assert.match(html, /d\.win === WINDOW_ID && d\.tpl === this\.tpl\.id && f >= 0/, 'moved only within the same template in the same window')
  assert.match(html, /Copied “\$\{c\.title\}” to the end of \$\{t\.name\}/, 'dropping on a template’s name in the list copies it there')
})

test('the pressure gauge step: the ProSim measures, the bench only reads it (PRESSX, quietly), nothing is set', () => {
  assert.match(html, /ps_gauge: \{ group: 'ps', label: 'Pressure gauge \(ProSim\)'/)
  assert.match(html, /cmds: \(\) => \[\], summary: \(\) => 'ProSim pressure, read live \(PRESSX\)'/, 'sends no commands')
  assert.match(html, /Devices\.ps\.send\('PRESSX', \{ timeout: 1500, retries: 0, quiet: true \}\)/, 'polls quietly, no retries')
  assert.match(html, /stopHold\(\) \{[^\n]*this\.stopGauge\(\);/, 'stops when the step changes')
  assert.match(html, /if \(!this\.quiet\) log\('tx'/, 'quiet polls stay out of the log')
  assert.ok(!/'PRESSX'|'PRESS'/.test(html.slice(html.indexOf('const PS_BLOCK'), html.indexOf('\n', html.indexOf('const PS_BLOCK')))), 'reading is not blocked')
  assert.match(html, /PS_BLOCK = \['RESET', 'PAIR', 'UNPAIR', 'PS=', 'PST=', 'NIBPLEAK', 'NIBPPOP', 'ZPRESS', 'CZPRESS'\]/, 'the pump stays blocked')
})

test('a protective earth failure measured without zeroing offers to zero the lead and re-test, in remote mode', () => {
  assert.match(html, /const zero = s\.type === 'esa_pe' && \(opts\.zero \|\| Prefs\.get\('zeroLead'\)\);/)
  assert.match(html, /const unzeroed = s\.type === 'esa_pe' && bad\.some\(x => \/lead not zeroed\/i\.test\(x\.label\)\);/)
  assert.match(html, /\.\.\.\(unzeroed \? \[\{ label: 'Zero lead and re-test', value: 'zero'/)
  assert.match(html, /choice === 'retest' \|\| choice === 'zero'\) \{[^\n]*this\.runEsa\(this\.steps\[i\], \{ auto: true, zero: choice === 'zero' \}\)/)
  assert.match(html, /await this\.esaSend\(link, 'IDLE'\); await this\.esaSend\(link, 'ERES'\); await this\.esaSend\(link, 'ZERO'\);/)
})

test('an Ansur import is reviewed: clean name, CHS details, AS/NZS 3551 limits chosen (never silently), ProSim steps offered', () => {
  const a = html.indexOf('/* ======================= Ansur import review'), b = html.indexOf('async function ansurReview(')
  let n = 0
  const same = (x, y, m) => assert.deepEqual(JSON.parse(JSON.stringify(x)), y, m)
  const types = { check: {}, esa_pe: { label: 'Protective earth resistance' },
    ps_spo2: { label: 'SpO2', instructions: 'Connect the SpO2 sensor to the ProSim 8 finger.', summary: (s) => `${s.params.sat}%` },
    ps_nsr: { label: 'ECG normal sinus', instructions: 'Connect the ECG leads to the ProSim 8.', summary: (s) => `${s.params.rate} bpm` },
    ps_gauge: { label: 'Pressure gauge (ProSim)', instructions: 'Gauge.', summary: () => 'PRESSX' },
    ps_resp: { label: 'Respiration', instructions: '', summary: (s) => `${s.params.rate} brpm` },
    ps_temp: { label: 'Temperature', instructions: '', summary: (s) => s.params.t } }
  const ctx = { TYPES: types, clone: (x) => JSON.parse(JSON.stringify(x)), monitorCheck: (label, unit, lo, hi) => ({ enabled: true, label, unit, lo, hi }),
    TEMPS: Array.from({ length: 25 }, (_, i) => (30 + i * 0.5).toFixed(1)),
    uid: () => `u${++n}`,
    newStep: (type, over) => ({ id: `new${++n}`, type, images: [], hold: 0, instructions: '', ...over }) }
  const L = vm.runInNewContext(html.slice(a, b) + '; ({ ansurCleanName, ansurLimitIssues, ansurProsimSuggestions, ansurApplyReview, ansurDuplicates, CHS_DUT })', ctx)
  assert.equal(L.ansurCleanName('Rad-97 ASNZ 3551, EST + PVT 11.07.2025', 'Masimo'), 'Masimo Rad-97')
  assert.equal(L.ansurCleanName('0000-Rad-97 Nomoline AS-NZS 3551 EST and PVT Master', ''), 'Rad-97 Nomoline')
  assert.equal(L.ansurCleanName('SN-Vetal 3 AS-NZS 3551 EST and PVT', 'Mindray'), 'Mindray Vetal 3')
  const conv = { steps: [
    { type: 'check', title: 'Visual Inspection', params: { items: ['Case OK'] } },
    { type: 'esa_mains', title: 'Mains voltage', params: {} },
    { type: 'esa_ins', title: 'Insulation: mains to protective earth', params: { target: 'MINS', lo: 2 } },
    { type: 'esa_encl', title: 'Enclosure leakage', params: { conds: [{ c: 'NC', hi: 500 }, { c: 'ON', hi: 100 }, { c: 'OE', hi: 500 }] } },
    { type: 'esa_earthl', title: 'Earth leakage', params: { conds: [{ c: 'NC', hi: 500 }, { c: 'ON', hi: 1000 }] } },
    { type: 'check', title: 'SpO2 Accuracy Test', instructions: 'Measure SpO2 on a healthy person’s finger.', params: { items: ['Pleth wave shown'], readings: [{ label: 'SpO2', unit: '%', lo: 95, hi: 100 }] } },
    { type: 'check', title: 'ECG Heart Rate', params: { items: [], readings: [{ label: 'HR at 80 bpm', unit: 'bpm', lo: 79, hi: 81 }] } },
    { type: 'check', title: 'NIBP accuracy', params: { items: ['Overpressure releases'], readings: [{ label: 'At 50 mmHg', unit: 'mmHg', lo: 47, hi: 53 }, { label: 'At 200 mmHg', unit: 'mmHg', lo: 197, hi: 203 }] } },
    { type: 'check', title: 'SpO2 and NIBP', params: { items: ['x'] } },
    { type: 'check', title: 'IR Temperature (ear)', params: { items: [], readings: [{ label: 'Temp', unit: '°C', lo: 36.8, hi: 37.2 }] } }],
    appliedParts: [{ name: 'Probe', apclass: 'B', leads: ['RA'] }], dut: ['Serial Number', 'Configuration'] }
  const issues = L.ansurLimitIssues(conv)
  same(issues.map((x) => x.kind), ['ins', 'encl', 'earthl', 'addpe'], 'insulation 2 MΩ, swapped enclosure, earth 500/1000, no PE on a Class I device')
  assert.match(issues[1].std, /NC 100, ON 500, OE 500/)
  const sugg = L.ansurProsimSuggestions(conv, 'Mindray')
  same(sugg.map((x) => [x.type, x.on]), [['ps_spo2', false], ['ps_nsr', true], ['ps_gauge', true], ['ps_temp', false]], 'a person’s finger and an ear thermometer are offered unticked; a mixed step is left alone')
  assert.equal(sugg[1].step.params.rate, 80, 'the rate is the middle of the Ansur limits')
  same(sugg[2].step.params.extra.map((x) => x.label), ['At 200 mmHg', 'Overpressure releases'], 'the other readings and items stay')
  assert.equal(sugg[0].step.params.probe, 'MINDR')
  const out = L.ansurApplyReview(conv, { name: 'Mindray Vetal 3', category: 'Vet patient monitors', manufacturer: 'Mindray', chsDut: true, apClasses: { 0: 'CF' },
    limits: { [issues[0].id]: 'ansur' }, prosim: {} }, issues, sugg, 'Vetal 3.mtr')
  same(out.steps.map((s) => s.type), ['check', 'esa_mains', 'esa_pe', 'esa_ins', 'esa_encl', 'esa_earthl', 'check', 'ps_nsr', 'ps_gauge', 'check', 'check'])
  assert.equal(out.steps[2].params.hi, 0.2, 'PE added after mains')
  assert.equal(out.steps[3].params.lo, 2, 'kept as in Ansur when chosen')
  same(out.steps[4].params.conds.map((c) => c.hi), [100, 500, 500])
  same(out.steps[5].params.conds.map((c) => c.hi), [5000, 10000])
  assert.equal(out.appliedParts[0].apclass, 'CF')
  same(out.dut, [...L.CHS_DUT])
  assert.equal(out.category, 'Vet patient monitors')
  assert.ok(out.desc.includes('Changed from Ansur: enclosure leakage NC 100, ON 500, OE 500 µA (Ansur: NC 500, ON 100, OE 500 µA); earth leakage NC 5000, ON 10000 µA (B11.6) (Ansur: NC 500, ON 1000 µA); protective earth resistance ≤ 0.2 Ω added (Ansur had none); applied part “Probe” type CF (Ansur: B).'), out.desc)
  assert.match(out.desc, /Kept as in Ansur, differs from AS\/NZS 3551 \(for Jonathan to confirm\): insulation: mains to protective earth ≥ 2 MΩ/)
  assert.match(out.desc, /ProSim 8 steps: ECG normal sinus, Pressure gauge\./)
  assert.equal(conv.steps.length, 10, 'the converted template itself is not changed')
  // Ansur's one "Performance Testing" container (Vetal 3), held twice in the file: split by section, the repeat left out.
  const perf = { type: 'check', title: 'Performance Testing', instructions: '5.4.1 ECG Test and Calibration:\nSet 80 bpm.\n\n5.4.6 CO2 Test and Calibration:\nApply the gas.', params: {
    items: ['Startup Selftest: The unit powers on normally'],
    readings: [{ label: '5.4.1 ECG Test and Calibration: HR Value', unit: '', lo: 79, hi: 81 }, { label: '5.4.1 ECG Test and Calibration: Square Wave %', unit: '', lo: 95, hi: 105 },
      { label: '5.4.2 Resp Performance Test: Resp Rate', unit: '', lo: 38, hi: 42 }, { label: '5.4.4 NIPB Test: Reading at 50mmHg', unit: '', lo: 47, hi: 53 },
      { label: '5.4.6 CO2 Test and Calibration: CO2 Accuracy Test', unit: '', lo: 5.7, hi: 6.3 }] } }
  const vet = { steps: [{ type: 'esa_mains', title: 'Mains voltage', params: {} }, perf, JSON.parse(JSON.stringify(perf))] }
  same(L.ansurDuplicates(vet), [2])
  const fuller = JSON.parse(JSON.stringify(perf)); fuller.params.readings.push({ label: '5.4.5 Temp Test: Temperature Channel 2', unit: '', lo: 36.9, hi: 37.1 })
  same(L.ansurDuplicates({ steps: [perf, fuller] }), [0], 'the copy with a check more is kept, wherever it is')
  const vs = L.ansurProsimSuggestions(vet, 'Mindray')
  same(vs.map((x) => [x.type, x.section]), [['ps_nsr', '5.4.1 ECG Test and Calibration'], ['ps_resp', '5.4.2 Resp Performance Test'], ['ps_gauge', '5.4.4 NIPB Test']], 'sections, not the repeat; "NIPB" (Ansur’s spelling) is NIBP')
  assert.equal(vs[0].step.instructions.split('\n\n')[0], 'Set 80 bpm.', 'the section’s own instructions go with it')
  const vo = L.ansurApplyReview(vet, { prosim: { [vs[1].id]: false } }, [], vs, 'v.mtr')
  same(vo.steps.map((s) => [s.type, s.title]), [['esa_mains', 'Mains voltage'], ['check', 'Startup Selftest'], ['ps_nsr', '5.4.1 ECG Test and Calibration'],
    ['check', '5.4.2 Resp Performance Test'], ['ps_gauge', '5.4.4 NIPB Test'], ['check', '5.4.6 CO2 Test and Calibration']], 'the original order; an unticked section stays typed')
  same(vo.steps[5].params.readings.map((r) => r.label), ['CO2 Accuracy Test'])
  assert.equal(vo.steps[5].instructions, 'Apply the gas.')
  assert.match(vo.desc, /1 repeated step left out \(“Performance Testing” twice in the Ansur file; the fuller copy kept\)/)
  assert.equal(L.ansurApplyReview(vet, { dropDupes: false, prosim: { [vs[0].id]: false, [vs[1].id]: false, [vs[2].id]: false } }, [], vs, 'v.mtr').steps.length, 3, 'nothing chosen: as converted')
  assert.match(html, /reviewed = await ansurReview\(conv, f\.name\); if \(!reviewed\) return;/)
  assert.match(html, /if \(reviewed && reviewed\.save\) await Shared\.save\(t\);/)
})
