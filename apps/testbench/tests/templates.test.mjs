// npm test --prefix apps/testbench: every template in apps/testbench/templates loads the way the bench will use it (they are the same files as in the
// SharePoint Templates folder): known step types, stable unique step ids, one ESA612 block, applied parts where the leakage steps need them,
// model-only steps naming real models, and the AS/NZS 3551:2012+A2 limits the other CHS templates use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../templates/', import.meta.url)
const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))

test('there are templates for the monitors, modules, vital signs monitors and BeneHeart defibrillators', () => {
  for (const want of ['R700', 'TM80', 'PM-60', 'VS8', 'VS-600', 'Exergen', 'BeneHeart D1', 'BeneHeart C', 'Sidestream CO2', 'AG + O2', 'NMT+', 'NMT, BIS', 'rSO2', 'C.O.', 'CCO-SvO2', 'CO2 + O2', 'EEG', 'IBP', 'PiCCO', 'BatteryFeed 20']) {
    assert.ok(files.some((f) => f.includes(want)), `a template for ${want}`)
  }
})

// Templates from the CHS Ansur library or made earlier (not by the generators here): checked for structure only. Their limits still
// follow the old Ansur template (e.g. earth leakage 500/1000 µA, see change-log.md); the bench gives every step a fresh id on loading.
const LEGACY = ['Medical power supply', 'A7 Anaesthetic', 'A9 Anaesthetic', 'D30-D60', 'Patient Monitor and OR Modules']
for (const f of files) {
  const legacy = LEGACY.some((l) => f.includes(l))
  test(`template ${f} is ready for the bench${legacy ? ' (older template: structure only)' : ''}`, () => {
    const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8')), t = j.template
    assert.equal(j.format, 'chs-test-bench-template')
    assert.ok(t.name && t.desc && t.dut[0] === 'Serial number')
    const ids = t.steps.map((s) => s.id)
    if (!legacy) { assert.equal(new Set(ids).size, ids.length, 'step ids are unique'); assert.ok(ids.every(Boolean), 'every step has an id') }
    for (const s of t.steps) {
      assert.ok(s.type === 'check' || html.includes(`${s.type}:`), `bench knows ${s.type}`)
      if (s.type === 'check') assert.ok((s.params.items || []).length || (s.params.readings || []).length, `${s.id} has something to check`)
      for (const r of (s.params && s.params.readings) || []) assert.ok(r.lo !== '' || r.hi !== '', `${s.id}: “${r.label}” has a limit`)
      if (s.models) { assert.ok(t.models && t.models.length > 1); for (const m of s.models) assert.ok(t.models.includes(m), `${s.id}: model ${m}`) }
      if (legacy) continue
      if (s.type === 'esa_earthl') for (const c of s.params.conds) assert.equal(c.hi, { NC: 5000, ON: 10000 }[c.c], 'earth leakage 5000 / 10000 µA (B11.6)')
      if (s.type === 'esa_ins' && s.params.target === 'MAINS_AP') assert.equal(s.params.lo, 1, 'mains to applied parts over 1 MΩ (B9.3)')
      if (s.type === 'esa_pe') assert.ok(s.params.hi <= 0.2)
    }
    const esa = t.steps.map((s, i) => (s.type.startsWith('esa_') ? i : -1)).filter((i) => i >= 0)
    if (!legacy && esa.length > 1) assert.equal(esa[esa.length - 1] - esa[0], esa.length - 1, 'the ESA612 steps are one block')
    if (t.steps.some((s) => s.type === 'esa_pat' || s.type === 'esa_map')) assert.ok(t.appliedParts && t.appliedParts.length, 'applied parts for the leakage steps')
    const seen = new Set(t.steps.filter((s) => s.type === 'esa_ins').map((s) => s.params.target)); assert.equal(seen.size, t.steps.filter((s) => s.type === 'esa_ins').length, 'no insulation step twice')
  })
}

test('the BeneHeart templates: internally powered units have no mains, earth or insulation steps; the D1 has Pro-only steps', () => {
  const get = (n) => JSON.parse(readFileSync(new URL(files.find((f) => f.includes(n)), dir), 'utf8')).template
  for (const n of ['BeneHeart D1', 'BeneHeart C']) for (const s of get(n).steps) assert.ok(!['esa_mains', 'esa_pe', 'esa_ins', 'esa_earthl'].includes(s.type), `${n}: ${s.type}`)
  const d1 = get('BeneHeart D1')
  assert.deepEqual(d1.models, ['Pro', 'Public'])
  assert.ok(d1.steps.filter((s) => s.models && s.models.join() === 'Pro').length >= 4)
  const aed = d1.steps.find((s) => s.id === 'aed'); assert.equal(aed.models, undefined, 'the AED test is for both')
})

test('modules are in their own group, and the general patient monitors are highlighted', () => {
  const all = files.map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')).template)
  for (const t of all.filter((x) => /\bModules?\b/.test(x.name) && !/Monitor/.test(x.name))) assert.equal(t.category, 'Modules', t.name)
  for (const n of ['R700', 'TM80', 'PM-60', 'VS8', 'VS-600']) assert.equal(all.find((t) => t.name.includes(n)).highlight, true, n)
  assert.ok(!all.some((t) => t.category === 'Modules' && t.highlight))
  assert.match(html, /const CATEGORIES = \['Anaesthesia', 'Monitoring', 'Modules'/)
  assert.match(html, /\.tpl-tile\.hl\{/)
  assert.match(html, /highlight: !!raw\.highlight/, 'the flag survives loading a template from a file')
})

test('the BatteryFeed 20 charger station template: Class I, no applied parts, earth and insulation then touch and earth leakage, then the charging checks', () => {
  const t = JSON.parse(readFileSync(new URL('Mindray BatteryFeed 20 Charger Station - Test Bench template.json', dir), 'utf8')).template
  assert.deepEqual(t.appliedParts, [])
  const ids = t.steps.map((s) => s.id)
  assert.deepEqual(ids.slice(0, 8), ['visual', 'mains', 'lead-pe', 'bond-inlet', 'ins-mains-pe', 'ins-mains-ne', 'touch', 'earth-leak'])
  assert.ok(!t.steps.some((s) => s.type === 'esa_pat' || s.type === 'esa_map'), 'nothing is applied to a patient')
  const by = (id) => t.steps.find((s) => s.id === id)
  assert.equal(by('lead-pe').params.hi, 0.2); assert.equal(by('bond-inlet').params.hi, 0.1)
  assert.equal(by('ins-mains-pe').params.lo, 1); assert.equal(by('ins-mains-ne').params.lo, 1)
  assert.deepEqual(by('touch').params.conds.map((c) => c.hi), [100, 500, 500])
  assert.deepEqual(by('earth-leak').params.conds.map((c) => c.hi), [5000, 10000])
  assert.deepEqual(ids.slice(8), ['power-on', 'bay-1', 'bay-2', 'finish'], 'the checks come after the electrical tests')
})
