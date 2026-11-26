// npm test -w apps/hub — a job already Complete or Archived in Simpro Asset Sync: its notes are checked for each device and only the missing ones are added
// (apps/simprosync/core.js, plus how app.js uses it). Fixture data only: made-up devices, no Simpro, nothing identifying.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SyncCore as C } from '../../simprosync/core.js'

const STAMP = 'EST and PVT completed - 27/11/2026'
const dev = (ser, extra = {}) => ({ ser, site: '100', model: 'Model-' + ser, deviceType: 'Monitor', batterySerial: '', ...extra })
const closed = (attach, already, notes, stage = 'Complete') => ({ jobNo: '501', attach, already, problems: [], closedStage: stage, job: { notes } })
const W = (serials = [], columnFound = false) => ({ columnFound, serials: new Set(serials), values: new Map() })
const text = (lines) => lines.map((l) => l.text)

test('a closed job: the devices already in its notes (by serial, spaces and case ignored) are not added again', () => {
  const j = closed([dev('F5 68092378'), dev('AA3-1')], [dev('TP1 69007909')], '<div>Model-TP1 69007909 — SN:tp169007909<br>f5 68092378</div>')
  assert.deepEqual(C.jobNotesMissing(j).map((a) => a.ser), ['AA3-1'])
  const b = C.jobNoteBlock(j, W(), STAMP)
  assert.deepEqual(text(b.lines), ['Model-AA3-1 — SN:AA3-1'], 'only the missing device is listed')
  assert.equal(b.html, `<div>Model-AA3-1 — SN:AA3-1</div><div>${STAMP}</div>`)
})

test('a closed job whose notes already list every device has nothing to add', () => {
  const j = closed([], [dev('A1'), dev('A2')], '<div>Model-A1 — SN:A1<br>Model-A2 — SN:A2</div><div>EST and PVT completed - 4/11/2026</div>')
  assert.deepEqual(C.jobNotesMissing(j), [])
  assert.deepEqual(C.jobNoteBlock(j, W(), STAMP).lines, [])
  assert.equal(C.jobNotePreview(j, W(), STAMP).state, 'unchanged')
})

test('a closed job with empty notes gets the full list and the stamp; with notes it is appended; an existing stamp is not repeated', () => {
  const none = closed([dev('A1')], [], '')
  assert.equal(C.jobNotePreview(none, W(), STAMP).state, 'write')
  assert.equal(C.jobNoteBlock(none, W(), STAMP).html, `<div>Model-A1 — SN:A1</div><div>${STAMP}</div>`)
  const some = closed([dev('A1')], [], '<div>Handover done</div>')
  assert.equal(C.jobNotePreview(some, W(), STAMP).state, 'append')
  const stamped = closed([dev('A1')], [], '<div>EST and PVT completed - 4/11/2026</div>')
  assert.equal(C.jobNoteBlock(stamped, W(), STAMP).html, '<div>Model-A1 — SN:A1</div>', 'the "EST and PVT completed" line is not added a second time')
})

test('the missing devices are grouped by Extended Warranty like any job note', () => {
  const j = closed([dev('A1'), dev('A2'), dev('A3')], [], '<div>Model-A3 — SN:A3</div>')
  assert.deepEqual(text(C.jobNoteBlock(j, W(['A2'], true), STAMP).lines), ['Extended Warranty required on these devices:', 'Model-A2 — SN:A2', '', 'Other devices added:', 'Model-A1 — SN:A1'])
})

test('a job that is not closed is written exactly as before', () => {
  const open = { jobNo: '501', attach: [dev('A1')], already: [dev('A2')], problems: [], job: { notes: '<div>Model-A1 — SN:A1</div>' } }
  assert.deepEqual(text(C.jobNoteBlock(open, W(), STAMP).lines), ['Model-A1 — SN:A1', 'Model-A2 — SN:A2'], 'everything is listed, even what the notes have')
  assert.equal(C.jobNoteBlock(open, W(), STAMP).html, `<div>Model-A1 — SN:A1<br>Model-A2 — SN:A2</div><div>${STAMP}</div>`)
})

test('app.js: Complete and Archived jobs are updated without touching their stage or status; Invoiced is still left alone', () => {
  const src = readFileSync(new URL('../../simprosync/app.js', import.meta.url), 'utf8').replaceAll(String.fromCharCode(13), '')
  assert.ok(src.includes("const CLOSE_CHECKED = ['Complete', 'Archived'];"))
  assert.ok(src.includes("if (CLOSE_CHECKED.includes(jp.job.stage)) jp.closedStage = jp.job.stage;\n      else if (CLOSED_STAGES.includes(jp.job.stage)) jp.problems.push(`Job is already at stage \"${jp.job.stage}\" - left alone`);"))
  // nothing to do: left alone, as before
  assert.ok(src.includes('and its notes already list every device - left alone'))
  // Apply: the closed branch writes only Notes and leaves before the Stage and Status calls
  const a = src.indexOf('if (jp.closedStage) {\n          // Already Complete or Archived'), b = src.indexOf("let r = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Stage: 'Complete' });")
  assert.ok(a > 0 && b > a, 'the closed branch comes before the Stage call')
  const branch = src.slice(a, src.indexOf('          continue;\n        }', a) + '          continue;\n        }'.length)
  assert.ok(branch.length > 100 && a + branch.length < b, 'the branch ends before the normal flow starts')
  assert.ok(/\{ Notes: /.test(branch) && !/\{ (Stage|Status)\b/.test(branch), 'only Notes is written: no Stage or Status in any PATCH')
  assert.equal((branch.match(/call\('PATCH'/g) || []).length, 1, 'one PATCH, for the notes')
  assert.ok(/continue;\s*\}\s*$/.test(branch.trimEnd()), 'and it moves on to the next job')
})
