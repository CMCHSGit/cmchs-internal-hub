// npm test --prefix apps/testbench: the longest an ESA612 reading waits to settle (3 s) is a bench setting, Devices → Test settings, kept on this laptop.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8').replaceAll(String.fromCharCode(13), '')

test('the setting shortens the 3 s rows, leaves the others, and never goes over 30 s', () => {
  const a = html.indexOf('/** The ESA612 rows of a step.'), b = html.indexOf('function buildEsaRowsAt3s(')
  assert.ok(a > 0 && b > a)
  const rows = () => [{ label: 'Mains', settle: 2 }, { label: 'PE', settle: 3 }, { label: 'Leakage', settle: 3 }]
  const run = (esaSettle) => vm.runInNewContext(html.slice(a, b) + '; buildEsaRows({}, {}).map((r) => r.settle)', { buildEsaRowsAt3s: rows, Prefs: { get: () => esaSettle }, Math })
  assert.deepEqual(run(3), [2, 3, 3], 'the usual 3 s')
  assert.deepEqual(run(undefined), [2, 3, 3], 'no setting')
  assert.deepEqual(run(1.5), [2, 1.5, 1.5], 'shortened; the 2 s mains row is left alone')
  assert.deepEqual(run(99), [2, 30, 30])
  assert.deepEqual(run(0), [2, 3, 3], 'nonsense falls back to 3 s')
  assert.deepEqual(run('x'), [2, 3, 3])
})

test('Devices → Test settings has the box, it is saved with the other settings, and a laptop with none keeps 3 s', () => {
  assert.match(html, /data-prefnum="esaSettle"/, 'the box')
  assert.match(html, /d: \{ zeroLead: false, confirmPower: false, chargeAfter: true, autoSave: true, saveKinds: 'both', esaSettle: 3 \}/, 'default 3 s')
  assert.match(html, /\$\$\('#view-devices \[data-prefnum\]'\)\.forEach\(c => c\.addEventListener\('change', \(\) => \{ const v = Math\.min\(30, Math\.max\(0\.5, \+c\.value \|\| 3\)\); c\.value = v; Prefs\.set\(c\.dataset\.prefnum, v\); \}\)\);/, 'a change is clamped to 0.5 to 30 s and saved')
  assert.match(html, /\$\$\('#view-devices \[data-prefnum\]'\)\.forEach\(c => \{ c\.value = Prefs\.get\(c\.dataset\.prefnum\); \}\)/, 'the box shows the saved value')
})
