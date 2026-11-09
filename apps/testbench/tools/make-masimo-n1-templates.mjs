// Builds the Test Bench templates for the Masimo monitors CHS tests for Promed (Rad-97, Radical-7, Root, Rad-G) and for the
// Mindray N1 tested as a set with its N1 TDS and N1 Handle.
// Run: node apps/testbench/tools/make-masimo-n1-templates.mjs [outDir]   (default apps/testbench/templates)
// The files go into the SharePoint Templates folder (Service\Test Software\CHS Test Bench\Templates); the bench picks them up there.
//
// Sources: the completed CHS Ansur records (.mtr) for each model, which carry their .mtt template:
//   Rad-97      "0000-Rad-97 AS-NZS 3551 EST and PVT DD.MM.YYYY Master.mtt"           (record 04.11.2026)
//   Radical-7   "0000-Radical 7 AS-NZS 3551 EST and PVT DD.MM.YYYY Master.mtt"        (record 27.10.2026)
//   Root        "0000- Root  + Rad 7 AS-NZS 3551 EST and PVT DD.MM.YYYY Template.mtt"  (record 27.10.2026)
//   Rad-G       "-Masimo Rad-G AS-NZS 3551 EST and PVT 04.12.2023.mtt"                 (record 03.11.2026)
//   N1 set      "0000 - Patient Monitor AS-NZS 3551 EST and PVT Template.mtt"          (N1 + TDS + Handle record 09.10.2026)
// Where they differ from the CHS conventions (apps/testbench/docs/bench-notes.md §8), the template `desc` says so:
//   - Masimo applied parts are measured as type BF (the records' ESA612 module is BF), so BF limits apply: patient leakage
//     100/500 uA, mains on applied parts 5000 uA. Some Ansur templates also listed CF limits (10/50) that were never applied.
//   - Earth leakage 5000/10000 uA (AS/NZS 3551:2012+A2 B11.6, flexible-cord Class I) as the other bench templates; the Radical-7
//     and Root Ansur templates had 500/1000.
//   - Patient auxiliary current (in the Rad-97, Radical-7 and Root Ansur templates) has no bench step; it is left out.
//   - Readings keep the Ansur limits (Rad-97/Radical-7/Rad-G finger SpO2 94-101 %, Root 95-100 %).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || path.join(here, '..', 'templates')
const step = (id, type, title, instructions, params = {}) => ({ id, type, title, instructions, images: [], hold: 0, params })
const reading = (label, unit, lo = '', hi = '') => ({ label, unit, lo, hi })

const DUT = ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing company', 'Testing engineer']
const LEAD = 'Connect the device’s mains lead to the ESA612 equipment outlet'

const visual = step('visual', 'check', 'Visual inspection', 'Inspect the monitor, cables and accessories.', {
  items: [
    'The case, display screen, buttons, power cord, and accessories have no obvious signs of damage.',
    'The external connecting cables are not frayed and the connector pins are not loose or bent.',
    'The external connectors are not loose and their pins are not bent.',
    'The safety labels and data plate are clearly legible.',
    'The power-on test is passed. The power indicator and alarm system works correctly and the monitor starts up properly.'] })
const mains = step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply you are testing from.')
const pe = (where = 'an exposed earthed metal part, such as a rear-panel screw') => step('pe', 'esa_pe', 'Protective earth resistance', `${LEAD}. Clip the red test lead to ${where}.`, { hi: 0.2 })
const ins = (id, target, title, lo, note = '') => step(id, 'esa_ins', `Insulation: ${title}`, `${LEAD} and switch the device on. Don’t touch the device during the test.${note ? ' ' + note : ''}`, { target, volts: 'HIGH', lo })
const encl = (where = 'a conductive non-earthed exposed part of the monitor') => step('encl', 'esa_encl', 'Enclosure leakage', `Connect the red test lead to ${where}.\nNote: only a representative sample of conductive non-earthed exposed parts needs to be tested.`, { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }, { c: 'OE', hi: 500 }] })
const earthl = step('earthl', 'esa_earthl', 'Earth leakage', `${LEAD}. The device will be switched on and off between conditions. Limits: 5000 µA normal, 10000 µA neutral open (AS/NZS 3551:2012+A2 B11.6).`, { conds: [{ c: 'NC', hi: 5000 }, { c: 'ON', hi: 10000 }] })
const pat = (what) => step('pat', 'esa_pat', 'Patient leakage', `Connect ${what} to the ESA612 RA post. ${LEAD}.`, { mode: 'together', conds: [{ c: 'NC' }, { c: 'ON' }, { c: 'OE' }] })
const map = (what) => step('map', 'esa_map', 'Mains on applied parts', `Connect ${what} to the ESA612 RA post. ${LEAD}.`, { mode: 'together', pols: ['NORM'] })

const SPO2_SENSOR = 'the SpO2 sensor (wrapped in foil, or its cable connector pins linked)'
const spo2Finger = (lo, hi) => step('spo2', 'check', 'SpO2', 'Measure SpO2 on a healthy person’s finger. Check a Pleth wave and PR value are displayed, then enter the displayed SpO2.', {
  items: ['A Pleth wave and PR value are displayed.', 'The SpO2 alarms work correctly.'],
  readings: [reading('Displayed SpO2 on a healthy finger (95–100 %)', '%', lo, hi)] })

const masimo = (name, desc, apName, steps) => ({
  name, desc, category: 'Promed', manufacturer: 'Masimo', dut: DUT, esaAuto: true, esaHalt: true,
  appliedParts: [{ id: 'ap1', name: apName, apclass: 'BF', leads: ['RA'] }], steps,
})
const COMMON = 'Applied parts type BF on RA, as the Ansur records measured them (patient leakage 100/500 µA, mains on applied parts 5000 µA); the Ansur template also listed CF limits that were not applied. Patient auxiliary current has no bench step and is left out.'

const templates = [
  masimo('Masimo Rad-97 Pulse CO-Oximeter',
    `Masimo Rad-97 (Class I, SpO2; NIBP where fitted). From the CHS Ansur template “Rad-97 AS-NZS 3551 EST and PVT”. Electrical safety to AS/NZS 3551:2012+A2: PE 0.2 ohm, insulation mains–PE over 1 Mohm, enclosure 100/500/500 µA, earth leakage 5000/10000 µA (B11.6; the Ansur template listed both 500/1000 and 5000/10000). ${COMMON} Readings keep the Ansur limits.`,
    'SpO2',
    [visual, mains, pe(), ins('ins-mins', 'MINS', 'mains to protective earth', 1), encl(), earthl, pat(SPO2_SENSOR), map(SPO2_SENSOR),
      spo2Finger(94, 101),
      step('touch', 'check', 'Touchscreen', 'Check each touch gesture on the display.', { items: [
        'Touch and release: the action is performed once the finger is released.',
        'Touch and hold: the action is performed once the hold duration is reached, and a notification is displayed.',
        'Touch, move (left, right, up or down) and release: moves an object across the display.',
        'Touch and quickly swipe (left, right, up or down), and release.',
        'Two touch points: moving them apart zooms in, moving them together zooms out.',
        'Touch, hold, drag an object to the desired position and drop it by releasing.'] }),
      step('nibp', 'check', 'NIBP', 'Skip this step if the Rad-97 has no NIBP.\n1. Calibration check: compare the NIBP module pressure with the manometer. If it is outside ±3 mmHg, calibrate (zero point and span point) and check again; if it still fails the module is faulty.\n2. Air leak test: if the leak is over 6 mmHg, check the calibration equipment (tubing, 500 mL container, cuff) for leaks first; if it still fails, contact Masimo Technical Services.\n3. Overpressure test: watch the manometer as the valves open.', {
        items: ['Overpressure: when the overpressure point is reached the valves open (a faint click) and the pressure drops rapidly to 0 mmHg.'],
        readings: [reading('Difference between NIBP module and manometer (max 3)', 'mmHg', '', 3), reading('Air leak (max 6)', 'mmHg', '', 6)] }),
      step('battery', 'check', 'Battery', '', { items: [
        'The monitor operates correctly from battery power when external AC power is removed.',
        'The battery charging or charged symbol is displayed.',
        'The battery state of health is acceptable.'] })]),

  masimo('Masimo Radical-7 Pulse CO-Oximeter',
    `Masimo Radical-7 (Class I, SpO2). From the CHS Ansur template “Radical 7 AS-NZS 3551 EST and PVT”. Electrical safety to AS/NZS 3551:2012+A2: PE 0.2 ohm, insulation mains–PE over 1 Mohm, enclosure 100/500/500 µA, earth leakage 5000/10000 µA (B11.6; the Ansur template had 500/1000). ${COMMON} SpO2 reading keeps the Ansur limits.`,
    'SpO2',
    [visual, mains, pe(), ins('ins-mins', 'MINS', 'mains to protective earth', 1), encl(), earthl, pat(SPO2_SENSOR), map(SPO2_SENSOR),
      spo2Finger(94, 101),
      step('battery', 'check', 'Battery', '', { items: [
        'The monitor operates correctly from battery power when external AC power fails.',
        'The operating time of the battery meets the product specification.'] })]),

  masimo('Masimo Root Patient Monitoring Platform',
    `Masimo Root with Radical-7 docked, and its SedLine / O3 modules where fitted (Class I). From the CHS Ansur template “Root + Rad 7 AS-NZS 3551 EST and PVT”. Electrical safety to AS/NZS 3551:2012+A2: PE 0.2 ohm, insulation mains–PE and mains–non-earthed parts over 1 Mohm, mains to applied parts over 1 Mohm (B9.3; no limit in Ansur), the other two recorded; enclosure 100/500/500 µA, earth leakage 5000/10000 µA (B11.6; the Ansur template had 500/1000). ${COMMON} Readings keep the Ansur limits.`,
    'SpO2, SedLine, O3',
    [visual, mains, pe(),
      ins('ins-mins', 'MINS', 'mains to protective earth', 1),
      ins('ins-apins', 'APINS', 'applied parts to protective earth', '', 'Recorded only.'),
      ins('ins-mains-ap', 'MAINS_AP', 'mains to applied parts', 1, 'Must be over 1 Mohm (AS/NZS 3551 B9.3).'),
      ins('ins-mains-ne', 'MAINS_NE', 'mains to non-earth accessible conductive part', 1),
      ins('ins-ap-ne', 'AP_NE', 'applied parts to non-earth accessible conductive part', '', 'Recorded only.'),
      encl(), earthl, pat('the SedLine or SpO2 patient cable (connector pins linked)'), map('the SedLine or SpO2 patient cable (connector pins linked)'),
      spo2Finger(95, 100),
      step('temp', 'check', 'Temperature', 'Only if a temperature module is fitted; otherwise mark the item N/A.', { items: ['The temperature is within ±0.05 °C (±0.1 °F) of the reference, or the customer’s specification.'] }),
      step('nibp', 'check', 'NIBP', 'Only if NIBP is fitted; otherwise skip this step.\n1. Set 0, 50 and 200 mmHg and enter the largest difference from the reference.\n2. Run the leak test (or a manual leak test).\n3. Run the overpressure test and time how long the pressure takes to be released.', {
        items: [],
        readings: [reading('Largest difference at 0, 50 and 200 mmHg (max 3)', 'mmHg', 0, 3), reading('Leak (max 6)', 'mmHg/min', 0, 6), reading('Overpressure release time (max 15)', 's', '', 15)] }),
      step('sedline-o3', 'check', 'SedLine and O3', 'Connect the SedLine and O3 simulators. Mark N/A for a module that isn’t fitted.', { items: ['SedLine: works correctly with the simulator.', 'O3: works correctly with the simulator.'] }),
      step('battery', 'check', 'Battery', 'Open the Battery Diagnostics screen.', { items: [], readings: [reading('Full charge capacity (min 4000)', 'mAh', 4000, '')] })]),

  masimo('Masimo Rad-G Pulse Oximeter',
    `Masimo Rad-G handheld pulse oximeter, tested on its charger as Class II (the Ansur template is “AS/NZS 3551 - CL2”): no protective earth or earth leakage. From the CHS Ansur template “Masimo Rad-G AS-NZS 3551 EST and PVT”. Electrical safety to AS/NZS 3551:2012+A2: insulation mains–accessible parts over 1 Mohm, enclosure 100/500/500 µA. ${COMMON.replace(' Patient auxiliary current has no bench step and is left out.', '')} SpO2 readings keep the Ansur limits.`,
    'SpO2',
    [visual, mains,
      ins('ins-mains-ne', 'MAINS_NE', 'mains to accessible parts', 1, 'Plug the Rad-G charger into the ESA612 equipment outlet with the Rad-G connected. Clip the red test lead to foil wrapped around the Rad-G.'),
      pat(SPO2_SENSOR), map(SPO2_SENSOR),
      encl('foil wrapped around the Rad-G (it stays on its charger, plugged into the ESA612 equipment outlet)'),
      step('spo2', 'check', 'SpO2', '1. Measure SpO2 on a healthy person’s finger: a Pleth wave and PR value are displayed. Enter the SpO2.\n2. Measure on the SpO2 simulator set to 95 %: a Pleth wave and PR value are displayed. Enter the SpO2.', {
        items: ['A Pleth wave and PR value are displayed.', 'The SpO2 alarms work correctly.'],
        readings: [reading('Displayed SpO2 on a healthy finger (95–100 %)', '%', 94, 101), reading('Displayed SpO2 with the simulator at 95 % (94–96 %)', '%', 94, 96)] }),
      step('temp', 'check', 'Temperature', 'Only if the Rad-G has temperature; otherwise mark the item N/A.', { items: ['The monitor displays a temperature value.'] }),
      step('functional', 'check', 'Battery, touchscreen and speaker', '', { items: [
        'The monitor operates correctly from battery power when external AC power fails.',
        'The operating time of the battery meets the product specification.',
        'The touchscreen works properly.',
        'The speaker works.'] })]),
]

// ---- Mindray N1 with its N1 TDS (transport docking station) and N1 Handle: one test, one report ----
const n1Steps = (() => {
  const src = JSON.parse(fs.readFileSync(path.join(here, '..', 'templates', 'Patient Monitor and OR Modules - Test Bench template.json'), 'utf8')).template.steps
  const from = (title) => { const s = src.find((x) => x.title === title); if (!s) throw new Error(`Patient Monitor template has no step "${title}"`); return s }
  const ps = (id, title) => ({ ...structuredClone(from(title)), id })
  const AP = 'the N1’s ECG leads, SpO2 sensor and temperature probe (all on the RA post)'
  return [
    { ...visual, instructions: 'Inspect the N1, the N1 TDS, the N1 Handle, cables and accessories.' },
    step('mains', 'esa_mains', 'Mains voltage', 'Set up for the electrical safety tests:\n1. Plug the ESA612 into the mains supply.\n2. Dock the N1 in the N1 TDS and plug the TDS’s mains lead into the ESA612 equipment outlet.\n3. Fit the N1 Handle as it is used.'),
    pe('an exposed earthed metal part of the N1 TDS'),
    ins('ins-mins', 'MINS', 'mains to protective earth', 1),
    ins('ins-apins', 'APINS', 'applied parts to protective earth', '', 'Recorded only.'),
    ins('ins-mains-ap', 'MAINS_AP', 'mains to applied parts', 1, 'Must be over 1 Mohm (AS/NZS 3551 B9.3).'),
    ins('ins-mains-ne', 'MAINS_NE', 'mains to non-earth accessible conductive part', 1),
    ins('ins-ap-ne', 'AP_NE', 'applied parts to non-earth accessible conductive part', '', 'Recorded only.'),
    encl('a conductive non-earthed exposed part of the N1, the TDS or the Handle'),
    earthl,
    pat(AP), map(AP),
    ps('ecg', 'ECG: heart rate, waveform and lead off'),
    ps('ecg-cal', 'ECG: calibration square wave'),
    ps('ecg-paced', 'ECG: paced signals'),
    ps('resp', 'Respiration'),
    ps('temp', 'Temperature'),
    ps('ibp-static', 'IBP: static pressure, both channels'),
    ps('ibp-waves', 'IBP: ART and LV waveforms'),
    step('spo2-nibp', 'check', 'SpO2 and NIBP', 'SpO2: measure SpO2 on a healthy person’s finger. Check a Pleth wave and PR value are displayed, then enter the displayed SpO2.\nNIBP: check accuracy against the simulator, the leak test and the overpressure test (Adult/Peds and Neo).', {
      items: [
        'A Pleth wave and PR value are displayed.',
        'NIBP: the accuracy difference between the monitor and the simulator is within ±3 mmHg.',
        'NIBP: there is no leakage, or the manual leakage test result does not exceed 6 mmHg/min.',
        'NIBP overpressure: test passes for Adult and Peds.',
        'NIBP overpressure: test passes for Neo.'],
      readings: [reading('Displayed SpO2', '%', 95, 100)] }),
    step('co2', 'check', 'Sidestream CO2', 'Only if sidestream CO2 is fitted; otherwise skip this step.\n1. Block the gas inlet of the module or watertrap and check for the CO2 Filterline Err alarm.\n2. Apply the calibration gas and enter the displayed CO2.', {
      items: ['Leak test: with the gas inlet blocked, the sidestream CO2 flowrate is slower than 10 ml/min and a CO2 Filterline Err alarm is given (no leakage).'],
      readings: [reading('Displayed CO2 (6.0 ±0.3 %)', '%', 5.7, 6.3)] }),
    step('tds-handle', 'check', 'N1 TDS and N1 Handle', 'Undock and redock the N1 with mains connected to the TDS.', { items: [
      'The N1 locks into the N1 TDS, and is powered and charged from it when docked (AC power and battery charging indicators).',
      'The N1 Handle is secure on the N1 and its latches and release work.'] }),
    step('network-battery', 'check', 'Network, battery and production test', 'Run the production test under factory maintenance.', { items: [
      'Network: the monitor can print over the network.',
      'Network: the network printer correctly prints ECG reports.',
      'Battery: the monitor operates correctly from battery power when external AC power fails (undocked from the TDS).',
      'Battery: the operating time of the battery meets the product specification.',
      'Production test: all tests pass.'] }),
  ]
})()

templates.push({
  name: 'Mindray N1 with N1 TDS and N1 Handle',
  desc: 'Mindray BeneVision N1 transport monitor tested as one set with its N1 TDS (transport docking station, which takes the mains lead) and N1 Handle: one test and one report for all three serial numbers (add the TDS and Handle under “Other devices in this test”). Class I, applied parts type CF (SpO2, ECG, Temp) on RA. From the CHS Ansur template “Patient Monitor AS-NZS 3551 EST and PVT” as used for the N1 set on 09.10.2026. Electrical limits from AS/NZS 3551:2012+A2 (earth leakage 5000/10000 µA, B11.6). ECG, respiration, temperature and IBP are ProSim 8 steps, as in the Patient Monitor template. The TDS and Handle checks are new: the Ansur template had none.',
  category: 'Monitoring', highlight: true, dut: DUT, esaAuto: true, esaHalt: true,
  appliedParts: [{ id: 'ap1', name: 'SpO2, ECG, Temp', apclass: 'CF', leads: ['RA'] }],
  steps: n1Steps,
})

fs.mkdirSync(outDir, { recursive: true })
for (const template of templates) {
  const ids = template.steps.map((s) => s.id)
  if (new Set(ids).size !== ids.length) throw new Error(`${template.name}: duplicate step ids`)
  const file = `${template.name} - Test Bench template.json`
  fs.writeFileSync(path.join(outDir, file), JSON.stringify({ format: 'chs-test-bench-template', version: 1, template }, null, 1) + '\n', 'utf8')
  console.log(file, template.steps.length, 'steps')
}
