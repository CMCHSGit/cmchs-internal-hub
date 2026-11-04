// npm test --prefix apps/testbench: the Test Bench's shared previous tests (src/bench-tests.js) and the two things the bench page
// does with them (lists them, shares a finished test), plus the charging step after the electrical tests.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_JSON, forBench, packRun, summaryOf } from '../src/bench-tests.js'

const run = { id: 'r1', started: '2026-11-03T00:30:00Z', finished: '2026-11-03T01:00:00Z', overall: 'pass',
  dut: { 'Serial number': ' FP5-6A036792 ', Model: 'BeneHeart D30', Customer: 'Waitemata', 'Customer asset #': 'WDH-77', 'CHS asset #': 'CHS-1', 'Testing engineer': 'Jonathan' },
  template: { name: 'Mindray D30', steps: [{ id: 'a' }, { id: 'b' }] }, results: { a: { status: 'pass', rows: [] } } }

test('a test is summarised in one small line: who, what, which device, the result', () => {
  const s = summaryOf(run, { email: 'Jonathan.Nasrun@cass.co.nz', name: 'Jonathan Nasrun' }, 5)
  assert.deepEqual(s, { id: 'r1', by: 'jonathan.nasrun@cass.co.nz', byName: 'Jonathan Nasrun', template: 'Mindray D30', serial: 'FP5-6A036792', model: 'BeneHeart D30', customer: 'Waitemata', overall: 'pass', finished: '2026-11-03T01:00:00Z', started: '2026-11-03T00:30:00Z', steps: 2, savedAt: 5 })
  assert.equal(summaryOf({ ...run, overall: 'something else' }, { email: 'a@b.c' }).overall, 'incomplete', 'only pass, fail or incomplete')
  assert.equal(summaryOf({ id: 'x', dut: { 'Customer asset #': 'Z' } }, { email: 'a@b.c' }).customer, '', 'the customer asset number is not the customer')
})

test('the whole test is one JSON string, unless it is too big for a document', () => {
  assert.deepEqual(JSON.parse(packRun(run)), run)
  assert.equal(packRun({ id: 'big', pad: 'x'.repeat(MAX_JSON) }), null)
})

test('the bench gets only the list fields, no extras', () => {
  const [row] = forBench([{ id: 'r1', by: 'a', byName: 'A', template: 'T', serial: 'S', model: 'M', customer: 'C', overall: 'pass', finished: 'f', started: 's', steps: 3, size: 99999, savedAt: 1 }])
  assert.deepEqual(Object.keys(row).sort(), ['by', 'byName', 'customer', 'finished', 'id', 'model', 'overall', 'serial', 'started', 'steps', 'template'])
})

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')

test('the bench lists shared tests, opens one by fetching it, and shares a test when it finishes', () => {
  assert.match(html, /const SharedTests = \{/)
  assert.match(html, /SharedTests\.share\(run\);\s*\n\s*\$\('#runActive'\)\.hidden = true/, 'finish() shares the test')
  assert.match(html, /SharedTests\.fetch\(id\)/, 'a shared test is fetched when opened')
  assert.match(html, /\.\.\.local, \.\.\.sharedOnly/, 'the list is this PC\'s tests and the shared ones that are not on it')
  assert.match(html, /if \(run\.sharedBy\) \|\| |sharedBy: run\.sharedBy \|\| ''/, 'a test opened from someone else\'s share carries who shared it')
  assert.match(html, /if \(!this\.inHub\(\) \|\| !run \|\| !run\.finished \|\| run\.inProgress \|\| run\.imported\) return/, 'only finished tests, and not ones from a file or Ansur')
  // the hub answers the bench's three requests
  for (const t of ['chs-bench:hello', 'chs-bench:run', 'chs-bench:get-run', 'chs-bench:delete-run']) assert.ok(section.includes(`'${t}'`), `the hub handles ${t}`)
  assert.match(section, /m\.sharedBy && m\.sharedBy !== who\.current\.email/, 'someone else\'s shared test is not shared again under this engineer')
})

test('the device is powered after the electrical tests so it charges, unless a safety test failed, it is switched off in the settings, or the test was stopped', () => {
  assert.match(html, /chargeAfter: true/, 'on by default')
  assert.match(html, /data-pref="chargeAfter"/, 'a setting for it')
  assert.match(html, /async chargeAfterTests\(\)/)
  assert.match(html, /esa\.some\(s => \(run\.results\[s\.id\] \|\| \{\}\)\.status === 'fail'\)/, 'not a device that failed a safety test')
  assert.match(html, /this\.chargeAfterTests\(\);\s*\/\/ the tests are done/, 'at the end of the auto sequence')
  assert.match(html, /if \(!stopped && !Power\.on\) this\.chargeAfterTests\(\)/, 'and when the test finishes, but not when it is stopped')
  assert.match(html, /async start\(auto\)/, 'switched on without a question when the bench does it')
  assert.match(html, /if \(Power\.on\) Power\.off\(true\);\s*\/\/ the next device/, 'off again before the next device goes on the outlet')
})

test('an ESA612 still in remote mode (REMOTE refused with error 02) is reset with LOCAL and connects, instead of failing with a toast', () => {
  assert.match(html, /REMOTE refused \(error 02\)[\s\S]{0,260}await link\.send\('LOCAL'\)[\s\S]{0,120}await link\.send\('REMOTE', \{ retries: 3 \}\)/)
  assert.match(html, /opts\.stillRemote/, 'the simulator can mimic it')
  assert.match(html, /if \(c === 'REMOTE'\) \{ if \(esaRemote\) return reply\('!02'\)/)
})

test('Save PDF + Ansur file saves both together after asking where; Saved reports saves PDF and Ansur record for every test, making whichever is missing', () => {
  assert.match(html, /async function saveReportFiles\(run\)/)
  assert.match(html, /showDirectoryPicker\(\{ id: 'chs-test-bench-save', mode: 'readwrite', startIn: 'documents' \}\)/, 'asks where, opening where it was last')
  assert.match(html, /if \(!run\.imported\) files\.push\(\[outName\(run, 'mtr'\)/, 'the Ansur record is made too (not for one opened from an Ansur record)')
  assert.match(html, /\$\('#sumPdf'\)\.addEventListener\('click', \(\) => saveReportFiles\(\)\)/)
  assert.match(html, /m\.type !== 'chs-bench:build-pdf'/, 'the bench can build a PDF from a results file or an Ansur record')
  const reports = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.match(reports, /const needPdf = /)
  assert.match(reports, /await makePdf\(g\)/)
  assert.match(reports, /showDirectoryPicker\(\{ id: 'chs-test-bench-save'/, 'Saved reports asks where too')
  assert.match(reports, /remove\(\[\.\.\.files, \.\.\.stale\]/, 'removing a test removes the older copies of it too')
  assert.match(section, /'chs-bench:build-pdf'/)
})

test('the template tiles are compact: name and badges, the description only as a hover title', () => {
  assert.match(html, /class="tpl-tile\$\{c \? ' hl c-' \+ c : ''\}" data-id="\$\{t\.id\}" style="--ts:\$\{Layout\.tileScale\(t\)\}" aria-pressed="\$\{this\.picked === t\.id\}"\$\{title \? ` title="\$\{esc\(title\)\}"` : ''\}>/)
  assert.doesNotMatch(html, /<span class="muted" style="font-size:14px">\$\{esc\(t\.desc\)\}<\/span>/, 'no description text in the tile')
  assert.match(html, /\.tpl-pick\{display:grid;grid-template-columns:repeat\(auto-fill,minmax\(calc\(210px\*var\(--g,1\)\),1fr\)\)/)
})

test('each engineer arranges the Run a test page (move, group, colour, text size, models covered), searches it, and can publish a team layout', () => {
  assert.match(html, /const Layout = \{/)
  assert.match(html, /const LAYOUT_FILE = '_Run a test layout\.json'/, 'a file the template loader ignores (leading underscore)')
  for (const id of ['tplArrange', 'tplSearch', 'arrScale', 'arrPublish', 'arrReset']) assert.ok(html.includes(`id="${id}"`), id)
  for (const attr of ['draggable="true"', 'data-color', 'data-size', 'data-grp', 'data-mv', 'data-gmove', 'data-grename', 'data-covers']) assert.ok(html.includes(attr), attr)
  assert.match(html, /await Layout\.pullShared\(\);\s*\n\s*this\.count =/, 'the team layout is read with the shared folder')
  assert.match(html, /const r = await Layout\.pushShared\(\)/, 'Publish writes the team layout')
  assert.match(html, /Layout\.clearItem\(this\.tpl, 'color'\)/, 'the Templates page tick box takes over again')
  assert.match(html, /hits\.length === 1\) this\.pick/, 'Enter in the search picks a single match')
})

test('search finds a template by what it covers: N1 and V500 find Patient Monitor, series and wildcards work, every word must match', async () => {
  const { default: vm } = await import('node:vm')
  const a = html.indexOf('const CATEGORIES'), b = html.indexOf('/** Build a clean Test Bench template')
  const L = vm.runInNewContext('const DB = {}, clone = (o) => JSON.parse(JSON.stringify(o)); ' + html.slice(a, b) + '; ({ Layout, groupTemplates })')
  const pm = { name: 'Patient Monitor', desc: 'Class I', models: [] }, tm = { name: 'Mindray TM80 Telemetry Monitor', desc: '', models: [] }, an = { name: 'Mindray A9 Anaesthetic Machine', desc: '', models: [] }
  L.Layout.data = L.Layout.clean({ items: { 'name:patient monitor': { covers: ['ePM', 'uMEC', 'N-Series', 'V-Series', 'V200', 'V500', 'V700', 'VMAX'] } } })
  const m = (t, q) => L.Layout.matches(t, q)
  for (const q of ['N1', 'n12', 'N17', 'ePM', 'epm60', 'uMEC12', 'V500', 'v700', 'vmax', 'V3', 'patient', 'patient N1']) assert.ok(m(pm, q), q)
  assert.ok(!m(tm, 'N1') && !m(an, 'N1') && !m(pm, 'A9') && !m(pm, 'N1 anaesthetic'), 'only the template that covers it')
  assert.ok(m(tm, 'telemetry') && m(tm, 'tm8') && m(an, 'anaesth') && m(an, ''), 'name words and an empty search')
  L.Layout.data = L.Layout.clean({ items: { 'name:patient monitor': { covers: ['V5*'] } } })
  assert.ok(m(pm, 'V500') && !m(pm, 'V700'), 'wildcard')
  // colour, size and group of one user over the team's
  L.Layout.team = L.Layout.clean({ items: { 'name:patient monitor': { color: 'green', group: 'Monitoring' } } })
  L.Layout.data = L.Layout.clean({ items: { 'name:patient monitor': { color: 'red', size: 'xl' } } })
  assert.equal(L.Layout.color(pm), 'red'); assert.equal(L.Layout.cat(pm), 'Monitoring'); assert.equal(L.Layout.tileScale(pm), 1.45)
  assert.equal(L.Layout.color({ name: 'Other', highlight: true }), 'purple', 'a template highlighted in its file is purple')
  assert.equal(L.Layout.color({ name: 'Other' }), '')
  L.Layout.data = L.Layout.clean({ items: { 'name:patient monitor': { color: '' } } }); L.Layout.team = L.Layout.clean({})
  assert.equal(L.Layout.color({ name: 'Patient Monitor', highlight: true }), '', 'highlight can be switched off')
})
