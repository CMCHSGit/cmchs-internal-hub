// npm test -w apps/projects — the planning workbook read into weeks, and compared with the tracker (plan-sheet.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { themeHex, colourName, parseCell, initialsMap, matchJob, readPlanSheet, diffPlan, describeChange } from '../src/plan-sheet.js'

test("fills: theme colours with a tint become the legend's hex; the grid's own shades get their names", () => {
  assert.equal(themeHex(8, 0.6), 'BDD7EE', 'blue accent, lighter 60% (Prep week)')
  assert.equal(themeHex(0), 'FFFFFF')
  assert.equal(colourName('BDD7EE'), 'Prep week')
  assert.equal(colourName('FFFF00'), 'EST Testing')
  assert.equal(colourName('92D050'), 'Go-live week', 'the cells use 92D050, the legend A9D18E')
  assert.equal(colourName('FFC000'), 'Apps support')
  assert.equal(colourName('FFE699', 'Pending Trials/Demos'), 'Demo /Trial')
  assert.equal(colourName('FFE699', '2025 Conferences /Workshops'), 'Conference')
  assert.equal(colourName('FFFFFF'), '')
  assert.equal(colourName(''), '')
  assert.equal(colourName('123456'), '?123456', 'matches nothing: kept visible')
})

test('a cell: initials separated by /, ? for not confirmed, the rest a note', () => {
  const known = new Set(['JC', 'MH', 'GH', 'SM', 'TF', 'KF'])
  assert.deepEqual(parseCell('?JC/MH (GH weekend)', known), { people: [{ i: 'JC', t: true }, { i: 'MH', t: false }], note: '(GH weekend)', unknown: [] })
  assert.deepEqual(parseCell('GH/SM(KF)/JC/MH', known).people.map((p) => p.i), ['GH', 'SM', 'JC', 'MH'])
  assert.equal(parseCell('GH/SM(KF)/JC/MH', known).note, '(KF)')
  assert.deepEqual(parseCell('MH/TF Superuser', known), { people: [{ i: 'MH', t: false }, { i: 'TF', t: false }], note: 'Superuser', unknown: [] })
  assert.deepEqual(parseCell('Wifi survey', known), { people: [], note: 'Wifi survey', unknown: [] })
  assert.deepEqual(parseCell('?Go/live', known), { people: [], note: '?Go/live', unknown: [] }, 'no initials: the whole cell is the note, as written')
  assert.equal(parseCell('KF/BD', known).unknown[0], 'BD', 'two capitals that are nobody here are reported')
  assert.deepEqual(parseCell('IT/prep/TF/Eng x2', known).people, [{ i: 'TF', t: false }])
  assert.deepEqual(parseCell('', known), { people: [], note: '', unknown: [] })
})

const staff = [
  { id: 'jacqui', name: 'Jacqui', initials: 'JC' }, { id: 'jessc', name: 'Jess C', initials: 'JC' },
  { id: 'james', name: 'James', initials: 'JB' }, { id: 'jessb', name: 'Jess B', initials: 'JB' },
  { id: 'mark', name: 'Mark H', initials: 'MH' }, { id: 'sam', name: 'Sam', initials: 'SL' },
]
test("shared initials are settled by the workbook's own Team Names sheet", () => {
  const r = initialsMap(staff, [{ name: 'Jacqui', initials: 'JC' }, { name: 'James', initials: 'JB' }, { name: 'Sam', initials: 'SL' }])
  assert.equal(r.map.get('JC').id, 'jacqui')
  assert.equal(r.map.get('JB').id, 'james')
  assert.equal(r.map.get('MH').id, 'mark')
  assert.deepEqual(r.ambiguous, [])
  assert.deepEqual(initialsMap(staff, []).ambiguous.sort(), ['JB', 'JC'], 'said, not guessed silently')
})

test('a workbook row finds its job: same name, a long shared start, or nearly the same words', () => {
  const jobs = [{ id: '1', name: 'Hutt CCU monitoring' }, { id: '2', name: 'Waikato Hospital 2X N15 3X N1 1X TDS docking station (w/o VGA, English, Australia cord)' }, { id: '3', name: 'A9 upgrade - North Shore (27 Oct)' }]
  assert.equal(matchJob('Hutt CCU monitoring ', jobs).id, '1')
  assert.equal(matchJob('Waikato Hospital 2X N15 3X N1 1X TDS docking station', jobs).id, '2')
  assert.equal(matchJob('Southern Hospital', jobs), null)
  assert.equal(matchJob('A9 upgrade - NS 27th Oct', jobs), null, 'too different to guess: the person picks it')
})

async function workbook() {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Team Planning')
  const fill = (cell, argb) => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + argb } } }
  ws.getRow(1).values = ['Install / Trial sites/departments', 'Status', 'Planned Start', 'Planned End', new Date('2026-11-09T00:00:00Z'), new Date('2026-11-16T00:00:00Z'), new Date('2026-11-23T00:00:00Z')]
  ws.getRow(2).values = ['Pending Trials/Demos']
  for (let c = 1; c <= 4; c++) fill(ws.getRow(2).getCell(c), 'FFE699')
  ws.getRow(3).values = ['Hutt CCU monitoring', 'tentative', new Date('2026-11-02T00:00:00Z'), new Date('2026-12-11T00:00:00Z'), 'AK/?GH', 'GH/SM(KF) Wifi survey', null]
  for (const c of [5, 6]) fill(ws.getRow(3).getCell(c), 'FFFF00')
  ws.getRow(4).values = ['Nothing yet', 'planning']
  const tn = wb.addWorksheet('Team Names')
  tn.getRow(1).values = ['Prep week', 'Sam SL', 'Andrew AJ']
  tn.getRow(2).values = ['Go-live week', 'Mark H MH', 'Adam AK']
  return wb.xlsx.writeBuffer()
}

test('the sheet read from a file: weeks, rows, fills, the legend names', async () => {
  const p = await readPlanSheet(await workbook())
  assert.deepEqual(p.weeks, ['2026-11-09', '2026-11-16', '2026-11-23'])
  assert.equal(p.rows.length, 2, 'the gold group row is not a job')
  const r = p.rows[0]
  assert.equal(r.name, 'Hutt CCU monitoring')
  assert.equal(r.status, 'tentative')
  assert.equal(r.start, '2026-11-02')
  assert.equal(r.end, '2026-12-11')
  assert.equal(r.group, 'Pending Trials/Demos')
  assert.deepEqual(r.cells, [{ week: '2026-11-09', colour: 'EST Testing', text: 'AK/?GH' }, { week: '2026-11-16', colour: 'EST Testing', text: 'GH/SM(KF) Wifi survey' }])
  assert.deepEqual(p.teamNames.map((t) => t.initials), ['SL', 'AJ', 'MH', 'AK'])
  assert.deepEqual(p.teamNames[2], { name: 'Mark H', initials: 'MH' })
})

test('what would change: colour, note, people added, not-sure flipped; what the workbook lacks is optional', async () => {
  const p = await readPlanSheet(await workbook())
  const st = [{ id: 'ad', name: 'Adam', initials: 'AK' }, { id: 'gr', name: 'Grant', initials: 'GH' }, { id: 'st', name: 'Steve', initials: 'SM' }, { id: 'tr', name: 'Teri', initials: 'TB' }]
  const jobs = [{ id: 'j1', name: 'Hutt CCU monitoring', weekColours: { '2026-11-09': 'Prep week' } }]
  const assignments = [
    { id: 'a1', jobId: 'j1', staffId: 'ad', week: '2026-11-09', activity: 'Prep week' },
    { id: 'a2', jobId: 'j1', staffId: 'gr', week: '2026-11-09', activity: 'Prep week' }, // workbook: ?GH (not confirmed)
    { id: 'a3', jobId: 'j1', staffId: 'tr', week: '2026-11-09', activity: 'Prep week' }, // not in the workbook
    { id: 'a4', jobId: 'j1', staffId: 'tr', week: '2026-11-23', activity: 'Prep week' }, // a week the workbook has nothing for
  ]
  const { changes, unmatched, notes } = diffPlan(p.rows, { jobs, assignments, staff: st, teamNames: p.teamNames, weeks: p.weeks })
  assert.deepEqual(unmatched, [], 'a row with no weeks and no job is not worth a question')
  const by = (kind, week) => changes.filter((c) => c.kind === kind && c.week === week)
  assert.equal(by('colour', '2026-11-09')[0].to, 'EST Testing')
  assert.equal(by('colour', '2026-11-09')[0].from, 'Prep week')
  assert.equal(by('tentative', '2026-11-09')[0].who, 'GH')
  assert.equal(by('tentative', '2026-11-09')[0].to, true)
  const rm = by('remove', '2026-11-09')
  assert.equal(rm.length, 1)
  assert.equal(rm[0].optional, true)
  assert.equal(rm[0].who, 'TB')
  assert.deepEqual(by('add', '2026-11-16').map((c) => c.who).sort(), ['GH', 'SM'])
  assert.equal(by('note', '2026-11-16')[0].to, '(KF) Wifi survey')
  assert.equal(by('remove', '2026-11-23').length, 1, 'the tracker has someone where the workbook is empty: offered, optional')
  assert.equal(changes.filter((c) => c.kind === 'add' && c.week === '2026-11-09').length, 0, 'AK is already on')
  assert.deepEqual(notes, [])
  // already matching: nothing to do
  const same = diffPlan(p.rows, {
    jobs: [{ id: 'j1', name: 'Hutt CCU monitoring', weekColours: { '2026-11-09': 'EST Testing', '2026-11-16': 'EST Testing' }, weekNotes: { '2026-11-16': '(KF) Wifi survey' } }],
    assignments: [{ id: 'x1', jobId: 'j1', staffId: 'ad', week: '2026-11-09' }, { id: 'x2', jobId: 'j1', staffId: 'gr', week: '2026-11-09', tentative: true }, { id: 'x3', jobId: 'j1', staffId: 'gr', week: '2026-11-16' }, { id: 'x4', jobId: 'j1', staffId: 'st', week: '2026-11-16' }],
    staff: st, teamNames: p.teamNames, weeks: p.weeks,
  })
  assert.deepEqual(same.changes, [])
  assert.equal(describeChange(by('add', '2026-11-16')[0]), 'add GH')
  assert.equal(describeChange({ kind: 'tentative', who: 'GH', to: true }), 'GH not confirmed (?)')
})

test('a row can be matched by hand', async () => {
  const p = await readPlanSheet(await workbook())
  const jobs = [{ id: 'q', name: 'Hutt critical care unit patient monitors' }]
  const ctx = { jobs, assignments: [], staff: [{ id: 'ad', name: 'Adam', initials: 'AK' }], teamNames: [], weeks: p.weeks }
  assert.deepEqual(diffPlan(p.rows, ctx).unmatched.map((r) => r.name), ['Hutt CCU monitoring'])
  const by = diffPlan(p.rows, { ...ctx, choices: { 'Hutt CCU monitoring': 'q' } })
  assert.deepEqual(by.unmatched, [])
  assert.ok(by.changes.some((c) => c.kind === 'colour' && c.jobId === 'q'))
})
