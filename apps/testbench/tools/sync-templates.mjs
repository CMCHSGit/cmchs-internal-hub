// Copies the Test Bench templates from the SharePoint Templates folder into apps/testbench/templates/, which the build publishes at
// /bench-app/templates/ for browsers that can't use the shared folder (Firefox: no folder picker). SharePoint stays the master;
// run this and push after changing a template there.
//
//   node apps/testbench/tools/sync-templates.mjs [--from "<Templates folder>"] [--dry]
//
// Copies every *.json (not in Old, not starting with . ~ or _) and the team layout (_Run a test layout.json). Files that are only in
// the repo are listed, never deleted.
import { copyFileSync, existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
const flag = (n) => args.includes(n), val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
const root = fileURLToPath(new URL('../../..', import.meta.url))
const to = join(root, 'apps/testbench/templates')
const from = val('--from') || join(homedir(), 'Cass Medical Limited', 'Cass & CHS SharePoint - Documents (1)', 'CMCHS Files', 'Service', 'Test Software', 'CHS Test Bench', 'Templates')
if (!existsSync(from)) { console.error(`Can't find the Templates folder: ${from}\nGive it with --from "<folder>".`); process.exit(1) }

const LAYOUT = '_Run a test layout.json'
const wanted = readdirSync(from).filter((n) => /\.json$/i.test(n) && (n === LAYOUT || !/^[._~]/.test(n)) && statSync(join(from, n)).isFile())
let copied = 0, same = 0
for (const n of wanted) {
  try { JSON.parse(readFileSync(join(from, n), 'utf8')) } catch { console.warn(`skipped (not valid JSON): ${n}`); continue }
  const dst = join(to, n)
  if (existsSync(dst) && readFileSync(dst).equals(readFileSync(join(from, n)))) { same++; continue }
  console.log(`${existsSync(dst) ? 'updated' : 'new    '} ${n}`)
  if (!flag('--dry')) copyFileSync(join(from, n), dst)
  copied++
}
const onlyHere = readdirSync(to).filter((n) => /\.json$/i.test(n) && !wanted.includes(n))
console.log(`${copied} ${flag('--dry') ? 'would change' : 'copied'}, ${same} already the same.`)
if (onlyHere.length) console.log(`Only in the repo (not in SharePoint): ${onlyHere.join('; ')}`)
