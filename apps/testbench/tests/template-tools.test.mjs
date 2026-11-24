// npm test --prefix apps/testbench: the template tools (tools/template-lib.mjs, check-templates.mjs, new-template.mjs): the checker reads what the
// bench allows from bench/index.html, finds the mistakes that really happened (bench-notes §9), and the starter templates it writes pass it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchVocabulary, checkTemplate, checkTemplateFile } from '../tools/template-lib.mjs'
import { blankTemplate, copyTemplate, fileNameFor, findTemplate, KINDS, serialise } from '../tools/new-template.mjs'

const dir = fileURLToPath(new URL('../templates/', import.meta.url))
const tools = fileURLToPath(new URL('../tools/', import.meta.url))
const vocab = benchVocabulary()
const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith('_'))
const wrap = (template) => ({ format: 'chs-test-bench-template', version: 1, template })
const check = (template, file = 'New.json') => checkTemplate(wrap(JSON.parse(JSON.stringify(template))), file, vocab)
const good = () => blankTemplate({ kind: 'applied', name: 'Test device', apName: 'ECG' })
const finished = () => { const t = good(); t.desc = 'A device. Limits from AS/NZS 3551.'; t.steps = t.steps.filter((s) => s.id !== 'functional'); return t }

test('the checker reads the bench page: step types, leads, insulation targets, colours and blocked ProSim commands', () => {
  for (const t of ['check', 'info', 'numeric', 'esa_mains', 'esa_pe', 'esa_ins', 'esa_encl', 'esa_earthl', 'esa_pat', 'esa_map', 'ps_nsr', 'ps_spo2', 'ps_gauge', 'ps_custom']) assert.ok(vocab.types[t], t)
  assert.equal(vocab.types.esa_pe, 'esa'); assert.equal(vocab.types.ps_nsr, 'ps'); assert.equal(vocab.types.check, 'manual')
  assert.deepEqual(vocab.leads, ['RA', 'LA', 'LL', 'RL', 'V1'])
  assert.deepEqual(vocab.insTargets.slice().sort(), ['APINS', 'AP_NE', 'MAINS_AP', 'MAINS_NE', 'MINS'])
  assert.ok(vocab.conds.includes('NC') && vocab.conds.includes('OE'))
  assert.ok(vocab.colours.includes('teal'))
  assert.ok(vocab.psBlock.includes('RESET') && vocab.psBlock.includes('ZPRESS'))
})

test('every template in the repo passes the checker with no error and no warning', () => {
  for (const f of files) { const r = checkTemplateFile(join(dir, f), vocab); assert.deepEqual(r.errors, [], f); assert.deepEqual(r.warnings, [], f) }
})

test('the blank starters are valid, and only unfinished text is left to do', () => {
  for (const kind of KINDS) {
    const t = blankTemplate({ kind, name: `Start ${kind}` }), r = check(t)
    assert.deepEqual(r.errors, [], kind)
    assert.equal(r.warnings.length, 1, kind); assert.match(r.warnings[0], /TODO/)
    const esa = t.steps.filter((s) => s.type.startsWith('esa_')).map((s) => s.type)
    assert.equal(esa[0], 'esa_mains', kind)
    assert.equal(t.steps[0].id, 'visual', kind)
    assert.ok(t.dut.includes('Testing engineer') && t.dut.includes('Testing company'), kind)
  }
  assert.deepEqual(blankTemplate({ kind: 'class2', name: 'a' }).steps.map((s) => s.type), ['check', 'esa_mains', 'esa_ins', 'check'], 'Class II: no earth, touch or earth leakage')
  assert.ok(!blankTemplate({ kind: 'class1', name: 'a' }).steps.some((s) => s.type === 'esa_pat' || s.type === 'esa_map'), 'Class I: nothing applied to a patient')
  const ap = blankTemplate({ kind: 'applied', name: 'a', apClass: 'BF', apName: 'ECG' })
  assert.deepEqual(ap.appliedParts.map((g) => [g.name, g.apclass, g.leads]), [['ECG', 'BF', ['RA']]])
  assert.ok(ap.steps.some((s) => s.type === 'esa_pat') && ap.steps.some((s) => s.type === 'esa_map'))
  assert.throws(() => blankTemplate({ kind: 'nope', name: 'a' })); assert.throws(() => blankTemplate({ name: 'a', apClass: 'X' }))
  const finishedOk = check(finished()); assert.deepEqual(finishedOk, { errors: [], warnings: [] }, 'with the TODOs written the starter is clean')
})

test('the checker catches the problems the bench would silently drop or that already happened', () => {
  const bad = (edit, re, level = 'errors') => { const t = finished(); edit(t); const r = check(t); assert.ok(r[level].some((m) => re.test(m)), `${re}: ${JSON.stringify(r)}`) }
  bad((t) => { t.steps[1].type = 'esa_mainz' }, /not one the bench has/)
  bad((t) => { t.steps[2].id = t.steps[1].id }, /id is used twice/)
  bad((t) => { delete t.steps[2].id }, /has no id/)
  bad((t) => { t.appliedParts[0].leads = ['RA', 'XX'] }, /lead "XX"/)
  bad((t) => { t.appliedParts[0].apclass = 'C' }, /apclass/)
  bad((t) => { t.appliedParts = [] }, /needs applied parts/)
  bad((t) => { t.steps.find((s) => s.id === 'earthl').params.conds[0].hi = 500 }, /earth leakage NC should be 5000/)
  bad((t) => { t.steps.find((s) => s.id === 'pe').params.hi = 1 }, /over 0\.2 ohm/)
  bad((t) => { t.steps.find((s) => s.id === 'ins-mins').params.lo = '' }, /at least 1 MΩ/)
  bad((t) => { t.steps.find((s) => s.id === 'ins-ap-ne').params.target = 'MINS' }, /twice/)
  bad((t) => { t.steps.splice(5, 0, { id: 'mid', type: 'check', title: 'Mid', instructions: '', images: [], hold: 0, params: { items: ['x'] } }) }, /one block/)
  bad((t) => { t.steps[0].models = ['D60'] }, /fewer than two/)
  bad((t) => { t.models = ['D30', 'D60']; t.steps[0].models = ['D90'] }, /model "D90"/)
  bad((t) => { t.steps[0].params.items = [] }, /nothing to check/)
  bad((t) => { t.steps[0].params.readings = [{ label: 'Flow', unit: 'ml/min', lo: '', hi: '' }] }, /no limit/)
  bad((t) => { t.steps.push({ id: 'ps', type: 'ps_custom', title: 'Custom', instructions: '', images: [], hold: 0, params: { text: 'NSRA=080\nreset' } }) }, /RESET is blocked/)
  bad((t) => { t.dut = ['Model'] }, /Serial number/)
  bad((t) => { t.dut = ['Serial number', 'Model'] }, /Testing engineer/)
  bad((t) => { t.desc = '' }, /no description/)
  bad((t) => { t.color = 'chartreuse' }, /color/)
  bad((t) => { t.steps.find((s) => s.id === 'encl').params.conds[0].hi = 250 }, /enclosure NC limit is 250/, 'warnings')
  bad((t) => { t.sholdNA = true }, /unknown template field "sholdNA"/, 'warnings')
  bad((t) => { t.steps[0].titel = 'x' }, /unknown field "titel"/, 'warnings')
  bad((t) => { t.steps[1].title = t.steps[0].title }, /same title/, 'warnings')
  assert.deepEqual(check({}, 'x.json').errors.length > 0, true)
  assert.match(checkTemplate(null, 'x.json', vocab).errors[0], /not a template/)
})

test('older templates get the structure checks only', () => {
  const t = finished(); t.steps.find((s) => s.id === 'earthl').params.conds[0].hi = 500; delete t.steps[2].id
  assert.ok(checkTemplate(wrap(t), 'New.json', vocab).errors.length)
  assert.deepEqual(checkTemplate(wrap(t), 'Mindray A7 Anaesthetic Machine - Test Bench template.json', vocab).errors, [])
  t.steps[1].type = 'esa_mainz'
  assert.ok(checkTemplate(wrap(t), 'Mindray A7 Anaesthetic Machine - Test Bench template.json', vocab).errors.length, 'an unknown step type is an error for old templates too')
})

test('text that looks like patient information is warned about without being quoted', () => {
  const t = finished(); t.steps[0].params.items.push('Patient ABC1234 was at jane.doe@example.org')
  const r = check(t), all = r.warnings.join(' | ')
  assert.match(all, /NHI/); assert.match(all, /email/)
  assert.ok(!/ABC1234|jane\.doe/.test(JSON.stringify(r)), 'the message never repeats it')
})

test('a file that is not JSON is one clear error', () => {
  const d = mkdtempSync(join(tmpdir(), 'tpl-')); try { writeFileSync(join(d, 'bad.json'), '{ nope'); const r = checkTemplateFile(join(d, 'bad.json'), vocab); assert.equal(r.errors.length, 1); assert.match(r.errors[0], /not valid JSON/) } finally { rmSync(d, { recursive: true, force: true }) }
})

test('copying a template keeps its steps and their ids but not its identity, and asks for a description', () => {
  const src = findTemplate('R700').json.template
  const t = copyTemplate({ ...src, id: 'abc', updated: 1, shared: { file: 'x' }, sharedDirty: true }, { name: 'Mindray N22 Patient Monitor', manufacturer: 'Mindray' })
  for (const k of ['id', 'updated', 'shared', 'sharedDirty', 'sharedConflict']) assert.ok(!(k in t), k)
  assert.equal(t.name, 'Mindray N22 Patient Monitor'); assert.match(t.desc, /TODO/); assert.ok(t.desc.includes(src.name))
  assert.deepEqual(t.steps.map((s) => s.id), src.steps.map((s) => s.id))
  assert.notEqual(t.steps, src.steps, 'a copy, not the same list')
  const r = check(t); assert.deepEqual(r.errors, []); assert.equal(r.warnings.length, 1)
})

test('finding a template to copy: one match, or an error that lists them', () => {
  assert.match(findTemplate('R700').file, /R700/)
  assert.ok(findTemplate('mindray ibp module (n1, n17 series)').file.includes('IBP Module'), 'by template name, any case')
  assert.throws(() => findTemplate('Mindray'), /matches \d+ templates/)
  assert.throws(() => findTemplate('no such device'), /no template matches/)
})

test('file names: the usual suffix, and nothing Windows refuses', () => {
  assert.equal(fileNameFor('Mindray D30 / D60 Defibrillator'), 'Mindray D30 - D60 Defibrillator - Test Bench template.json')
  assert.equal(fileNameFor('Radical-7: “Pro”?'), 'Radical-7 “Pro” - Test Bench template.json')
  assert.throws(() => fileNameFor('  '))
})

test('new-template.mjs writes a file the checker reads, and won’t overwrite one', () => {
  const d = mkdtempSync(join(tmpdir(), 'tpl-'))
  try {
    const run = (...a) => spawnSync(process.execPath, [join(tools, 'new-template.mjs'), ...a], { encoding: 'utf8' })
    const r = run('--name', 'Test Device 9', '--kind', 'class1', '--manufacturer', 'Acme', '--models', 'A9, B9', '--out', d)
    assert.equal(r.status, 0, r.stdout + r.stderr)
    const [f] = readdirSync(d); assert.equal(f, 'Test Device 9 - Test Bench template.json')
    const j = JSON.parse(readFileSync(join(d, f), 'utf8'))
    assert.equal(j.format, 'chs-test-bench-template'); assert.equal(j.template.manufacturer, 'Acme'); assert.deepEqual(j.template.models, ['A9', 'B9'])
    assert.equal(readFileSync(join(d, f), 'utf8'), serialise(j.template), 'the same layout as the generators write')
    assert.equal(run('--name', 'Test Device 9', '--out', d).status, 2, 'refuses to overwrite')
    assert.equal(run('--name', 'Test Device 9', '--out', d, '--force').status, 0)
    assert.equal(run('--out', d).status, 2, 'needs a name')
    assert.equal(run('--name', 'Z', '--kind', 'nope', '--out', d).status, 2)
    const c = spawnSync(process.execPath, [join(tools, 'check-templates.mjs'), d], { encoding: 'utf8' })
    assert.equal(c.status, 0, c.stdout); assert.match(c.stdout, /TODO/); assert.match(c.stdout, /0 with errors/)
    assert.equal(spawnSync(process.execPath, [join(tools, 'check-templates.mjs'), d, '--strict'], { encoding: 'utf8' }).status, 1, '--strict fails on a warning')
    assert.equal(spawnSync(process.execPath, [join(tools, 'check-templates.mjs')], { encoding: 'utf8' }).status, 0, 'the repo templates pass')
  } finally { rmSync(d, { recursive: true, force: true }) }
})
