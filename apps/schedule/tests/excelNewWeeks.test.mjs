import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { weekSheetName, candidateWeeks, planNewWeeks, hasEntries, blankWeek, newSheetSteps, headerDateCol, MAX_AHEAD, MAX_CREATE } from '../src/utils/excelNewWeeks.js'
import { runExport } from '../scripts/excelExportJob.mjs'

test('sheet names follow the workbook: 9-Nov, Sept for September, a year when the name is taken', () => {
  assert.equal(weekSheetName('2026-11-09'), '9-Nov')
  assert.equal(weekSheetName('2026-09-07'), '7-Sept')
  assert.equal(weekSheetName('2026-11-02', ['2-Nov']), '2-Nov-26')
  assert.equal(weekSheetName('2026-11-02', ['2-NOV', '2-Nov-26']), '2-Nov-26 (2)')
})

test('only weeks after the newest sheet, up to a limit past this week, can be started', () => {
  const c = candidateWeeks('2026-11-02', '2026-11-09')
  assert.equal(c[0], '2026-11-09')
  assert.equal(c.at(-1), '2026-12-21') // 6 weeks past 9 Nov
  assert.equal(c.length, MAX_AHEAD + 1)
  assert.deepEqual(candidateWeeks('2026-12-28', '2026-11-09'), []) // already far enough ahead
})

test('a day with a place, or a comment, is an entry; blanks are not', () => {
  assert.equal(hasEntries(null), false)
  assert.equal(hasEntries({ days: [{ location: '' }, { location: '  ' }], comments: '' }), false)
  assert.equal(hasEntries({ days: [{ location: '' }, { location: 'Leave' }] }), true)
  assert.equal(hasEntries({ days: [{ location: '' }], comments: 'back Monday' }), true)
})

test('planNewWeeks: weeks with entries, with no gap before them, never more than the cap', () => {
  const doc = weekStart => ({ weekStart, days: [{ location: 'Cass Office' }] })
  const base = { newestWeek: '2026-11-02', currentWeek: '2026-11-02' }
  assert.deepEqual(planNewWeeks({ ...base, schedules: [] }), [])
  assert.deepEqual(planNewWeeks({ ...base, schedules: [doc('2026-11-09')] }), ['2026-11-09'])
  assert.deepEqual(planNewWeeks({ ...base, schedules: [doc('2026-11-16')] }), ['2026-11-09', '2026-11-16']) // the week between is made too
  assert.deepEqual(planNewWeeks({ ...base, schedules: [{ weekStart: '2026-11-09', days: [{ location: '' }] }] }), []) // an empty document is no entry
  assert.deepEqual(planNewWeeks({ ...base, schedules: [doc('2026-10-26')] }), []) // never the past
  assert.deepEqual(planNewWeeks({ ...base, schedules: [doc('2027-06-07')] }), []) // too far ahead: a mistyped date makes nothing
  assert.equal(planNewWeeks({ ...base, schedules: [doc('2026-12-14')] }).length, MAX_CREATE)
})

// The newest sheet: header date in column C (a real date) with the days after it as formulas, team | name | AM/PM | Mon-Fri | comments.
function newest() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('2-Nov')
  ws.getCell(1, 3).value = new Date(Date.UTC(2026, 10, 2))
  ws.getCell(1, 4).value = { formula: '+C1', result: new Date(Date.UTC(2026, 10, 2)) }
  ws.getCell(3, 1).value = 'Engineers'
  ws.getCell(3, 2).value = 'Ana Smith - OnCall'; ws.getCell(3, 3).value = 'AM'; ws.getCell(4, 3).value = 'PM'
  ws.getCell(5, 2).value = 'Bo Jones'; ws.getCell(5, 3).value = 'AM'; ws.getCell(6, 3).value = 'PM'
  for (const r of [3, 4, 5, 6]) for (let c = 4; c <= 8; c++) ws.getCell(r, c).value = 'Cass Office'
  ws.getCell(3, 9).value = 'last week note'
  return wb
}
const users = [
  { uid: 'u1', displayName: 'Ana Smith', team: 'Engineers', email: 'ana@example.test' },
  { uid: 'u2', displayName: 'Bo Jones', team: 'Engineers', email: 'bo@example.test' },
]
const doc = (uid, weekStart, locations, comments = '') => ({ weekStart, uid, days: locations.map(location => ({ location, onCall: false })), comments })

function store(docs) {
  const calls = { bases: [], activity: [], weeks: [] }
  return {
    calls,
    loadUsers: async () => users,
    loadSchedules: async weeks => { calls.weeks.push(weeks); return new Map(docs.filter(d => weeks.includes(d.weekStart)).map(d => [`${d.weekStart}_${d.uid}`, d])) },
    commitBases: async list => { calls.bases.push(...list) },
    logActivity: async s => { calls.activity.push(s) },
  }
}

test('blank copy and the steps for the new sheet: the same rows, nothing in them, the Monday cell found, on-call suffix off', () => {
  const wb = newest()
  const ws = wb.worksheets[0]
  const run = { dryOnly: true }
  assert.equal(headerDateCol(ws, { amCol: 3, firstDayCol: 4 }), 3)
  const source = { layout: { amCol: 3, nameCol: 2, groupCol: 1, firstDayCol: 4, commentCol: 9 }, people: [
    { row: 3, name: 'Ana Smith', onCall: true, halves: [], days: [], comment: 'x', commentRow: 3 },
    { row: 5, name: 'Bo Jones', onCall: false, halves: [], days: [], comment: '', commentRow: 5 }] }
  const blank = blankWeek({ name: '9-Nov', source })
  assert.deepEqual(blank.people.map(p => [p.row, p.onCall, p.comment, p.days.join('')]), [[3, false, '', ''], [5, false, '', '']])
  assert.equal(blank.fresh, true)
  const steps = newSheetSteps({ name: '9-Nov', weekStart: '2026-11-09', source, sourceSheet: '2-Nov', dateCol: 3 })
  assert.deepEqual(steps.clearRows, [3, 4, 5, 6])
  assert.deepEqual(steps.clearCols, [4, 5, 6, 7, 8, 9])
  assert.deepEqual(steps.nameFixes, [{ row: 3, col: 2, text: 'Ana Smith' }])
  assert.equal(run.dryOnly, true)
})

test('export starts next week\'s sheet when the app has entries for it, and fills it in the same run', async () => {
  const s = store([doc('u1', '2026-11-09', ['Wellington', '', 'Leave', '', ''], 'back Monday'), doc('u2', '2026-11-02', ['Cass Office', 'Cass Office', 'Cass Office', 'Cass Office', 'Cass Office'])])
  let got
  const r = await runExport({
    workbook: newest(), store: s, fromWeek: '2026-10-26', currentWeek: '2026-11-02', apply: true,
    applyEdits: async (edits, newSheets) => { got = { edits, newSheets }; return { state: 'ok', statuses: edits.map(() => 'written') } },
  })
  assert.equal(r.status, 'done')
  assert.deepEqual(r.newSheets, [{ name: '9-Nov', weekStart: '2026-11-09' }])
  assert.equal(got.newSheets.length, 1)
  assert.equal(got.newSheets[0].source, '2-Nov')
  assert.equal(got.newSheets[0].dateCol, 3)
  assert.ok(got.edits.every(e => e.sheet === '9-Nov' && e.fresh && e.before === ''))
  // Wellington and Leave, each in an AM and a PM cell, plus the week's comment
  assert.deepEqual(got.edits.map(e => [e.row, e.col, e.text]), [[3, 4, 'Wellington'], [4, 4, 'Wellington'], [3, 6, 'Leave'], [4, 6, 'Leave'], [3, 9, 'back Monday']])
  assert.equal(got.edits.at(-1).comment, true)
  assert.equal(s.calls.bases.length, 1)
  assert.match(s.calls.activity[0], /Started the sheet for the week of 2026-11-09/)
  assert.doesNotMatch(s.calls.activity[0], /Wellington|Ana|back Monday/)
})

test('dry run: says which sheets it would start and starts none', async () => {
  const s = store([doc('u1', '2026-11-09', ['Wellington', '', '', '', ''])])
  const r = await runExport({ workbook: newest(), store: s, fromWeek: '2026-10-26', currentWeek: '2026-11-02', applyEdits: async () => assert.fail('dry run') })
  assert.equal(r.status, 'dry-run')
  assert.deepEqual(r.newSheets, [{ name: '9-Nov', weekStart: '2026-11-09' }])
  assert.match(r.summary, /1 new week sheet to start \(9-Nov\)/)
  assert.equal(r.sheetSteps.length, 1)
})

test('nothing is started when the app has no entries for a later week; a week with a sheet is not started again', async () => {
  const none = await runExport({ workbook: newest(), store: store([doc('u1', '2026-11-09', ['', '', '', '', ''])]), fromWeek: '2026-10-26', currentWeek: '2026-11-02', apply: true, applyEdits: async () => assert.fail('nothing to do') })
  assert.equal(none.status, 'nothing')
  const wb = newest()
  const ws = wb.addWorksheet('9-Nov')
  ws.getCell(1, 3).value = new Date(Date.UTC(2026, 10, 9))
  ws.getCell(3, 1).value = 'Engineers'; ws.getCell(3, 2).value = 'Ana Smith'; ws.getCell(3, 3).value = 'AM'; ws.getCell(4, 3).value = 'PM'
  const again = await runExport({ workbook: wb, store: store([doc('u1', '2026-11-09', ['Wellington', '', '', '', ''])]), fromWeek: '2026-10-26', currentWeek: '2026-11-09', apply: false, applyEdits: async () => assert.fail('dry') })
  assert.deepEqual(again.newSheets, [])
  assert.ok(again.edits.every(e => e.sheet === '9-Nov' && !e.fresh))
})

test('a new sheet\'s cells have their own limit and do not count against the ordinary one', async () => {
  const s = store([doc('u1', '2026-11-09', ['A', 'B', 'C', 'D', 'E'])])
  const base = { workbook: newest(), store: s, fromWeek: '2026-10-26', currentWeek: '2026-11-02', apply: true, maxCells: 4, applyEdits: async edits => ({ state: 'ok', statuses: edits.map(() => 'written') }) }
  assert.equal((await runExport(base)).status, 'done') // 10 cells onto a new sheet, over maxCells 4
  const capped = await runExport({ ...base, workbook: newest(), maxNewCells: 9, applyEdits: async () => assert.fail('refused') })
  assert.equal(capped.status, 'too-many')
})
