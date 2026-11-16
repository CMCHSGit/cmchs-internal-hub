// The optional technician: Simpro's staff, matching the person signed in, and what it adds to a new job. Invented people only.
// Run: cd apps/simprojobs && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { loadStaff, matchStaff, runChecks } from '../src/lookups.js'
import { buildPlan, jobBody } from '../src/plan.js'
import { makeCall } from '../../testbench/src/simpro-api.js'

const STAFF = [
  { ID: 5, Name: 'Peter Lin', Type: 'employee', TypeId: 5 }, { ID: 6, Name: 'Alex Smith', Type: 'employee', TypeId: 6 }, { ID: 7, Name: 'Alex Smith', Type: 'employee', TypeId: 7 },
  { ID: 8, Name: 'Jonathan Nasrun', Type: 'employee', TypeId: 8 }, { ID: 9, Name: 'Zoe Contractor', Type: 'contractor', TypeId: 1 }, { ID: 10, Name: 'Crane 1', Type: 'plant', TypeId: 1 },
  { ID: 11, Name: 'Māori Tane', Type: 'employee', TypeId: 11 }, { ID: 12, Name: 'Sam Contractor', Type: 'contractor', TypeId: 2 },
]
function fakeSimpro(opts = {}) {
  const seen = []
  const fetchFn = async (_u, init) => {
    const { requests } = JSON.parse(init.body)
    const { method, path } = requests[0]
    seen.push({ method, path })
    const reply = (status, data) => ({ status: 200, json: async () => ({ success: true, results: [{ status, data }] }) })
    if (method !== 'GET') throw new Error('a write was attempted')
    if (opts.blocked) return { status: 200, json: async () => ({ success: false, error: `Request 0 (GET ${path}) is not allowed` }) }
    const [p, q = ''] = path.split('?')
    if (/\/staff\/$/.test(p)) {
      const page = +(/page=(\d+)/.exec(q)?.[1] || 1)
      const all = opts.many ? Array.from({ length: opts.many }, (_, i) => ({ ID: 1000 + i, Name: 'Person ' + String(i).padStart(4, '0'), Type: 'employee' })) : STAFF
      return reply(200, all.slice((page - 1) * 250, page * 250))
    }
    return reply(404, {})
  }
  return { call: makeCall({ getToken: async () => 't', proxyUrl: 'x', fetchFn }), seen }
}

test('staff: employees and contractors A to Z, plant left out, read in pages until the last', async () => {
  const { call, seen } = fakeSimpro()
  const staff = await loadStaff(call, 3)
  assert.deepEqual(staff.map((s) => s.name), ['Alex Smith', 'Alex Smith', 'Jonathan Nasrun', 'Māori Tane', 'Peter Lin', 'Sam Contractor', 'Zoe Contractor'])
  assert.deepEqual(staff.find((s) => s.id === 9), { id: 9, name: 'Zoe Contractor', type: 'contractor' })
  assert.equal(seen.length, 1)
  assert.match(seen[0].path, /^\/companies\/3\/staff\/\?columns=ID,Name,Type&pageSize=250$/)
  const big = fakeSimpro({ many: 520 })
  assert.equal((await loadStaff(big.call, 3)).length, 520)
  assert.deepEqual(big.seen.map((s) => /page=(\d+)/.exec(s.path)?.[1] || '1'), ['1', '2', '3'])
})

test('matching the person signed in: by their Microsoft name, else their email, and only when it is exactly one employee', async () => {
  const staff = await loadStaff(fakeSimpro().call, 3)
  const hit = (who) => matchStaff(staff, who)
  assert.deepEqual([hit({ name: 'Peter Lin' }).person.id, hit({ name: 'Peter Lin' }).how], [5, 'name'])
  assert.equal(hit({ name: 'LIN, peter' }).person.id, 5)                  // words in any order, any case
  assert.equal(hit({ name: '  Peter   Lin  ' }).person.id, 5)
  assert.equal(hit({ name: 'Maori Tane' }).person.id, 11)                 // accents ignored
  assert.equal(hit({ name: 'Māori Tane' }).person.id, 11)
  assert.deepEqual([hit({ name: '', email: 'peter.lin@example.invalid' }).person.id, hit({ name: '', email: 'peter.lin@example.invalid' }).how], [5, 'email'])
  assert.equal(hit({ name: 'P Lin', email: 'jonathan.nasrun@example.invalid' }).person.id, 8) // the name fails, the email's name part matches
  assert.equal(hit({ name: 'Jonathan', email: 'j.nasrun2@example.invalid' }), null)           // one word is not a name; "j nasrun" is not Jonathan Nasrun
  assert.equal(hit({ name: 'Alex Smith' }), null)                        // two employees with that name: no guess
  assert.equal(hit({ name: 'Zoe Contractor' }), null)                    // a contractor is never the default
  assert.equal(hit({ name: 'Crane 1' }), null)                           // plant is not in the list at all
  assert.equal(hit({ name: 'Peter' }), null)
  assert.equal(hit({ name: 'Peter Lini' }), null)                        // a near miss is not a match
  assert.equal(hit({ name: '', email: '' }), null)
  assert.equal(hit({}), null)
  assert.equal(matchStaff([], { name: 'Peter Lin' }), null)
  assert.equal(matchStaff(null, { name: 'Peter Lin' }), null)
})

test('Check Simpro says whether the person signed in was matched, with counts only', async () => {
  // The pretend Simpro has only staff, so the other lines fail and the staff line is read on its own.
  const lines = await runChecks(fakeSimpro().call, 3, { name: 'Peter Lin', email: 'peter.lin@example.invalid' })
  const staff = lines.find((l) => l.label === 'Staff (technician)')
  assert.equal(staff.state, 'ok')
  assert.match(staff.detail, /7 employees and contractors; you were found as a Simpro employee \(by your name\)/)
  assert.ok(!/Peter|Lin/.test(staff.detail))
  const stranger = (await runChecks(fakeSimpro().call, 3, { name: 'Nobody Here', email: 'x@example.invalid' })).find((l) => l.label === 'Staff (technician)')
  assert.match(stranger.detail, /not matched to one Simpro employee, so the technician starts empty/)
  const blocked = (await runChecks(fakeSimpro({ blocked: true }).call, 3, { name: 'Peter Lin' })).find((l) => l.label === 'Staff (technician)')
  assert.equal(blocked.state, 'fail')
  assert.match(blocked.detail, /not been deployed/)
})

const FORM = {
  customer: { ID: 12, kind: 'companies', name: 'Example Hospital' }, site: { id: 34, name: 'Theatre 1' }, costCentre: { id: 15, name: 'Service' },
  jobType: { id: 'Repair', name: 'Repair' }, chargeCategory: { id: 'Warranty', name: 'Warranty' }, priority: { id: 'Standard', name: 'Standard' },
  title: 'Monitor fault', description: 'Fault',
}
const SETUP = { jobType: { field: { id: 44, name: 'Job Type' } }, chargeCategory: { field: { id: 45, name: 'Charge category - CHS' } }, priority: { field: { id: 46, name: 'Priority' } } }

test('a new job carries the technician when one is chosen, shows it, and is complete without one', () => {
  assert.equal(jobBody({ ...FORM, technician: { id: 5, name: 'Peter Lin', type: 'employee' } }).Technicians, 5)
  assert.equal('Technicians' in jobBody(FORM), false)
  assert.equal('Technicians' in jobBody({ ...FORM, technician: null }), false)
  const withTech = buildPlan({ ...FORM, technician: { id: 5, name: 'Peter Lin', type: 'employee' } }, SETUP, 3)[0]
  assert.deepEqual(withTech.facts.find(([l]) => l === 'Technician'), ['Technician', 'Peter Lin'])
  assert.equal(withTech.request().body.Technicians, 5)
  const without = buildPlan(FORM, SETUP, 3)[0] // not mandatory: the plan builds
  assert.deepEqual(without.facts.find(([l]) => l === 'Technician'), ['Technician', 'None'])
})

const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
const ctx = vm.createContext({ console, Logger: { log() {} } })
vm.runInContext(source, ctx)
const J = JSON.stringify
const allowed = (m, p) => vm.runInContext(`simproSyncAllowed_(${J(m)}, ${J(p)})`, ctx)
const createWhy = (body) => vm.runInContext(`simproSyncJobWriteError_('post', '/companies/3/jobs/', ${J(body)}, 1)`, ctx)

test('the relay: the staff list is only ID, name and type; a technician on a new job is only a whole-number staff id', () => {
  const base = '/companies/3/staff/'
  for (const q of ['', '?columns=ID,Name,Type&pageSize=250', '?columns=ID,Name,Type&pageSize=250&page=2', '?pageSize=250&orderby=Name', '?Type=employee&columns=ID,Name']) assert.equal(allowed('get', base + q), true, q)
  for (const q of ['?columns=ID,Email', '?columns=ID,Name,Email', '?columns=Email', '?columns=ID,Rates', '?Email=%25a%25', '?Name=%25a%25', '?search=any', '?columns=ID&columns=ID,Email', '?x=1', '?pageSize=abc']) assert.equal(allowed('get', base + q), false, q)
  for (const p of ['/companies/3/staff/5', '/companies/3/employees/', '/companies/3/employees/5', '/companies/3/contractors/']) assert.equal(allowed('get', p), false, p)
  for (const m of ['post', 'patch', 'delete', 'put']) assert.equal(allowed(m, base), false, m)
  const good = { Type: 'Service', Customer: 12, Site: 34, Description: '<p>Fault</p>' }
  assert.equal(createWhy({ ...good, Technicians: 5 }), '')
  assert.equal(createWhy(good), '')
  for (const bad of [0, -1, 1.5, '5', null, [5], {}, true, 1e12]) assert.match(createWhy({ ...good, Technicians: bad }), /technician that is not a staff id/, J(bad))
  assert.match(createWhy({ ...good, Technician: 5 }), /field that is not allowed/) // the deprecated name is not accepted
  assert.match(createWhy({ ...good, Salesperson: 5 }), /field that is not allowed/)
  assert.match(createWhy({ ...good, ProjectManager: 5 }), /field that is not allowed/)
})
