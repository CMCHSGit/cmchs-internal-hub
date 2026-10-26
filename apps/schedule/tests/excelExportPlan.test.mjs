import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planExport, splitHalves } from '../src/utils/excelExportPlan.js'
import { nameKey } from '../src/utils/excelPlan.js'

const layout = { amCol: 3, nameCol: 2, groupCol: 1, firstDayCol: 4, commentCol: 9 }
const person = (over = {}) => {
  const halves = over.halves || [['', ''], ['', ''], ['', ''], ['', ''], ['', '']]
  return { name: 'Ana Smith', row: 10, halves, days: halves.map(([a, b]) => (!a ? b : !b || a.toLowerCase() === b.toLowerCase() ? a : `${a} / ${b}`)), comment: '', commentRow: 10, ...over }
}
const week = (...people) => new Map([['2026-10-26', { sheet: '26-Oct', layout, people }]])
const mapping = new Map([[nameKey('Ana Smith'), { kind: 'user', uid: 'u1' }]])
const sched = (days, extra = {}) => ({ days: days.map(location => ({ location, onCall: false })), ...extra })
const run = (p, app) => planExport({ weeks: week(p), mapping, existing: new Map([['2026-10-26_u1', app]]), nameKey })

test('one place goes in both halves; two places split AM and PM; three can\'t be split', () => {
  assert.deepEqual(splitHalves('Wellington'), ['Wellington', 'Wellington'])
  assert.deepEqual(splitHalves('Starship / Cass Office'), ['Starship', 'Cass Office'])
  assert.deepEqual(splitHalves('A / B / C'), null)
  assert.deepEqual(splitHalves(''), ['', ''])
})

test('an app entry where the Excel is blank is written, to the right cells, and remembered as the new base', () => {
  const r = run(person(), sched(['Wellington', '', '', '', '']))
  assert.deepEqual(r.edits.map(e => [e.sheet, e.row, e.col, e.before, e.text]), [['26-Oct', 10, 4, '', 'Wellington'], ['26-Oct', 11, 4, '', 'Wellington']])
  assert.deepEqual(r.bases[0].base.days, ['Wellington', '', '', '', ''])
  assert.equal(r.stats.cells, 2)
})

test('an app edit over an Excel cell that still says what it said at the last import is written', () => {
  const p = person({ halves: [['Cass Office', 'Cass Office'], ['', ''], ['', ''], ['', ''], ['', '']] })
  const r = run(p, sched(['Hamilton', '', '', '', ''], { excelBase: { days: ['Cass Office', '', '', '', ''], comments: '' } }))
  assert.equal(r.edits.length, 2)
  assert.equal(r.edits[0].text, 'Hamilton')
  assert.equal(r.edits[0].before, 'Cass Office')
})

test('a cell somebody changed in the Excel since the last import is left alone and counted', () => {
  const p = person({ halves: [['Auckland', 'Auckland'], ['', ''], ['', ''], ['', ''], ['', '']] })
  const r = run(p, sched(['Hamilton', '', '', '', ''], { excelBase: { days: ['Cass Office', '', '', '', ''], comments: '' } }))
  assert.equal(r.edits.length, 0)
  assert.equal(r.stats.conflicts, 1)
})

test('never from an app entry that was never compared with the Excel, over something the Excel already says', () => {
  const p = person({ halves: [['Auckland', 'Auckland'], ['', ''], ['', ''], ['', ''], ['', '']] })
  assert.equal(run(p, sched(['Hamilton', '', '', '', ''])).edits.length, 0)
})

test('nothing to do when they already agree, the app is blank, or only one half differs', () => {
  const p = person({ halves: [['Wellington', 'Wellington'], ['Hutt', ''], ['', ''], ['', ''], ['', '']] })
  assert.equal(run(p, sched(['Wellington', '', '', '', ''])).edits.length, 0)
  const half = run(person({ halves: [['Hutt', ''], ['', ''], ['', ''], ['', ''], ['', '']] }), sched(['Hutt', '', '', '', ''], { excelBase: { days: ['Hutt', '', '', '', ''], comments: '' } }))
  assert.equal(half.edits.length, 0, 'AM only reads as the same place')
  assert.equal(run(p, sched(['', '', '', '', ''])).edits.length, 0)
})

test('a changed AM/PM pair writes only the half that differs', () => {
  const p = person({ halves: [['Starship', 'Cass Office'], ['', ''], ['', ''], ['', ''], ['', '']] })
  const r = run(p, sched(['Starship / Wellington', '', '', '', ''], { excelBase: { days: ['Starship / Cass Office', '', '', '', ''], comments: '' } }))
  assert.deepEqual(r.edits.map(e => [e.row, e.text]), [[11, 'Wellington']])
})

test('the week comment: written when the Excel has none, into the row that holds comments', () => {
  const r = run(person(), sched(['', '', '', '', ''], { comments: 'Back Thursday' }))
  assert.deepEqual(r.edits.map(e => [e.row, e.col, e.text]), [[10, 9, 'Back Thursday']])
  const pm = run(person({ comment: 'Old', commentRow: 11 }), sched(['', '', '', '', ''], { comments: 'New', excelBase: { days: ['', '', '', '', ''], comments: 'Old' } }))
  assert.deepEqual(pm.edits.map(e => [e.row, e.text]), [[11, 'New']])
})

test('people the app has no entry for, or that aren\'t matched for certain, are skipped', () => {
  const none = planExport({ weeks: week(person()), mapping, existing: new Map(), nameKey })
  assert.equal(none.edits.length, 0)
  const unmatched = planExport({ weeks: week(person({ name: 'Someone Else' })), mapping, existing: new Map([['2026-10-26_u1', sched(['X', '', '', '', ''])]]), nameKey })
  assert.equal(unmatched.edits.length, 0)
})
