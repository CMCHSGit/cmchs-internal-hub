// npm test --prefix apps/testbench — the Test Bench's orders (src/orders.js): how many of each model, and which finished tests count toward which order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { belongs, cleanOrder, expectedText, expectedTotal, jobNumber, modelKey, ordersForCustomer, orderProblem, parseExpected, progress, sameCustomer, summaryLine } from '../src/orders.js'
import { forBench, summaryOf } from '../src/bench-tests.js'

const order = { id: 'o1', number: '209676', customer: 'Waikato', expected: { D30: 15, D60: 2 }, since: '2026-11-03', status: 'open' }
let n = 0
const t = (serial, model, overall, finished, extra = {}) => ({ id: 't' + ++n, serial, model, overall, finished, customer: 'Waikato District Health Board', by: 'a@x.nz', byName: 'A', ...extra })

test('"15 D30, 2 D60" is read as quantities, in the ways people write them', () => {
  assert.deepEqual(parseExpected('15 D30, 2 D60').expected, { D30: 15, D60: 2 })
  assert.deepEqual(parseExpected('D30 x15; D60: 2').expected, { D30: 15, D60: 2 })
  assert.deepEqual(parseExpected('15 x BeneHeart D30\n2 BeneHeart D60').expected, { 'BeneHeart D30': 15, 'BeneHeart D60': 2 })
  assert.deepEqual(parseExpected('5 D30, 3 D30').expected, { D30: 8 }, 'the same model twice adds up')
  assert.deepEqual(parseExpected('D30, 0 D60').bad, ['D30', '0 D60'], 'what can\'t be read is reported, not guessed')
  assert.equal(expectedText({ D30: 15, D60: 2 }), '15 × D30, 2 × D60'); assert.equal(expectedTotal({ D30: 15, D60: 2 }), 17)
})

test('a job number and a customer are matched the way people type them', () => {
  assert.equal(jobNumber('#209676'), '209676'); assert.equal(jobNumber('Job 209676 (Waikato)'), '209676')
  assert.ok(sameCustomer('Waikato District Health Board', 'waikato') && sameCustomer('Waitemata', 'Waitemata ') && !sameCustomer('Waikato', 'Waitemata') && !sameCustomer('', 'Waikato'))
  assert.ok(!sameCustomer('Mid', 'Midcentral'), 'a very short name is not enough')
})

test('a finished test counts for an order started against it, or by customer (not before it began, not if it is for another order)', () => {
  assert.ok(belongs(order, t('S1', 'D30', 'pass', '2026-11-04T01:00:00Z')), 'customer match, after the start date')
  assert.ok(!belongs(order, t('S1', 'D30', 'pass', '2026-10-20T01:00:00Z')), 'an earlier job for the same customer is not this order')
  assert.ok(!belongs(order, t('S1', 'D30', 'pass', '2026-11-04T01:00:00Z', { customer: 'Waitemata' })), 'another customer')
  assert.ok(belongs(order, t('S1', 'D30', 'pass', '2026-11-04T01:00:00Z', { customer: 'Waitemata', order: '#209676' })), 'started against the order: counts whatever the customer says')
  assert.ok(!belongs(order, t('S1', 'D30', 'pass', '2026-11-04T01:00:00Z', { order: '555111' })), 'started against another order')
})

test('progress: devices by model, the latest test of a serial counts, and what is still to go', () => {
  const tests = [
    t('S1', 'BeneHeart D30', 'fail', '2026-11-04T01:00:00Z'), t('S1', 'BeneHeart D30', 'pass', '2026-11-04T02:00:00Z'),   // retested: one device, passed
    t('S2', 'D30, MR6502 Internal Defib Paddles', 'pass', '2026-11-04T03:00:00Z', { by: 'b@x.nz', byName: 'B' }),          // another engineer; paddles are a part
    t('S3', 'BeneHeart D30', 'fail', '2026-11-04T04:00:00Z'),
    t('S4', 'BeneHeart D60', 'pass', '2026-11-05T01:00:00Z'),
    t('S5', 'BeneHeart D30', 'incomplete', '2026-11-05T02:00:00Z'),                                                       // left unfinished: not tested yet
    t('S6', 'BatteryFeed 20', 'pass', '2026-11-05T03:00:00Z'),                                                            // not on the order
    t('X1', 'BeneHeart D30', 'pass', '2026-11-05T03:00:00Z', { customer: 'Hutt' }),                                       // someone else's
  ]
  const p = progress(order, tests)
  const d30 = p.rows.find((r) => r.model === 'D30'), d60 = p.rows.find((r) => r.model === 'D60')
  assert.deepEqual([d30.need, d30.tested, d30.passed, d30.failed, d30.missing], [15, 3, 2, 1, 12])
  assert.deepEqual([d60.need, d60.tested, d60.missing], [2, 1, 1])
  assert.deepEqual([p.need, p.tested, p.passed, p.failed, p.missing, p.complete], [17, 4, 3, 1, 13, false])
  assert.deepEqual(p.other.map((d) => d.serial), ['S6'], 'a model not on the order is reported')
  assert.deepEqual(p.incomplete.map((d) => d.serial), ['S5'])
  assert.equal(summaryLine(order, tests), '4 of 17 tested, 13 to go')
  const done = progress({ ...order, expected: { D30: 1, D60: 1 } }, tests)
  assert.equal(done.complete, true); assert.equal(done.missing, 0); assert.equal(done.rows[0].extra, 2, 'more than needed is shown as over')
})

test('"D30" is found in a longer model name only as a whole word', () => {
  assert.equal(modelKey(order, 'BeneHeart D30'), 'D30'); assert.equal(modelKey(order, 'D300 something'), null); assert.equal(modelKey({ expected: { D3: 1, D30: 1 } }, 'BeneHeart D30'), 'D30', 'the longest name wins')
})

test('the bench is offered the open orders that fit the customer, and an order is saved cleaned and only when it is complete', () => {
  const closed = { ...order, number: '1', status: 'closed' }, other = { ...order, number: '2', customer: 'Hutt' }
  assert.deepEqual(ordersForCustomer([order, closed, other], 'Waikato DHB'.replace('DHB', '')).map((o) => o.number), ['209676'])
  assert.deepEqual(ordersForCustomer([order, closed, other], '').map((o) => o.number), ['209676', '2'], 'no customer typed: all the open ones')
  assert.equal(orderProblem({ number: '', customer: 'W', expected: { D30: 1 } }), 'Enter the job number.')
  assert.match(orderProblem({ number: '1', customer: '', expected: { D30: 1 } }), /customer/); assert.match(orderProblem({ number: '1', customer: 'W', expected: {} }), /how many/)
  assert.equal(orderProblem(order), '')
  const c = cleanOrder({ ...order, number: 'Job #209676', expected: { D30: '15', '': 3, D60: -1 }, junk: 'x' }, { email: 'A@X.nz', name: 'A' }, Date.parse('2026-11-06T00:00:00Z'))
  assert.deepEqual([c.number, c.expected, c.createdBy, 'junk' in c], ['209676', { D30: 15 }, 'a@x.nz', false])
})

test('a shared test carries the order it was started against, and the bench, hub and rules know the order', () => {
  const run = { id: 'r1', order: '209676', dut: { 'Serial number': 'S1' }, template: { name: 'X', steps: [] }, overall: 'pass', finished: '2026-11-04T01:00:00Z' }
  assert.equal(summaryOf(run, { email: 'a@x.nz' }).order, '209676')
  assert.equal('order' in summaryOf({ ...run, order: undefined }, { email: 'a@x.nz' }), false, 'no order, no field (older rules keep working)')
  assert.equal(forBench([summaryOf(run, { email: 'a@x.nz' })])[0].order, '209676')
  const rules = readFileSync(new URL('../../../rules/firestore.rules', import.meta.url), 'utf8')
  assert.ok(rules.includes("'customer', 'order', 'overall'") && rules.includes('match /benchOrders/{id}') && rules.includes('function isBenchOrder()'))
  const bench = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.ok(bench.includes('id="dutOrder"') && bench.includes("'chs-bench:orders'") && bench.includes('Runner.run.order = order') && bench.includes('if (prev.order) r.order = prev.order'), 'the bench offers the orders and keeps the choice, also for a rerun')
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.ok(section.includes("type: 'chs-bench:orders'") && section.includes('<Orders') && section.includes('startJob={startJob}'))
})
