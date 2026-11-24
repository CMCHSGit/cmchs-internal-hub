// Checks Test Bench templates against what the bench can load and the CHS template rules (docs/bench-notes.md §8).
//
//   node apps/testbench/tools/check-templates.mjs [file or folder ...] [--strict]
//
// With no file it checks every template in apps/testbench/templates. A folder is checked for every *.json in it (not names starting with
// . ~ or _), so point it at the SharePoint Templates folder to check what engineers have saved there. Exit code 1 when anything has an
// error; with --strict, a warning counts too. Nothing is changed.
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchVocabulary, checkTemplateFile, TEMPLATES_DIR } from './template-lib.mjs'

const args = process.argv.slice(2), strict = args.includes('--strict')
const targets = args.filter((a) => !a.startsWith('--'))
if (!targets.length) targets.push(fileURLToPath(TEMPLATES_DIR))

const files = []
for (const t of targets) {
  if (!existsSync(t)) { console.error(`Can't find ${t}`); process.exit(2) }
  if (statSync(t).isDirectory()) for (const n of readdirSync(t).sort()) { if (/\.json$/i.test(n) && !/^[._~]/.test(n)) files.push(join(t, n)) }
  else files.push(t)
}
if (!files.length) { console.error('No template files found.'); process.exit(2) }

const vocab = benchVocabulary()
let bad = 0, warned = 0
for (const f of files) {
  const r = checkTemplateFile(f, vocab)
  if (r.errors.length) bad++; else if (r.warnings.length) warned++
  if (!r.errors.length && !r.warnings.length) continue
  console.log(r.file)
  for (const m of r.errors) console.log(`  ERROR    ${m}`)
  for (const m of r.warnings) console.log(`  warning  ${m}`)
}
console.log(`${files.length} template${files.length === 1 ? '' : 's'} checked: ${files.length - bad - warned} clean, ${warned} with warnings only, ${bad} with errors.`)
process.exit(bad || (strict && warned) ? 1 : 0)
