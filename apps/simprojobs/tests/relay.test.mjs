// What the Simpro relay (backend/apps-script/proxy/Code.js) lets through for Simpro Jobs: this loads the real file, so the test
// fails if the allowlist and the page ever drift apart. Run: cd apps/simprojobs && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { customersPath } from '../src/lookups.js'

const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
const ctx = vm.createContext({ console, Logger: { log() {} } })
vm.runInContext(source, ctx)
const allowed = (method, path) => vm.runInContext(`simproSyncAllowed_(${JSON.stringify(method)}, ${JSON.stringify(path)})`, ctx)

test('the new-job form’s reads are allowed', () => {
  for (const path of [
    customersPath(3, '', 1, 0), customersPath(3, 'mid central', 2, 1), customersPath(3, 'mid', 1, 2),
    '/companies/3/customers/companies/12?columns=ID,Sites',
    '/companies/3/customers/individuals/12?columns=ID,Sites,Archived',
    '/companies/3/sites/?Customers.ID=12&columns=ID,Name,Customers,Archived&orderby=Name&pageSize=250',
    '/companies/3/setup/accounts/costCenters/?pageSize=250',
    '/companies/3/setup/responseTimes/?pageSize=250',
    '/companies/3/setup/customFields/projects/?pageSize=250',
    '/companies/3/setup/customFields/projects/44',
  ]) assert.equal(allowed('get', path), true, path)
})

test('a customer’s own record is only readable for its sites', () => {
  assert.equal(allowed('get', '/companies/3/customers/companies/12'), false)                         // the whole record: banking, contacts
  assert.equal(allowed('get', '/companies/3/customers/companies/12?columns=ID,Banking'), false)
  assert.equal(allowed('get', '/companies/3/customers/companies/12?columns=ID,Sites,Banking'), false)
  assert.equal(allowed('get', '/companies/3/customers/12?columns=ID,Sites'), false)                  // no such route
})

test('nothing new can be written, and nothing else under setup or customers opens up', () => {
  for (const method of ['post', 'patch', 'put', 'delete']) {
    for (const path of ['/companies/3/customers/', '/companies/3/customers/companies/12', '/companies/3/setup/responseTimes/', '/companies/3/setup/accounts/costCenters/', '/companies/3/setup/customFields/projects/44', '/companies/3/sites/']) {
      assert.equal(allowed(method, path), false, method + ' ' + path)
    }
  }
  for (const path of ['/companies/3/setup/labor/payRates/', '/companies/3/setup/customFields/employees/', '/companies/3/customers/12/contacts/', '/companies/3/customers/12/statements/invoices/', '/companies/3/employees/', '/companies/3/setup/accounts/chartOfAccounts/']) {
    assert.equal(allowed('get', path), false, path)
  }
})

test('the query policy still stops a query from restructuring the address', () => {
  assert.equal(allowed('get', '/companies/3/customers/?CompanyName=%25a%25&x=/../other'), false)
  assert.equal(allowed('get', '/companies/3/sites/?Name=a#b'), false)
})

test('what was already allowed still is, and sites keep working with a plain query', () => {
  assert.equal(allowed('get', '/companies/'), true)
  assert.equal(allowed('get', '/companies/3/sites/?pageSize=250&page=2'), true)
  assert.equal(allowed('get', '/companies/3/jobs/?Description=%25a%25&columns=ID'), true)
  assert.equal(allowed('patch', '/companies/3/jobs/123'), true)
  assert.equal(allowed('delete', '/companies/3/sites/7/assets/9'), true) // the relay then asks for the admin role
})
