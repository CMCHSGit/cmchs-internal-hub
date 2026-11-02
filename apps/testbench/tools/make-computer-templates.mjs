// Builds the two computer / IT equipment templates for the Test Bench (Class I and Class II).
// Run: node apps/testbench/tools/make-computer-templates.mjs [outDir]   (default apps/testbench/templates)
// The files go into the SharePoint Templates folder (Service\Test Software\CHS Test Bench\Templates); the bench picks them up there.
// Step ids are fixed on purpose: autosave and Reload template match steps by id.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || path.join(here, '..', 'templates')

const step = (id, type, title, instructions, params = {}) => ({ id, type, title, instructions, images: [], hold: false, params })

const DUT = ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing engineer']

const SOURCES = 'Limits follow the other CHS templates (AS/NZS 3551 EST): protective earth 0.2 ohm or less; insulation 1 Mohm or more; touch leakage 100 uA normal and 500 uA single fault; earth leakage 500 uA normal and 1000 uA single fault. Check them against the standard before first use.'

const functional = (extra = []) => step('functional', 'check', 'Power on and function', 'Do this after the electrical safety tests.', {
  items: [
    'Powers on and reaches the operating system without error messages.',
    'Fans run and vents are clear of dust and blockage.',
    'Screen, keyboard and pointing device work; connected peripherals work.',
    ...extra,
    'Equipment clean and fit for the clinical area; test label applied.'],
})

const classI = {
  name: 'Computer / IT equipment – Class I – AS/NZS 3551 EST',
  desc: `Class I (earthed) computer, laptop power supply, monitor or other IT equipment. ${SOURCES}`,
  category: 'Computers',
  steps: [
    step('visual', 'check', 'Visual inspection', 'Unplug the equipment before inspecting. Do not open the case.', {
      items: [
        'Mains lead: plug, cable and connector undamaged; plug pins straight and secure; strain relief intact.',
        'Case undamaged: no cracks, missing screws, heat marks or signs of liquid.',
        'Ports, sockets and switches undamaged; no loose connectors.',
        'Labels legible: model, ratings and the Class I (earthed) marking.'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply. Nothing needs to be connected to the equipment outlet for this step.'),
    step('lead-pe', 'esa_pe', 'Mains lead earth continuity', 'Test the mains lead on its own, disconnected from the equipment.\n1. Plug the lead into the ESA612 equipment outlet.\n2. Clip the red test lead to the earth contact inside the connector (C13/C5).\nSkip this step for equipment with a fixed (non-detachable) lead; the next step covers it.', { hi: 0.2 }),
    step('bond-pe', 'esa_pe', 'Earth bond to accessible metal', 'Connect the equipment to the ESA612 equipment outlet with its own lead, switched off.\nClip the red test lead to an unpainted metal part of the case, a screw or a metal port shell. Test more than one point if there are separate metal parts.', { hi: 0.2 }),
    step('ins-mains-pe', 'esa_ins', 'Insulation: mains to protective earth', 'Mains pins (live and neutral linked by the ESA612) to the earth pin. Switch the equipment on if it has a switch, and disconnect all peripherals and network cables.', { target: 'MINS', volts: 'HIGH', lo: 1 }),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to accessible non-earthed parts', 'Only for equipment with accessible parts that are not connected to earth (isolated ports, plastic-case screws, isolated metal). Clip the red test lead to the part, or link several parts together with a shorting clip or foil.\nMark this step skipped if every accessible part is earthed.', { target: 'MAINS_NE', volts: 'HIGH', lo: 1 }),
    step('touch', 'esa_encl', 'Touch leakage', 'Keep the equipment on with the peripherals disconnected. Red test lead on an accessible metal part of the case, or on foil wrapped around a plastic case.', { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }, { c: 'OE', hi: 500 }] }),
    step('earth-leak', 'esa_earthl', 'Earth leakage', 'Equipment on, peripherals disconnected.', { conds: [{ c: 'NC', hi: 500 }, { c: 'ON', hi: 1000 }] }),
    functional(),
  ],
}

const classII = {
  name: 'Computer / IT equipment – Class II – AS/NZS 3551 EST',
  desc: `Class II (double insulated, no earth) computer, laptop power supply, monitor or other IT equipment. No earth continuity, mains-to-earth insulation or earth leakage test: there is no protective earth. ${SOURCES}`,
  category: 'Computers',
  steps: [
    step('visual', 'check', 'Visual inspection', 'Unplug the equipment before inspecting. Do not open the case.', {
      items: [
        'Mains lead: plug, cable and connector undamaged; strain relief intact; two-core lead or no connection to the earth pin.',
        'Case undamaged: no cracks, missing screws, heat marks or signs of liquid.',
        'Ports, sockets and switches undamaged; no loose connectors.',
        'Labels legible: model, ratings and the Class II (double square) marking.'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply. Nothing needs to be connected to the equipment outlet for this step.'),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to accessible parts', 'Mains pins (live and neutral linked by the ESA612) to the accessible parts. Clip the red test lead to a metal port shell or screw, or to foil wrapped around the case (link several parts together with a shorting clip). Switch the equipment on if it has a switch, and disconnect all peripherals and network cables.', { target: 'MAINS_NE', volts: 'HIGH', lo: 1 }),
    step('touch', 'esa_encl', 'Touch leakage', 'Equipment on, peripherals disconnected. Red test lead on an accessible metal part, or on foil wrapped around the case. No earth fault condition: Class II equipment has no earth.', { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }] }),
    functional(),
  ],
}

fs.mkdirSync(outDir, { recursive: true })
for (const [t, file] of [[classI, 'Computer - IT equipment - Class I - Test Bench template.json'], [classII, 'Computer - IT equipment - Class II - Test Bench template.json']]) {
  const template = { ...t, dut: DUT, appliedParts: [], models: [], showNA: false, esaAuto: true, esaHalt: true }
  fs.writeFileSync(path.join(outDir, file), JSON.stringify({ format: 'chs-test-bench-template', version: 1, template }, null, 1) + '\n', 'utf8')
  console.log(file, template.steps.length, 'steps')
}
