import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { runExport } from '../scripts/excelExportJob.mjs'

// A workbook with one week sheet (Monday 26 Oct 2026): a person on an AM row and a PM row, Mon-Fri in columns D-H.
function workbook(days = ['', '', '', '', '']) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('26-Oct')
  ws.getCell(1, 4).value = new Date(Date.UTC(2026, 9, 26))
  ws.getCell(2, 1).value = 'Engineers'
  ws.getCell(2, 2).value = 'Ana Smith'
  ws.getCell(2, 3).value = 'AM'
  ws.getCell(3, 3).value = 'PM'
  days.forEach((d, i) => { if (d) { ws.getCell(2, 4 + i).value = d; ws.getCell(3, 4 + i).value = d } })
  return wb
}

const users = [{ uid: 'u1', displayName: 'Ana Smith', team: 'Engineers', email: 'ana@example.test' }]
const schedule = (locations, extra = {}) => ({ weekStart: '2026-10-26', uid: 'u1', days: locations.map(location => ({ location, onCall: false })), ...extra })

function fakeStore(sched) {
  const calls = { bases: [], activity: [] }
  return {
    calls,
    loadUsers: async () => users,
    loadSchedules: async () => new Map([['2026-10-26_u1', sched]]),
    commitBases: async list => { calls.bases.push(...list) },
    logActivity: async s => { calls.activity.push(s) },
  }
}

test('dry run: says what it would write and writes nothing', async () => {
  const store = fakeStore(schedule(['Wellington', '', '', '', '']))
  let called = false
  const r = await runExport({ workbook: workbook(), store, fromWeek: '2026-10-26', applyEdits: async () => { called = true } })
  assert.equal(r.status, 'dry-run')
  assert.equal(r.cells, 2)
  assert.deepEqual(r.edits.map(e => [e.row, e.col, e.text]), [[2, 4, 'Wellington'], [3, 4, 'Wellington']])
  assert.equal(called, false)
  assert.equal(store.calls.bases.length, 0)
})

test('apply: every cell written, so the week is remembered as copied and logged once', async () => {
  const store = fakeStore(schedule(['Wellington', '', '', '', '']))
  const r = await runExport({ workbook: workbook(), store, fromWeek: '2026-10-26', apply: true, applyEdits: async edits => ({ state: 'ok', statuses: edits.map(() => 'written') }) })
  assert.equal(r.status, 'done')
  assert.equal(store.calls.bases.length, 1)
  assert.deepEqual(store.calls.bases[0].base.days, ['Wellington', '', '', '', ''])
  assert.equal(store.calls.activity.length, 1)
})

test('apply: a cell that changed meanwhile means the week is not remembered, so it is planned again next run', async () => {
  const store = fakeStore(schedule(['Wellington', '', '', '', '']))
  const r = await runExport({ workbook: workbook(), store, fromWeek: '2026-10-26', apply: true, applyEdits: async () => ({ state: 'ok', statuses: ['written', 'mismatch'] }) })
  assert.equal(r.status, 'partial')
  assert.equal(store.calls.bases.length, 0)
})

test('apply: too many cells is refused whole; a locked or failed Excel writes nothing', async () => {
  const sched = schedule(['A', 'B', 'C', 'D', 'E'])
  let called = false
  const big = await runExport({ workbook: workbook(), store: fakeStore(sched), fromWeek: '2026-10-26', apply: true, maxCells: 4, applyEdits: async () => { called = true } })
  assert.equal(big.status, 'too-many')
  assert.equal(called, false)
  const locked = await runExport({ workbook: workbook(), store: fakeStore(sched), fromWeek: '2026-10-26', apply: true, applyEdits: async () => ({ state: 'locked', statuses: [] }) })
  assert.equal(locked.status, 'locked')
  const store = fakeStore(sched)
  const failed = await runExport({ workbook: workbook(), store, fromWeek: '2026-10-26', apply: true, applyEdits: async () => ({ state: 'error: x', statuses: [] }) })
  assert.equal(failed.status, 'error')
  assert.equal(store.calls.bases.length, 0)
})

test('nothing to do when the Excel already says what the app says', async () => {
  const r = await runExport({ workbook: workbook(['Wellington', '', '', '', '']), store: fakeStore(schedule(['Wellington', '', '', '', ''])), fromWeek: '2026-10-26', apply: true, applyEdits: async () => assert.fail('no edits expected') })
  assert.equal(r.status, 'nothing')
})
