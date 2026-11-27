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
const cut = (from, to) => html.slice(html.indexOf(from), html.indexOf(to, html.indexOf(from)))
const { earlierPasses, carryEarlier, retestBody } = vm.runInNewContext([
  'const overallOf = (r) => r.overall; const esc = (v) => String(v).replace(/</g, "&lt;"); const TYPES = { check: { group: "check" } }; const clone = (o) => JSON.parse(JSON.stringify(o));',
  cut('function judge(', 'function isSteady('), cut('function limitText(', '/* ======================= test library'),   // the bench's own judging and limit text
  cut('function stepChecks(', '/**\n * What a finished test answered'), html.slice(a, b), '; ({ earlierPasses, carryEarlier, retestBody })'].join('\n'))
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

const setter = (run) => (s) => status(run.results[s.id], (s.params.items || []).length + (s.params.readings || []).length)
// A checklist step as the bench has it: pass / fail items, then typed readings.
const checkStep = (id, title, items, readings = []) => ({ id, type: 'check', title, params: { items, readings } })
const blank = (steps) => ({ template: { steps }, results: Object.fromEntries(steps.map((s) => [s.id, { status: 'pending', rows: [] }])) })
const finished = (steps, results) => ({ template: { steps }, results })
const status = (s, count) => {   // the bench's checksStatus: one result for each item of the step, so an unanswered one is a gap
  const v = Array.from({ length: count }, (_, k) => s.rows[k] && s.rows[k].result)
  s.status = v.includes('fail') ? 'fail' : !v.every(Boolean) ? 'pending' : v.every((x) => x === 'na') ? 'done' : v.some((x) => x === 'pass') ? 'pass' : 'info'
}

test('a re-test keeps what was answered by hand: Pass, N/A and typed readings, judged again by the new limits', () => {
  const oldSteps = [checkStep('v', 'Visual', ['Case undamaged', 'Labels legible', 'Cable intact']), checkStep('s', 'SpO2', [], [{ label: 'SpO2 on a healthy finger', unit: '%', lo: 95, hi: 100 }, { label: 'Pulse rate', unit: 'bpm', lo: 77, hi: 83 }])]
  const old = finished(oldSteps, {
    v: { status: 'pass', rows: [{ label: 'Case undamaged', result: 'pass' }, { label: 'Labels legible', result: 'na' }, { label: 'Cable intact', result: 'fail' }] },
    s: { status: 'pass', rows: [{ label: 'SpO2 on a healthy finger', value: '97', unit: '%', result: 'pass', limit: '95 – 100 %' }, { label: 'Pulse rate', value: '80', unit: 'bpm', result: 'pass', limit: '77 – 83 bpm' }] },
  })
  const run = blank(oldSteps), kept = carryEarlier(run, old, setter(run))
  assert.equal(kept, 4, 'Pass, N/A and both readings; the Fail is left to answer again')
  assert.equal(run.results.v.rows[0].result, 'pass'); assert.equal(run.results.v.rows[1].result, 'na'); assert.equal(run.results.v.rows[1].display, 'N/A')
  assert.equal(run.results.v.rows[2], undefined, 'a Fail is not carried')
  assert.equal(run.results.v.status, 'pending', 'the step is not done until the Fail one is answered')
  assert.equal(run.results.s.rows[0].value, '97'); assert.equal(run.results.s.rows[1].value, '80'); assert.equal(run.results.s.status, 'pass')
  // The same readings on a template with tighter limits are judged again, not carried as passes.
  const tight = blank([checkStep('s', 'SpO2', [], [{ label: 'SpO2 on a healthy finger', unit: '%', lo: 98, hi: 100 }, { label: 'Pulse rate', unit: 'bpm', lo: 77, hi: 83 }])])
  carryEarlier(tight, old, setter(tight))
  assert.equal(tight.results.s.rows[0].result, 'fail'); assert.equal(tight.results.s.rows[0].limit, '98 – 100 %'); assert.equal(tight.results.s.status, 'fail')
  assert.equal(old.results.s.rows[0].result, 'pass', 'the earlier test itself is not changed')
})

test('a re-test with another template: steps match by title, items by wording; nothing else is carried', () => {
  const old = finished([checkStep('a1', 'Visual inspection', ['Case undamaged', 'Old wording']), checkStep('a2', 'Performance', [], [{ label: 'SpO2', unit: '%', lo: 90, hi: 100 }]), { id: 'e1', type: 'esa_pe', title: 'Protective earth', params: { hi: 0.2 } }], {
    a1: { status: 'pass', rows: [{ label: 'Case undamaged', result: 'pass' }, { label: 'Old wording', result: 'pass' }] },
    a2: { status: 'pass', rows: [{ label: 'SpO2', value: '96', unit: '%', result: 'pass' }] },
    e1: { status: 'pass', rows: [{ label: 'PE', value: '0.05', result: 'pass' }] },
  })
  const run = blank([checkStep('b1', ' visual  INSPECTION ', ['case undamaged', 'New wording']), checkStep('b2', 'Performance', [], [{ label: 'SpO2', unit: '%', lo: 95, hi: 100 }, { label: 'Respiration', unit: 'bpm' }]), { id: 'e9', type: 'esa_pe', title: 'Protective earth', params: { hi: 0.2 } }, checkStep('b3', 'Extra', ['Something new'])])
  assert.equal(carryEarlier(run, old, setter(run)), 2, 'one item by wording (any capitals and spaces), one reading')
  assert.equal(run.results.b1.rows[0].label, 'case undamaged', 'the new template’s own wording')
  assert.equal(run.results.b1.rows[1], undefined, 'a reworded item is answered again')
  assert.equal(run.results.b2.rows[0].value, '96'); assert.equal(run.results.b2.rows[1], undefined)
  assert.deepEqual(plain(run.results.e9), { status: 'pending', rows: [] }, 'ESA612 measurements are done again')
  assert.deepEqual(plain(run.results.b3), { status: 'pending', rows: [] }, 'a step the earlier test did not have')
  assert.equal(carryEarlier(blank([checkStep('x', 'Visual', ['Case'])]), finished([checkStep('x', 'Visual', ['Case'])], { x: { status: 'skipped', rows: [{ label: 'Case', result: 'pass' }] } }), () => {}), 0, 'a skipped step is not carried')
})

test('the wiring: the question at the start, the replace after a pass, the hub’s part', () => {
  assert.match(html, /earlierPasses\(\[sk \? dut\[sk\] : '', \.\.\.devices\.map\(d => d\.serial\)\], local, SharedTests\.list, SharedTests\.me\)/, 'asked from the start screen')
  assert.match(html, /title: 'Already tested'/)
  assert.match(html, /if \(!pick\) return;/, 'Cancel starts nothing')
  assert.match(html, /carryEarlier\(Runner\.run, earlier, \(s\) => Runner\.checksStatus\(s\)\)/, 'the earlier answers go into the new test')
  assert.match(html, /if \(pick === 'other'\) \{ this\.pick\(other\.id\); return this\.startRun\(\{ replaces, earlier, keepAll \}\); \}/, 'the earlier template can be used instead, without asking twice')
  assert.match(html, /async startRun\(again\)/)
  assert.match(html, /if \(prior\.mine\) replaces = \{ id: prior\.id, started: prior\.started \}/, 'someone else’s test is not replaced')
  assert.match(html, /if \(replaces\) Runner\.run\.replaces = replaces/, 'carried on the test, so autosave and Carry on keep it')
  assert.match(html, /if \(!stopped && run\.overall === 'pass' && run\.replaces\) this\.replaceEarlier\(run\)/, 'only a passed, finished re-test replaces')
  assert.match(html, /DB\.del\('runs', old\.id\)/, 'the earlier test leaves this laptop’s list')
  assert.match(html, /type: 'chs-bench:replace-test', id: old\.id, started: old\.started/, 'the hub is told')
  assert.doesNotMatch(html.slice(html.indexOf('rerun() {'), html.indexOf('nextDevice() {')), /replaces/, 'Run again on the summary is as before: its own test, its own files')
  assert.match(hub, /chs-bench:replace-test/); assert.match(hub, /removeTestFiles\(reportStore, m\.started\)/)
  assert.match(hub, /old\.by === who\.current\.email \|\| who\.current\.admin/, 'the shared record: its engineer or an admin, as Remove for everyone')
})

test('Retest on an opened test asks the same question, then goes the same way as Start test', () => {
  const prior = { serial: 'EX-1', template: 'Class I', mine: true, byName: '' }
  const body = retestBody(prior, '27 Nov 2026', '')
  assert.match(body, /EX-1<\/b> passed on 27 Nov 2026 with “Class I”/); assert.match(body, /Do you want to test it again\?/); assert.match(body, /replaces the earlier one/)
  assert.doesNotMatch(body, /This test uses/, 'no template note when it is the earlier test’s own')
  assert.match(retestBody(prior, 'd', 'Other <b>'), /This test uses “Other &lt;b>”/, 'and the other template is named, escaped')
  assert.match(retestBody({ ...prior, mine: false, byName: 'Sam' }, 'd', ''), /tested by Sam[\s\S]*belongs to someone else/, 'someone else’s test stays')
  const rerun = html.slice(html.indexOf('  rerun() {'), html.indexOf('  nextDevice() {'))
  assert.match(rerun, /overallOf\(prev\) === 'pass'\) \{ this\.retestPassed\(prev\); return; \}/, 'a passed test is asked about first')
  assert.ok(rerun.indexOf('retestPassed') < rerun.indexOf('Rerun of'), 'before the old rerun, which a test that did not pass still gets')
  assert.match(html, /id="sumRerun"[^>]*>[^<]*<svg[^>]*><use[^>]*\/><\/svg>Retest<\/button>/, 'the button reads Retest')
  const fn = html.slice(html.indexOf('  async retestPassed(prev) {'), html.indexOf('  updateStartHint() {'))
  assert.match(fn, /title: 'Already tested', body: retestBody\(prior, day, '', t \? prior\.template : ''\)/)
  assert.match(fn, /\(t \? \[\{ label: 'Test again', value: 'same' \}\] : \[\]\), \{ label: 'Use a different template…', value: 'other' \}/, 'the same template, or another')
  assert.match(fn, /if \(!pick\) return;/, 'Cancel changes nothing')
  assert.match(fn, /await this\.startRun\(\{ replaces, earlier: prev, keepAll \}\)/, 'the same template starts at once, with the earlier answers and the replace')
  assert.match(fn, /const keepAll = pick === 'same' && !!ans\.data\.all;/, 'every result is kept only with this test’s own template, never another')
  assert.match(fn, /this\.retest = \{ replaces, earlier: prev \}/, 'another template: the retest waits for Start test')
  assert.match(html, /if \(!again && this\.retest\) \{ const r = this\.retest; this\.retest = null;/, 'taken once, and only for that device’s serial number')
  assert.match(html, /this\.picked = null; this\.retest = null;/, 'dropped when the setup is left')
})

test('a retest can keep every result: a ticked box, only with the earlier test’s own template, and the steps and results as they were', () => {
  const withBox = retestBody({ serial: 'EX-1', template: 'Class I', mine: true, byName: '' }, 'd', '', 'Class I')
  assert.match(withBox, /<input type="checkbox" id="rtAll" checked>/, 'ticked: Jonathan wants every result kept')
  assert.match(withBox, /Keep all results, including the ESA612 and simulator steps, when testing with “Class I”: they are not measured again/)
  assert.doesNotMatch(withBox, /ESA612 measurements and simulator steps are done again/, 'the note that they are measured again goes while the box is offered')
  const without = retestBody({ serial: 'EX-1', template: 'Class I', mine: true, byName: '' }, 'd', '', '')
  assert.doesNotMatch(without, /rtAll/); assert.match(without, /ESA612 measurements and simulator steps are done again/, 'no box when the earlier template is not there to use')
  // Both questions read the box, and Start test keeps every result only when the template used is the earlier test's own.
  assert.equal((html.match(/collect: \(el\) => \(\{ all: !!\$\('#rtAll', el\)\?\.checked \}\)/g) || []).length, 2, 'Start test’s question and Retest’s')
  assert.match(html, /keepAll = !!ans\.data\.all && \(pick === 'other' \|\| !differs\);/)
  const keep = html.slice(html.indexOf('if (earlier && keepAll && earlier.template'), html.indexOf('} else if (earlier) {'))
  assert.match(keep, /earlier\.templateId === t\.id \|\| norm\(earlier\.template\.name\) === norm\(t\.name\)/, 'the same template, by id or name')
  assert.match(keep, /r\.template = clone\(earlier\.template\); r\.results = clone\(earlier\.results\)/, 'every step and result as it was')
  assert.match(keep, /r\.keptFrom = \{ id: earlier\.id, finished: earlier\.finished \}/, 'the run says which test its results came from')
  assert.match(keep, /Runner\.restorePhotos\(r\)/, 'step photos come back from the template')
  assert.match(keep, /\['pass', 'done', 'info', 'na'\]\.includes\(Runner\.res\(s\)\.status\)/, 'opens on the first step still to do')
  assert.match(html, /const replaces = prior\.mine && prev\.started/, 'it still replaces the opened test when it passes')
})

