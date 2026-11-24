// Starts a new Test Bench template, either from a blank skeleton or as a copy of an existing template, and checks it.
//
//   node apps/testbench/tools/new-template.mjs --name "Mindray BeneVision N17 Patient Monitor" --kind applied --manufacturer Mindray --category Monitoring
//   node apps/testbench/tools/new-template.mjs --name "Mindray BeneVision N22" --from "R700"
//   node apps/testbench/tools/new-template.mjs --list
//
//   --name "<template name>"   required. The file is "<name> - Test Bench template.json" (slashes and colons become hyphens).
//   --kind class1 | class2 | applied     blank skeletons: Class I (earthed, nothing applied to a patient); Class II (no earth);
//                                        Class I with applied parts (default). AS/NZS 3551 limits as the other CHS templates use them.
//   --ap-class B|BF|CF  --ap-name "ECG, SpO2, Temp"   the applied-part group of `applied` (default CF on post RA).
//   --from "<text>"            copy an existing template instead (matched on its file or template name; must match one).
//   --category / --manufacturer / --models "D30,D60"   set these fields.
//   --out <folder>             where to write (default apps/testbench/templates, like the make-*-templates generators).
//   --force                    overwrite a file of the same name. Never do this to a template engineers have edited in SharePoint.
//   --list                     list the existing templates and stop.
//
// The new file has TODO wherever something device-specific must be written (check-templates.mjs warns until they are gone). Limits are the
// standard's, never copied from a manual: if the manufacturer's differ, say so in `desc` and leave the decision to Jonathan (bench-notes §9).
// Then: edit the file (or open it in the bench's Templates page), run check-templates.mjs, copy it into the SharePoint Templates folder
// (Service\Test Software\CHS Test Bench\Templates: the master), run npm test --prefix apps/testbench, and open a pull request.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { benchVocabulary, checkTemplate, TEMPLATE_FILE_SUFFIX, TEMPLATES_DIR } from './template-lib.mjs'

export const KINDS = ['class1', 'class2', 'applied']
const step = (id, type, title, instructions, params = {}) => ({ id, type, title, instructions, images: [], hold: 0, params })
const DUT = ['Serial number', 'Manufacturer', 'Model', 'Customer', 'Location', 'CHS asset #', 'Customer asset #', 'Testing company', 'Testing engineer']
const LEAD = 'Connect the device’s mains lead to the ESA612 equipment outlet'
const insFn = (target, lo) => ({ target, volts: 'HIGH', lo })

const visual = () => step('visual', 'check', 'Visual inspection', 'Inspect the device, cables and accessories. Unplug it first.', { items: [
  'The case, display, buttons, power cord and accessories have no obvious signs of damage.',
  'The external connecting cables are not frayed and the connector pins are not loose or bent.',
  'The safety labels and data plate are clearly legible.'] })
const mains = () => step('mains', 'esa_mains', 'Mains voltage', 'Plug the ESA612 into the mains supply you are testing from.')
const pe = () => step('pe', 'esa_pe', 'Protective earth resistance', `${LEAD}. Clip the red test lead to an exposed earthed metal part, such as a rear-panel screw or the equipotential terminal. Limit 0.2 ohm (AS/NZS 3551 B8.6).`, { hi: 0.2 })
const encl = () => step('encl', 'esa_encl', 'Enclosure leakage', `${LEAD}. Clip the red test lead to a conductive non-earthed exposed part. Only a representative sample of such parts needs to be tested.`, { conds: [{ c: 'NC', hi: 100 }, { c: 'ON', hi: 500 }, { c: 'OE', hi: 500 }] })
const earthl = () => step('earthl', 'esa_earthl', 'Earth leakage', `${LEAD}. The device is switched on and off between conditions. Limits: 5000 µA normal, 10000 µA neutral open (AS/NZS 3551:2012+A2 B11.6).`, { conds: [{ c: 'NC', hi: 5000 }, { c: 'ON', hi: 10000 }] })
const functional = () => step('functional', 'check', 'Power on and function', 'TODO: write the device’s own function checks after the electrical safety tests, from the service manual’s maintenance chapter. Put the setting and the target in each item.', { items: [
  'The device powers on normally and the power-on test is passed.',
  'TODO: first function check, with its setting and target.'] })

/** The steps of a blank skeleton, in the CHS order: visual, then the ESA612 sequence as one block, then the device's own checks. */
export function skeletonSteps(kind) {
  if (kind === 'class2') return [visual(), mains(),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to accessible parts', `Mains pins to the accessible parts, at 500 V. Clip the red test lead to a metal port shell or screw, or to foil around the case. Switch the device on if it has a switch. Must be over 1 MΩ (B9.3).`, insFn('MAINS_NE', 1)),
    functional()]
  const base = [visual(), mains(), pe(),
    step('ins-mins', 'esa_ins', 'Insulation: mains to protective earth', `${LEAD} and switch the device on. Don’t touch the device during the test. Must be over 1 MΩ (B9.3).`, insFn('MINS', 1))]
  if (kind === 'class1') return [...base, encl(), earthl(), functional()]
  return [...base,
    step('ins-apins', 'esa_ins', 'Insulation: applied parts to protective earth', `${LEAD}, with the applied parts connected to the ESA612 posts. Recorded, no limit.`, insFn('APINS', '')),
    step('ins-mains-ap', 'esa_ins', 'Insulation: mains to applied parts', `${LEAD}, with the applied parts connected to the ESA612 posts. Must be over 1 MΩ (B9.3).`, insFn('MAINS_AP', 1)),
    step('ins-mains-ne', 'esa_ins', 'Insulation: mains to accessible non-earthed parts', 'Clip the red test lead to an accessible non-earthed conductive part. Mark this step skipped if every accessible part is earthed. Must be over 1 MΩ (B9.3).', insFn('MAINS_NE', 1)),
    step('ins-ap-ne', 'esa_ins', 'Insulation: applied parts to accessible non-earthed parts', 'Clip the red test lead to an accessible non-earthed conductive part, with the applied parts connected to the ESA612 posts. Recorded, no limit.', insFn('AP_NE', '')),
    encl(), earthl(),
    step('pat', 'esa_pat', 'Patient leakage', `Connect the applied parts to the ESA612 posts. ${LEAD}.`, { mode: 'together', conds: [{ c: 'NC' }, { c: 'ON' }, { c: 'OE' }] }),
    step('map', 'esa_map', 'Mains on applied parts', `Connect the applied parts to the ESA612 posts. ${LEAD}.`, { mode: 'together', pols: ['NORM'] }),
    functional()]
}

/** A blank template. `opts`: kind, name, category, manufacturer, models (array), apClass, apName. */
export function blankTemplate({ kind = 'applied', name, category, manufacturer, models, apClass = 'CF', apName } = {}) {
  if (!KINDS.includes(kind)) throw new Error(`--kind must be one of ${KINDS.join(', ')}`)
  if (!['B', 'BF', 'CF'].includes(apClass)) throw new Error('--ap-class must be B, BF or CF')
  const what = { class1: 'Class I (earthed) device with nothing applied to a patient', class2: 'Class II (double insulated, no earth) device', applied: `Class I device with applied parts (${apClass} on post RA)` }[kind]
  const t = {
    name,
    desc: `${what}. TODO: say what the device is and which documents the checks come from (CHS Ansur template, completed record, service manual chapter and revision). Electrical safety to AS/NZS 3551:2012+A2; where a manufacturer’s limit differs, note it here and leave the decision to Jonathan.`,
    ...(category ? { category } : {}),
    ...(manufacturer ? { manufacturer } : {}),
    models: models || [],
    dut: [...DUT],
    esaAuto: true, esaHalt: true,
    appliedParts: kind === 'applied' ? [{ id: 'ap1', name: apName || 'TODO name the applied parts', apclass: apClass, leads: ['RA'] }] : [],
    steps: skeletonSteps(kind),
  }
  return t
}

/** A copy of an existing template's content under a new name: no id, timestamp or SharePoint state; step ids are kept (they are meant to be stable). */
export function copyTemplate(source, { name, category, manufacturer, models } = {}) {
  const t = JSON.parse(JSON.stringify(source))
  for (const k of ['id', 'updated', 'shared', 'sharedDirty', 'sharedConflict']) delete t[k]
  const was = source.name
  t.name = name
  t.desc = `Started from the “${was}” template. TODO: say what is different for this model and where its limits come from. Original description: ${source.desc || ''}`.trim()
  if (category) t.category = category
  if (manufacturer) t.manufacturer = manufacturer
  if (models) t.models = models
  return t
}

/** File name for a template name: what the other templates use, with characters Windows files can't have swapped out. */
export function fileNameFor(name) {
  const base = String(name).replace(/[\\/]/g, '-').replace(/[–—]/g, '-').replace(/[<>:"|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  if (!base) throw new Error('the template needs a name')
  return base + TEMPLATE_FILE_SUFFIX
}

/** Find one existing template whose file or template name contains `text`. Returns { file, json } or throws with the candidates. */
export function findTemplate(text, dir = fileURLToPath(TEMPLATES_DIR)) {
  const want = String(text).toLowerCase()
  const all = readdirSync(dir).filter((f) => /\.json$/i.test(f) && !/^[._~]/.test(f)).map((f) => ({ file: f, json: JSON.parse(readFileSync(join(dir, f), 'utf8')) }))
  const exact = all.filter((x) => x.file.toLowerCase() === want || String(x.json.template && x.json.template.name).toLowerCase() === want)
  const hits = exact.length ? exact : all.filter((x) => x.file.toLowerCase().includes(want) || String(x.json.template && x.json.template.name).toLowerCase().includes(want))
  if (hits.length === 1) return hits[0]
  throw new Error(hits.length ? `"${text}" matches ${hits.length} templates; be more specific:\n  ${hits.map((h) => h.file).join('\n  ')}` : `no template matches "${text}" (run with --list to see them)`)
}

export function serialise(template) { return JSON.stringify({ format: 'chs-test-bench-template', version: 1, template }, null, 1) + '\n' }

function main() {
  const args = process.argv.slice(2)
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
  const dir = fileURLToPath(TEMPLATES_DIR)
  if (args.includes('--list')) {
    for (const f of readdirSync(dir).filter((f) => /\.json$/i.test(f) && !/^[._~]/.test(f)).sort()) { const t = JSON.parse(readFileSync(join(dir, f), 'utf8')).template; console.log(`${t.name}${t.category ? `  [${t.category}]` : ''}`) }
    return
  }
  const name = (val('--name') || '').trim()
  if (!name) { console.error('Give the new template a name: --name "Mindray BeneVision N17 Patient Monitor" (see the top of this file for the options).'); process.exit(2) }
  const models = val('--models') ? val('--models').split(',').map((m) => m.trim()).filter(Boolean) : undefined
  const common = { name, category: val('--category'), manufacturer: val('--manufacturer'), models }
  let template
  try {
    if (val('--from')) template = copyTemplate(findTemplate(val('--from')).json.template, common)
    else template = blankTemplate({ ...common, kind: val('--kind') || 'applied', apClass: val('--ap-class') || 'CF', apName: val('--ap-name') })
  } catch (e) { console.error(e.message); process.exit(2) }

  const out = val('--out') || dir, file = fileNameFor(name), dest = join(out, file)
  if (existsSync(dest) && !args.includes('--force')) { console.error(`${file} already exists in ${out}. Pick another name, or use --force only if no one has edited it in SharePoint.`); process.exit(2) }
  mkdirSync(out, { recursive: true })
  writeFileSync(dest, serialise(template), 'utf8')
  console.log(`Wrote ${dest}  (${template.steps.length} steps)`)
  const r = checkTemplate(JSON.parse(readFileSync(dest, 'utf8')), file, benchVocabulary())
  for (const m of r.errors) console.log(`  ERROR    ${m}`)
  for (const m of r.warnings) console.log(`  warning  ${m}`)
  console.log('Next: edit it (here, or in the bench’s Templates page), run  node apps/testbench/tools/check-templates.mjs "' + dest + '"  until it is clean, copy it into the SharePoint Templates folder, then npm test --prefix apps/testbench and a pull request.')
  if (r.errors.length) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
