import test from 'node:test'
import assert from 'node:assert/strict'
import { readTar } from '../src/tar.js'
import { lzo1x, unlzop, isLzop } from '../src/lzo.js'
import { familyOf, rotationOf, parseLog, mergeLines, fmtTime, parseLocalInput, csvCell } from '../src/lines.js'
import { filterIndexes, makeMatcher } from '../src/filter.js'
import { shockTable, marker } from '../src/defib.js'

const enc = new TextEncoder()
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

/** A one-file tar, the way `tar` writes it. */
function makeTar(files) {
  const parts = []
  for (const [name, text] of files) {
    const data = enc.encode(text)
    const h = new Uint8Array(512)
    h.set(enc.encode(name), 0)
    h.set(enc.encode(data.length.toString(8).padStart(11, '0') + '\0'), 124)
    h[156] = 48
    h.set(enc.encode('ustar\0' + '00'), 257)
    h.fill(32, 148, 156)
    let sum = 0; for (const b of h) sum += b
    h.set(enc.encode(sum.toString(8).padStart(6, '0') + '\0 '), 148)
    parts.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512))
  }
  parts.push(new Uint8Array(1024))
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

test('tar: lists files and their contents', () => {
  const tar = makeTar([['var/log/A.log', 'hello'], ['var/log/B.log.1', 'x'.repeat(700)]])
  const f = readTar(tar)
  assert.deepEqual(f.map(x => x.name), ['var/log/A.log', 'var/log/B.log.1'])
  assert.equal(new TextDecoder().decode(f[0].data), 'hello')
  assert.equal(f[1].size, 700)
})

test('tar: something else is refused with a plain message', () => {
  assert.throws(() => readTar(new Uint8Array(2048).fill(7)), /not a tar/)
  const tar = makeTar([['a', 'hello']])
  assert.throws(() => readTar(tar.subarray(0, 514)), /cut short/)
})

// lzo1x: "abc" as literals, a 6-byte match 3 back, then the end marker
const BLOCK = Uint8Array.from([17 + 3, 97, 98, 99, 168, 0, 17, 0, 0])

test('lzo1x: literals, a match and the end marker', () => {
  const out = new Uint8Array(9)
  lzo1x(BLOCK, out, 9)
  assert.equal(new TextDecoder().decode(out), 'abcabcabc')
})

test('lzo1x: damaged data throws instead of returning something', () => {
  assert.throws(() => lzo1x(BLOCK, new Uint8Array(8), 8), /damaged/)
  assert.throws(() => lzo1x(BLOCK.subarray(0, 5), new Uint8Array(9), 9), /cut short/)
  assert.throws(() => lzo1x(BLOCK, new Uint8Array(12), 12), /wrong length/)
})

function lzop(blocks) {
  const head = [0x89, 0x4c, 0x5a, 0x4f, 0, 0x0d, 0x0a, 0x1a, 0x0a,
    0x10, 0x30, 0x20, 0x60, 0x09, 0x40, 1, 5, // version, lib version, version needed, method, level
    ...be32(0), ...be32(0o100644), ...be32(0), ...be32(0), 0, ...be32(0)] // flags, mode, mtime, mtime_high, name length, header checksum
  const out = [...head]
  for (const [u, c, data] of blocks) out.push(...be32(u), ...be32(c), ...data)
  out.push(...be32(0))
  return Uint8Array.from(out)
}

test('unlzop: reads the container, compressed and stored blocks', () => {
  // 'abc' then a 12-byte match 3 back (smaller than its output, so it is a compressed block), then a stored block
  const packed = Uint8Array.from([17 + 3, 97, 98, 99, 42, 8, 0, 17, 0, 0])
  const file = lzop([[15, packed.length, packed], [3, 3, enc.encode('xyz')]])
  assert.ok(isLzop(file))
  assert.equal(new TextDecoder().decode(unlzop(file)), 'abcabcabcabcabcxyz')
  assert.ok(!isLzop(enc.encode('hello hello hello')))
  assert.throws(() => unlzop(file.subarray(0, file.length - 8)), /cut short/)
})

test('file names: families and rotations', () => {
  assert.equal(familyOf('var/log/PrintServerLog.log.2.lzo'), 'PrintServerLog')
  assert.equal(familyOf('var/log/PrintServerLog.log'), 'PrintServerLog')
  assert.equal(familyOf('sys.log.0.lzo'), 'sys')
  assert.equal(familyOf('important_info_log.txt'), 'important_info_log')
  assert.equal(rotationOf('PrintServerLog.log.2.lzo'), 2)
  assert.equal(rotationOf('PrintServerLog.log'), 0)
})

const L = (s, file = 0) => parseLog(s, file)

test('parseLog: both line shapes, continuation lines, source and level', () => {
  const lines = L([
    '11/12/26 09:22:06 INFO - StartGuid SaveShockData, wave Size:250, sparkEnergy:2042, tick:0 [MD2ServerImpByNet.cpp:390]',
    '11/12/26 09:22:22 789017504 ERROR- MPrintSearch::ProcessSearchPrinter status=33554432 [PrintSearch.cpp:217]',
    '  at something wrapped',
    '11/12/26 09:22:27 789017504 INFO - Report::Report:Shock Report (AED) [ReportJob.cpp:101]\r',
  ].join('\n'))
  assert.equal(lines.length, 3)
  assert.equal(lines[0].lvl, 'INFO'); assert.equal(lines[0].thr, ''); assert.equal(lines[0].src, 'MD2ServerImpByNet.cpp:390')
  assert.equal(lines[1].thr, '789017504'); assert.equal(lines[1].lvl, 'ERROR')
  assert.match(lines[1].msg, /status=33554432\nat something wrapped|wrapped/)
  assert.equal(lines[2].msg, 'Report::Report:Shock Report (AED)')
  assert.equal(fmtTime(lines[0].t), '2026-11-12 09:22:06')
})

test('parseLog: 1970 lines are early and take the time of their neighbours', () => {
  const lines = L([
    '01/01/70 00:00:03 INFO - boot a',
    '01/01/70 00:00:05 INFO - boot b',
    '11/12/26 07:00:00 INFO - clock set',
    '01/01/70 00:00:09 INFO - odd',
  ].join('\n'))
  assert.deepEqual(lines.map(l => l.early), [true, true, false, true])
  assert.equal(fmtTime(lines[0].t), '2026-11-12 07:00:00') // leading ones take the first real time
  assert.equal(fmtTime(lines[3].t), '2026-11-12 07:00:00')
})

test('mergeLines: time order across files, older file first on a tie', () => {
  const a = L('11/12/26 09:00:02 INFO - a2\n11/12/26 09:00:05 INFO - a5', 0)
  const b = L('11/12/26 09:00:03 INFO - b3\n11/12/26 09:00:05 INFO - b5', 1)
  assert.deepEqual(mergeLines([a, b]).map(l => l.msg), ['a2', 'b3', 'a5', 'b5'])
})

test('time boxes: written and read back as shown', () => {
  const t = parseLocalInput('2026-11-12T09:22')
  assert.equal(fmtTime(t), '2026-11-12 09:22:00')
  assert.ok(Number.isNaN(parseLocalInput('')))
  assert.ok(Number.isNaN(parseLocalInput('yesterday')))
})

test('csvCell: quotes, and keeps a spreadsheet from running a formula', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('=1+1'), "'=1+1")
  assert.equal(csvCell(null), '')
  assert.equal(csvCell(12), '12')
})

const sample = L([
  '11/12/26 09:00:00 INFO - one', '11/12/26 09:00:01 ERROR- two boom', '11/12/26 09:00:02 INFO - three',
  '11/12/26 09:00:03 DEBUG- four', '11/12/26 09:00:04 INFO - five boom', '11/12/26 09:00:05 INFO - six',
].join('\n'))

test('filter: levels, time range and search with context', () => {
  assert.deepEqual(filterIndexes(sample, {}), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(filterIndexes(sample, { levels: new Set(['ERROR']) }), [1])
  assert.deepEqual(filterIndexes(sample, { from: sample[2].t, to: sample[3].t }), [2, 3])
  assert.deepEqual(filterIndexes(sample, { test: makeMatcher('BOOM').test }), [1, 4])
  assert.deepEqual(filterIndexes(sample, { test: makeMatcher('boom').test, context: 1 }), [0, 1, 2, 3, 4, 5])
  assert.deepEqual(filterIndexes(sample, { test: makeMatcher('^f(our|ive)', true).test }), [3, 4])
  assert.ok(makeMatcher('(', true).error)
})

// The shock table, on made-up lines shaped like the real logs
const backend = L([
  '11/12/26 09:00:00 INFO - Last power Off type = 2 [MPowerNormalController.cpp:1119]',
  '11/12/26 09:00:30 INFO - StartGuid SaveShockData, wave Size:250, sparkEnergy:2042, tick:0 [MD2ServerImpByNet.cpp:390]',
  '11/12/26 09:10:02 INFO - Last power Off type = 3 [MPowerNormalController.cpp:1119]',
  '11/12/26 09:10:06 INFO - StartGuid SaveShockData, wave Size:250, sparkEnergy:3700, tick:0 [MD2ServerImpByNet.cpp:390]',
  '11/12/26 09:30:00 INFO - StartGuid SaveShockData, wave Size:250, sparkEnergy:3700, tick:0 [MD2ServerImpByNet.cpp:390]',
].join('\n'))
const print = L([
  '11/12/26 09:00:02 700 INFO - Recorder_Open-1 [RecorderUartDataSender.cpp:67]',
  '11/12/26 09:00:31 800 INFO - Report::Report:Shock Report (Manual Defib) [ReportJob.cpp:101]',
  '11/12/26 09:00:35 800 INFO - Recorder Log:       150 E gHardErr[2] 30 [RecorderReport.cpp:962]',
  '11/12/26 09:10:04 700 INFO - Recorder_Open-1 [RecorderUartDataSender.cpp:67]',
  '11/12/26 09:10:10 800 ERROR- MPrintSearch::ProcessSearchPrinter status=33554432 [PrintSearch.cpp:217]',
  '11/12/26 09:10:27 800 INFO - Report::Report:Shock Report (AED) [ReportJob.cpp:101]',
].join('\n'))

test('shock table: fast, slow and no report', () => {
  const rows = shockTable(backend, print)
  assert.equal(rows.length, 3)
  const [a, b, c] = rows
  assert.deepEqual([a.status, a.sinceBoot, a.recorderRel, a.delay, a.report, a.hardErr, a.bootType], ['ok', 30, -28, 1, 'Shock Report (Manual Defib)', 30, '2'])
  assert.deepEqual([b.status, b.sinceBoot, b.recorderRel, b.delay, b.report, b.errors], ['slow', 4, -2, 21, 'Shock Report (AED)', 1])
  assert.deepEqual([c.status, c.delay, c.report], ['none', null, ''])
  assert.equal(b.energy, 3700)
  assert.equal(shockTable(backend, print, { slowSecs: 30 })[1].status, 'ok')
})

test('shock table: a report only counts inside the wait window', () => {
  assert.equal(shockTable(backend, print, { windowSecs: 10 })[1].status, 'none')
})

test('markers: the lines worth marking on the timeline', () => {
  assert.equal(marker(backend[1]).kind, 'shock')
  assert.equal(marker(backend[0]).kind, 'boot')
  assert.equal(marker(print[0]).kind, 'recorder')
  assert.equal(marker(print[1]).label, 'Shock Report (Manual Defib)')
  assert.equal(marker(sample[0]), null)
})

// Alarm records, shaped like the device's BackendLog (tab-separated)
import { parseAlarm, alarmEvents, alarmSummary, filterEvents, alarmMarker } from '../src/alarms.js'
const al = (t, name, start, pri, type, edge) => `11/13/26 ${t} INFO - \t\t${name}\t${start}\tAlarmPriority_${pri}\t${type}\t/\tAlarm ${edge}\t [AlarmInfoLogManager.cpp:1332]`
const alarmLines = L([
  al('08:49:14', 'Recorder Initializing', '2026-11-13 8:49:13', 'Prompt', 'Technical', 'Begin'),
  al('08:49:21', 'Recorder Initializing', '2026-11-13 8:49:13', 'Prompt', 'Technical', 'End'),
  al('09:00:00', 'HR High', '2026-11-13 9:00:00', 'High', 'Physiological', 'Begin'),
  al('09:00:00', 'HR High', '2026-11-13 9:00:00', 'High', 'Physiological', 'Begin'), // logged twice
  al('09:05:30', 'HR High', '2026-11-13 9:00:00', 'High', 'Physiological', 'End'),
  al('09:10:00', 'Low Battery', '2026-11-13 9:10:00', 'Medium', 'Technical', 'Begin'),
  al('09:20:00', 'Old One', '2026-11-12 23:00:00', 'Low', 'Technical', 'End'),
  '11/13/26 09:30:00 INFO - some other line',
].join('\n'))

test('alarms: a record line is read; other lines are not', () => {
  const a = parseAlarm(alarmLines[0])
  assert.deepEqual([a.name, a.priority, a.type, a.edge, fmtTime(a.start)], ['Recorder Initializing', 'Prompt', 'Technical', 'Begin', '2026-11-13 08:49:13'])
  assert.equal(parseAlarm(alarmLines[alarmLines.length - 1]), null)
  assert.equal(alarmMarker(alarmLines[2]).label, 'High physiological alarm begin')
})

test('alarms: begin and end are paired, a repeated begin counted once', () => {
  const ev = alarmEvents(alarmLines)
  assert.equal(ev.length, 4)
  const byName = Object.fromEntries(ev.map(e => [e.name, e]))
  assert.deepEqual([byName['Recorder Initializing'].status, byName['Recorder Initializing'].secs], ['cleared', 8])
  assert.deepEqual([byName['HR High'].status, byName['HR High'].secs], ['cleared', 330])
  assert.equal(byName['Low Battery'].status, 'open')
  assert.equal(byName['Old One'].status, 'noBegin')
  assert.deepEqual(ev.map(e => e.name), ['Old One', 'Recorder Initializing', 'HR High', 'Low Battery']) // by start time
})

test('alarms: filters by priority, type, name and time; summary counts', () => {
  const ev = alarmEvents(alarmLines)
  assert.deepEqual(filterEvents(ev, { priorities: new Set(['High']) }).map(e => e.name), ['HR High'])
  assert.deepEqual(filterEvents(ev, { types: new Set(['Technical']) }).length, 3)
  assert.deepEqual(filterEvents(ev, { priorities: new Set(['High', 'Medium']), types: new Set(['Technical']) }).map(e => e.name), ['Low Battery'])
  assert.deepEqual(filterEvents(ev, { text: 'RECORDER' }).length, 1)
  assert.deepEqual(filterEvents(ev, { from: Date.UTC(2026, 10, 13, 9, 0, 0) }).map(e => e.name), ['HR High', 'Low Battery'])
  const sum = alarmSummary([...ev, ...alarmEvents(alarmLines)])
  assert.equal(sum.find(s => s.name === 'HR High').count, 2)
})
