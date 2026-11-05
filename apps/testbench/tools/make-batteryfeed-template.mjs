// Builds the Test Bench template for the Mindray BatteryFeed 20 charger station (the two-bay charger for BeneHeart D30 / D60 batteries).
// Run: node apps/testbench/tools/make-batteryfeed-template.mjs [outDir]   (default apps/testbench/templates)
// The file goes into the SharePoint Templates folder (Service\Test Software\CHS Test Bench\Templates); the bench picks it up there.
// Step ids are fixed on purpose: autosave and Reload template match steps by id.
//
// Source: "BatteryFeed 20 Charger Station Instructions For Use" V1.0 EN (Service\SoftwareAndManuals\Mindray\Mindray Human\AED_Defibrillators\BeneHeart D1).
// What it says (several digits are missing from the PDF's text layer, so only what reads clearly is used):
//   Class I (protection against electric shock), IPX1, portable; AC 100–240 V 50/60 Hz via an AC power socket (detachable cord),
//   or DC via a DC power socket; two charging bays for BeneHeart D3x / D6x batteries; "use only the supplied AC/DC power cords";
//   never connect AC and DC together. Indicators: power (green = AC/DC connected), per bay a charge indicator (yellow = charging,
//   green = full, off = no power or no battery) and a status indicator (off = working, red = failure). A power-on test runs by itself
//   when power is connected. Battery pins are exposed: "do not touch the battery pin".
// There are no applied parts. Limits are AS/NZS 3551:2012+A2 Appendix B, as in the other CHS templates:
//   B8.6  earth continuity: detachable lead on its own 0.2 ohm; appliance inlet earth pin to earthed accessible metal 0.1 ohm
//   B9.3  insulation (500 V d.c.) over 1 Mohm: mains to earth, and mains to accessible parts that are not earthed
//   B10.5 touch current: 100 uA normal, 500 uA neutral open, 500 uA earth open
//   B11.6 earth leakage (flexible-cord Class I): 5000 uA normal, 10000 uA neutral open
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const outDir = process.argv[2] || path.join(here, '..', 'templates')
const step = (id, type, title, instructions, params = {}) => ({ id, type, title, instructions, images: [], hold: false, params })

const DUT = ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing engineer']

const template = {
  name: 'Mindray BatteryFeed 20 Charger Station',
  desc: 'Two-bay charger for BeneHeart D30 / D60 batteries (Class I, no applied parts, AC or DC input). Electrical safety to AS/NZS 3551:2012+A2 Appendix B: earth continuity 0.2 ohm (lead) and 0.1 ohm (inlet), insulation over 1 Mohm, touch current 100/500/500 uA, earth leakage 5000/10000 uA; then power, charging and indicator checks from the BatteryFeed 20 Instructions For Use V1.0.',
  category: 'Defibrillation',
  dut: DUT,
  appliedParts: [],
  models: [],
  showNA: false,
  esaAuto: true,
  esaHalt: true,
  steps: [
    step('visual', 'check', 'Visual inspection', 'Unplug the charger station before inspecting. Do not open it (there are no user-serviceable parts) and do not touch the battery pins.', {
      items: [
        'AC power cord: plug, cable and connector undamaged; plug pins straight and secure; strain relief intact. DC power cord (if supplied) undamaged.',
        'Charger station case undamaged: no cracks, missing parts, heat marks or signs of liquid.',
        'Both charging bays: contact pins straight, clean and undamaged (look, do not touch); no debris in the bays.',
        'Battery stoppers move freely and can be set for D30 and D60 batteries; bay latches intact.',
        'Indicators (power, charge, status), AC and DC sockets undamaged; labels legible: model, serial number, ratings and the Class I and IPX1 markings.'] }),
    step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply. Nothing needs to be connected to the equipment outlet for this step.'),
    step('lead-pe', 'esa_pe', 'AC power cord: earth continuity', 'Test the cord on its own, disconnected from the charger station.\n1. Plug the AC power cord into the ESA612 equipment outlet.\n2. Clip the red test lead to the earth contact inside the connector.\nThis checks the cord from the plug earth pin to the connector earth pin (0.2 ohm, AS/NZS 3551 B8.6). Use only the cord supplied with the charger station.', { hi: 0.2 }),
    step('bond-inlet', 'esa_pe', 'Earth bond: AC socket', 'Only if the charger station has an accessible earthed metal part (check in the visual inspection). Mark this step skipped if the case is all plastic with nothing earthed to touch.\nConnect the AC power cord to the charger station and the ESA612 outlet, switched off. Clip the red test lead to the earthed metal part. The limit is 0.1 ohm from the earth pin in the AC socket to that part (B8.6).', { hi: 0.1 }),
    step('ins-mains-pe', 'esa_ins', 'Insulation: mains to protective earth', 'Mains pins (live and neutral linked by the ESA612) to the earth pin, at 500 V. No battery in the bays, DC cord disconnected, and the charger station connected to the ESA612 equipment outlet. Over 1 Mohm (B9.3).', { target: 'MINS', volts: 'HIGH', lo: 1 }),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to accessible non-earthed parts', 'Mains pins to the accessible parts that are not connected to earth, at 500 V. Clip the red test lead to the metal of the DC power socket (cord disconnected) and to foil wrapped around the case, linked together. Do not touch the battery pins. Over 1 Mohm (B9.3).', { target: 'MAINS_NE', volts: 'HIGH', lo: 1 }),
    step('touch', 'esa_encl', 'Touch current', 'No battery in the bays, DC cord disconnected, charger station on. Keep the red test lead on the foil around the case (and the DC socket metal). Limits: 100 uA normal, 500 uA neutral open, 500 uA earth open (B10.5).', { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }, { c: 'OE', hi: 500 }] }),
    step('earth-leak', 'esa_earthl', 'Earth leakage', 'Flexible-cord Class I equipment (B11). Use the supplied AC power cord. Charger station on, no battery in the bays. Limits: 5000 uA normal, 10000 uA neutral open (B11.6).', { conds: [{ c: 'NC', hi: 5000 }, { c: 'ON', hi: 10000 }] }),
    step('power-on', 'check', 'Power-on test and indicators', 'After the electrical tests the ESA612 outlet stays on (the bench powers it so the device runs), so the charger station is powered from AC. Connect only one power source at a time: never AC and DC together.', {
      items: [
        'Power indicator green when AC power is connected.',
        'Power-on self-test runs by itself and ends with both status indicators off (no red) and no battery installed: charge indicators off.',
        'DC power input: only if a DC supply is available, with the AC cord removed: power indicator green. Mark N/A if not tested.'] }),
    step('bay-1', 'check', 'Charging bay 1', 'Use a known good BeneHeart D30 or D60 battery. Set the battery stopper for the battery type as the manual shows, insert the battery with its pin towards the front panel and push down until it clicks. Do not touch the battery pin.', {
      items: [
        'Battery locks into the bay with a click and is held by the stopper.',
        'Charge indicator of bay 1 yellow while the battery charges (green if it is already full).',
        'Status indicator of bay 1 off.',
        'Battery releases when the latch is pinched, and comes out cleanly.'] }),
    step('bay-2', 'check', 'Charging bay 2', 'Repeat in bay 2 (the same battery, or a second one). Both bays can be loaded together.', {
      items: [
        'Battery locks into the bay with a click and is held by the stopper.',
        'Charge indicator of bay 2 yellow while the battery charges (green if it is already full).',
        'Status indicator of bay 2 off.',
        'Battery releases when the latch is pinched, and comes out cleanly.'] }),
    step('finish', 'check', 'Finish', 'Both bays empty and the charger station switched off at the ESA612 outlet.', {
      items: [
        'Charger station clean and dry (wipe with a cloth dampened with mild soap and water; never immerse or spray it).',
        'Test label applied; accessories (AC and DC cords) returned with the unit.'] }),
  ],
}

fs.mkdirSync(outDir, { recursive: true })
const file = 'Mindray BatteryFeed 20 Charger Station - Test Bench template.json'
fs.writeFileSync(path.join(outDir, file), JSON.stringify({ format: 'chs-test-bench-template', version: 1, template }, null, 1) + '\n', 'utf8')
console.log(file, template.steps.length, 'steps')
