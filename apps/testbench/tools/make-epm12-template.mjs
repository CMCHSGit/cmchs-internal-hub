// Builds the Test Bench template for the Mindray ePM12 patient monitor.
// Run: node apps/testbench/tools/make-epm12-template.mjs [outDir]   (default apps/testbench/templates)
// The file goes into the SharePoint Templates folder (Service\Test Software\CHS Test Bench\Templates); the bench picks it up there.
//
// Source: the completed CHS Ansur record "AC6-69082858 - ePM12 AS-NZS 3551 EST & PVT 30.09.2026.mtr" (Clutha Health First), made with the
// generic "0000 - Patient Monitor AS-NZS 3551 EST and PVT Template.mtt" — the same Ansur template as the N1 set. Applied parts were measured
// as one CF group "SpO2, ECG, TEMP". Electrical limits follow AS/NZS 3551:2012+A2 as the other bench templates (earth leakage 5000/10000 uA,
// B11.6; the Ansur template listed both 500/1000 and 5000/10000). ECG, respiration and temperature are ProSim 8 steps copied from the
// Patient Monitor and OR Modules template. IBP: a zero step (ProSim at 0 mmHg), static 200 mmHg, then ART (120/80) and LV (120/0) waves on
// both ProSim channels, as the engineers set it up in their Patient monitor template (18 Nov 2026).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || path.join(here, '..', 'templates')
const step = (id, type, title, instructions, params = {}) => ({ id, type, title, instructions, images: [], hold: 0, params })
const reading = (label, unit, lo = '', hi = '') => ({ label, unit, lo, hi })
const pf = (label) => ({ label, unit: '', lo: '', hi: '' })
const LEAD = 'Connect the monitor’s mains lead to the ESA612 equipment outlet'
const AP = 'the ECG leads, SpO2 sensor and temperature probe (all on the RA post)'
const ins = (id, target, title, lo, note = '') => step(id, 'esa_ins', `Insulation: ${title}`, `${LEAD} and switch the monitor on. Don’t touch the monitor during the test.${note ? ' ' + note : ''}`, { target, volts: 'HIGH', lo })

const src = JSON.parse(fs.readFileSync(path.join(here, '..', 'templates', 'Patient Monitor and OR Modules - Test Bench template.json'), 'utf8')).template.steps
const from = (title, id) => { const s = src.find((x) => x.title === title); if (!s) throw new Error(`Patient Monitor template has no step "${title}"`); return { ...structuredClone(s), id } }

const template = {
  name: 'Mindray ePM12 Patient Monitor',
  desc: 'Mindray ePM12 patient monitor (Class I), applied parts type CF (SpO2, ECG, Temp) on RA. From the CHS Ansur template “Patient Monitor AS-NZS 3551 EST and PVT” as used for the ePM12 on 30.09.2026. Electrical limits from AS/NZS 3551:2012+A2 (earth leakage 5000/10000 µA, B11.6; mains to applied parts over 1 Mohm, B9.3). ECG, respiration, temperature and IBP are ProSim 8 steps; IBP is zeroed from the bench first, then 200 mmHg static, then ART (120/80) and LV (120/0) waves on both ProSim channels. SpO2 (healthy finger), NIBP and CO2 are typed or checked by hand.',
  category: 'Monitoring',
  highlight: true,
  dut: ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing company', 'Testing engineer'],
  esaAuto: true, esaHalt: true,
  appliedParts: [{ id: 'ap1', name: 'SpO2, ECG, Temp', apclass: 'CF', leads: ['RA'] }],
  steps: [
    step('visual', 'check', 'Visual inspection', 'Inspect the monitor, cables and accessories.', { items: [
      'The case, display screen, buttons, power cord, and accessories have no obvious signs of damage.',
      'The external connecting cables are not frayed and the connector pins are not loose or bent.',
      'The external connectors are not loose and their pins are not bent.',
      'The safety labels and data plate are clearly legible.',
      'The power-on test is passed. The power indicator and alarm system works correctly and the monitor starts up properly.'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply you are testing from.'),
    step('pe', 'esa_pe', 'Protective earth resistance', `${LEAD}. Clip the red test lead to an exposed earthed metal part, such as a rear-panel screw.`, { hi: 0.2 }),
    ins('ins-mins', 'MINS', 'mains to protective earth', 1),
    ins('ins-apins', 'APINS', 'applied parts to protective earth', '', 'Recorded only.'),
    ins('ins-mains-ap', 'MAINS_AP', 'mains to applied parts', 1, 'Must be over 1 Mohm (AS/NZS 3551 B9.3).'),
    ins('ins-mains-ne', 'MAINS_NE', 'mains to non-earth accessible conductive part', 1),
    ins('ins-ap-ne', 'AP_NE', 'applied parts to non-earth accessible conductive part', '', 'Recorded only.'),
    step('encl', 'esa_encl', 'Enclosure leakage', 'Connect the red test lead to a conductive non-earthed exposed part of the monitor.\nNote: only a representative sample of conductive non-earthed exposed parts needs to be tested.', { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }, { c: 'OE', hi: 500 }] }),
    step('earthl', 'esa_earthl', 'Earth leakage', `${LEAD}. The monitor will be switched on and off between conditions. Limits: 5000 µA normal, 10000 µA neutral open (AS/NZS 3551:2012+A2 B11.6).`, { conds: [{ c: 'NC', hi: 5000 }, { c: 'ON', hi: 10000 }] }),
    step('pat', 'esa_pat', 'Patient leakage', `Connect ${AP}. ${LEAD}.`, { mode: 'together', conds: [{ c: 'NC' }, { c: 'ON' }, { c: 'OE' }] }),
    step('map', 'esa_map', 'Mains on applied parts', `Connect ${AP}. ${LEAD}.`, { mode: 'together', pols: ['NORM'] }),
    from('ECG: heart rate, waveform and lead off', 'ecg'),
    from('ECG: calibration square wave', 'ecg-cal'),
    from('ECG: paced signals', 'ecg-paced'),
    from('Respiration', 'resp'),
    from('Temperature', 'temp'),
    step('ibp-zero', 'ps_custom', 'IBP: zero', 'Connect the IBP cables from ProSim BP1 and BP2 to the monitor. The simulator sets both channels to 0 mmHg. Zero each IBP channel on the monitor now, then go on. Mark channel 2 N/A if the monitor has only one IBP channel.', { text: 'IBPS=1,+000\nIBPS=2,+000', monitor: { enabled: true, label: 'IBP channel 1 zeroed on the monitor', unit: '', lo: '', hi: '' }, extra: [pf('IBP channel 2 zeroed on the monitor')] }),
    step('ibp-static', 'ps_custom', 'IBP: static pressure, both channels', 'The simulator sets both ProSim channels to 200 mmHg. Enter what the monitor shows (196–204 mmHg). Mark channel 2 N/A if the monitor has only one IBP channel.', { text: 'IBPS=1,+200\nIBPS=2,+200', monitor: { enabled: true, label: 'IBP channel 1 on monitor', unit: 'mmHg', lo: 196, hi: 204 }, extra: [reading('IBP channel 2 on monitor', 'mmHg', 196, 204)] }),
    step('ibp-art', 'ps_custom', 'IBP: ART wave', 'The simulator outputs an arterial wave at 120/80 on both ProSim channels. Set each monitor IBP channel’s label to ART. Wait a few seconds for it to settle (a short “interference” message is normal after a change).', { text: 'IBPW=1,ART\nIBPW=2,ART\nIBPP=1,120,080\nIBPP=2,120,080', monitor: { enabled: true, label: 'ART wave shown correctly on IBP channel 1 (about 120/80)', unit: '', lo: '', hi: '' }, extra: [pf('ART wave shown correctly on IBP channel 2 (about 120/80)')] }),
    step('ibp-lv', 'ps_custom', 'IBP: LV wave', 'The simulator outputs a left-ventricle wave at 120/0 on both ProSim channels. Set each monitor IBP channel’s label to LV (or P1 / P2). Wait a few seconds for it to settle.', { text: 'IBPW=1,LV\nIBPW=2,LV\nIBPP=1,120,000\nIBPP=2,120,000', monitor: { enabled: true, label: 'LV wave shown correctly on IBP channel 1 (about 120/0)', unit: '', lo: '', hi: '' }, extra: [pf('LV wave shown correctly on IBP channel 2 (about 120/0)')] }),
    step('spo2-nibp', 'check', 'SpO2 and NIBP', 'SpO2: measure SpO2 on a healthy person’s finger. Check a Pleth wave and PR value are displayed, then enter the displayed SpO2.\nNIBP: check accuracy against the simulator, the leak test and the overpressure test (Adult/Peds and Neo).', { items: [
      'A Pleth wave and PR value are displayed.',
      'NIBP: the accuracy difference between the monitor and the simulator is within ±3 mmHg.',
      'NIBP: there is no leakage, or the manual leakage test result does not exceed 6 mmHg/min.',
      'NIBP overpressure: test passes for Adult and Peds.',
      'NIBP overpressure: test passes for Neo.'], readings: [reading('Displayed SpO2', '%', 95, 100)] }),
    step('co2', 'check', 'Sidestream CO2', 'Only if sidestream CO2 is fitted; otherwise skip this step.\n1. Block the gas inlet of the module or watertrap and check for the CO2 Filterline Err alarm.\n2. Apply the calibration gas and enter the displayed CO2.', {
      items: ['Leak test: with the gas inlet blocked, the sidestream CO2 flowrate is slower than 10 ml/min and a CO2 Filterline Err alarm is given (no leakage).'],
      readings: [reading('Displayed CO2 (6.0 ±0.3 %)', '%', 5.7, 6.3)] }),
    step('network-battery', 'check', 'Network, battery and production test', 'Run the production test under factory maintenance.', { items: [
      'Network: the monitor can print over the network.',
      'Network: the network printer correctly prints ECG reports.',
      'Battery: the monitor operates correctly from battery power when external AC power fails.',
      'Battery: the operating time of the battery meets the product specification.',
      'Production test: all tests pass.'] }),
  ],
}

fs.mkdirSync(outDir, { recursive: true })
const ids = template.steps.map((s) => s.id)
if (new Set(ids).size !== ids.length) throw new Error('duplicate step ids')
const file = 'Mindray ePM12 Patient Monitor - Test Bench template.json'
fs.writeFileSync(path.join(outDir, file), JSON.stringify({ format: 'chs-test-bench-template', version: 1, template }, null, 1) + '\n', 'utf8')
console.log(file, template.steps.length, 'steps')
