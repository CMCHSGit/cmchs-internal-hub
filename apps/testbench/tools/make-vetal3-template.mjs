// Builds the Test Bench template for the Mindray Vetal 3 veterinary patient monitor, in its own group "Vet patient monitors".
// Run: node apps/testbench/tools/make-vetal3-template.mjs [outDir]   (default apps/testbench/templates)
// The file goes into the SharePoint Templates folder (Service\Test Software\CHS Test Bench\Templates); the bench picks it up there.
//
// Source: the completed CHS Ansur record "2797, AW2-58004046A Vetal 3 AS-NZS 3551 EST and PVT 17.12.2025.mtr" (Pohutukawa Coast Vets),
// which carries the Ansur template "0000, SN-Vetal 3 AS-NZS 3551 EST and PVT DD.MM.YYYY Template.mtt". Its performance checks follow the
// Vetal 3 service manual sections 5.4.1-5.4.6. Where it differs from the CHS conventions (docs/bench-notes.md §8) the `desc` says so:
//   - No protective earth test in the Ansur template, though the monitor is Class I (it has earth leakage): PE <= 0.2 ohm added.
//   - Enclosure limits read 500 / 100 / 500 uA (normal / neutral open / earth open), clearly swapped: AS/NZS 3551 100 / 500 / 500 used.
//   - Earth leakage 5000 / 10000 uA (B11.6) as the other bench templates; the Ansur template had 500 / 1000.
//   - Applied parts: Ansur measured patient leakage as type B ("Probe") but mains on applied parts with CF limits ("Mains"). CF on RA is
//     used, as for the Mindray human monitors (the stricter limits; the record's readings pass them) — for Jonathan to confirm on the label.
//   - Mains on applied parts normal and reversed, as in Ansur.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || path.join(here, '..', 'templates')
const step = (id, type, title, instructions, params = {}) => ({ id, type, title, instructions, images: [], hold: 0, params })
const reading = (label, unit, lo = '', hi = '') => ({ label, unit, lo, hi })
const check = (label, unit = '', lo = '', hi = '') => ({ enabled: true, label, unit, lo, hi })
const LEAD = 'Connect the monitor’s mains lead to the ESA612 equipment outlet'
const AP = 'the ECG leads, SpO2 sensor and temperature probe (all on the RA post)'

const template = {
  name: 'Mindray Vetal 3 Veterinary Monitor',
  desc: 'Mindray Vetal 3 veterinary patient monitor (Class I; ECG, Resp, SpO2, NIBP, Temp, CO2 where fitted). From the CHS Ansur template “SN-Vetal 3 AS-NZS 3551 EST and PVT” (record AW2-58004046A, 17.12.2025); performance checks from the Vetal 3 service manual 5.4.1–5.4.6. Electrical safety to AS/NZS 3551:2012+A2. Where it differs from Ansur: protective earth 0.2 ohm added (Ansur had no PE test for this Class I monitor); enclosure 100/500/500 µA (Ansur had 500/100/500, swapped); earth leakage 5000/10000 µA (B11.6; Ansur 500/1000); applied parts type CF on RA as for the Mindray human monitors (Ansur measured patient leakage as type B and mains on applied parts with CF limits) — to confirm against the monitor’s label. ECG, respiration and temperature are ProSim 8 steps; SpO2, NIBP and CO2 readings are typed.',
  category: 'Vet patient monitors',
  manufacturer: 'Mindray',
  models: [],
  dut: ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing company', 'Testing engineer'],
  esaAuto: true, esaHalt: true,
  appliedParts: [{ id: 'ap1', name: 'ECG, SpO2, Temp', apclass: 'CF', leads: ['RA'] }],
  steps: [
    step('visual', 'check', 'Visual inspection', 'Inspect the monitor, cables and accessories.', { items: [
      'The case, display screen, buttons, knob, power cord and accessories have no obvious signs of damage.',
      'The external connecting cables are not frayed and the connector pins are not loose or bent.',
      'The external connectors are not loose and their pins are not bent.',
      'The safety labels and data plate are clearly legible.',
      'The power-on test is passed. The power indicator and alarm system work correctly and the monitor starts up properly.',
      'The unit runs on battery (if a battery is installed).'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply you are testing from.'),
    step('pe', 'esa_pe', 'Protective earth resistance', `${LEAD}. Clip the red test lead to an exposed earthed metal part, such as a rear-panel screw or the equipotential terminal. Not in the Ansur template; AS/NZS 3551 B8.6 (0.2 ohm).`, { hi: 0.2 }),
    step('ins-mins', 'esa_ins', 'Insulation: mains to protective earth', `${LEAD} and switch the monitor on. Don’t touch the monitor during the test.`, { target: 'MINS', volts: 'HIGH', lo: 1 }),
    step('encl', 'esa_encl', 'Enclosure leakage', 'Connect the red test lead to a conductive non-earthed exposed part of the monitor.\nNote: only a representative sample of conductive non-earthed exposed parts needs to be tested.', { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }, { c: 'OE', hi: 500 }] }),
    step('earthl', 'esa_earthl', 'Earth leakage', `${LEAD}. The monitor will be switched on and off between conditions. Limits: 5000 µA normal, 10000 µA neutral open (AS/NZS 3551:2012+A2 B11.6).`, { conds: [{ c: 'NC', hi: 5000 }, { c: 'ON', hi: 10000 }] }),
    step('pat', 'esa_pat', 'Patient leakage', `Connect ${AP}. ${LEAD}.`, { mode: 'together', conds: [{ c: 'NC' }, { c: 'ON' }, { c: 'OE' }] }),
    step('map', 'esa_map', 'Mains on applied parts', `Connect ${AP}. ${LEAD}. Measured with mains normal and reversed, as in the Ansur template.`, { mode: 'together', pols: ['NORM', 'REV'] }),
    step('selftest', 'check', 'Startup self-test', '', { items: ['The unit powers on normally and the power-on test is passed.'] }),
    step('ecg-hr', 'ps_nsr', 'ECG: heart rate (5.4.1)', 'Connect the ECG leads to the ProSim 8. The simulator is set to ECG sinus rhythm, 80 bpm, 1 mV. Enter the HR shown on the monitor.', { who: 'A', rate: 80, ampl: '1.00', monitor: check('Heart rate on monitor (80 ±1)', 'bpm', 79, 81), extra: [{ label: 'ECG waves are displayed correctly without noise.', unit: '', lo: '', hi: '' }] }),
    step('ecg-cal', 'ps_perf', 'ECG: calibration square wave (5.4.1)', 'The simulator outputs a square wave. Set the ECG filter on the monitor to Diagnostic and compare the wave with the scale. Enter its amplitude as a percentage of the scale.', { wave: 'SQUARE=2.0', monitor: check('Square wave amplitude (95–105 % of the scale)', '%', 95, 105) }),
    step('resp', 'ps_resp', 'Respiration (5.4.2)', 'The simulator outputs respiration at 40 rpm (on the ECG leads). Enter the Resp rate shown on the monitor.', { rate: 40, monitor: check('Resp rate on monitor (40 ±2)', 'rpm', 38, 42), extra: [{ label: 'The Resp wave is not distorted.', unit: '', lo: '', hi: '' }] }),
    step('spo2', 'check', 'SpO2 (5.4.3)', 'Measure SpO2 and enter the reading.', { items: ['A Pleth wave and PR value are displayed.'], readings: [reading('SpO2 reading (95–100 %)', '%', 95, 100)] }),
    step('nibp', 'check', 'NIBP accuracy (5.4.4)', 'Check the NIBP pressure reading against the reference manometer at 50 and 200 mmHg (NIBP accuracy test in the maintenance menu). Enter what the monitor shows.', { items: [], readings: [reading('Reading at 50 mmHg (47–53)', 'mmHg', 47, 53), reading('Reading at 200 mmHg (197–203)', 'mmHg', 197, 203)] }),
    step('temp', 'ps_temp', 'Temperature (5.4.5)', 'The simulator outputs 37.0 °C. Connect the temperature cable to the ProSim 8 and enter each channel’s reading. Mark channel 2 N/A if the monitor has one temperature channel.', { t: '37.0', monitor: check('Temperature channel 1 (36.9–37.1)', '°C', 36.9, 37.1), extra: [{ label: 'Temperature channel 2 (36.9–37.1)', unit: '°C', lo: 36.9, hi: 37.1 }] }),
    step('co2', 'check', 'CO2 (5.4.6)', 'Only if CO2 is fitted; otherwise skip this step.\n1. Leak test: block the gas inlet and read the flow rate.\n2. Apply the calibration gas and enter the displayed CO2.', { items: [], readings: [reading('Leak test flow rate (max 10)', 'ml/min', '', 10), reading('Displayed CO2 (6.0 ±0.3 %)', '%', 5.7, 6.3)] }),
  ],
}

fs.mkdirSync(outDir, { recursive: true })
const ids = template.steps.map((s) => s.id)
if (new Set(ids).size !== ids.length) throw new Error('duplicate step ids')
const file = 'Mindray Vetal 3 Veterinary Monitor - Test Bench template.json'
fs.writeFileSync(path.join(outDir, file), JSON.stringify({ format: 'chs-test-bench-template', version: 1, template }, null, 1) + '\n', 'utf8')
console.log(file, template.steps.length, 'steps')
