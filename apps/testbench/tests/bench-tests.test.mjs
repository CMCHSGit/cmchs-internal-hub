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

test('Save keeps the PDF and Ansur record in Saved reports, Download writes both after asking where; Saved reports saves PDF and Ansur record for every test, making whichever is missing', () => {
  assert.match(html, /async function saveReportFiles\(run, mode = 'download'\)/)
  assert.match(html, /showDirectoryPicker\(\{ id: 'chs-test-bench-save', mode: 'readwrite', startIn: 'documents' \}\)/, 'asks where, opening where it was last')
  assert.ok(html.includes("if (kinds !== 'pdf' && !run.imported) files.push([outName(run, 'mtr')"), 'the Ansur record is made too (not for one opened from an Ansur record)')
  assert.match(html, /\$\('#sumSave'\)\.addEventListener\('click', \(\) => saveReportFiles\(null, 'save'\)\)/, 'Save keeps both in Saved reports')
  assert.match(html, /\$\('#sumDownload'\)\.addEventListener\('click', \(\) => saveReportFiles\(null, 'download'\)\)/, 'Download writes both to a folder')
  assert.ok(html.includes('if (keep) { offerToHub(name, blob, true); continue; }'), 'Save asks for no folder and writes no file')
  assert.match(html, /if \(!keep && typeof window\.showDirectoryPicker === 'function'\)/, 'only Download asks where')
  assert.doesNotMatch(html, /id="sumExport"|id="sumMtr"/, 'no results-file or Ansur-only button')
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

test('a "Test this device" link carries the model and serial, is read once and taken out of the address, and opens the bench on the right template', async () => {
  const { deviceFromSearch, LINK_PARAMS } = await import('../src/device-link.js')
  const r = deviceFromSearch('?model=BeneHeart%20D30&serial=FP5-6A036796&manufacturer=Mindray&asset=CHS-1&site=2350&keep=1')
  assert.deepEqual(r.device, { model: 'BeneHeart D30', serial: 'FP5-6A036796', manufacturer: 'Mindray', site: '2350', asset: 'CHS-1' })
  assert.equal(r.rest, '?keep=1', 'other parameters stay')
  assert.deepEqual(deviceFromSearch('?next=%2Ftestbench%2F'), { device: null, rest: '?next=%2Ftestbench%2F' }, 'not a device link')
  assert.equal(deviceFromSearch('?model=' + 'x'.repeat(500)).device.model.length, 120, 'long values are cut')
  assert.equal(deviceFromSearch('?serial=a%00b%0Ac').device.serial, 'a b c', 'control characters go')
  assert.ok(LINK_PARAMS.includes('template'))
  const sec = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.match(sec, /m\?\.type === 'chs-bench:hello'\) \{ sendShared\(\); sendDevice\(\)/, 'handed to the bench when it says hello')
  assert.match(sec, /type: 'chs-bench:open-device'/)
  assert.match(html, /e\.data\.type === 'chs-bench:open-device'\) this\.openDevice\(e\.data\.device\)/)
  assert.match(html, /if \(this\.pendingDevice\) \{ const d = this\.pendingDevice; this\.pendingDevice = null; this\.fillDevice\(d\); \}/, 'the details are filled in when the template is picked, by the link or by hand')
  assert.match(html, /A test is in progress\. Finish or stop it, then open the link again/, 'a test in progress is never replaced')
})

test('the template for a device model: one clear match, else none (the bench then offers the search)', async () => {
  const { default: vm } = await import('node:vm')
  const { readdirSync } = await import('node:fs')
  const a = html.indexOf('const CATEGORIES'), b = html.indexOf('/** Build a clean Test Bench template')
  const L = vm.runInNewContext('const DB = {}, clone = (o) => JSON.parse(JSON.stringify(o)); ' + html.slice(a, b) + '; ({ Layout })').Layout
  const dir = new URL('../templates/', import.meta.url)
  const list = readdirSync(dir).filter(n => n.endsWith('.json') && !n.startsWith('_')).map(n => JSON.parse(readFileSync(new URL(n, dir), 'utf8')).template)
  L.data = L.clean({ items: { 'name:patient monitor and or modules': { covers: ['ePM', 'uMEC', 'N-Series', 'V-Series', 'V200', 'V500', 'V700', 'VMAX'] } } })
  const best = (m) => (L.bestFor(list, m) || {}).name || null
  assert.equal(best('BeneHeart D1 Pro'), 'Mindray BeneHeart D1 Defibrillator')
  assert.equal(best('BeneVision N12'), 'Patient Monitor and OR Modules')
  assert.equal(best('V500'), 'Patient Monitor and OR Modules')
  assert.equal(best('PM-60'), 'Mindray BeneVision PM-60 Patient Monitor')
  assert.equal(best('VS-600'), 'Mindray VS-600 / VS-900 Vital Signs Monitor')
  assert.equal(best('Nonexistent X99'), null, 'a model with a number that no template lists')
  assert.equal(best(''), null)
})

test('the Excel script puts a button-looking link first, replaces an older one, and the bench no longer writes the column itself', () => {
  const ps = readFileSync(new URL('../tools/add-test-link-column.ps1', import.meta.url), 'utf8')
  assert.ok(ps.includes('ListColumns.Add(1)'), 'Excel inserts the column first')
  assert.ok(ps.includes('.Delete(); $replaced = $true'), 'an older column is replaced')
  assert.ok(ps.includes(`FormatConditions.Add(1, 4, '=""')`), 'rows with a link look like buttons, rows without stay plain')
  assert.ok(ps.includes('Interior.Color = 9848149; $fc.Font.Color = 16777215'), 'white on CHS purple')
  assert.ok(ps.includes('Font.Color = 0'), 'a black header: red means mandatory')
  assert.ok(ps.includes("'Old'"), 'a copy is kept first')
  assert.ok(ps.includes('https://internal.chsnz.co.nz/testbench/') && ps.includes("'?'") && ps.includes('SUBSTITUTE('), 'the link is built from plain SUBSTITUTE calls')
  assert.ok(!ps.split('\n').filter((l) => !/^\s*(#|\.)/.test(l)).join('\n').includes('ENCODEURL(['), 'no ENCODEURL in the formula (not in every Excel)')
  assert.ok(ps.includes('-Pick'))
  assert.ok(!html.includes('addLinkColumn') && !html.includes('data-sheet="addLinks"'), 'the bench does not write the column itself')
})

test('a browser with no folder picker (Firefox) loads the templates published with the site, read-only, and the build publishes them', () => {
  assert.match(html, /if \(!this\.supported\(\)\) \{ this\.state = 'unsupported'; this\.render\(\); await this\.loadPublished\(\); return; \}/)
  assert.match(html, /async loadPublished\(\)/)
  assert.match(html, /fetch\('templates\/index\.json', \{ cache: 'no-store' \}\)/)
  assert.match(html, /existing\.shared\.v === e\.v \|\| existing\.sharedDirty/, 'an unchanged one, or one changed on this PC, is left alone')
  assert.match(html, /t\.shared\.published\) \{ el\.innerHTML/, 'its note says it is a published copy')
  const build = readFileSync(new URL('../../../scripts/build.mjs', import.meta.url), 'utf8')
  assert.match(build, /bench-app\/templates/); assert.match(build, /writeFileSync\(join\(to, 'index\.json'\)/)
  const sync = readFileSync(new URL('../tools/sync-templates.mjs', import.meta.url), 'utf8')
  assert.match(sync, /_Run a test layout\.json/, 'the team layout goes with the templates')
})

test('the logo, "Test Bench" and the hub\'s Test Bench tab take a finished test back to Choose a template, never leaving one in progress', () => {
  assert.ok(html.includes("$('.brand').addEventListener('click', (e) => this.home(e))"))
  assert.ok(html.includes("e.data.type === 'chs-bench:home') this.home()"), 'the hub can ask too')
  const home = html.slice(html.indexOf('  home(e) {'), html.indexOf('  nextDevice() {'))
  assert.ok(home.includes("if (!$('#runActive').hidden) { this.show('run'); return; }"), 'a test in progress is only shown')
  assert.ok(home.includes("$('#runSummary').hidden = true; $('#runSetup').hidden = false") && home.includes("$('#tplSearch').value = ''") && home.includes('this.refreshRunPicker()'))
  const sec = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.ok(sec.includes("if (tab === 'bench') toBench({ type: 'chs-bench:home' })"), 'the open Test Bench tab, clicked again')
})

test('Save and Download make the files you choose: PDF and Ansur record, PDF only, or Ansur record only', () => {
  assert.ok(html.includes('id="sumKinds"') && html.includes('<option value="pdf">PDF only</option>') && html.includes('<option value="mtr">Ansur record (.mtr) only</option>') && html.includes('<option value="both">PDF and Ansur record</option>'))
  assert.ok(html.includes("saveKinds: 'both'"), 'both by default')
  assert.ok(html.includes("Prefs.set('saveKinds', e.target.value)"), 'remembered')
  assert.ok(html.includes("if (kinds !== 'mtr') files.push([ReportPdf.fileName(run)") && html.includes("if (kinds !== 'pdf' && !run.imported) files.push([outName(run, 'mtr')"))
  assert.ok(html.includes('offerToHub(name, blob, true)') && html.includes('if (!only && mtrName !== name'), 'a PDF-only Save does not add the Ansur record on its own')
  assert.ok(html.includes('so that file already exists'), 'a test opened from an Ansur record has no .mtr to make')
})

test('Rerun test starts the same template on the same device from the first step, as a new test', () => {
  assert.ok(html.includes('id="sumRerun"') && html.includes("$('#sumRerun').addEventListener('click', () => this.rerun())"))
  const fn = html.slice(html.indexOf('  rerun() {'), html.indexOf('  nextDevice() {'))
  assert.ok(fn.includes('Runner.start(t, clone(run.dut), run.model)'), 'the same details and model, a fresh run')
  assert.ok(fn.includes('Power.off(true)') && fn.includes('stays in Previous tests'))
})
