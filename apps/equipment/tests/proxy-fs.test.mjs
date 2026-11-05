// npm test -w apps/equipment — the proxy's side of step 5's cutover: which Firestore place each old
// database path is, and the value conversions (read straight out of backend/apps-script/proxy/Code.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const grab = (name) => { const i = code.indexOf('function ' + name + '('); assert.ok(i >= 0, name); return code.slice(i, code.indexOf('\n}\n', i) + 3) }
const ctx = vm.createContext({})
vm.runInContext(['trackerFsPlace_', 'trackerMarkerId_', 'fsUnpack_', 'fsValue_'].map(grab).join('\n'), ctx)

test('old database paths map to their Firestore places', () => {
  const p = (path) => JSON.parse(JSON.stringify(ctx.trackerFsPlace_(path)))
  assert.deepEqual(p('/data/equipment.json'), { kind: 'equipment' })
  assert.deepEqual(p('/upcomingLoans.json'), { kind: 'bookings' })
  assert.deepEqual(p('/loanDocs/' + encodeURIComponent('loandoc_Hutt%7C%7C%7C2026-10-30') + '.json'), { kind: 'form', key: 'loandoc_Hutt%7C%7C%7C2026-10-30' })
  assert.deepEqual(p('/loanDocs/batch_1/simproJobId.json'), { kind: 'jobId', key: 'batch_1' })
  assert.deepEqual(p('/simproConfig.json'), { kind: 'simproConfig' })
  assert.deepEqual(p('/returnDueSoonReminders/' + encodeURIComponent('Hutt|||2026-10-30') + '.json'), { kind: 'marker', mark: 'returnDueSoonReminders', key: 'Hutt|||2026-10-30' })
  assert.equal(ctx.trackerMarkerId_('stuckLoanReminders', 'a/b c'), 'stuckLoanReminders__a%2Fb%20c')
})

test('values: arrays in arrays unpacked as fs-shape.js packs them; plain values to REST values', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.fsUnpack_({ savedRows: [{ _a: ['A1', 'M'] }, { _a: ['A2'] }], n: 1 }))), { savedRows: [['A1', 'M'], ['A2']], n: 1 })
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.fsValue_({ id: 209677, x: null, ok: true, f: 1.5, a: ['s'] }))), { mapValue: { fields: {
    id: { integerValue: '209677' }, x: { nullValue: null }, ok: { booleanValue: true }, f: { doubleValue: 1.5 }, a: { arrayValue: { values: [{ stringValue: 's' }] } } } } })
})

test('the team (step 5A): hub people with a tracker role, signed in only; a role other than service counts as account manager', () => {
  const c = vm.createContext({ fsList_: () => [
    { __id: 'a', displayName: 'Kiri Moana', email: 'kiri@x.nz', trackerRole: 'service' },
    { __id: 'b', displayName: 'Tama Brown', email: 'tama@x.nz', trackerRole: 'am' },
    { __id: 'c', displayName: 'Waiting', email: 'w@x.nz', trackerRole: 'am', pending: true },
    { __id: 'd', displayName: 'No Role', email: 'n@x.nz' },
    { email: 'nameless@x.nz', trackerRole: 'am' },
  ] })
  vm.runInContext('let trackerTeam__ = null;\n' + ['trackerTeam_', 'amEffectiveRole_'].map(grab).join('\n'), c)
  const team = JSON.parse(JSON.stringify(c.trackerTeam_()))
  assert.deepEqual(team, [
    { name: 'Kiri Moana', email: 'kiri@x.nz', role: 'service' },
    { name: 'Tama Brown', email: 'tama@x.nz', role: 'am' },
    { name: 'nameless@x.nz', email: 'nameless@x.nz', role: 'am' },
  ])
  assert.equal(c.amEffectiveRole_(team[0]), 'service')
  assert.equal(c.amEffectiveRole_({ name: 'Peter Lin' }), 'am', 'no hard-coded service names any more')
})
