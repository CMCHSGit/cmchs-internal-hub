// npm test -w apps/hub — the job notes Simpro Asset Sync writes, and their preview (apps/simprosync/core.js), given the
// sheet's "Extended Warranty" column. Fixture data only: made-up devices, no Simpro, nothing identifying.
// The point of every case: the preview must show exactly the note Apply writes, and say what Apply will do with it.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SyncCore as C } from '../../simprosync/core.js'

const STAMP = 'EST and PVT completed - 7/10/2026'
const dev = (ser, extra = {}) => ({ ser, site: '100', model: 'Model-' + ser, deviceType: 'Monitor', batterySerial: '', ...extra })
const jp = (attach, already = [], over = {}) => ({ jobNo: '501', attach, already, problems: [], job: { notes: '' }, ...over })
const W = (serials, columnFound = true, values = []) => ({ columnFound, serials: new Set(serials), values: new Map(values) })
const text = (lines) => lines.map((l) => l.text)

test('no Extended Warranty column: one flat list, no warranty headings', () => {
  const b = C.jobNoteBlock(jp([dev('A1'), dev('A2')]), W([], false), STAMP)
  assert.deepEqual(text(b.lines), ['Model-A1 — SN:A1', 'Model-A2 — SN:A2'])
  assert.ok(b.lines.every((l) => l.kind === 'flat'))
  assert.equal(b.html, `<div>Model-A1 — SN:A1<br>Model-A2 — SN:A2</div><div>${STAMP}</div>`)
})

test('devices marked Yes go under the Extended Warranty heading, the rest under Other devices added', () => {
  const b = C.jobNoteBlock(jp([dev('A1'), dev('A2'), dev('A3')]), W(['A2']), STAMP)
  assert.deepEqual(text(b.lines), [
    'Extended Warranty required on these devices:', 'Model-A2 — SN:A2', '',
    'Other devices added:', 'Model-A1 — SN:A1', 'Model-A3 — SN:A3',
  ])
  assert.deepEqual(b.lines.map((l) => l.kind), ['head', 'warranty', 'blank', 'head', 'other', 'other'])
  // exactly what Simpro receives: one <div>, <br> between lines, the blank line as a double <br>
  assert.equal(b.html, `<div>Extended Warranty required on these devices:<br>Model-A2 — SN:A2<br><br>Other devices added:<br>Model-A1 — SN:A1<br>Model-A3 — SN:A3</div><div>${STAMP}</div>`)
})

test('nothing on warranty says so, and the rest are "Devices added" (not "Other")', () => {
  const b = C.jobNoteBlock(jp([dev('A1')]), W(['ZZ']), STAMP)
  assert.deepEqual(text(b.lines), ['No devices require Extended Warranty.', '', 'Devices added:', 'Model-A1 — SN:A1'])
})

test('every device on warranty: no Other section and no trailing blank line', () => {
  const b = C.jobNoteBlock(jp([dev('A1'), dev('A2')]), W(['A1', 'A2']), STAMP)
  assert.deepEqual(text(b.lines), ['Extended Warranty required on these devices:', 'Model-A1 — SN:A1', 'Model-A2 — SN:A2'])
})

test('already-attached devices are in the note too, and the warranty match ignores serial case', () => {
  const b = C.jobNoteBlock(jp([dev('a1')], [dev('B2')]), W(['A1', 'B2']), STAMP)
  assert.deepEqual(text(b.lines).filter((t) => t.includes('SN:')), ['Model-a1 — SN:a1', 'Model-B2 — SN:B2'])
  assert.equal(b.lines.filter((l) => l.kind === 'warranty').length, 2)
})

test('a defibrillator shows its battery serial; a device with no model shows just the serial; markup is escaped', () => {
  const b = C.jobNoteBlock(jp([dev('D1', { deviceType: 'AED Defibrillator', batterySerial: 'BAT-1' }), dev('M1', { model: '' }), dev('X1', { model: 'A<b>&B' }), dev('M2', { batterySerial: 'BAT-2' })]), W([], false), STAMP)
  assert.deepEqual(text(b.lines), ['Model-D1 — SN:D1 (Battery SN:BAT-1)', 'SN:M1', 'A<b>&B — SN:X1', 'Model-M2 — SN:M2'])   // M2 is not a defibrillator: no battery
  assert.match(b.html, /A&lt;b&gt;&amp;B/)
  assert.doesNotMatch(b.html, /<b>/)
})

test('a job with no assets has no list, only the date line', () => {
  const b = C.jobNoteBlock(jp([]), W(['A1']), STAMP)
  assert.deepEqual(b.lines, [])
  assert.equal(b.html, `<div>${STAMP}</div>`)
})

/* ---- reading the column ---- */
const sheet = (header, rows) => C.toRecords([header, ...rows])

test('warrantyScan: Yes in any case counts, serials are upper-cased, other values are tallied', () => {
  const s = C.warrantyScan([sheet(['Serial Number', 'Extended Warranty'], [['ab1', 'Yes'], ['ab2', ' YES '], ['ab3', 'No'], ['ab4', 'Y'], ['ab5', ''], ['ab6', 'Yes - 3 years']])])
  assert.equal(s.columnFound, true)
  assert.deepEqual([...s.serials].sort(), ['AB1', 'AB2'])
  assert.equal(s.values.get('No'), 1)
  assert.equal(s.values.get('Y'), 1)
  assert.equal(s.values.get('Yes - 3 years'), 1)
  assert.equal(s.values.has(''), false)
})

test('warrantyScan: no column in any sheet means columnFound false; a column without a Serial Number still counts as found', () => {
  assert.equal(C.warrantyScan([sheet(['Serial Number', 'Model'], [['A1', 'M']])]).columnFound, false)
  assert.equal(C.warrantyScan([]).columnFound, false)
  const s = C.warrantyScan([sheet(['Serial', 'Extended Warranty'], [['A1', 'Yes']])])
  assert.equal(s.columnFound, true)
  assert.equal(s.serials.size, 0)
})

test('warrantyScan: a header with a skipped cell does not throw; serials from several sheets are merged', () => {
  const holey = { header: ['Serial Number', undefined, 'Extended Warranty'], recs: [{ rownum: 2, r: { 'Serial Number': 'h1', 'Extended Warranty': 'yes' } }] }
  const s = C.warrantyScan([holey, sheet(['Serial Number', 'extended warranty'], [['h2', 'Yes']])])
  assert.deepEqual([...s.serials].sort(), ['H1', 'H2'])
})

/* ---- the preview of one job ---- */
test('preview state: write on empty notes, append after existing ones', () => {
  const w = W(['A1'])
  assert.equal(C.jobNotePreview(jp([dev('A1')]), w, STAMP).state, 'write')
  assert.equal(C.jobNotePreview(jp([dev('A1')], [], { job: { notes: '<div>Site visit booked</div>' } }), w, STAMP).state, 'append')
  const v = C.jobNotePreview(jp([dev('A1')], [], { job: { notes: '<div>Site visit booked</div>' } }), w, STAMP)
  assert.equal(v.existingChars, 'Site visit booked'.length)
})

test('preview state: unchanged only when the exact block (same list, same date) is already there', () => {
  const w = W(['A1'])
  const written = C.jobNoteBlock(jp([dev('A1')]), w, STAMP).html
  assert.equal(C.jobNotePreview(jp([dev('A1')], [], { job: { notes: 'Earlier note\n' + written } }), w, STAMP).state, 'unchanged')
  // the list changed (a device went on warranty): a new block, not a repeat
  assert.equal(C.jobNotePreview(jp([dev('A1')], [], { job: { notes: 'Earlier note\n' + written } }), W([]), STAMP).state, 'append')
  // a different day: a new block
  assert.equal(C.jobNotePreview(jp([dev('A1')], [], { job: { notes: written } }), w, 'EST and PVT completed - 8/10/2026').state, 'append')
})

test('preview state: a job with a problem is skipped and nothing is said to be written', () => {
  const v = C.jobNotePreview(jp([dev('A1')], [], { problems: ['Job is already at stage "Complete" - left alone'] }), W(['A1']), STAMP)
  assert.equal(v.state, 'skipped')
})

test('the preview shows the same block Apply sends (one function builds both)', () => {
  const j = jp([dev('A1'), dev('A2')], [dev('A3')])
  const w = W(['A2'])
  const v = C.jobNotePreview(j, w, STAMP)
  assert.deepEqual(v.lines, C.jobNoteBlock(j, w, STAMP).lines)
  assert.equal(v.yes, 1)
  assert.equal(v.other, 2)
})

/* ---- the summary ---- */
test('summary counts jobs by outcome and devices by group', () => {
  const w = W(['A1', 'B1'], true, [['Yes', 2], ['No', 3], ['Y', 1], ['yes - extra year', 2]])
  const written = C.jobNoteBlock(jp([dev('C1')]), w, STAMP).html
  const previews = [
    C.jobNotePreview(jp([dev('A1'), dev('A2')]), w, STAMP),                                                  // write, 1 warranty + 1 other
    C.jobNotePreview(jp([dev('B1')], [], { jobNo: '502', job: { notes: 'old' } }), w, STAMP),                   // append, all warranty
    C.jobNotePreview(jp([dev('C1')], [], { jobNo: '503', job: { notes: written } }), w, STAMP),                // unchanged, none required
    C.jobNotePreview(jp([dev('D1')], [], { jobNo: '504', problems: ['x'] }), w, STAMP),                        // skipped
  ]
  const s = C.summariseNotes(previews, w)
  assert.equal(s.jobs, 4)
  assert.equal(s.mode, 'grouped')
  assert.deepEqual([s.written, s.appended, s.unchanged, s.skipped], [2, 1, 1, 1])
  assert.equal(s.jobsWithWarranty, 2)
  assert.equal(s.jobsNoneRequired, 1)           // the unchanged one; the skipped one is not counted
  assert.equal(s.devicesWarranty, 2)
  assert.equal(s.devicesOther, 2)               // A2 and C1
  assert.deepEqual(s.nearMiss, [{ value: 'Y', rows: 1 }, { value: 'yes - extra year', rows: 2 }])
})

test('summary in flat mode counts devices flat and reports no near-misses', () => {
  const w = W([], false)
  const s = C.summariseNotes([C.jobNotePreview(jp([dev('A1'), dev('A2')]), w, STAMP)], w)
  assert.equal(s.mode, 'flat')
  assert.equal(s.devicesFlat, 2)
  assert.equal(s.jobsWithWarranty + s.jobsNoneRequired, 0)
  assert.deepEqual(s.nearMiss, [])
})

/* ---- end to end: a sheet, through compare(), to the previewed note ---- */
test('from a sheet: model, device type and battery ride along, and Extended Warranty decides the group', () => {
  const header = ['Site ID', 'Serial Number', 'Simpro Job', 'Device Model', 'Device Type', 'Battery Serial Number', 'Extended Warranty']
  const rows = [
    ['100', 'dfx1', '501', 'Defib One', 'Defibrillator', 'BAT-9', 'Yes'],
    ['100', 'mon2', '501', 'Monitor Two', 'Monitor', '', 'No'],
    ['100', 'mon3', '501', 'Monitor Three', 'Monitor', '', 'Y'],
  ]
  const { header: h, recs } = C.toRecords([header, ...rows])
  const res = C.compare(recs, {}, new Map(), null)
  const items = res.jobs.get('501')
  assert.equal(items.length, 3)
  const w = C.warrantyScan([{ header: h, recs }])
  const v = C.jobNotePreview(jp(items.slice(0, 2), [items[2]]), w, STAMP)
  assert.deepEqual(text(v.lines), [
    'Extended Warranty required on these devices:', 'Defib One — SN:DFX1 (Battery SN:BAT-9)', '',
    'Other devices added:', 'Monitor Two — SN:MON2', 'Monitor Three — SN:MON3',
  ])
  const s = C.summariseNotes([v], w)
  assert.deepEqual(s.nearMiss, [{ value: 'Y', rows: 1 }])
})
