// The Ansur record (.mtr) the bench writes: every numerical list carries a <Limit> for each reading, as Ansur itself writes them.
// A numerical list with no <Limit> at all (the bench's Mains voltage step) froze Ansur 3.1.4's test guide on the Next that reached it
// (found 25/11/2026 on a Vetal 3 and a Rad-97 record; the same file with unit-only limits stepped through to the end).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
const a = html.indexOf('/* ======================= Ansur .mtr export')
const b = html.indexOf('async function exportMtr(')
assert.ok(a > 0 && b > a, 'the .mtr export section is where the test expects it')

function load() {
  const ctx = {
    TYPES: { esa_mains: { group: 'esa' }, esa_pe: { group: 'esa' }, numeric: {}, check: { group: 'check' } },
    buildEsaRows: (s) => s.params.rows,
    stepChecks: (s) => s.params.checks || [],
    reportSteps: (run) => run.template.steps.map((s) => ({ s })),
    overallOf: () => 'pass',
    otherDevices: () => [],
    deviceLine: () => '',
  }
  return vm.runInNewContext(html.slice(a, b) + '; ({ buildMtr, crc32, trimBytes })', ctx)
}

const run = {
  template: {
    name: 'Test monitor',
    steps: [
      { id: 'vis', type: 'check', title: 'Visual inspection', params: { checks: [{ kind: 'pf', label: 'Case undamaged' }] } },
      { id: 'mains', type: 'esa_mains', title: 'Mains voltage', params: { rows: [
        { label: 'Live – neutral', unit: 'V', lo: '', hi: '' }, { label: 'Live – earth', unit: 'V', lo: '', hi: '' }, { label: 'Neutral – earth', unit: 'V', lo: '', hi: '' }] } },
      { id: 'pe', type: 'esa_pe', title: 'Protective earth resistance', params: { rows: [{ label: 'Protective earth resistance', unit: 'Ω', lo: '', hi: 0.2 }] } },
      { id: 'mixed', type: 'check', title: 'CO2', params: { checks: [
        { kind: 'num', label: 'Leak test flow rate', unit: 'ml/min', lo: '', hi: 10 }, { kind: 'num', label: 'Note reading', unit: '', lo: '', hi: '' },
        { kind: 'num', label: 'Displayed CO2', unit: '%', lo: 5.7, hi: 6.3 }] } },
    ],
  },
  results: {
    vis: { status: 'done', rows: [{ result: 'pass' }] },
    mains: { status: 'done', rows: [{ result: 'pass', value: 230.2 }, { result: 'pass', value: 229.6 }, { result: 'pass', value: 0 }] },
    pe: { status: 'done', rows: [{ result: 'pass', value: 0.006 }] },
    mixed: { status: 'done', rows: [{ result: 'na' }, { result: 'pass', value: 3 }, { result: 'pass', value: 6.1 }] },
  },
  dut: { 'Serial number': 'TEST-1', Model: 'Test' },
  finished: '2026-11-25T10:00:00',
}

const text = (bytes) => Buffer.from(bytes).toString('latin1')
const element = (xml, name) => {
  const m = xml.match(new RegExp(`<TestElement ID="\\d+" Version="1">\\r\\n\\s*<PlugIn Name="AVPI" TestID="300"/>(?:(?!</TestElement>)[\\s\\S])*?<Name>${name}</Name>[\\s\\S]*?</TestElement>`))
  assert.ok(m, `numerical list ${name} is in the record`)
  return m[0]
}
const limitBlock = (el) => el.match(/<ExpectedResult>([\s\S]*?)<\/ExpectedResult>/)[1]

test('a numerical list with no limits gets a unit-only <Limit> for each reading, never an empty <Standard/>', () => {
  const xml = text(load().buildMtr(run))
  const lim = limitBlock(element(xml, 'Mains voltage'))
  assert.ok(!/<Standard [^>]*\/>/.test(lim), 'no self-closing Standard in a numerical list (that froze the Ansur test guide)')
  for (const k of [1, 2, 3]) assert.match(lim, new RegExp(`<Limit Key="S${k}">\\r\\n\\s*<Unit>V</Unit>\\r\\n\\s*</Limit>`), `S${k}: unit only`)
  assert.ok(!lim.includes('<Value'), 'no limit values are made up')
})

test('readings with limits keep them; in a mixed list every reading has a <Limit>, an empty one when it has no unit either', () => {
  const xml = text(load().buildMtr(run))
  const pe = limitBlock(element(xml, 'Protective earth resistance'))
  assert.match(pe, /<Limit Key="S1">\r\n\s*<Unit>Ohm<\/Unit>\r\n\s*<Value Type="High">\.2<\/Value>\r\n\s*<\/Limit>/)
  const co2 = limitBlock(element(xml, 'CO2'))
  assert.match(co2, /<Limit Key="S1">\r\n\s*<Unit>ml\/min<\/Unit>\r\n\s*<Value Type="High">10<\/Value>\r\n\s*<\/Limit>/)
  assert.match(co2, /<Limit Key="S2"\/>/)
  assert.match(co2, /<Limit Key="S3">\r\n\s*<Unit>%<\/Unit>\r\n\s*<Value Type="High">6\.3<\/Value>\r\n\s*<Value Type="Low">5\.7<\/Value>\r\n\s*<\/Limit>/)
})

test('every numerical list in the record has one <Limit> per step; checklists keep the plain <Standard/>', () => {
  const xml = text(load().buildMtr(run))
  const lists = [...xml.matchAll(/<PlugIn Name="AVPI" TestID="300"\/>[\s\S]*?<\/TestElement>/g)].map((m) => m[0])
  assert.equal(lists.length, 3)
  for (const el of lists) {
    const steps = [...el.matchAll(/<Step Key="(S\d+)"/g)].map((m) => m[1])
    const lims = [...limitBlock(el).matchAll(/<Limit Key="(S\d+)"/g)].map((m) => m[1])
    assert.deepEqual(lims, steps)
  }
  const vis = xml.match(/<PlugIn Name="AVPI" TestID="200"\/>[\s\S]*?<\/TestElement>/)[0]
  assert.match(limitBlock(vis), /^\s*<Standard AlphaName="Ansur" CompleteName="User defined"\/>\s*$/)
})

test('the file checksum (DIdCS) still matches the file, CRLF throughout outside the RTF', () => {
  const { buildMtr, crc32, trimBytes } = load()
  const bytes = buildMtr(run)
  const s = text(bytes)
  const m = s.match(/\r\n {4}<DIdCS>(-?\d+)<\/DIdCS>/)
  assert.ok(m, 'DIdCS line present')
  const without = Buffer.from(s.slice(0, m.index) + s.slice(m.index + m[0].length), 'latin1')
  assert.equal(crc32(trimBytes(new Uint8Array(without))), +m[1])
  const outsideRtf = s.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
  assert.ok(!/[^\r]\n/.test(outsideRtf), 'no bare LF outside the RTF instructions')
})
