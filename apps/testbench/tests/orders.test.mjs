// npm test --prefix apps/testbench — the Test Bench's orders (src/orders.js): how many of each model, and which finished tests count toward which order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { belongs, cleanOrder, devicesFromTitle, expectedText, expectedTotal, jobNumber, modelKey, nzDate, ordersForCustomer, orderProblem, parseExpected, progress, sameCustomer, summaryLine } from '../src/orders.js'
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

test('the order form takes one row per model, each with a quantity', async () => {
  const { rowsToExpected } = await import('../src/orders.js')
  assert.deepEqual(rowsToExpected([{ model: 'D30', qty: '15' }, { model: ' D60 ', qty: '2' }, { model: '', qty: '' }]), { expected: { D30: 15, D60: 2 }, bad: [] }, 'a blank row is left out')
  assert.deepEqual(rowsToExpected([{ model: 'D30', qty: '5' }, { model: 'D30', qty: '3' }]).expected, { D30: 8 }, 'the same model twice adds up')
  assert.deepEqual(rowsToExpected([{ model: 'D30', qty: '' }, { model: 'D60', qty: '0' }, { model: 'A9', qty: '1.5' }, { model: '', qty: '4' }]).bad, ['D30', 'D60', 'A9', 'a row with no model'], 'a row that can\'t be used is named, not guessed')
  const ui = readFileSync(new URL('../src/Orders.jsx', import.meta.url), 'utf8')
  assert.ok(ui.includes('Device model') && ui.includes('Quantity') && ui.includes('type="number"') && !ui.includes('15 D30, 2 D60, banana') && ui.includes('tb-modelrow'))
})

// The titles below are the ways real test-and-add jobs were titled (made up from the pattern: no customers, no serial numbers that exist).
const listed = (title) => devicesFromTitle(title).map((d) => `${d.qty} ${d.model}`)

test('a job title lists its devices: quantities in front or behind, one model or several', () => {
  assert.deepEqual(listed('Test and add assets - 16x VS9'), ['16 VS9'])
  assert.deepEqual(listed('Test and add asset 3X A9'), ['3 A9'])
  assert.deepEqual(listed('test and add asset TM80'), ['1 TM80'], 'no quantity is one')
  assert.deepEqual(listed('test and add asset ePM12 X4'), ['4 ePM12'])
  assert.deepEqual(listed('test and add assets EPM 15 x 4'), ['4 EPM 15'], 'the 15 is the model, the 4 the quantity')
  assert.deepEqual(listed('Test and add assets- 21 xVS9, 2xN12, 3XN1'), ['21 VS9', '2 N12', '3 N1'])
  assert.deepEqual(listed('test and add asset 2X N19 2X N1 4x VS9 1X 16bed Work station'), ['2 N19', '2 N1', '4 VS9', '1 16bed Work station'])
  assert.deepEqual(listed('Test and add asset D60 & 3X AED'), ['1 D60', '3 AED'])
  assert.deepEqual(listed('test and add asset 2X N15 and 3X N1'), ['2 N15', '3 N1'])
  assert.deepEqual(listed('Test and add assets EPM12-N15-N1'), ['1 EPM12', '1 N15', '1 N1'])
  assert.deepEqual(listed('test and add assets - 3 x N15 N1, 1 x VS9'), ['3 N15', '3 N1', '1 VS9'], 'a quantity goes with every model after it, up to the comma')
  assert.deepEqual(listed('test and add assets - A7, TE7,VS9 R700,AED'), ['1 A7', '1 TE7', '1 VS9', '1 R700', '1 AED'])
  assert.deepEqual(listed('was job 209336 test and add assets 6X D30 -5x AED'), ['6 D30', '5 AED'], 'the old job number is not a device')
  assert.deepEqual(listed('Test and add assets 28 x AED 26 X cabinets'), ['28 AED', '26 cabinets'])
  assert.deepEqual(listed('Test and add asset 8 vs9'), ['8 vs9'])
})

test('a job title: the extra words around a model are dropped, so the model matches what the bench records', () => {
  assert.deepEqual(listed('test and add asset 2x N22 monitors'), ['2 N22'])
  assert.deepEqual(listed('Test and Add asset 2x Benevision N1'), ['2 N1'])
  assert.deepEqual(listed('Please test and add assests into Simpro - 3 x R700s - extended warranty to be ordered'), ['3 R700'], 'plural and instructions')
  assert.deepEqual(listed('Test and add asset D30 battery charger'), ['1 D30'])
  assert.deepEqual(listed('Test and add asset R700 - TP1-64004419'), ['1 R700'], 'a serial number is not a device')
  assert.deepEqual(listed('R700 - please test and add asset'), ['1 R700'], 'a model before the words works too')
  assert.deepEqual(listed('test and add assets TEX20 -Rollstand'), ['1 TEX20'], 'TEX20 is not "TE" times 20')
  assert.deepEqual(listed('test and add asset MX5& trolly'), ['1 MX5'])
  assert.deepEqual(listed('Test and add asset PM-60, PM60 Main Unit, English(Software)'), ['1 PM-60'], 'the same device named twice is one')
  assert.deepEqual(listed('Test and add asset 4x Te Air on Roll stands'), ['4 Te Air on Roll stands'], 'a counted name with no model code is kept as written')
  assert.deepEqual(listed('Test and Add asset docking mount'), ['1 docking mount'], 'a short plain name is still the device')
})

test('a job title that names no device gives no rows (the person types them)', () => {
  for (const t of ['Test and add assets', 'please test and add asset', 'Please test and add assets into Simpro', 'Please test and add assets into Simpro - please put S/Ns of AEDs in the notes need them for Invoicing', 'test and add asset Mindray', '', null, undefined]) assert.deepEqual(devicesFromTitle(t), [], String(t))
  assert.deepEqual(devicesFromTitle('<p>Test and add 2x VS9</p>').map((d) => d.model), ['VS9'], 'Simpro descriptions can carry HTML')
})

test('Orders: picking a job fills the model rows from its title, and does not overwrite rows already typed', () => {
  const src = readFileSync(new URL('../src/Orders.jsx', import.meta.url), 'utf8').replaceAll('\r', '')
  assert.ok(src.includes('onJob={pickJob}') && src.includes('devicesFromTitle(j.name)') && src.includes('devicesFromTitle(j.description)'))
  assert.ok(src.includes("const typed = rows.some((r) => r.model || r.qty)\n    if (!typed) setRows(withSpare(listed))"), 'only blank rows are filled')
  assert.ok(src.includes('Use this list instead'), 'with rows already typed, the title\'s list is offered, not forced')
  assert.ok(readFileSync(new URL('../src/JobPicker.jsx', import.meta.url), 'utf8').includes("name: j.Name || '', description: j.Description || ''"), 'the picker passes the title on')
})

test('orders count days as New Zealand sees them: a test finished on a NZ morning counts for an order started that morning', () => {
  assert.equal(nzDate('2026-11-26T19:30:00Z'), '2026-11-27', 'NZDT is UTC+13: 8:30 am on the 27th is still the 26th in UTC')
  assert.equal(nzDate('2026-07-26T11:30:00Z'), '2026-07-26', 'NZST is UTC+12: 11:30 pm on the 26th')
  assert.equal(nzDate('2026-07-26T12:30:00Z'), '2026-07-27', 'and half past midnight is the 27th')
  assert.equal(nzDate('2026-11-27T08:30:00+13:00'), '2026-11-27'); assert.equal(nzDate('2026-11-27'), '2026-11-27', 'a day with no time stays as it is')
  assert.equal(nzDate(''), ''); assert.equal(nzDate(undefined), ''); assert.equal(nzDate('not a date'), 'not a date'.slice(0, 10))
  const morning = { number: '1', customer: 'Waikato', expected: { D30: 1 }, since: '2026-11-27' }   // made at 8 am NZ on the 27th: the form's default day
  assert.ok(belongs(morning, t('S1', 'D30', 'pass', '2026-11-26T20:00:00Z')), 'tested at 9 am NZ the same morning (the UTC date is still the 26th)')
  assert.ok(!belongs(morning, t('S2', 'D30', 'pass', '2026-11-26T10:00:00Z')), 'tested at 11 pm NZ the night before: not this order')
  const c = cleanOrder({ number: '1', customer: 'X', expected: { D30: 1 } }, { email: 'a@x.nz' }, Date.parse('2026-11-26T20:00:00Z'))
  assert.equal(c.since, '2026-11-27', 'an order saved with no start day gets the NZ day')
})
