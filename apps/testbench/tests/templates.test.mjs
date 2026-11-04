// npm test --prefix apps/testbench: every template in apps/testbench/templates loads the way the bench will use it (they are the same files as in the
// SharePoint Templates folder): known step types, stable unique step ids, one ESA612 block, applied parts where the leakage steps need them,
// model-only steps naming real models, and the AS/NZS 3551:2012+A2 limits the other CHS templates use.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const dir = new URL('../templates/', import.meta.url)
const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
const files = readdirSync(dir).filter((f) => f.endsWith('.json'))

test('there are templates for the monitors, modules, vital signs monitors and BeneHeart defibrillators', () => {
  for (const want of ['R700', 'TM80', 'PM-60', 'VS8', 'VS-600', 'Exergen', 'BeneHeart D1', 'BeneHeart C', 'Sidestream CO2', 'AG + O2', 'NMT+', 'NMT, BIS', 'rSO2', 'C.O.', 'CCO-SvO2', 'CO2 + O2', 'EEG', 'IBP', 'PiCCO']) {
    assert.ok(files.some((f) => f.includes(want)), `a template for ${want}`)
  }
})

for (const f of files) {
  test(`template ${f} is ready for the bench`, () => {
    const j = JSON.parse(readFileSync(new URL(f, dir), 'utf8')), t = j.template
    assert.equal(j.format, 'chs-test-bench-template')
    assert.ok(t.name && t.desc && t.dut[0] === 'Serial number')
    const ids = t.steps.map((s) => s.id)
    assert.equal(new Set(ids).size, ids.length, 'step ids are unique')
    assert.ok(ids.every(Boolean), 'every step has an id')
    for (const s of t.steps) {
      assert.ok(s.type === 'check' || html.includes(`${s.type}:`), `bench knows ${s.type}`)
      if (s.type === 'check') assert.ok((s.params.items || []).length || (s.params.readings || []).length, `${s.id} has something to check`)
      for (const r of (s.params && s.params.readings) || []) assert.ok(r.lo !== '' || r.hi !== '', `${s.id}: “${r.label}” has a limit`)
      if (s.models) { assert.ok(t.models && t.models.length > 1); for (const m of s.models) assert.ok(t.models.includes(m), `${s.id}: model ${m}`) }
      if (s.type === 'esa_earthl') for (const c of s.params.conds) assert.equal(c.hi, { NC: 5000, ON: 10000 }[c.c], 'earth leakage 5000 / 10000 µA (B11.6)')
      if (s.type === 'esa_ins' && s.params.target === 'MAINS_AP') assert.equal(s.params.lo, 1, 'mains to applied parts over 1 MΩ (B9.3)')
      if (s.type === 'esa_pe') assert.ok(s.params.hi <= 0.2)
    }
    const esa = t.steps.map((s, i) => (s.type.startsWith('esa_') ? i : -1)).filter((i) => i >= 0)
    if (esa.length > 1) assert.equal(esa[esa.length - 1] - esa[0], esa.length - 1, 'the ESA612 steps are one block')
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
