// npm test --prefix apps/testbench — a test whose file is already on a Simpro job (sent from another laptop, or put there in Simpro)
// counts as sent to that job. Invented serial numbers only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { testsInFiles, addOnJob, withOnJob, groupReports } from '../src/reports.js'

const names = ['TP1-0001 - BeneHeart R700 09.11.2026.pdf', 'TP1-0002 - BeneHeart R700 09.11.2026 (rerun 2).mtr', 'N1-1 + TDS-2 - N1 09.11.2026.pdf', 'Quote.pdf']

test('a job’s file names become the tests they are: serial and day', () => {
  assert.deepEqual([...testsInFiles(names)].sort(), ['N1-1|09.11.2026', 'QUOTE|', 'TDS-2|09.11.2026', 'TP1-0001|09.11.2026', 'TP1-0002|09.11.2026'])
})

test('those tests show as sent to the job, on the same day only; others are unchanged', () => {
  const known = addOnJob({}, '#209653', names)
  const g = (serial, date, extra = {}) => ({ serial, date, sentTo: [], unsent: true, ...extra })
  const out = withOnJob([g('TP1-0001', '09.11.2026'), g('TP1-0001', '01.10.2026'), g('tp1-0002', '09.11.2026', { sentTo: ['#1'] }), g('TDS-2', '09.11.2026'), g('OTHER', '09.11.2026')], known)
  assert.deepEqual(out.map((x) => [x.sentTo, x.unsent]), [[['#209653'], false], [[], true], [['#1', '#209653'], false], [['#209653'], false], [[], true]])
  assert.deepEqual(addOnJob(known, '#209653', names), known, 'looking again adds nothing')
  assert.equal(withOnJob([g('A', '')], {})[0].unsent, true)
})

test('a results file never goes to Simpro, so it doesn’t keep a sent test "not sent"', () => {
  const rec = (name, sent) => ({ name, buffer: new ArrayBuffer(1), savedAt: 1, sent: sent ? [{ job: '#5', at: 1 }] : [], meta: { testedAt: '2026-11-09T00:00:00Z' } })
  const [one] = groupReports([rec('S1 - M 09.11.2026.pdf', true), rec('S1 - M 09.11.2026.json', false)])
  assert.equal(one.unsent, false)
  const [two] = groupReports([rec('S2 - M 09.11.2026.pdf', true), rec('S2 - M 09.11.2026.mtr', false)])
  assert.equal(two.unsent, true, 'an Ansur record not yet sent still counts')
  const [three] = groupReports([rec('S3 - M 09.11.2026.json', false)])
  assert.equal(three.unsent, true, 'nothing sent at all')
})

test('the hub reads the job’s files when a job is chosen in Saved reports, and for each order', () => {
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  assert.match(section, /listJobFiles\(call, companyId, jobId\)/)
  assert.match(section, /await noteJobFiles\(id\)/)
  const reports = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.match(reports, /if \(onJobFiles\) onJobFiles\(job\.id\)/)
  assert.match(reports, /withOnJob\(\[\.\.\.groupReports\(reports\)/)
})
