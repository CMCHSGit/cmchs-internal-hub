// What the Simpro relay lets through when a job is made: this loads the real Code.js. Run: cd apps/simprojobs && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
const ctx = vm.createContext({ console, Logger: { log() {} } })
vm.runInContext(source, ctx)
const J = JSON.stringify
const allowed = (method, path) => vm.runInContext(`simproSyncAllowed_(${J(method)}, ${J(path)})`, ctx)
const why = (method, path, body, count = 1) => vm.runInContext(`simproSyncJobWriteError_(${J(method)}, ${J(path.split('?')[0])}, ${J(body)}, ${count})`, ctx)
/** Allowed by the path rules AND the body check: '' when the relay would send it. */
const verdict = (method, path, body, count = 1) => (allowed(method, path) ? why(method, path, body, count) : 'path not allowed')

const JOB = '/companies/3/jobs/'
const GOOD = { Type: 'Service', Customer: 12, Site: 34, Description: '<p>Fault</p>' }

test('the five steps of making a job are allowed', () => {
  assert.equal(verdict('post', JOB, GOOD), '')
  assert.equal(verdict('post', JOB, { ...GOOD, Notes: '<p>n</p>', Stage: 'Pending' }), '')
  assert.equal(verdict('post', JOB + '5001/sections/', {}), '')
  assert.equal(verdict('post', JOB + '5001/sections/77/costCenters/', { CostCenter: 15 }), '')
  assert.equal(verdict('patch', JOB + '5001/customFields/44', { Value: 'Repair' }), '')
})

test('a new job is a Service job with a customer, a site and a description, and nothing else can be set', () => {
  for (const [label, body] of [
    ['project type', { ...GOOD, Type: 'Project' }], ['no type', { Customer: 12, Site: 34, Description: 'x' }], ['prepaid', { ...GOOD, Type: 'Prepaid' }],
    ['stage', { ...GOOD, Stage: 'Complete' }], ['status', { ...GOOD, Status: 1 }], ['due date', { ...GOOD, DueDate: '2026-12-01' }],
    ['custom fields', { ...GOOD, CustomFields: [{ CustomField: 1, Value: 'x' }] }], ['tags', { ...GOOD, Tags: [1] }], ['technician', { ...GOOD, Technician: 5 }],
    ['no customer', { ...GOOD, Customer: undefined }], ['string customer', { ...GOOD, Customer: '12' }], ['zero site', { ...GOOD, Site: 0 }], ['float site', { ...GOOD, Site: 1.5 }],
    ['negative customer', { ...GOOD, Customer: -1 }], ['huge site', { ...GOOD, Site: 1e12 }],
    ['no description', { Type: 'Service', Customer: 12, Site: 34 }], ['blank description', { ...GOOD, Description: '  ' }], ['object description', { ...GOOD, Description: {} }],
    ['huge description', { ...GOOD, Description: 'x'.repeat(130001) }], ['object notes', { ...GOOD, Notes: {} }], ['huge notes', { ...GOOD, Notes: 'x'.repeat(130001) }],
    ['response time (priority is a custom field here)', { ...GOOD, ResponseTime: 2 }], ['string response time', { ...GOOD, ResponseTime: '1' }],
  ]) assert.notEqual(verdict('post', JOB, body), '', label)
  for (const bad of [null, undefined, 'x', [], [GOOD]]) assert.notEqual(verdict('post', JOB, bad), '', J(bad))
})

test('a job is made on its own: never inside a batch, never with a query', () => {
  assert.match(verdict('post', JOB, GOOD, 2), /one of several/)
  assert.match(verdict('post', JOB + '5001/sections/', {}, 5), /one of several/)
  assert.equal(allowed('post', JOB + '?x=1'), false)
  assert.equal(allowed('post', JOB + '5001/sections/?x=1'), false)
  assert.equal(allowed('post', JOB + '5001/sections/77/costCenters/?x=1'), false)
  assert.equal(allowed('patch', JOB + '5001/customFields/44?x=1'), false)
})

test('a section is empty, a cost centre is only a cost centre id, a custom field is only a short piece of text', () => {
  assert.notEqual(verdict('post', JOB + '5001/sections/', { Name: 'x' }), '')
  assert.notEqual(verdict('post', JOB + '5001/sections/', null), '')
  for (const body of [{}, { CostCenter: 0 }, { CostCenter: '15' }, { CostCenter: 15, Name: 'x' }, { Name: 'x' }, { CostCenter: 15, Stage: 'Complete' }]) {
    assert.notEqual(verdict('post', JOB + '5001/sections/77/costCenters/', body), '', J(body))
  }
  for (const body of [{}, { Value: '' }, { Value: '  ' }, { Value: 5 }, { Value: {} }, { Value: 'x'.repeat(201) }, { Value: 'a\nb' }, { Value: 'a\u0000b' }, { Value: 'x', Other: 1 }, { Other: 'x' }]) {
    assert.notEqual(verdict('patch', JOB + '5001/customFields/44', body), '', J(body))
  }
})

test('nothing else about a job or its parts opens up', () => {
  // Writes that were never allowed stay refused.
  for (const [method, path] of [
    ['delete', JOB + '5001'], ['delete', JOB], ['put', JOB], ['post', JOB + '5001'], ['patch', JOB],
    ['delete', JOB + '5001/sections/77'], ['patch', JOB + '5001/sections/77'], ['delete', JOB + '5001/customFields/44'], ['post', JOB + '5001/customFields/44'],
    ['patch', JOB + '5001/sections/77/costCenters/'], ['delete', JOB + '5001/sections/77/costCenters/9'], ['post', JOB + '5001/notes/'],
    ['post', '/companies/3/customers/'], ['post', '/companies/3/customers/companies/'], ['post', '/companies/3/sites/'], ['patch', '/companies/3/sites/7'],
    ['post', '/companies/3/setup/responseTimes/'], ['post', '/companies/3/setup/customFields/projects/'], ['patch', '/companies/3/setup/customFields/projects/44'],
    ['post', '/companies/3/quotes/'], ['post', '/companies/3/jobs/5001/sections/77/costCenters/9/labor/'], ['post', JOB + '5001/schedules/'],
  ]) assert.equal(allowed(method, path), false, method + ' ' + path)
  // The job PATCH is still only Stage, Status and Notes, and the attachments and asset routes are as they were.
  assert.equal(allowed('patch', JOB + '5001'), true)
  assert.match(vm.runInContext(`simproSyncJobPatchError_(${J({ DueDate: '2026-12-01' })})`, ctx), /not allowed/)
  assert.equal(allowed('post', JOB + '5001/attachments/files/'), true)
  assert.equal(allowed('post', JOB + '5001/sections/77/costCenters/9/assets/'), true)
  // A call that is not one of these steps is not judged by this check.
  assert.equal(why('get', JOB, null), '')
  assert.equal(why('post', JOB + '5001/attachments/files/', { Filename: 'a.pdf' }), '')
})

test('the relay’s activity line says what was done to which job, with no private text', () => {
  const line = (requests, results) => vm.runInContext(`simproSyncWriteSummary_(${J(requests)}, ${J(results)})`, ctx)
  assert.equal(line([{ method: 'POST', path: JOB, body: { ...GOOD, Description: 'SECRET FAULT TEXT' } }], [{ status: 201, data: { ID: 5001 } }]), 'Simpro: created a Service job (job 5001)')
  assert.equal(line([{ method: 'POST', path: JOB + '5001/sections/', body: {} }], [{ status: 201, data: { ID: 77 } }]), 'Simpro: added a section to job 5001')
  assert.equal(line([{ method: 'POST', path: JOB + '5001/sections/77/costCenters/', body: { CostCenter: 15 } }], [{ status: 201 }]), 'Simpro: added a cost centre to job 5001')
  assert.equal(line([{ method: 'PATCH', path: JOB + '5001/customFields/44', body: { Value: 'SECRET' } }], [{ status: 204 }]), 'Simpro: set a custom field on job 5001')
  assert.match(line([{ method: 'POST', path: JOB, body: GOOD }], [{ status: 422, data: { errors: [] } }]), /created a Service job — refused by Simpro/)
  assert.ok(!line([{ method: 'POST', path: JOB, body: { ...GOOD, Description: 'SECRET FAULT TEXT' } }], [{ status: 201, data: { ID: 1 } }]).includes('SECRET'))
})
