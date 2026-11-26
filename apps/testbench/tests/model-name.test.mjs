// npm test --prefix apps/testbench — device models match however the spaces, hyphens and capitals were written (src/model-name.js for orders,
// Layout.modelWords for the bench's template finder), and models that really are different are not run together.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, readdirSync } from 'node:fs'
import { modelContains, modelId, modelWords, sameModel, uniqueModels } from '../src/model-name.js'
import { modelKey, progress, rowsToExpected } from '../src/orders.js'

// The Mindray model list Jonathan gave (monitors, accessories and screens, modules).
const MONITORS = ['BeneHeart R12', 'BP 10', 'BP 20', 'EP30', 'ePM 10', 'ePM 12', 'ePM 12M', 'ePM 15', 'ES30', 'iMec 10', 'N1', 'N1 Ultimate', 'N12', 'N15', 'N17', 'N19 CPU', 'N22 CPU', 'PM-60', 'TM80 II', 'uMec12', 'VS600', 'VS8', 'VS9', 'VS900', 'Defib N1', 'T8', 'BeneHeart R700', 'SV70', 'V200', 'V700', 'VMAX', 'VP10', 'T1', 'TM80 I', 'V500', 'BeneHeart R3']
const ACCESSORIES = ['27MK430', 'Central Charger', 'Elo ET1919LM', 'Elo ET2203LM', 'Exergen Thermometer', 'LG 32GN650', 'N1 Handle', 'N1 TDS', 'N1 Transport Dock', 'N19 Screen Primary', 'N19 Screen Secondary', 'N22 Screen Primary', 'N22 Screen Secondary', 'P2419H', 'PM-60 Charger', 'SMR', 'T1 Handle', 'T1 TDS', 'TM80 Battery', 'TrueTymp Thermometer', 'TrueTymp Cradle', 'M203dn', 'BatteryFeed 20', 'MR6502 Internal Defib Paddles', 'PowerBay 2X', 'DOCK-DEFIB', '32ML600M']
const MODULES = ['A9 Desflurane', 'A9 Isoflurane', 'A9 Sevoflurane', 'aEEG', 'AG + O2', 'AG + O2/BIS', 'Benelink', 'BIS', 'C.O.', 'CCO', 'CCO/SvO2', 'CO2 + O2', 'CO2 Mainstream', 'CO2 Microstream', 'CO2 Sidestream', 'Dummy Module', 'EEG', 'e-Link', 'IBP', 'INVOS rSO2', 'MPM Platinum', 'NMT', 'PICCO', 'R20', 'RM', 'SPO2 Masimo', 'SPO2 Mindray', 'V60 Sevoflurane QuikFil', 'Mainstream Sensor', 'Benelink ID Adapter']
const ALL = [...MONITORS, ...ACCESSORIES, ...MODULES]

// Spellings people use for one model.
const SAME = [
  ['VS600', 'VS 600', 'VS-600', 'vs600', 'Vs 600', ' VS  -600 '],
  ['BeneHeart R12', 'BeneHeart R 12', 'Beneheart-R12', 'BeneHeart R-12', 'beneheart r12'],
  ['PM-60', 'PM60', 'PM 60', 'pm-60'],
  ['TM80 II', 'TM80II', 'TM80-II', 'tm80 ii'],
  ['ePM 12M', 'ePM12M', 'ePM-12M', 'EPM 12 M'],
]
// Models that must stay different from each other, in whatever spelling.
const DIFFERENT = [['N1', 'N12', 'N1 Ultimate', 'N15', 'N17'], ['T1', 'T8', 'TM80 I', 'TM80 II', 'T1 Handle'], ['ePM 10', 'ePM 12', 'ePM 12M', 'ePM 15'], ['VS8', 'VS9', 'VS600', 'VS900'], ['PM-60', 'PM-60 Charger'], ['BeneHeart R12', 'BeneHeart R3', 'BeneHeart R700'], ['CO2 Mainstream', 'CO2 Microstream', 'CO2 Sidestream']]

test('one model, any spelling: spaces, hyphens and capitals do not tell models apart', () => {
  for (const g of SAME) for (const a of g) for (const b of g) assert.ok(sameModel(a, b) && modelId(a) === modelId(b), `${a} = ${b}`)
  assert.equal(modelId('VS-600'), 'vs600'); assert.deepEqual(modelWords('BeneHeart R-12'), ['beneheart', 'r', '12'])
  assert.ok(!sameModel('', '') && !sameModel('-', ' '), 'nothing is not a model')
})

test('different models stay different, in every spelling', () => {
  for (const g of DIFFERENT) for (const a of g) for (const b of g) if (a !== b) {
    for (const x of [a, a.replace(/ /g, ''), a.replace(/ /g, '-')]) for (const y of [b, b.replace(/ /g, ''), b.replace(/ /g, '-')]) assert.ok(!sameModel(x, y), `${x} is not ${y}`)
  }
  const ids = ALL.map(modelId)
  assert.equal(new Set(ids).size, ids.length, 'no two names in the whole Mindray list run together once spaces and hyphens are ignored')
})

test('a tested model contains the wanted one as whole words, however either is spelled; never as part of a word', () => {
  assert.ok(modelContains('BeneHeart D30', 'D30') && modelContains('BeneHeart D30', 'D 30') && modelContains('BeneHeart D 30', 'd-30') && modelContains('Mindray VS 600 Monitor', 'VS600'))
  assert.ok(modelContains('Mindray VS-600', 'VS600') && modelContains('VS600', 'VS 600') && modelContains('Beneheart-R12', 'BeneHeart R 12') && modelContains('PM60', 'PM-60'))
  assert.ok(!modelContains('N12', 'N1') && !modelContains('N 12', 'N1') && !modelContains('N1', 'N12') && !modelContains('N15', 'N1') && !modelContains('N1 Ultimate', 'N12'))
  assert.ok(!modelContains('TM80 II', 'TM80 I') && !modelContains('TM80II', 'TM80 I') && !modelContains('TM80-I', 'TM80 II') && modelContains('TM80 II', 'TM80II') && modelContains('TM80 I', 'TM80-I'))
  assert.ok(!modelContains('ePM 12M', 'ePM 12') && !modelContains('ePM12M', 'ePM12') && !modelContains('T8', 'T1') && !modelContains('TM80 I', 'T1') && !modelContains('VS9', 'VS900') && !modelContains('VS900', 'VS9'))
  assert.ok(!modelContains('', 'VS600') && !modelContains('VS600', '') && !modelContains('', ''))
  // across the whole Mindray list, what contains what:
  const inside = (b) => ALL.filter((a) => a !== b && modelContains(a, b))
  assert.deepEqual(inside('N1'), ['N1 Ultimate', 'Defib N1', 'N1 Handle', 'N1 TDS', 'N1 Transport Dock'], 'N1: its own variants and accessories, never N12, N15, N17, N19 or N22')
  assert.deepEqual(inside('T1'), ['T1 Handle', 'T1 TDS'])
  assert.deepEqual(inside('TM80 I'), [], 'TM80 I is not inside TM80 II')
  assert.deepEqual(inside('ePM 12'), [], 'ePM 12 is not inside ePM 12M')
})

test('an order counts a test for its model whatever spelling the test was made with', () => {
  const order = { number: '1', customer: 'X', expected: { VS600: 3, N1: 1, 'TM80 I': 1 }, since: '' }
  assert.equal(modelKey(order, 'VS 600'), 'VS600'); assert.equal(modelKey(order, 'Mindray VS-600'), 'VS600'); assert.equal(modelKey(order, 'vs600'), 'VS600')
  assert.equal(modelKey(order, 'N12'), null, 'N12 is not N1'); assert.equal(modelKey(order, 'TM80 II'), null, 'TM80 II is not TM80 I'); assert.equal(modelKey(order, 'TM80-I'), 'TM80 I')
  const t = (id, model) => ({ id, serial: 'S' + id, model, overall: 'pass', finished: '2026-11-27T01:00:00Z', customer: 'X' })
  const p = progress(order, [t(1, 'VS600'), t(2, 'VS 600'), t(3, 'VS-600'), t(4, 'N12')])
  assert.equal(p.rows.find((r) => r.model === 'VS600').tested, 3, 'the three spellings are three VS600s')
  assert.equal(p.other.length, 1, 'the N12 is not on this order')
  // a longer expected name wins over a shorter one it contains, however spelled
  assert.equal(modelKey({ expected: { N1: 1, 'N1 Ultimate': 1 } }, 'Mindray N1-Ultimate'), 'N1 Ultimate')
  // two rows of one model written differently add up
  assert.deepEqual(rowsToExpected([{ model: 'VS600', qty: '2' }, { model: 'VS 600', qty: '3' }, { model: 'N1', qty: '1' }]).expected, { VS600: 5, N1: 1 })
  assert.deepEqual(uniqueModels(['VS600', 'VS 600', 'vs-600', 'N1']), ['VS600', 'N1'], 'suggestions list a model once')
})

test('the bench finds the same template for every spelling of a model, and different ones for different models', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const a = html.indexOf('const CATEGORIES'), b = html.indexOf('/** Build a clean Test Bench template')
  const L = vm.runInNewContext('const DB = {}, clone = (o) => JSON.parse(JSON.stringify(o)); ' + html.slice(a, b) + '; ({ Layout })').Layout
  const dir = new URL('../templates/', import.meta.url)
  const list = readdirSync(dir).filter((n) => n.endsWith('.json') && !n.startsWith('_')).map((n) => JSON.parse(readFileSync(new URL(n, dir), 'utf8')).template)
  L.data = L.clean({ items: { 'name:patient monitor and or modules': { covers: ['ePM', 'uMEC', 'N-Series', 'V-Series', 'V200', 'V500', 'V700', 'VMAX'] } } })
  const found = (m) => L.candidates(list, m).map((t) => t.name).sort().join(' | ')
  const best = (m) => (L.bestFor(list, m) || {}).name || null
  for (const g of SAME) for (const x of g) {
    assert.deepEqual(L.modelWords(x), L.modelWords(g[0]), `${x} has the same words as ${g[0]}`)
    assert.equal(found(x), found(g[0]), `${x} finds what ${g[0]} finds`)
    assert.equal(best(x), best(g[0]))
  }
  for (const m of ['VS600', 'TE5', 'D30', 'N12', 'T1', 'TM80 I', 'ePM 12M', 'A9']) for (const x of [m.replace(/ /g, ''), m.replace(/ /g, '-'), m.toLowerCase(), m.replace(/(\D)(\d)/, '$1 $2')]) assert.equal(found(x), found(m), `${x} finds what ${m} finds`)
  for (const m of ['BeneHeart D30', 'D1 Pro']) assert.equal(found(m.toLowerCase()), found(m), `${m} in lower case`)
  assert.equal(best('VS 600'), 'Mindray VS-600 / VS-900 Vital Signs Monitor')
  assert.equal(best('BeneHeart R 12'), best('BeneHeart R12'))
  assert.equal(best('TM80-I'), 'Mindray BeneVision TM80 Telemetry Monitor')
  assert.notEqual(found('TM80 I'), found('TM80 II'), 'TM80 I and TM80 II are different models')
  assert.notEqual(found('VS600'), found('D30'))
  // the two files agree on what is one model: whatever the bench reads as the same words, src/model-name.js reads as the same model
  for (const g of SAME) for (const x of g) assert.equal(L.modelWords(x).join(''), modelId(x))
})
