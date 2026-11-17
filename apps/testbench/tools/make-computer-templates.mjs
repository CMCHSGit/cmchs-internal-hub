// Builds the computer / IT equipment templates for the Test Bench (Class I and Class II, and the Cybernet CyberMed G22 PC with its Class II supply).
// Run: node apps/testbench/tools/make-computer-templates.mjs [outDir]   (default apps/testbench/templates)
// The files go into the SharePoint Templates folder (Service\Test Software\CHS Test Bench\Templates); the bench picks them up there.
// Step ids are fixed on purpose: autosave and Reload template match steps by id.
//
// Limits are from AS/NZS 3551:2012+A2 (Jonathan's copy in Knowledge Base\Legislative Resources), Appendix B:
//   B8.6  protective earthing: fixed (non-detachable) lead, mains plug earth pin to earthed metal 200 mOhm;
//         appliance inlet earth pin to earthed metal 100 mOhm; the detachable lead on its own 200 mOhm.
//   B9.3  insulation (500 V d.c.): greater than 1 MOhm; if under 10 MOhm it must not be under 80% of the acceptance value.
//         Applies to Class I and Class II. B9.2: mains to PE, to exposed conductive parts, to applied parts.
//   B10   touch current: Class I only (B10.1). 100 uA normal, 500 uA neutral open, 500 uA earth open (B10.5).
//   B11.6 earth leakage (flexible-cord Class I): 5000 uA normal, 10000 uA neutral open.
//   Clause 6.1: non-medical equipment in the patient environment must also meet B10 touch current, or be on a separation transformer.
// NOTE: the other CHS templates use 500/1000 uA for earth leakage (the pre-A2 values); the standard now says 5000/10000.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || path.join(here, '..', 'templates')

const step = (id, type, title, instructions, params = {}) => ({ id, type, title, instructions, images: [], hold: false, params })

const DUT = ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing engineer']

const functional = () => step('functional', 'check', 'Power on and function', 'Do this after the electrical safety tests.', {
  items: [
    'Powers on and reaches the operating system without error messages.',
    'Fans run and vents are clear of dust and blockage.',
    'Screen, keyboard and pointing device work; connected peripherals work.',
    'Equipment clean and fit for the clinical area; test label applied.'],
})

const classI = {
  name: 'Computer / IT equipment – Class I',
  desc: 'Class I (earthed) computer, laptop power supply, monitor or other IT equipment. Limits from AS/NZS 3551:2012+A2 Appendix B: earth resistance 0.2 ohm (fixed lead or detachable lead alone) or 0.1 ohm (appliance inlet to earthed metal); insulation over 1 Mohm at 500 V; touch current 100 uA normal, 500 uA neutral open or earth open; earth leakage 5000 uA normal, 10000 uA neutral open. Non-medical equipment in the patient environment must meet the touch current limits (clause 6.1).',
  category: 'Computers',
  steps: [
    step('visual', 'check', 'Visual inspection', 'Unplug the equipment before inspecting. Do not open the case.', {
      items: [
        'Mains lead: plug, cable and connector undamaged; plug pins straight and secure; strain relief intact.',
        'Case undamaged: no cracks, missing screws, heat marks or signs of liquid.',
        'Ports, sockets and switches undamaged; no loose connectors.',
        'Labels legible: model, ratings and the Class I (earthed) marking.'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply. Nothing needs to be connected to the equipment outlet for this step.'),
    step('lead-pe', 'esa_pe', 'Detachable mains lead: earth continuity', 'Only for equipment with a detachable lead (appliance inlet). Mark this step skipped for a fixed lead.\nTest the lead on its own, disconnected from the equipment.\n1. Plug the lead into the ESA612 equipment outlet.\n2. Clip the red test lead to the earth contact inside the connector (C13/C5).\nLimit 0.2 ohm (AS/NZS 3551 B8.4).', { hi: 0.2 }),
    step('bond-fixed', 'esa_pe', 'Earth bond: fixed lead', 'Only for equipment with a fixed (non-detachable) lead. Mark this step skipped for a detachable lead.\nPlug the equipment into the ESA612 equipment outlet, switched off. Clip the red test lead to an unpainted, earthed metal part of the case (a screw or a metal port shell). Test more than one point if there are separate earthed metal parts.\nMeasured from the earth pin of the mains plug: limit 0.2 ohm (B8.2, B8.6).', { hi: 0.2 }),
    step('bond-inlet', 'esa_pe', 'Earth bond: appliance inlet', 'Only for equipment with a detachable lead. Mark this step skipped for a fixed lead.\nThe limit is 0.1 ohm from the earth pin in the appliance inlet to the earthed metal parts (B8.3, B8.6), not including the lead. A reading through the lead that is 0.1 ohm or less passes. If it reads higher, measure again from the earth pin in the inlet itself (test leads) and record that; the lead step above covers the lead.\nPlug the equipment into the ESA612 equipment outlet with its lead, switched off. Clip the red test lead to an unpainted, earthed metal part of the case.', { hi: 0.1 }),
    step('ins-mains-pe', 'esa_ins', 'Insulation: mains to protective earth', 'Mains pins (live and neutral linked by the ESA612) to the earth pin, at 500 V. Switch the equipment on if it has a switch, and disconnect all peripherals and network cables.\nMust be over 1 Mohm. If it is under 10 Mohm, it must be at least 80% of the acceptance test value (B9.3). A surge protector (MOV) can cause a low reading: if so, document it and repeat at 250 V.', { target: 'MINS', volts: 'HIGH', lo: 1 }),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to accessible non-earthed parts', 'Only for equipment with accessible parts that are not connected to earth (isolated ports, a plastic case with metal screws, isolated metal). Mark this step skipped if every accessible part is earthed.\nClip the red test lead to the part, or link several parts together with a shorting clip or foil. Must be over 1 Mohm (B9.3). For a detachable power supply (plug pack), test from mains to its low-voltage output terminals.', { target: 'MAINS_NE', volts: 'HIGH', lo: 1 }),
    step('touch', 'esa_encl', 'Touch current', 'Equipment on, peripherals disconnected. Red test lead on a representative accessible conductive part, or on foil wrapped around a plastic case. Limits: 100 uA normal, 500 uA neutral open, 500 uA earth open (B10.5). Non-medical equipment in the patient environment must meet these (clause 6.1), otherwise it goes on a separation transformer.', { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }, { c: 'OE', hi: 500 }] }),
    step('earth-leak', 'esa_earthl', 'Earth leakage', 'Flexible-cord Class I equipment (B11). Use a detachable lead of the length normally used. Equipment on, peripherals disconnected. Limits: 5000 uA normal, 10000 uA neutral open (B11.6). Mark this step skipped for permanently wired equipment.', { conds: [{ c: 'NC', hi: 5000 }, { c: 'ON', hi: 10000 }] }),
    functional(),
  ],
}

const classII = {
  name: 'Computer / IT equipment – Class II',
  desc: 'Class II (double insulated, no earth) computer, laptop power supply, monitor or other IT equipment. AS/NZS 3551:2012+A2 Appendix B: insulation over 1 Mohm at 500 V (B9.3). No earth continuity, mains-to-earth insulation or earth leakage test (no protective earth), and no touch current test: B10.1 considers touch current from Class I equipment only.',
  category: 'Computers',
  steps: [
    step('visual', 'check', 'Visual inspection', 'Unplug the equipment before inspecting. Do not open the case.', {
      items: [
        'Mains lead: plug, cable and connector undamaged; strain relief intact; two-core lead or no connection to the earth pin.',
        'Case undamaged: no cracks, missing screws, heat marks or signs of liquid.',
        'Ports, sockets and switches undamaged; no loose connectors.',
        'Labels legible: model, ratings and the Class II (double square) marking.'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply. Nothing needs to be connected to the equipment outlet for this step.'),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to accessible parts', 'Mains pins (live and neutral linked by the ESA612) to the accessible parts, at 500 V. Clip the red test lead to a metal port shell or screw, or to foil wrapped around the case (link several parts together with a shorting clip). Switch the equipment on if it has a switch, and disconnect all peripherals and network cables.\nMust be over 1 Mohm. If it is under 10 Mohm, it must be at least 80% of the acceptance test value (B9.3). For a detachable power supply (plug pack), test from mains to its low-voltage output terminals.', { target: 'MAINS_NE', volts: 'HIGH', lo: 1 }),
    functional(),
  ],
}

// Cybernet CyberMed G22 all-in-one PC (medical grade, fitted behind a Mindray BeneVision monitor) with its EDAC EPU120MG-21856 external
// medical power supply (EM11011M-190: 100-240 V~ 2.0-1.0 A in, 19.0 V 6.31 A 120 W out, 4-pin DIN). The supply has no protective earth: the
// "GND" on its label is the 0 V return pin of the DC plug, not mains earth, so the system is Class II: no earth continuity, mains-to-earth
// insulation or earth leakage, and no touch current (B10.1 covers Class I only, as in the Class II computer template above).
// The class is NOT printed on the label, so the visual inspection makes it a pass/fail check (two-core lead, no earth pin); an earth pin
// means Class I and the Class I templates apply. No DC output voltage step: it is not an AS/NZS 3551 test and the ESA612 can't measure it.
const cybernetG22 = {
  name: 'Cybernet CyberMed G22 PC with EDAC EPU120MG-21856 power supply – Class II',
  desc: 'Cybernet CyberMed G22 all-in-one medical PC and its EDAC EPU120MG-21856 external power supply (19.0 V, 6.31 A, 120 W, 4-pin DIN output). The supply has no protective earth (GND on its label is the 0 V return of the DC plug), so this is tested as Class II: AS/NZS 3551:2012+A2 Appendix B insulation over 1 Mohm at 500 V from mains to the accessible parts and the DC output (B9.3), then function. No earth continuity, mains-to-earth insulation or earth leakage (no protective earth), and no touch current: B10.1 covers Class I equipment only. The label does not state the class, so the visual inspection checks it: a two-core lead with no earth pin. If there is an earth pin, the supply is Class I: use the Class I computer or isolated-output power supply template instead.',
  category: 'Computers',
  dut: [...DUT, 'Power supply serial'],
  steps: [
    step('visual', 'check', 'Visual inspection', 'Unplug the supply from the mains and from the PC before inspecting. Do not open the PC or the supply.', {
      items: [
        'Class II check: the AC lead is two-core, with no earth pin in the plug or in the supply’s inlet, and the supply has no earth marking. If there is an earth pin it is Class I: fail this item, stop, and use the Class I computer or the isolated-output power supply template.',
        'Power supply: case undamaged (no cracks, heat marks or signs of liquid); label legible (EDAC EPU120MG-21856, model EM11011M-190, 19.0 V 6.31 A, I.T.E. and medical power supply markings).',
        'AC lead: plug, cable and connector undamaged; plug pins straight and secure; strain relief intact.',
        'DC lead: cable and ferrite undamaged; the 4-pin DIN plug is clean and its pins are straight, not burnt or loose; the lead is clipped away from the PC vents and the mounting.',
        'PC: case, screen and rear plate undamaged; no cracks, missing screws or signs of liquid; ports and sockets undamaged; cable clips and mounting secure on the monitor.',
        'Labels legible on the PC (Cybernet CyberMed G22) and the supply. Record the PC serial number and the power supply serial number (S/N on its label).'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply. Nothing needs to be connected to the equipment outlet for this step.'),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to the DC output and the PC', 'Plug the supply’s AC lead into the ESA612 equipment outlet, with the DC plug connected to the PC and the PC shut down (not asleep). Mains pins (live and neutral linked by the ESA612) to the accessible parts, at 500 V.\nClip the red test lead to the metal shell of the DC plug and link the PC’s accessible metal parts to it with a shorting clip or foil: a rear plate screw, the port shells and the mounting screws. Disconnect network cables and peripherals.\nMust be over 1 Mohm. If it is under 10 Mohm, it must be at least 80% of the acceptance test value (B9.3). If it fails, repeat with the supply alone, its DC plug disconnected from the PC, the lead on the DC pins and shell, to tell whether the supply or the PC is at fault.', { target: 'MAINS_NE', volts: 'HIGH', lo: 1 }),
    step('functional', 'check', 'Power on and function', 'Do this after the electrical safety tests. Run the PC from the supply being tested.', {
      items: [
        'Powers on from this supply and reaches the operating system without error messages; runs steadily for a few minutes with no restarts, flicker or buzzing from the supply, and the supply is warm at most, not hot.',
        'Display and touch (if fitted) work, with no dead pixels, lines or dim areas; connected peripherals work.',
        'Network and USB ports work; a data connection to the monitor (if used) is working.',
        'Fans run and vents are clear of dust and blockage.',
        'Equipment clean and fit for the clinical area; test label applied to the PC and to the power supply.'],
    }),
  ],
}

fs.mkdirSync(outDir, { recursive: true })
for (const [t, file] of [[classI, 'Computer - IT equipment - Class I - Test Bench template.json'], [classII, 'Computer - IT equipment - Class II - Test Bench template.json'], [cybernetG22, 'Cybernet CyberMed G22 PC with EDAC power supply - Class II - Test Bench template.json']]) {
  const template = { ...t, dut: t.dut || DUT, appliedParts: [], models: [], showNA: false, esaAuto: true, esaHalt: true }
  fs.writeFileSync(path.join(outDir, file), JSON.stringify({ format: 'chs-test-bench-template', version: 1, template }, null, 1) + '\n', 'utf8')
  console.log(file, template.steps.length, 'steps')
}
