import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { rosterWeeks, matchEngineer, planOnCall } from '../src/utils/onCallRoster.js'
import { runOnCallSync } from '../scripts/oncallSyncJob.mjs'

const users = [
  { uid: 'u1', displayName: 'Ana Smith', team: 'Engineers' },
  { uid: 'u2', displayName: 'Bo', team: 'Engineers' },
  { uid: 'u3', displayName: 'Cy Jones', team: 'Sales' },
  { uid: 'u4', displayName: 'Cy Lee', team: 'Engineers' },
  { uid: 'u5', displayName: 'Cy Hart', team: 'Engineers' },
]

test('a roster name is one person: full name, or a first name only one person has (or only one engineer)', () => {
  assert.equal(matchEngineer('Ana', users)?.uid, 'u1')
  assert.equal(matchEngineer('ana smith', users)?.uid, 'u1')
  assert.equal(matchEngineer('Bo', users)?.uid, 'u2')
  assert.equal(matchEngineer('Cy', users), null)            // three of them, two engineers
  assert.equal(matchEngineer('Cy Jones', users)?.uid, 'u3')
  assert.equal(matchEngineer('Ana / Bo', users), null)
  assert.equal(matchEngineer('Ana and Bo', users), null)
  assert.equal(matchEngineer('Dee', users), null)
  assert.equal(matchEngineer('', users), null)
  assert.equal(matchEngineer('Dee', [{ uid: 'x', displayName: 'Dee Kay', team: 'Sales' }, { uid: 'y', displayName: 'Dee Roe', team: 'Engineers' }])?.uid, 'y')
})

// A roster workbook as the file has it: one 2026 sheet whose first week is 29 Dec 2025, an Engineers sheet.
function roster(engineers) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('2026')
  ws.addRow(['Month', 'Week', 'Start Date', 'End Date', 'Engineer', 'Public Holidays', 'Notes'])
  engineers.forEach((e, i) => ws.addRow([i === 0 ? 'January' : '', `Week ${i + 1}`, i === 0 ? new Date(Date.UTC(2025, 11, 29)) : null, null, e, '', '']))
  wb.addWorksheet('Engineers').addRow(['Engineers'])
  return wb
}

test('weeks run seven days on from the first, from the engineer column, one person each', () => {
  const parsed = { sheets: [], engineers: [] }
  const weeks = rosterWeeks({ ...parsed, sheets: [{ name: '2026', year: 2026, extras: [], weeks: [
    { start: '2025-12-29', engineer: 'Ana (cover Bo)' }, { start: '2026-01-05', engineer: 'Bo' }, { start: '2026-01-12', engineer: '' }] }] })
  assert.deepEqual(weeks.map(w => [w.start, w.engineer]), [['2025-12-29', 'Ana'], ['2026-01-05', 'Bo'], ['2026-01-12', '']])
})

test('plan: sets weeks with nobody, changes the app to the roster, leaves unmatched and blank weeks, never before fromWeek', () => {
  const weeks = [
    { start: '2026-10-12', engineer: 'Ana' },   // before fromWeek
    { start: '2026-10-19', engineer: 'Ana' },   // already right
    { start: '2026-10-26', engineer: 'Dee' },   // nobody by that name
    { start: '2026-11-02', engineer: 'Bo' },    // the app says Ana
    { start: '2026-11-09', engineer: 'Ana' },   // nothing in the app
    { start: '2026-11-16', engineer: '' },
  ]
  const existing = new Map([['2026-10-19', { uid: 'u1' }], ['2026-10-26', { uid: 'u1' }], ['2026-11-02', { uid: 'u1', calls: [] }]])
  const { writes, stats } = planOnCall({ weeks, users, existing, fromWeek: '2026-10-19' })
  assert.deepEqual(writes, [{ weekStart: '2026-11-02', uid: 'u2', displayName: 'Bo' }, { weekStart: '2026-11-09', uid: 'u1', displayName: 'Ana Smith' }])
  assert.deepEqual(stats, { weeks: 5, same: 1, set: 1, changed: 1, blank: 1, unmatched: 1 })
})

function store(existing = new Map()) {
  const calls = { history: 0, oncall: [], activity: [] }
  return {
    calls,
    loadUsers: async () => users,
    loadOnCall: async () => existing,
    saveHistory: async () => { calls.history++ },
    commitOnCall: async w => { calls.oncall.push(...w) },
    logActivity: async s => { calls.activity.push(s) },
  }
}
const names = ['Ana', 'Bo', 'Ana']

test('dry run says what it would write and writes nothing', async () => {
  const s = store()
  const r = await runOnCallSync({ workbook: roster(names), store: s, fromWeek: '2026-01-05' })
  assert.equal(r.status, 'dry-run')
  assert.equal(r.writes, 2)
  assert.match(r.summary, /hub roster page: 2 roster sheets|hub roster page: 1 roster sheet/)
  assert.equal(s.calls.history + s.calls.oncall.length + s.calls.activity.length, 0)
})

test('apply: the hub roster page and the schedule weeks are both written, and it is logged in words', async () => {
  const s = store(new Map([['2026-01-05', { uid: 'u1' }]]))
  const r = await runOnCallSync({ workbook: roster(names), store: s, fromWeek: '2026-01-05', apply: true })
  assert.equal(r.status, 'done')
  assert.equal(s.calls.history, 1)
  assert.deepEqual(s.calls.oncall.map(w => [w.weekStart, w.uid]), [['2026-01-05', 'u2'], ['2026-01-12', 'u1']])
  assert.equal(s.calls.activity.length, 1)
  assert.doesNotMatch(s.calls.activity[0], /Ana|Bo\b/)
})

test('an unchanged roster file only checks the schedule: no history rewrite, and nothing at all when it already matches', async () => {
  const same = new Map([['2026-01-05', { uid: 'u2' }], ['2026-01-12', { uid: 'u1' }]])
  const s = store(same)
  const quiet = await runOnCallSync({ workbook: roster(names), store: s, fromWeek: '2026-01-05', apply: true, history: false })
  assert.equal(quiet.status, 'nothing')
  assert.equal(s.calls.history + s.calls.oncall.length + s.calls.activity.length, 0)
  const s2 = store()
  await runOnCallSync({ workbook: roster(names), store: s2, fromWeek: '2026-01-05', apply: true, history: false })
  assert.equal(s2.calls.history, 0)
  assert.equal(s2.calls.oncall.length, 2)
})

test('a workbook with no year sheets is an error, not a quiet success', async () => {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('Notes')
  await assert.rejects(runOnCallSync({ workbook: wb, store: store(), fromWeek: '2026-01-05' }), /No year sheets/)
})
