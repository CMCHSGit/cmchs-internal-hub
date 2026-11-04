// Runs every *.test.mjs here, one after another, against the Firestore emulator
// that `npm test` (in rules/) starts. Wipes the emulator's data between files so
// one file's leftovers can't make another pass or fail. Exits 1 if any file fails.
// Run from rules/, so equipment-layer.test.mjs writes its bundle there (git-ignored).
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const files = readdirSync(new URL('.', import.meta.url)).filter(f => f.endsWith('.test.mjs')).sort()
const clear = () => fetch('http://127.0.0.1:8085/emulator/v1/projects/rules-test/databases/(default)/documents', { method: 'DELETE' })
const failed = []
for (const f of files) {
  await clear()
  console.log(`\n=== ${f}`)
  const r = spawnSync(process.execPath, [new URL(f, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], { stdio: 'inherit' })
  if (r.status !== 0) failed.push(f)
}
console.log(`\n${files.length - failed.length} of ${files.length} test files passed.`)
if (failed.length) { console.log('Failed: ' + failed.join(', ')); process.exit(1) }
