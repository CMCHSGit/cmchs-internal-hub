// npm test --prefix apps/testbench — an order closes by itself once its Simpro job is marked Complete (or Archived). Invented names only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { jobClosesOrder } from '../src/orders.js'

const order = { id: 'o1', number: '#209653', customer: 'Grace Hospital - Evolution Southern Cross Ltd.', jobLabel: '#209653 Evolution Southern Cross Ltd. · Grace Hospital', status: 'open' }

test('a Complete or Archived job closes its open order; any other stage does not', () => {
  assert.equal(jobClosesOrder(order, { ID: 209653, Stage: 'Complete' }, 'Evolution Southern Cross Ltd.'), true)
  assert.equal(jobClosesOrder(order, { ID: 209653, Stage: 'Archived' }, 'Evolution Southern Cross Ltd.'), true)
  assert.equal(jobClosesOrder(order, { ID: 209653, Stage: 'Progress' }, 'Evolution Southern Cross Ltd.'), false)
  assert.equal(jobClosesOrder(order, { ID: 209653, Stage: 'Pending' }), false)
  assert.equal(jobClosesOrder(order, null), false, 'job not found')
  assert.equal(jobClosesOrder({ ...order, status: 'closed' }, { ID: 209653, Stage: 'Complete' }), false, 'already closed')
})

test('only the order’s own job: the same number, and a customer that agrees', () => {
  assert.equal(jobClosesOrder(order, { ID: 209654, Stage: 'Complete' }), false)
  assert.equal(jobClosesOrder(order, { ID: 209653, Stage: 'Complete' }, 'Somebody Else Ltd'), false, 'a job of that number in another Simpro company')
  assert.equal(jobClosesOrder(order, { ID: 209653, Stage: 'Complete' }, ''), true, 'Simpro gave no customer: the number decides')
  assert.equal(jobClosesOrder({ ...order, customer: '' }, { ID: 209653, Stage: 'Complete' }, 'Anyone'), true)
})

test('the hub looks at each open order’s job, and again after a stage change in Saved reports', () => {
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.match(section, /jobClosesOrder\(o, job, job \? customerOf\(job\) : ''\)/)
  assert.match(section, /status: 'closed', closedAt: Date\.now\(\), closedBy: who\.current\.email/)
  assert.match(section, /logActivity\(null, `Closed a Test Bench order \(its Simpro job is/, 'one activity line, no names')
  assert.match(section, /onJobUpdated=\{\(jobId\) => closeDoneOrders\(/)
  const reports = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.match(reports, /if \(upd\.done\.includes\('stage'\) && onJobUpdated\) onJobUpdated\(job\.id\)/)
})
