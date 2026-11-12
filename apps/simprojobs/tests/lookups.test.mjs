// Run: cd apps/simprojobs && npm test
// A pretend Simpro with invented customers, sites and setup lists: nothing here is real, and nothing leaves the process.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CUSTOMER_VARIANTS, PAGE_SIZE, customerKind, customerName, customersPath, friendly, likeTerm, loadCustomers, loadSetup, loadSites, pickDefault, runChecks } from '../src/lookups.js'
import { SendError, makeCall } from '../../testbench/src/simpro-api.js'

const CUSTOMERS = [
  { ID: 1, Type: 'Company', CompanyName: 'Example Hospital', GivenName: '', FamilyName: '' },
  { ID: 2, Type: 'Company', CompanyName: 'Example Aged Care', GivenName: '', FamilyName: '' },
  { ID: 3, Type: 'Individual', CompanyName: '', GivenName: 'Pat', FamilyName: 'Example' },
]
const SITES = [
  { ID: 11, Name: 'Ward 10', Customers: [{ ID: 1 }] },
  { ID: 12, Name: 'Ward 2', Customers: [{ ID: 1 }] },
  { ID: 13, Name: 'Main site', Customers: [{ ID: 2 }] },
  { ID: 14, Name: 'Old ward', Archived: true, Customers: [{ ID: 1 }] },
]
const FIELDS = [
  { ID: 44, Name: 'Job Type', Type: 'List' },
  { ID: 45, Name: 'Charge category', Type: 'List' },
  { ID: 46, Name: 'Reference', Type: 'Text' },
]
const LIST_ITEMS = { 44: ['Demo', 'Repair', 'Install'], 45: ['Chargeable', 'Warranty'] }

/**
 * opts.refuse: query words Simpro answers 400 to. opts.noSitesOnCustomer: the customer record has no Sites. opts.ignoreCustomerFilter: the site
 * list ignores Customers.ID. opts.missing: setup paths that 404. opts.blocked: the relay itself refuses (not deployed yet).
 */
function fakeSimpro(opts = {}) {
  const seen = []
  const fetchFn = async (_url, init) => {
    const { requests } = JSON.parse(init.body)
    const { method, path } = requests[0]
    seen.push({ method, path })
    if (method !== 'GET') throw new Error('a write was attempted: ' + method + ' ' + path)
    if (opts.blocked?.test(path)) return { status: 200, json: async () => ({ success: false, error: `Request 0 (GET ${path}) is not allowed` }) }
    const reply = (status, data) => ({ status: 200, json: async () => ({ success: true, results: [{ status, data }] }) })
    const [p, query = ''] = path.split('?')
    const params = Object.fromEntries(query.split('&').filter(Boolean).map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), decodeURIComponent(kv.slice(i + 1))] }))
    if (opts.refuse?.some((word) => path.includes(word))) return reply(400, { errors: [{ message: 'refused' }] })
    if (opts.missing?.test(p)) return reply(404, { errors: [{ message: 'no such thing' }] })
    let m
    if (/^\/companies\/\d+\/customers\/$/.test(p)) {
      const filt = ['CompanyName', 'GivenName', 'FamilyName'].map((k) => params[k]).filter(Boolean)
      const text = filt[0] ? filt[0].replace(/%/g, '').toLowerCase() : ''
      const hit = CUSTOMERS.filter((c) => !text || [c.CompanyName, c.GivenName, c.FamilyName].join(' ').toLowerCase().includes(text))
      const size = +params.pageSize || 30
      const page = +params.page || 1
      const many = opts.many ? Array.from({ length: opts.many }, (_, i) => ({ ID: 100 + i, Type: 'Company', CompanyName: 'Customer ' + String(100 + i) })) : hit
      return reply(200, many.slice((page - 1) * size, page * size))
    }
    if ((m = p.match(/^\/companies\/\d+\/customers\/(companies|individuals)\/$/))) return reply(200, CUSTOMERS.filter((c) => (c.Type === 'Individual') === (m[1] === 'individuals')).map(({ ID, Type, CompanyName }) => ({ ID, Type, CompanyName })))
    if ((m = p.match(/^\/companies\/\d+\/customers\/(companies|individuals)\/(\d+)$/))) {
      const c = CUSTOMERS.find((x) => x.ID === +m[2])
      if (!c) return reply(404, {})
      if (params.columns !== 'ID,Sites') throw new Error('the whole customer record was asked for')
      return reply(200, opts.noSitesOnCustomer ? { ID: c.ID } : { ID: c.ID, Sites: SITES.filter((s) => s.Customers.some((x) => x.ID === c.ID)).map(({ ID, Name, Archived }) => ({ ID, Name, Archived })) })
    }
    if (/^\/companies\/\d+\/sites\/$/.test(p)) {
      if (opts.ignoreCustomerFilter) return reply(200, SITES)
      return reply(200, SITES.filter((s) => s.Customers.some((x) => x.ID === +params['Customers.ID'])))
    }
    if (/setup\/accounts\/costCenters\/$/.test(p)) return reply(200, [{ ID: 15, Name: 'Service' }, { ID: 16, Name: 'Install' }, { ID: 17, Name: 'Old one', Archived: true }])
    if (/setup\/responseTimes\/$/.test(p)) return reply(200, [{ ID: 1, Name: 'Standard', Archived: false }, { ID: 2, Name: '24 Hours Emergency Response', Archived: false }, { ID: 3, Name: 'Retired', Archived: true }])
    if (/setup\/customFields\/projects\/$/.test(p)) return reply(200, FIELDS)
    if ((m = p.match(/setup\/customFields\/projects\/(\d+)$/))) return reply(200, { ID: +m[1], ListItems: LIST_ITEMS[m[1]] ?? null })
    return reply(404, { errors: [{ message: 'unknown path in the pretend Simpro: ' + p }] })
  }
  const call = makeCall({ getToken: async () => 'token', proxyUrl: 'https://proxy.invalid/', fetchFn })
  return { call, seen }
}
test('likeTerm wraps in wildcards and escapes what would break an address', () => {
  assert.equal(likeTerm('A&E (north)'), '%25A%26E%20%28north%29%25')
})

test('customerName and customerKind read both kinds of customer', () => {
  assert.equal(customerName(CUSTOMERS[0]), 'Example Hospital')
  assert.equal(customerName(CUSTOMERS[2]), 'Pat Example')
  assert.equal(customerName({ ID: 9 }), 'Customer 9')
  assert.equal(customerKind(CUSTOMERS[0]), 'companies')
  assert.equal(customerKind(CUSTOMERS[2]), 'individuals')
  assert.equal(customerKind({ ID: 5, GivenName: 'A' }), 'individuals')
})

test('customersPath: browse has no filter; a search filters the three name columns "any"; later ways drop what may be refused', () => {
  const browse = customersPath(3, '', 1, 0)
  assert.match(browse, /^\/companies\/3\/customers\/\?columns=ID,Type,CompanyName,GivenName,FamilyName&pageSize=30&orderby=CompanyName$/)
  const s = customersPath(3, ' mid ', 2, 0)
  assert.match(s, /page=2/)
  assert.match(s, /search=any&CompanyName=%25mid%25&GivenName=%25mid%25&FamilyName=%25mid%25$/)
  assert.doesNotMatch(customersPath(3, '', 1, 1), /orderby/)
  // Every address is something the relay's search policy lets through.
  for (const v of [0, 1]) assert.match(customersPath(3, 'Ben & Jerry’s', 2, v).split('?')[1], /^[A-Za-z0-9=&%+,.()\-_: ]*$/)
})

test('loadCustomers: browse, search, and "more" only when a full page came back', async () => {
  const { call } = fakeSimpro()
  const all = await loadCustomers(call, 3, '')
  assert.equal(all.rows.length, 3)
  assert.equal(all.more, false)
  assert.deepEqual(all.rows[2], { ID: 3, kind: 'individuals', name: 'Pat Example', individual: true })
  const found = await loadCustomers(call, 3, 'aged')
  assert.deepEqual(found.rows.map((r) => r.name), ['Example Aged Care'])
  const { call: many } = fakeSimpro({ many: 70 })
  const p1 = await loadCustomers(many, 3, '', 1)
  assert.equal(p1.rows.length, PAGE_SIZE)
  assert.equal(p1.more, true)
  const p3 = await loadCustomers(many, 3, '', 3)
  assert.equal(p3.rows.length, 10)
  assert.equal(p3.more, false)
})

test('loadCustomers tries the next way of asking when Simpro refuses one, and remembers which worked', async () => {
  const { call, seen } = fakeSimpro({ refuse: ['orderby='] })
  const r = await loadCustomers(call, 3, '', 1, 0)
  assert.equal(r.variant, 1)
  assert.equal(r.rows.length, 3)
  assert.equal(seen.length, 2)
  const next = await loadCustomers(call, 3, '', 2, r.variant)
  assert.equal(next.variant, 1)
  assert.equal(seen.length, 3) // it did not go back to the way that is refused
})

test('loadCustomers: all ways refused is an error that says what Simpro said', async () => {
  const { call } = fakeSimpro({ refuse: ['customers'] })
  await assert.rejects(() => loadCustomers(call, 3, 'x'), (e) => e instanceof SendError && /Customers: Simpro said 400/.test(e.message))
  const { call: blocked } = fakeSimpro({ blocked: /customers/ })
  await assert.rejects(() => loadCustomers(blocked, 3, ''), (e) => friendly(e).includes('new version has not been deployed'))
})

test('loadSites: a customer’s own record lists its sites; archived ones are left out, names sort the way people read them', async () => {
  const { call, seen } = fakeSimpro()
  const r = await loadSites(call, 3, { ID: 1, kind: 'companies' })
  assert.equal(r.via, 'customer')
  assert.deepEqual(r.sites.map((s) => s.name), ['Ward 2', 'Ward 10'])
  assert.equal(seen.length, 1)
  assert.deepEqual((await loadSites(call, 3, { ID: 2, kind: 'companies' })).sites, [{ id: 13, name: 'Main site' }])
})

test('loadSites: without Sites on the record it asks the site list and trusts each row’s own Customers', async () => {
  const { call } = fakeSimpro({ noSitesOnCustomer: true })
  const r = await loadSites(call, 3, { ID: 1, kind: 'companies' })
  assert.equal(r.via, 'sites')
  assert.deepEqual(r.sites.map((s) => s.id), [12, 11])
  // A filter Simpro ignores returns every site: another customer’s are not shown as this one’s.
  const { call: ignoring } = fakeSimpro({ noSitesOnCustomer: true, ignoreCustomerFilter: true })
  const only = await loadSites(ignoring, 3, { ID: 2, kind: 'companies' })
  assert.deepEqual(only.sites.map((s) => s.id), [13])
})

test('loadSetup: cost centres, priorities and the two custom fields, archived ones left out', async () => {
  const { call } = fakeSimpro()
  const s = await loadSetup(call, 3)
  assert.deepEqual(s.costCentre.options.map((o) => o.name), ['Install', 'Service'])
  assert.deepEqual(s.priority.options.map((o) => o.name), ['24 Hours Emergency Response', 'Standard'])
  assert.equal(s.jobType.field.id, 44)
  assert.deepEqual(s.jobType.options.map((o) => o.id), ['Demo', 'Repair', 'Install'])
  assert.equal(s.chargeCategory.field.id, 45)
  assert.equal(s.chargeCategory.options.length, 2)
  assert.deepEqual(s.fieldNames.map((f) => f.name), ['Job Type', 'Charge category', 'Reference'])
  assert.equal(pickDefault(s.costCentre.options, ' service ').id, 15)
  assert.equal(pickDefault(s.priority.options, 'Standard').id, 1)
  assert.equal(pickDefault(s.jobType.options, 'Repair').id, 'Repair')
  assert.equal(pickDefault(s.jobType.options, 'Nope'), null)
})

test('loadSetup: one lookup missing leaves the others working, and says which', async () => {
  const { call } = fakeSimpro({ missing: /responseTimes/ })
  const s = await loadSetup(call, 3)
  assert.match(s.priority.error, /Priorities: Simpro said 404/)
  assert.equal(s.costCentre.options.length, 2)
  assert.equal(s.jobType.options.length, 3)
})

test('loadSetup: a custom field that is not there, or is not a list, is explained rather than guessed at', async () => {
  const { call } = fakeSimpro()
  const real = FIELDS.splice(1, 1) // charge category gone
  try {
    const s = await loadSetup(call, 3)
    assert.match(s.chargeCategory.error, /No job custom field called “Charge Category”/)
    assert.equal(s.chargeCategory.field, null)
    FIELDS[0].Type = 'Text'
    const t = await loadSetup(call, 3)
    assert.match(t.jobType.error, /“Job Type” is a Text field/)
  } finally { FIELDS[0].Type = 'List'; FIELDS.splice(1, 0, ...real) }
})

test('runChecks reports each lookup in words and never prints a customer or site name', async () => {
  const { call } = fakeSimpro()
  const lines = await runChecks(call, 3)
  const text = JSON.stringify(lines)
  assert.ok(lines.every((l) => l.state === 'ok'), text)
  assert.ok(lines.some((l) => /Cost centres/.test(l.label) && /“Service” is there/.test(l.detail)))
  assert.ok(lines.some((l) => /Job type/.test(l.label) && /field “Job Type”/.test(l.detail)))
  for (const name of ['Example Hospital', 'Example Aged Care', 'Pat Example', 'Ward 2', 'Main site']) assert.ok(!text.includes(name), name + ' leaked into the checks')
  const { call: blocked } = fakeSimpro({ blocked: /customers|setup/ })
  const bad = await runChecks(blocked, 3)
  assert.ok(bad.some((l) => l.state === 'fail' && /not been deployed/.test(l.detail)))
})

test('nothing in the lookups ever writes', async () => {
  const { call, seen } = fakeSimpro()
  await loadCustomers(call, 3, 'x'); await loadSites(call, 3, { ID: 1, kind: 'companies' }); await loadSetup(call, 3); await runChecks(call, 3)
  assert.ok(seen.length > 5)
  assert.ok(seen.every((s) => s.method === 'GET'))
  assert.equal(CUSTOMER_VARIANTS, 2)
})
