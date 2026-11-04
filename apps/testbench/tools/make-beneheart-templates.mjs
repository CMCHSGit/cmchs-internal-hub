// Builds the two BeneHeart defibrillator templates for the Test Bench: the D1 (Pro and Public) and the C / S series AED.
// Run: node apps/testbench/tools/make-beneheart-templates.mjs [outDir]   (default apps/testbench/templates)
// The files go into the SharePoint Templates folder (Service\Test Software\CHS Test Bench\Templates); the bench picks them up there.
// Step ids are fixed on purpose: autosave and Reload template match steps by id.
//
// Sources (the service manuals, read 4/11/2026; limits copied as the manuals give them):
//   BeneHeart C & S series service manual 046-014001-00 V1.0, chapter 4 (PDF pp. 29-33) and report sheet p. 54.
//   BeneHeart D1 service manual 046-004675-00 V3.0, chapter 5 (pp. 25-29) and Appendix A (pp. 55-61).
// Both units are internally powered (no mains lead, no earth): electrical safety is the normal condition only, so the ESA612 tests are
// enclosure leakage, patient leakage and mains on applied part (no mains voltage, earth, insulation or earth leakage steps).
// NOT in either manual, and assumed here the way the D30 / D60 template has them: the applied part types (pads BF, ECG cable CF).
// Check the BeneHeart D1 Operator's Manual (046-004673-00) or the device label and change the groups if they differ.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || path.join(here, '..', 'templates')

const step = (id, type, title, instructions, params = {}, models) => ({ id, type, title, instructions, images: [], hold: 0, params, ...(models ? { models } : {}) })
const DUT = ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing engineer']
const rd = (label, unit, lo, hi) => ({ label, unit, lo, hi })
const none = { enabled: false, label: '', unit: '', lo: '', hi: '' }

const esaBlock = (ap, extra) => [
  step('encl', 'esa_encl', 'Enclosure leakage', `Internally powered: normal condition only. Wrap metal foil tightly around the enclosure and clip the ESA612 test lead to it (foil about 20 cm x 10 cm). Limit: 100 µA.${extra || ''}`, { conds: [{ c: 'NC', hi: 100 }] }),
  step('pat', 'esa_pat', 'Patient leakage', `Each applied-part group is measured on its own: ${ap}. Internally powered: normal condition only. Limits: B/BF 100 µA, CF 10 µA (AC).`, { mode: 'together', conds: [{ c: 'NC' }] }),
  step('map', 'esa_map', 'Mains on applied parts', 'High voltage (110% mains) is applied to the applied part: keep clear. Foil on the enclosure, red lead to it. Limits: BF 5000 µA, CF 50 µA, normal and reversed polarity.', { mode: 'together', pols: ['NORM', 'REV'] }),
]

// ---------- BeneHeart D1 ----------
const d1 = {
  name: 'Mindray BeneHeart D1 Defibrillator – AS/NZS 3551 EST and PVT',
  desc: 'BeneHeart D1, Pro (manual defibrillation, synchronised cardioversion, AED, 3-lead ECG) and Public (AED only): one template, Pro-only steps are left out for a Public. Internally powered, so electrical safety is enclosure leakage, patient leakage and mains on applied part. From the D1 service manual V3.0. Applied part types (ECG CF, pads BF) are assumed like the D30: check the Operator’s Manual. Needs the ESA612, a defibrillator analyser and (Pro) the ProSim 8.',
  category: 'Defibrillation', models: ['Pro', 'Public'], dut: DUT, esaAuto: true, esaHalt: true, showNA: false,
  appliedParts: [{ id: 'ap1', name: 'ECG', apclass: 'CF', leads: ['RA'] }, { id: 'ap2', name: 'Pads', apclass: 'BF', leads: ['LA'] }],
  steps: [
    step('visual', 'check', 'Visual inspection', 'Service Manual 5.2. Inspect the housing, display, buttons, pads, cables and accessories.', { items: [
      'The housing, display, buttons and accessories have no obvious signs of damage.',
      'The pad connector and the other external connectors are not loose and their pins are not bent; cables are not frayed.',
      'The safety labels and the data plate are clearly legible.'] }),
    step('power-user', 'check', 'Power-on test and user test', 'Service Manual 5.2. Insert a full or new battery.\n1. Power-on: the green power indicator and the screen light. If the battery-insert test screen appears, switch off and on again. Check the alarm message area and the battery icon.\n2. User test: connect the pads, switch on, Maintenance > User Test. Follow the prompts through the controls test, audio test and auto test.', { items: [
      'Power-on: starts normally with the green power indicator and screen lit; no alarm message.',
      'User test result is PASS (a failure code is shown if it fails: see the manual’s fault codes).'] }),
    ...esaBlock('ECG (CF) on RA, pads (BF) on LA', ' A Public has no ECG socket: leave the ECG group unconnected and mark its readings N/A.'),
    step('manual-charge', 'check', 'Manual defibrillation: charge and discharge', 'Service Manual 5.5.2 (Pro only). Test tool: defibrillator analyser. Pads on the analyser in energy measurement mode (reads 0 or blank). Manual mode: select 1 J, charge, discharge and enter the analyser reading. Repeat at 100 J and 360 J. The manual’s limits are about ±15% (1 J: 0–3 J).', { items: ['Shock events are recorded automatically and correctly.'], readings: [rd('Delivered energy at 1 J', 'J', 0, 3), rd('Delivered energy at 100 J', 'J', 85, 115), rd('Delivered energy at 360 J', 'J', 306, 414)] }, ['Pro']),
    step('disarm', 'check', 'Energy disarming', 'Service Manual 5.5.3 (Pro only). Pads on the analyser in energy measurement mode. Manual mode, select 360 J and charge: the charge tone sounds. Press Disarm. Charge again and leave it for 60 s.', { items: [
      'The charge tone sounds while charging.',
      '“Charge Removed” appears and the charge tone stops when disarmed; the analyser reads 0 J or blank.',
      'After 60 s unattended, “Shock Removed” appears and the analyser reads 0 J or blank.'] }, ['Pro']),
    step('sync', 'check', 'Synchronised cardioversion', 'Service Manual 5.5.4 (Pro only). Pads and ECG leads on the analyser; sinus rhythm 1 mV, 60 bpm. Manual mode: Enter Sync, Yes, select 10 J. With the source set to the ECG lead, charge and deliver (hold Shock). Repeat with the source set to the pads.', { items: [
      'Synchronous discharge succeeds with the ECG lead as the source, and with the pads as the source.',
      'The sync marker appears on the R wave and the prompts are correct.'], readings: [rd('Delivered energy at 10 J (sync)', 'J', 8, 12), rd('Synchronisation delay', 'ms', 0, 60)] }, ['Pro']),
    step('aed', 'check', 'AED', 'Service Manual 5.5.1. Pads on the analyser set to output a shockable rhythm. Enter AED mode: it should analyse, charge and discharge. In Config. Edit > AED Setup set Shock Series to 200 J, 300 J and 360 J in turn, restart, re-enter AED mode, charge and discharge and enter the analyser readings. The manual’s AED step prints its 1 / 100 / 360 J table by mistake; the limits here are its ±15% applied to 200, 300 and 360 J. Both Pro and Public.', { items: [
      'AED performs rhythm analysis, charging and discharging.',
      'Shock events are recorded automatically and correctly.'], readings: [rd('AED delivered energy at 200 J', 'J', 170, 230), rd('AED delivered energy at 300 J', 'J', 255, 345), rd('AED delivered energy at 360 J', 'J', 306, 414)] }),
    step('ecg-nsr', 'ps_nsr', 'ECG: heart rate and lead off', 'Service Manual 5.5.5 (Pro only). ECG cable on the ProSim 8: sinus rhythm, 80 bpm, 1 mV. Check the ECG lead too, then the pads (set [Lead] to the pads). Detach the simulator to test lead off.', { who: 'A', rate: 80, ampl: '1.00', monitor: { enabled: true, label: 'Heart rate on monitor (80 ±1 bpm)', unit: 'bpm', lo: 79, hi: 81 }, extra: [
      { label: 'ECG waves are displayed correctly without noise (ECG lead and pads).', unit: '', lo: '', hi: '' },
      { label: 'ECG Lead Off alarm behaves correctly.', unit: '', lo: '', hi: '' }] }, ['Pro']),
    step('ecg-paced', 'ps_paced', 'ECG: pacemaker pulses', 'Service Manual 5.5.5 (Pro only). In Config. Edit > ECG Setup enable Pacemaker Detection, then send pace signals from the ProSim 8 on the ECG lead and then on the pads.', { wave: 'ASY', ampl: '', monitor: { enabled: true, label: 'Pace pulses are detected and pace marks are displayed (ECG lead and pads).', unit: '', lo: '', hi: '' } }, ['Pro']),
  ],
}

// ---------- BeneHeart C and S series ----------
const c = {
  name: 'Mindray BeneHeart C / S Series AED – AS/NZS 3551 EST and PVT',
  desc: 'BeneHeart C and S series automated external defibrillator (AED only: no manual mode, pacing or monitoring). Internally powered by a disposable battery, so electrical safety is enclosure leakage, patient leakage and mains on applied part. From the C & S series service manual V1.0. The pads are BF per the manual’s report sheet. Needs the ESA612 and a defibrillator analyser.',
  category: 'Defibrillation', dut: DUT, esaAuto: true, esaHalt: true, showNA: false,
  appliedParts: [{ id: 'ap1', name: 'Pads', apclass: 'BF', leads: ['LA'] }],
  steps: [
    step('visual', 'check', 'Visual inspection', 'Service Manual 4.2. Inspect the case, display (if fitted), buttons, pads and accessories.', { items: [
      'The case, display (if fitted), buttons and accessories have no obvious signs of damage.',
      'The pad connector and the other external connectors are not loose and their pins are not bent; cables are not frayed.',
      'The safety labels and the data plate are clearly legible.'] }),
    step('battery-test', 'check', 'Battery loading test', 'Service Manual 4.2. Connect new pads and close the lid. Remove the battery for 3 minutes, reinsert it: the unit runs its battery-load self-test. Follow the voice prompts through the auto, audio and button tests. After a failed test remove the battery and wait over 3 minutes before retesting. Wireless units: after the pass close the lid, the unit runs a wireless test (green light) and switches off after about a minute.', { items: [
      'The voice says “Test completed, Device OK”.',
      'Wireless units: the Alert platform received the self-test report (mark N/A if not wireless).'] }),
    step('user-power', 'check', 'User test and power-on test', 'Service Manual 4.2 and 4.3. Pads connected, battery in, open the lid.\n1. User test: hold the language button 5 s then toggle the patient switch twice (or hold the Shock button 5 s then toggle the patient switch twice; or use the device management tool). Follow the prompts through the auto, audio and button tests.\n2. Power-on test: insert the battery and open the lid.', { items: [
      'User test passes: “Test completed, Device OK”.',
      'Power-on: the status indicator is green and there is no fault voice prompt.'] }),
    ...esaBlock('pads (BF) on LA', ' The unit has no mains lead: only the normal condition is tested.'),
    step('aed', 'check', 'AED', 'Service Manual 4.4 (the AED test). Pads on the analyser set to VF. Open the lid and check the unit analyses the rhythm, charges and discharges. With the PC configuration tool write sequential shock energies 200 J, 300 J and 360 J, disconnect the PC, restart the unit, re-enter AED analysis, charge and discharge at each energy and enter the analyser readings. Then export the event file and check each discharge was recorded.', { items: [
      'The unit analyses the rhythm, charges and discharges.',
      'Each discharge is recorded in the event file and the content is normal.'], readings: [rd('AED delivered energy at 200 J', 'J', 180, 220), rd('AED delivered energy at 300 J', 'J', 270, 330), rd('AED delivered energy at 360 J', 'J', 324, 396)] }),
  ],
}

for (const [file, t] of [['Mindray BeneHeart D1 Defibrillator - Test Bench template.json', d1], ['Mindray BeneHeart C-S Series AED - Test Bench template.json', c]]) {
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(outDir, file), JSON.stringify({ format: 'chs-test-bench-template', version: 1, template: t }, null, 2) + '\n', 'utf8')
  console.log('wrote', file, `(${t.steps.length} steps)`)
}
