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
    customersPath(3, '', 1, 0), customersPath(3, 'mid central', 2, 1), customersPath(3, 'Ben & Jerry’s', 3, 0),
    '/companies/3/customers/companies/12?columns=ID,Sites',
    '/companies/3/customers/individuals/12?columns=ID,Sites,Archived',
    '/companies/3/sites/?Customers.ID=12&columns=ID,Name,Customers,Archived&orderby=Name&pageSize=250',
    '/companies/3/setup/accounts/costCenters/?pageSize=250',
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

test('the customers LIST only returns the picker’s own columns: nothing record-level (banking, contacts) can be asked for', () => {
  const base = '/companies/3/customers/'
  const ok = 'columns=ID,Type,CompanyName,GivenName,FamilyName&pageSize=30'
  assert.equal(allowed('get', base + '?' + ok), true)
  assert.equal(allowed('get', base + '?' + ok + '&orderby=CompanyName&search=any&CompanyName=%25a%25&GivenName=%25a%25&FamilyName=%25a%25&page=2'), true)
  for (const bad of [
    'columns=ID,Banking', 'columns=ID,Contacts', 'columns=ID,CompanyName,Banking', 'columns=Banking', 'columns=ID,Sites',
    'columns=ID&columns=ID,Banking', 'columns=ID,Banking&columns=ID',           // a repeat can't smuggle one in either
    'columns=ID,CompanyName,', 'columns=ID,,CompanyName', 'columns=id,CompanyName', 'columns=ID,companyname',
    'pageSize=30',                                                              // no columns at all
    'pageSize=30&search=any&CompanyName=%25a%25',                               // still none
    ok + '&Banking=%25a%25', ok + '&Contacts.Email=%25a%25', ok + '&orderby=Banking', ok + '&orderby=-Banking', ok + '&display=all', ok + '&x=1',
    ok + '&CompanyName=%25a/b%25', ok + '&CompanyName=a;b', ok + '&CompanyName=#',
    '',
  ]) assert.equal(allowed('get', base + (bad ? '?' + bad : '')), false, 'customers list: ' + (bad || '(no query)'))
  // The per-type lists are not offered at all.
  for (const p of ['/companies/3/customers/companies/', '/companies/3/customers/individuals/']) {
    assert.equal(allowed('get', p + '?' + ok), false, p)
    assert.equal(allowed('get', p + '?columns=ID,Banking'), false, p)
  }
})

test('the sites list: paging as before, the form’s customer filter, and no other column or filter', () => {
  assert.equal(allowed('get', '/companies/3/sites/'), true)
  assert.equal(allowed('get', '/companies/3/sites/?pageSize=250&page=2'), true)       // SimproSync
  assert.equal(allowed('get', '/companies/3/sites/?Customers.ID=12&columns=ID,Name,Customers,Archived&orderby=Name&pageSize=250'), true)
  for (const bad of ['columns=ID,PrivateNotes', 'columns=PrivateNotes', 'columns=ID,BillingContact', 'columns=ID,Name,Rates', 'PrivateNotes=%25a%25', 'Customers.ID=a', 'orderby=PrivateNotes', 'search=any', 'Name=%25a%25', 'columns=ID&columns=ID,PrivateNotes']) {
    assert.equal(allowed('get', '/companies/3/sites/?' + bad), false, 'sites: ' + bad)
  }
})

test('the setup lists take paging and nothing else; response times are not read at all (priority is a custom field)', () => {
  assert.equal(allowed('get', '/companies/3/setup/responseTimes/'), false)
  assert.equal(allowed('get', '/companies/3/setup/responseTimes/?pageSize=250'), false)
  for (const p of ['/companies/3/setup/accounts/costCenters/', '/companies/3/setup/customFields/projects/', '/companies/3/setup/customFields/projects/44']) {
    assert.equal(allowed('get', p), true, p)
    assert.equal(allowed('get', p + '?pageSize=250&page=2'), true, p)
    for (const bad of ['columns=ID,Name', 'Name=%25a%25', 'search=any', 'orderby=Name', 'pageSize=abc', 'x=1']) assert.equal(allowed('get', p + '?' + bad), false, p + ' ' + bad)
  }
})

test('a filter value is only letters, digits, . - _ , %20 and %25: an encoded & or = can never ride inside one', () => {
  const ok = 'columns=ID,Type,CompanyName,GivenName,FamilyName&pageSize=30'
  for (const field of ['CompanyName', 'GivenName', 'FamilyName']) {
    assert.equal(allowed('get', `/companies/3/customers/?${ok}&${field}=%25mid%20central%25`), true, field)
    for (const bad of ['a%26columns%3DBanking%26x', 'a%26b', 'a%3Db', 'a%2Cb', 'a%27b', 'a%0Ab', 'a%00b', 'a%2f', 'a%C4%81', 'a+b', 'a b', 'a%2', 'a%', 'a%25%', '']) {
      assert.equal(allowed('get', `/companies/3/customers/?${ok}&${field}=${bad}`), false, field + '=' + bad)
    }
  }
  // Every search the page can build (whatever is typed) gets through, because the page turns the odd characters into wildcards.
  for (const typed of ['Ben & Jerry’s', 'Māori Health', 'x=1&columns=Banking', '100%', 'a\nb', '日本語', 'St. Mary-Ann_2', 'x'.repeat(500)]) {
    assert.equal(allowed('get', customersPath(3, typed, 1, 0)), true, typed.slice(0, 20))
    assert.equal(allowed('get', customersPath(3, typed, 2, 1)), true, typed.slice(0, 20))
  }
})
