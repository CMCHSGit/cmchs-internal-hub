// npm test --prefix apps/testbench — testing a device again that has already passed: the bench asks, and a re-test that passes takes the earlier
// test's place (this laptop's Previous tests, the shared record, the saved report files) instead of sitting beside it. Invented serials only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { memoryReports, removeTestFiles, saveReport } from '../src/reports.js'

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const hub = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

const a = html.indexOf('function otherDevices('), b = html.indexOf('const Extras = {')
const { earlierPasses } = vm.runInNewContext('const overallOf = (r) => r.overall;' + html.slice(a, b) + '; ({ earlierPasses })')
const plain = (v) => JSON.parse(JSON.stringify(v))

const T1 = '2026-11-05T01:00:00.000Z', T2 = '2026-11-10T01:00:00.000Z', T3 = '2026-11-12T01:00:00.000Z'
const local = (id, serial, overall, started, extra = {}) => ({ id, dut: { 'Serial number': serial }, overall, started, finished: started, template: { name: 'Class I' }, ...extra })
const shared = (id, serial, overall, started, by = 'me@example.com') => ({ id, serial, overall, started, finished: started, template: 'Class I', by, byName: 'Some Engineer' })

test('a device that passed before is found, whichever serial of a set matches, and only passes count', () => {
  const l = [local('r1', 'EX-1', 'pass', T1), local('r2', 'EX-2', 'fail', T1), local('r3', 'EX-3', 'pass', T1, { inProgress: true }), local('r4', 'EX-4', 'pass', T1, { imported: { source: 'Ansur' } })]
  assert.equal(earlierPasses(['ex-1'], l, [], 'me@example.com').length, 1, 'serial case does not matter')
  assert.equal(earlierPasses(['EX-2'], l, [], '').length, 0, 'a failed test is not a pass')
  assert.equal(earlierPasses(['EX-3'], l, [], '').length, 0, 'not one still being done')
  assert.equal(earlierPasses(['EX-4'], l, [], '').length, 0, 'not an imported Ansur record')
  assert.equal(earlierPasses(['', ' '], l, [], '').length, 0, 'no serial, nothing to match')
  const set = [{ ...local('s1', 'MAIN-1', 'pass', T1), devices: [{ serial: 'DOCK-2' }] }]
  assert.equal(earlierPasses(['DOCK-2'], set, [], '').length, 1, 'a set matches by any of its devices')
  assert.equal(earlierPasses(['MAIN-1'], [], [shared('x', 'MAIN-1 + DOCK-2', 'pass', T1)], 'me@example.com').length, 1, 'and so does the shared list’s joined serial field')
  assert.equal(earlierPasses(['AB'], [], [shared('x', 'AB+12', 'pass', T1)], '').length, 0, 'a + inside a serial is not a join')
})

test('the same test on this laptop and in the shared list is one, and the newest pass comes first', () => {
  const l = [local('r1', 'EX-1', 'pass', T1), local('r2', 'EX-1', 'pass', T2)]
  const s = [shared('r1', 'EX-1', 'pass', T1), shared('r9', 'EX-1', 'pass', T3)]
  const got = earlierPasses(['EX-1'], l, s, 'me@example.com')
  assert.deepEqual(plain(got.map((c) => c.id)), ['r9', 'r2', 'r1'])
  assert.deepEqual(earlierPasses(['EX-1'], [], [{ id: 'z', serial: 'EX-1', overall: 'pass', finished: T1 }], '').length, 0, 'a shared line with no start time cannot be told apart, so it is left alone')
})

test('only an engineer’s own test (or one only on this laptop) can be replaced, never someone else’s', () => {
  const l = [local('r1', 'EX-1', 'pass', T1)]
  assert.equal(earlierPasses(['EX-1'], l, [], 'me@example.com')[0].mine, true, 'only on this laptop')
  assert.equal(earlierPasses(['EX-1'], [], [shared('s1', 'EX-1', 'pass', T1)], 'me@example.com')[0].mine, true)
  const theirs = earlierPasses(['EX-1'], [], [shared('s1', 'EX-1', 'pass', T1, 'other@example.com')], 'me@example.com')[0]
  assert.equal(theirs.mine, false); assert.equal(theirs.byName, 'Some Engineer')
  assert.equal(earlierPasses(['EX-1'], [local('s1', 'EX-1', 'pass', T1, { sharedBy: 'other@example.com' })], [], 'me@example.com')[0].mine, false, 'a copy fetched from another engineer’s shared test')
  assert.equal(earlierPasses(['EX-1'], l, [shared('r1', 'EX-1', 'pass', T1, 'other@example.com')], 'me@example.com')[0].mine, false, 'the shared line says whose it is')
})

test('the saved files of the replaced test go, and nothing else', async () => {
  const store = memoryReports(), buf = new ArrayBuffer(4)
  const file = (name, testedAt, extra = {}) => saveReport(store, { name, buffer: buf, meta: { serial: 'EX-1', testedAt, ...extra } })
  await file('EX-1 - M 05.11.2026.pdf', T1); await file('EX-1 - M 05.11.2026.mtr', T1); await file('EX-1 - M 12.11.2026.pdf', T3)
  await file('Added by hand.pdf', T1, { uploaded: true }); await file('Other - M 05.11.2026.pdf', T2)
  assert.equal(await removeTestFiles(store, T1), 2)
  assert.deepEqual((await store.all()).map((f) => f.name).sort(), ['Added by hand.pdf', 'EX-1 - M 12.11.2026.pdf', 'Other - M 05.11.2026.pdf'])
  assert.equal(await removeTestFiles(store, ''), 0, 'no start time, nothing removed')
  assert.equal(await removeTestFiles(store, 'nothing'), 0)
})

test('the wiring: the question at the start, the replace after a pass, the hub’s part', () => {
  assert.match(html, /earlierPasses\(\[sk \? dut\[sk\] : '', \.\.\.devices\.map\(d => d\.serial\)\], await Records\.list\(\), SharedTests\.list, SharedTests\.me\)/, 'asked from the start screen')
  assert.match(html, /title: 'Already tested'/)
  assert.match(html, /if \(!go2\) return;/, 'Cancel starts nothing')
  assert.match(html, /if \(prior\.mine\) replaces = \{ id: prior\.id, started: prior\.started \}/, 'someone else’s test is not replaced')
  assert.match(html, /if \(replaces\) Runner\.run\.replaces = replaces/, 'carried on the test, so autosave and Carry on keep it')
  assert.match(html, /if \(!stopped && run\.overall === 'pass' && run\.replaces\) this\.replaceEarlier\(run\)/, 'only a passed, finished re-test replaces')
  assert.match(html, /DB\.del\('runs', old\.id\)/, 'the earlier test leaves this laptop’s list')
  assert.match(html, /type: 'chs-bench:replace-test', id: old\.id, started: old\.started/, 'the hub is told')
  assert.doesNotMatch(html.slice(html.indexOf('rerun() {'), html.indexOf('nextDevice() {')), /replaces/, 'Run again on the summary is as before: its own test, its own files')
  assert.match(hub, /chs-bench:replace-test/); assert.match(hub, /removeTestFiles\(reportStore, m\.started\)/)
  assert.match(hub, /old\.by === who\.current\.email \|\| who\.current\.admin/, 'the shared record: its engineer or an admin, as Remove for everyone')
})
