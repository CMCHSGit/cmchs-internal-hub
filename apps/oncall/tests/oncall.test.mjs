import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dateCell, firstStart, parseSheet, parseWorkbook, sheetId } from '../src/parse.js'
import { byYear, personOf, renameEngineer, tally, yearOfWeek } from '../src/roster.js'

const HEAD = ['Month', 'Week', 'Start Date', 'End Date', 'Engineer', 'Public Holidays', 'Notes']

test('a typed-right first date is used as it is; a copied-forward one lands on the same weekday in the new year', () => {
  assert.equal(new Date(firstStart(2025, '2024-12-30')).toISOString().slice(0, 10), '2024-12-30')
  assert.equal(new Date(firstStart(2022, '2021-01-03')).toISOString().slice(0, 10), '2022-01-02') // a Sunday, as it was
  assert.equal(new Date(firstStart(2021, '2020-01-04')).toISOString().slice(0, 10), '2021-01-02') // a Saturday
})

test('a year out or a bare number falls back to the Monday on or before 1 January', () => {
  assert.equal(new Date(firstStart(2026, '2026-12-29')).toISOString().slice(0, 10), '2025-12-29')
  assert.equal(new Date(firstStart(2024, '1899-12-31')).toISOString().slice(0, 10), '2024-01-01')
})

test('dated sheet: weeks run on seven days from the first, months carry down, blank-engineer weeks are kept', () => {
  const rows = [HEAD,
    ['January', 'Week 1', dateCell('2024-12-30'), dateCell('2025-01-05'), 'Ana', '', 'Swap with Ben'],
    [null, 'Week 2', dateCell('2025-01-06'), dateCell('2025-01-12'), ' Cal ', dateCell('2025-01-13'), null],
    ['February', 'Week 3', dateCell('2025-01-13'), dateCell('2025-01-19'), null, null, null],
    [null, null, null, null, null, null, 'a stray label'],
  ]
  const s = parseSheet('2025', rows)
  assert.deepEqual(s.weeks.map(w => [w.month, w.week, w.start, w.end, w.engineer]), [
    ['January', '1', '2024-12-30', '2025-01-05', 'Ana'],
    ['January', '2', '2025-01-06', '2025-01-12', 'Cal'],
    ['February', '3', '2025-01-13', '2025-01-19', ''],
  ])
  assert.equal(s.weeks[0].notes, 'Swap with Ben')
  assert.equal(s.weeks[1].holidays, '2025-01-13')
  assert.deepEqual(s.extras, ['a stray label'])
})

test('text-range sheet (2019): the months follow the day numbers, from the December before', () => {
  const rows = [['Month', 'Week', 'Start Date', 'Engineer', 'Public Holidays'],
    ['January', '01', '31st - 6th', 'Ben', "1st - New Years Day"],
    [null, '02', '7th - 13th', 'Dee'],
    [null, '03', '14th - 20th', 'Eli'],
    [null, '04', '21st - 27th', 'Fox'],
    [null, '05', '28th - 3rd', 'Ben'],
    ['February', '06', '4th - 10th', 'Dee']]
  const s = parseSheet('2019', rows)
  assert.deepEqual(s.weeks.map(w => [w.start, w.end]), [
    ['2018-12-31', '2019-01-06'], ['2019-01-07', '2019-01-13'], ['2019-01-14', '2019-01-20'],
    ['2019-01-21', '2019-01-27'], ['2019-01-28', '2019-02-03'], ['2019-02-04', '2019-02-10']])
  assert.equal(s.weeks[0].holidays, '1st - New Years Day')
})

test('workbook: year sheets and the engineers list; the id of a tab', () => {
  const wb = parseWorkbook([{ name: '2025', rows: [HEAD] }, { name: 'Enginners', rows: [['Engineers'], ['Ana'], ['Ben']] }])
  assert.equal(wb.sheets.length, 1)
  assert.deepEqual(wb.engineers, ['Ana', 'Ben'])
  assert.equal(sheetId('2023 Revised'), '2023-revised')
})

test('a week belongs to the year of its Thursday; the revised sheet wins; each year has one copy of a week', () => {
  assert.equal(yearOfWeek('2025-12-29'), 2026)
  assert.equal(yearOfWeek('2024-12-23'), 2024)
  const w = (start, engineer) => ({ month: '', week: '1', start, end: start, engineer, holidays: '', school: '', notes: '' })
  const sheets = [
    { name: '2025', year: 2025, weeks: [w('2025-12-22', 'A'), w('2025-12-29', 'old')], extras: [] },
    { name: '2026', year: 2026, weeks: [w('2025-12-29', 'B')], extras: ['x'] },
    { name: '2023', year: 2023, weeks: [w('2023-01-01', 'first')], extras: [] },
    { name: '2023 Revised', year: 2023, weeks: [w('2023-01-01', 'revised')], extras: [] },
  ]
  const years = byYear(sheets)
  assert.deepEqual(years.map(y => y.year), [2026, 2025, 2023])
  assert.equal(years[0].weeks[0].engineer, 'B') // the 2026 sheet's, not the 2025 sheet's carry-over
  assert.deepEqual(years[0].extras, ['x'])
  assert.equal(years[2].weeks[0].engineer, 'revised')
})

test('renaming a person changes whole names only, brackets included', () => {
  assert.equal(renameEngineer('Ana', 'Ana', 'Anna'), 'Anna')
  assert.equal(renameEngineer('Dee (Ana)', 'Ana', 'Anna'), 'Dee (Anna)')
  assert.equal(renameEngineer('Anaya', 'Ana', 'Anna'), 'Anaya')
  assert.equal(renameEngineer('C.J.', 'C.J.', 'CJ'), 'CJ')
})

test('tally: people once each, brackets dropped, blanks skipped, holiday weeks counted', () => {
  assert.equal(personOf(' Dee (Fox) '), 'Dee')
  const rows = [{ engineer: 'Ana', holidays: '1-Jan' }, { engineer: 'Ana (Ben)', holidays: '' }, { engineer: 'Ben', holidays: '' }, { engineer: '', holidays: '' }]
  assert.deepEqual(tally(rows), [{ name: 'Ana', weeks: 2, holidayWeeks: 1 }, { name: 'Ben', weeks: 1, holidayWeeks: 0 }])
})
