// npm test -w apps/equipment — kits offered by model (model.js kitFor): any device of a trigger's model starts
// the kit; each accessory model offers every unit of it, the kit's own ticked first when free.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kitFor, modelKey, unitsOfModel } from '../src/model.js'

const unit = (no, Model, o = {}) => ({ id: 'id' + no, CHSAssetNo: no, Model, Returned: 'Yes', OnLoanTo: '', ...o })
const out = (to, start, end) => ({ OnLoanTo: to, Returned: 'No', LoanStartDate: start, LoanEndDate: end })
const when = { startDate: '2026-11-24', endDate: '2026-11-30', today: '2026-11-24' }

// Three EP30s, each in its own kit with its own ES30 and charger; one EP30 in no kit.
const eq = [
  unit('131', 'EP30'), unit('132', 'ES30'), unit('130', 'mWear Charger'),
  unit('446', 'EP30'), unit('447', 'ES30', out('Hutt', '2026-11-01', '2026-12-05')), unit('445', 'mWear Charger'),
  unit('124', 'EP30'), unit('122', 'ES30'), unit('121', 'mWear Charger'),
  unit('900', 'EP30'),
  unit('176', 'A9'), unit('419', 'A9'), unit('071', 'A9 V90 Sevoflurane'), unit('178', 'A9 V90 Sevoflurane', out('Grace', '2026-12-10', '2026-12-20')),
  unit('356', 'A9 V90 Sevoflurane', out('Grace', '2026-11-26', '2026-12-20')),
]
const kits = {
  ep1: { label: 'EP30 #1', triggers: ['131'], accessories: [{ assetNo: '132', model: 'ES30' }, { assetNo: '130', model: 'mWear Charger' }] },
  ep2: { label: 'EP30 #2', triggers: ['446'], accessories: [{ assetNo: '447', model: 'ES30' }, { assetNo: '445', model: 'mWear Charger' }] },
  ep3: { label: 'EP30 #3', triggers: ['124'], accessories: [{ assetNo: '122', model: 'ES30' }, { assetNo: '121', model: 'mWear Charger' }] },
  a9: { label: 'A9 Anesthesia Machine', triggers: ['176'], accessories: [{ assetNo: '071', model: 'A9 V90 Sevoflurane' }] },
}
const rows = (k) => Object.fromEntries(k.models.map((m) => [m.model, { need: m.need, units: m.units.map((u) => `${u.no}:${u.status}${u.own ? '*' : ''}`), pick: m.pick }]))

test('models compare ignoring case, spaces and dashes', () => {
  assert.equal(modelKey('SP5-1S'), modelKey('sp5 1s'))
  assert.notEqual(modelKey('L18-6m'), modelKey('Mindray L18-6m'))
  assert.deepEqual(unitsOfModel(eq, 'ep30').map((e) => e.CHSAssetNo), ['131', '446', '124', '900'])
})

test('a device in its own kit: every unit of each accessory model, its own ticked when free', () => {
  const k = kitFor(kits, eq, '131', ['131'], when)
  assert.equal(k.label, 'EP30 #1')
  assert.equal(k.own, true)
  assert.deepEqual(rows(k), {
    ES30: { need: 1, units: ['132:free*', '122:free', '447:out'], pick: ['132'] },
    'mWear Charger': { need: 1, units: ['130:free*', '121:free', '445:free'], pick: ['130'] },
  })
})

test('its own unit out: another unit of the model is offered, none ticked for the person', () => {
  const k = kitFor(kits, eq, '446', ['446'], when)
  assert.deepEqual(rows(k).ES30, { need: 1, units: ['122:free', '132:free', '447:out*'], pick: [] })
  assert.deepEqual(rows(k)['mWear Charger'].pick, ['445'])
})

test('a device of a trigger model in no kit gets what those kits have, nothing ticked', () => {
  const k = kitFor(kits, eq, '900', ['900'], when)
  assert.equal(k.own, false)
  assert.equal(k.label, 'EP30', 'several kits matched: named by the model')
  assert.deepEqual(Object.keys(rows(k)), ['ES30', 'mWear Charger'])
  assert.ok(k.models.every((m) => m.need === 1 && m.pick.length === 0))
  // The second A9 starts the A9 kit too, under the kit's own name.
  const a9 = kitFor(kits, eq, '419', ['419'], when)
  assert.equal(a9.label, 'A9 Anesthesia Machine')
  assert.deepEqual(rows(a9)['A9 V90 Sevoflurane'], { need: 1, units: ['071:free', '178:free', '356:out'], pick: [] })
  assert.equal(kitFor(kits, eq, '071', ['071'], when), null, 'an accessory starts nothing')
})

test('booked after this loan is free for it; one already waited for on these dates is a clash', () => {
  const a9 = kitFor(kits, eq, '176', ['176'], when)
  const sevo = a9.models[0].units
  assert.deepEqual(sevo.map((u) => [u.no, u.status, u.will]), [['071', 'free', 'now'], ['178', 'free', 'reclaim'], ['356', 'out', 'follow']])
  const upcoming = [{ id: 'batch_1', loanTo: 'Wakefield', startDate: '2026-11-25', endDate: '2026-11-27', items: [{ id: 'id071', CHSAssetNo: '071' }] }]
  const k = kitFor(kits, eq, '176', ['176'], { ...when, upcoming })
  assert.deepEqual(k.models[0].units.map((u) => [u.no, u.status]), [['178', 'free'], ['071', 'clash'], ['356', 'out']])
  assert.deepEqual(k.models[0].pick, [], 'its own unit has a clash: not ticked')
})

test('how many are still wanted: one set per trigger of the model on the loan, less those already on it', () => {
  // Two EP30s on the loan and one ES30 already: one more ES30 and two chargers wanted.
  const k = kitFor(kits, eq, '446', ['131', '132', '446'], when)
  assert.deepEqual(k.models.map((m) => [m.model, m.need]), [['ES30', 1], ['mWear Charger', 2]])
  assert.ok(!k.models[0].units.some((u) => u.no === '132'), 'one already picked is not offered again')
  // An ES30 already on it for the one EP30: nothing more of that model.
  assert.equal(kitFor(kits, eq, '131', ['122', '131'], when).models[0].need, 0)
})

test('a kit counts the same model twice; a lost accessory with no units says so', () => {
  const k2 = { two: { label: 'Two vaporisers', triggers: ['176'], accessories: [{ assetNo: '071' }, { assetNo: '178' }, { assetNo: 'x1', model: 'Old probe' }] } }
  const k = kitFor(k2, eq, '176', ['176'], when)
  assert.deepEqual(k.models.map((m) => [m.model, m.qty, m.need, m.pick]), [['A9 V90 Sevoflurane', 2, 2, ['071', '178']], ['Old probe', 1, 1, []]])
  assert.deepEqual(k.models[1].units, [])
})
