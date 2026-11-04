/**
 * Starting next week's sheet in the Excel (the app → Excel copy, scripts/excelExportJob.mjs).
 *
 * People now fill the schedule in the hub, and nobody makes the week's tab in the workbook by hand any more. When the
 * app has entries for a week the workbook has no sheet for, the copy makes the sheet the way a person would: a copy of
 * the newest week's sheet (so the people, the teams, the merged cells, the colour rules and the column widths are
 * exactly as they were), cleared of last week's entries, with the new Monday in its header and a name like "9-Nov".
 * Then the ordinary copy fills it in from the app (the planned sheet is a blank copy of the newest week's rows, so
 * planExport sees it exactly as it will be). Plain functions, no Firebase and no Excel, so they are tested.
 *
 * Only weeks after the newest sheet are ever started, never a gap in the past, and never more than MAX_AHEAD weeks
 * past this week, so a mistyped date in the app can't litter the workbook with sheets.
 */
import { squash } from './excelSchedule.js'

export const MAX_AHEAD = 6 // weeks past the current one that can get a sheet
export const MAX_CREATE = 6 // sheets made in one run

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'] // the workbook's own "Sept"

const addDays = (iso, days) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** "2026-11-09" → "9-Nov". If a sheet with that name exists (the same week last year), "9-Nov-26". */
export function weekSheetName(weekStart, taken = []) {
  const [y, m, d] = weekStart.split('-').map(Number)
  const used = new Set([...taken].map(n => String(n).toLowerCase()))
  const plain = `${d}-${MONTH_NAMES[m - 1]}`
  if (!used.has(plain.toLowerCase())) return plain
  const withYear = `${plain}-${String(y).slice(2)}`
  if (!used.has(withYear.toLowerCase())) return withYear
  for (let n = 2; ; n++) if (!used.has(`${withYear} (${n})`.toLowerCase())) return `${withYear} (${n})`
}

/** Weeks after `newestWeek` that could get a sheet today: the Mondays up to MAX_AHEAD past `currentWeek`. */
export function candidateWeeks(newestWeek, currentWeek) {
  const last = addDays(currentWeek, MAX_AHEAD * 7)
  const out = []
  for (let w = addDays(newestWeek, 7); w <= last; w = addDays(w, 7)) out.push(w)
  return out
}

/** Does this app schedule say anything at all? A day with a place, or the week's comment. */
export function hasEntries(doc) {
  if (!doc) return false
  if (squash(doc.comments)) return true
  const days = Array.isArray(doc.days) ? doc.days : Object.values(doc.days || {})
  return days.some(d => squash(typeof d === 'string' ? d : d?.location))
}

/**
 * Which weeks to start: every week from the one after the newest sheet up to the last week the app has entries for
 * (no gaps), at most MAX_CREATE of them. `schedules` is whatever the app holds for the candidate weeks (docs with a `weekStart`).
 */
export function planNewWeeks({ newestWeek, currentWeek, schedules }) {
  const candidates = candidateWeeks(newestWeek, currentWeek)
  const filled = new Set([...schedules].filter(hasEntries).map(d => d.weekStart))
  let lastFilled = -1
  candidates.forEach((w, i) => { if (filled.has(w)) lastFilled = i })
  return candidates.slice(0, Math.min(lastFilled + 1, MAX_CREATE))
}

/** The column holding the week's Monday as a real date (the others are "previous day + 1"): usually the AM/PM column. */
export function headerDateCol(ws, layout) {
  for (const col of [layout.amCol, layout.firstDayCol]) if (ws.getCell(1, col).value instanceof Date) return col
  return layout.amCol
}

/**
 * The sheet-to-be as the export planner reads a sheet: the source's people on the same rows with nothing in their days
 * or comments, and "- OnCall" taken off the name (the on-call week is the app's to say). → { sheet, layout, people, fresh }
 */
export function blankWeek({ name, source }) {
  const people = source.people.map(p => ({
    ...p,
    halves: [0, 1, 2, 3, 4].map(() => ['', '']),
    days: ['', '', '', '', ''],
    comment: '', commentRow: p.row,
    onCall: false,
  }))
  return { sheet: name, layout: source.layout, people, fresh: true }
}

/**
 * What apply-excel-edits.ps1 does for one new sheet: copy `source`, call it `name`, put `weekStart` in the header's date
 * cell, clear the people's day and comment cells (merged cells by their top-left one), and rewrite the names that carried
 * "- OnCall".
 */
export function newSheetSteps({ name, weekStart, source, sourceSheet, dateCol }) {
  const { layout, people } = source
  const clearRows = [...new Set(people.flatMap(p => [p.row, p.row + 1]))]
  const clearCols = [0, 1, 2, 3, 4].map(i => layout.firstDayCol + i).concat(layout.commentCol)
  const nameFixes = people.filter(p => p.onCall).map(p => ({ row: p.row, col: layout.nameCol, text: p.name }))
  return { source: sourceSheet, name, weekStart, dateCol, clearRows, clearCols, nameFixes }
}
