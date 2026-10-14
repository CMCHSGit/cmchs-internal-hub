// Run with `npm test`. The automatic Excel → schedule import (scripts/excelImportJob.mjs), end to end against an
// in-memory stand-in for Firestore. Every name here is made up — never put real staff data in this repo.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { readWorkbook, runImport } from '../scripts/excelImportJob.mjs'
import { importOps } from '../src/utils/excelImportOps.js'

const utc = iso => new Date(`${iso}T00:00:00Z`)
const W1 = '2026-10-12'
const W2 = '2026-10-19'

/** One week's sheet in the real layout: team label merged down column A, AM/PM rows, Mon–Fri in D–H, comment in I. */
function addWeek(wb, monday, team, rows) {
  const ws = wb.addWorksheet(monday)
  ws.getCell('B1').value = 'Week starting:'; ws.getCell('C1').value = utc(monday); ws.getCell('D1').value = utc(monday)
  ws.getCell('A2').value = team; ws.mergeCells(2, 1, 2 + rows.length * 2, 1)
  rows.forEach(([name, days, comment], i) => {
    const r = 3 + i * 2
    ws.getCell(r, 2).value = name; ws.mergeCells(r, 2, r + 1, 2)
    ws.getCell(r, 3).value = 'AM'; ws.getCell(r + 1, 3).value = 'PM'
    days.forEach((d, c) => { if (d) ws.getCell(r, 4 + c).value = d; ws.mergeCells(r, 4 + c, r + 1, 4 + c) })
    if (comment) ws.getCell(r, 9).value = comment
  })
}

const week = (...d) => d
function workbook({ alexW1 = week('Hamilton', 'Hamilton', 'Cass Office', 'Cass Office', 'Leave') } = {}) {
  const wb = new ExcelJS.Workbook()
  addWeek(wb, W1, 'Engineers', [
    ['Alex', alexW1, 'Back Friday'],
    ['Blair - OnCall', week('Cass Office', 'Remote Support', 'Cass Office', 'Cass Office', 'Cass Office')],
    ['Sam', week('Tauranga', 'Tauranga', '', '', '')],       // two Sams in the app: several fit
    ['Mike', week('Rotorua', '', '', '', '')],               // only "Michael" in the app: close, not certain
    ['Zed', week('Waikato', '', '', '', '')],                // nobody in the app
  ])
  addWeek(wb, W2, 'Engineers', [['Alex', week('Napier', 'Napier', '', '', '')]])
  return wb
}

/** The users, schedules, on-call and activity collections, with Firestore's merge behaviour. */
function memoryStore() {
  const db = {
    users: new Map([
      ['u-alex', { displayName: 'Alex Morgan', team: 'Engineers', role: 'user' }],
      ['u-blair', { displayName: 'Blair Carter', team: 'Engineers', role: 'user' }],
      ['u-sam1', { displayName: 'Sam Reed', team: 'Engineers', role: 'user' }],
      ['u-sam2', { displayName: 'Sam Lee', team: 'Engineers', role: 'user' }],
      ['u-mike', { displayName: 'Michael Fox', team: 'Engineers', role: 'user' }],
    ]),
    schedules: new Map(),
    oncall: new Map(),
    activity: [],
    commits: 0,
  }
  const isMap = v => v && typeof v === 'object' && !Array.isArray(v)
  const merge = (a, b) => { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = isMap(v) && isMap(a?.[k]) ? merge(a[k], v) : v; return out }
  const copy = v => JSON.parse(JSON.stringify(v))
  return {
    db,
    now: () => 'NOW',
    loadUsers: async () => [...db.users].map(([uid, u]) => ({ uid, ...copy(u) })),
    loadSchedules: async weeks => new Map([...db.schedules].filter(([, s]) => weeks.includes(s.weekStart)).map(([id, s]) => [id, copy(s)])),
    loadOnCall: async weeks => new Map([...db.oncall].filter(([w]) => weeks.includes(w)).map(([w, o]) => [w, copy(o)])),
    commit: async ops => {
      db.commits++
      for (const op of ops) {
        const col = db[op.collection]
        col.set(op.id, op.merge ? merge(col.get(op.id) || {}, copy(op.data)) : copy(op.data))
      }
    },
    logActivity: async summary => { db.activity.push(summary) },
  }
}
const locations = (store, id) => store.db.schedules.get(id)?.days.map(d => d.location)

test('a dry run says what it would do and writes nothing', async () => {
  const store = memoryStore()
  const r = await runImport({ workbook: workbook(), store, fromWeek: W1 })
  assert.equal(r.status, 'dry-run')
  assert.equal(r.changes, 4) // Alex ×2 weeks, Blair, and Blair's on-call
  assert.equal(store.db.commits, 0)
  assert.equal(store.db.schedules.size, 0)
})

test('it brings in the people it is sure of, and leaves the rest for Admin → Excel', async () => {
  const store = memoryStore()
  const r = await runImport({ workbook: workbook(), store, fromWeek: W1, apply: true })
  assert.equal(r.status, 'done')
  assert.deepEqual(locations(store, `${W1}_u-alex`), ['Hamilton', 'Hamilton', 'Cass Office', 'Cass Office', 'Leave'])
  assert.equal(store.db.schedules.get(`${W1}_u-alex`).comments, 'Back Friday')
  assert.deepEqual(locations(store, `${W2}_u-alex`), ['Napier', 'Napier', '', '', ''])
  assert.ok(store.db.schedules.has(`${W1}_u-blair`))
  assert.equal(store.db.oncall.get(W1).uid, 'u-blair')
  // the two Sams, "Mike" and "Zed" are left alone — nothing is guessed, and nobody is added
  assert.equal(store.db.schedules.size, 3)
  assert.equal(store.db.users.size, 5)
  assert.match(r.summary, /3 Excel names left for Admin → Excel \(1 several fit, 1 to check, 1 not in the app\)/)
  // imported entries are not "saved in the app", so the app → Excel copy won't echo them back
  assert.equal(store.db.schedules.get(`${W1}_u-alex`).submittedAt, undefined)
  assert.equal(store.db.schedules.get(`${W1}_u-alex`).needsConfirm, false)
  assert.equal(store.db.activity.length, 1)
  assert.match(store.db.activity[0], /^Excel import \(automatic\): 12 entries brought in for 2 people across 2 weeks · 0 kept as the app has them \(changed in both\) · 1 on-call set · /)
})

test('running again finds nothing to do, writes nothing and logs nothing', async () => {
  const store = memoryStore()
  await runImport({ workbook: workbook(), store, fromWeek: W1, apply: true })
  const again = await runImport({ workbook: workbook(), store, fromWeek: W1, apply: true })
  assert.equal(again.status, 'nothing')
  assert.equal(store.db.commits, 1)
  assert.equal(store.db.activity.length, 1)
})

test('an Excel change flows in when the app was not touched; an app edit is kept', async () => {
  const store = memoryStore()
  await runImport({ workbook: workbook(), store, fromWeek: W1, apply: true })
  // someone edits Tuesday in the app
  const s = store.db.schedules.get(`${W1}_u-alex`)
  s.days[1] = { location: 'Starship', onCall: false }
  // …and someone else edits Monday and Tuesday in the Excel
  const r = await runImport({ workbook: workbook({ alexW1: week('Whangarei', 'Hastings', 'Cass Office', 'Cass Office', 'Leave') }), store, fromWeek: W1, apply: true })
  assert.equal(r.status, 'done')
  assert.deepEqual(locations(store, `${W1}_u-alex`), ['Whangarei', 'Starship', 'Cass Office', 'Cass Office', 'Leave'])
  assert.match(r.summary, /1 kept as the app has them/)
})

test('a run that would change too much is refused and writes nothing', async () => {
  const store = memoryStore()
  const r = await runImport({ workbook: workbook(), store, fromWeek: W1, apply: true, maxChanges: 3 })
  assert.equal(r.status, 'too-many')
  assert.equal(r.changes, 4)
  assert.equal(store.db.commits, 0)
})

test('only weeks from `fromWeek` on are looked at', async () => {
  const store = memoryStore()
  await runImport({ workbook: workbook(), store, fromWeek: W2, apply: true })
  assert.deepEqual([...store.db.schedules.keys()], [`${W2}_u-alex`])
})

test('a person matched once in Admin → Excel (their Excel name saved) is picked up from then on', async () => {
  const store = memoryStore()
  store.db.users.get('u-mike').excelName = 'Mike'
  await runImport({ workbook: workbook(), store, fromWeek: W1, apply: true })
  assert.deepEqual(locations(store, `${W1}_u-mike`), ['Rotorua', '', '', '', ''])
})

test('the workbook is read from a copy of the file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'excel-import-test-'))
  const file = path.join(dir, 'schedule.xlsx')
  await workbook().xlsx.writeFile(file)
  const before = fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('cmchs-excel-import-')).length
  const wb = await readWorkbook(file)
  assert.ok(wb.getWorksheet(W1))
  assert.equal(fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('cmchs-excel-import-')).length, before) // the copy is cleaned up
  fs.rmSync(dir, { recursive: true, force: true })
})

test('importOps writes what Admin → Excel always has: whole new weeks, content-only updates, and remembered values', () => {
  const plan = {
    newPeople: new Map([['pending-zed', { id: 'pending-zed', displayName: 'Zed', team: 'Sales', excelName: 'Zed' }]]),
    userUpdates: new Map([['u-mike', { excelName: 'Mike' }]]),
    schedules: [
      { id: `${W1}_u-a`, uid: 'u-a', weekStart: W1, displayName: 'A', email: null, team: 'Sales', isNew: true, contentChanged: true, days: [{ location: 'X' }], comments: 'c', base: { days: ['X'], comments: 'c' } },
      { id: `${W1}_u-b`, uid: 'u-b', weekStart: W1, isNew: false, contentChanged: true, days: [{ location: 'Y', onCall: true }], comments: '', base: { days: ['Y'], comments: '' } },
      { id: `${W1}_u-c`, uid: 'u-c', weekStart: W1, isNew: false, contentChanged: false, days: [], comments: '', base: { days: ['Z'], comments: '' } },
    ],
    onCall: [{ weekStart: W1, uid: 'u-b', displayName: 'B' }],
  }
  const ops = importOps(plan, { editorUid: 'me', now: () => 'T' })
  assert.deepEqual(ops.map(o => [o.collection, o.id, o.merge]), [
    ['users', 'pending-zed', false], ['users', 'u-mike', true],
    ['schedules', `${W1}_u-a`, true], ['schedules', `${W1}_u-b`, true], ['schedules', `${W1}_u-c`, true],
    ['oncall', W1, true],
  ])
  assert.deepEqual(ops[0].data, { displayName: 'Zed', team: 'Sales', role: 'user', excelName: 'Zed', pending: true, importedFromExcel: true, createdAt: 'T' })
  assert.deepEqual(Object.keys(ops[2].data).sort(), ['comments', 'days', 'displayName', 'email', 'excelBase', 'importedAt', 'importedFromExcel', 'needsConfirm', 'team', 'uid', 'weekStart'])
  assert.deepEqual(ops[3].data, { days: [{ location: 'Y', onCall: true }], comments: '', importedFromExcel: true, importedAt: 'T', excelBase: { days: ['Y'], comments: '', at: 'T' } })
  assert.deepEqual(ops[4].data, { excelBase: { days: ['Z'], comments: '', at: 'T' } })
  assert.deepEqual(ops[5].data, { uid: 'u-b', displayName: 'B', updatedBy: 'me', updatedAt: 'T', importedFromExcel: true })
})
