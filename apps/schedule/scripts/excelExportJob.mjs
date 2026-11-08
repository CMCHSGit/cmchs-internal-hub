/**
 * One run of the app → Excel copy, with the database and the Excel-writing passed in so it can be tested without
 * Firebase or Excel. scripts/excel-export.mjs runs it on a PC (right after the Excel → app import, see
 * scripts/excel-sync.mjs); apply-excel-edits.ps1 makes the changes inside Excel itself.
 *
 * The rules are in src/utils/excelExportPlan.js. Nothing is written unless `apply` is set, and a run that would
 * change more than `maxCells` cells is refused whole.
 *
 * store: { loadUsers(), loadSchedules(weeks), commitBases(list), logActivity(summary) }
 * applyEdits(edits) → { state, statuses }   one status per edit: 'written' | 'mismatch' | 'failed'
 */
import { indexWorkbook, readPeople } from '../src/utils/excelSchedule.js'
import { excelPeople, matchPeople, buildMapping, nameKey } from '../src/utils/excelPlan.js'
import { planExport } from '../src/utils/excelExportPlan.js'
import { getCurrentWeekStart } from '../src/utils/week.js'
import { candidateWeeks, planNewWeeks, weekSheetName, blankWeek, newSheetSteps, headerDateCol } from '../src/utils/excelNewWeeks.js'

/**
 * → { status, summary, cells, people, newSheets }
 *   status: 'dry-run' | 'nothing' | 'too-many' | 'done' | 'partial' (some cells weren't written: left for the next run) | 'locked' | 'error'
 *   newSheets: the week sheets started this run (or that a dry run would start), [{ name, weekStart }]
 *
 * A week the app has entries for but the workbook has no sheet for is started first (src/utils/excelNewWeeks.js): a copy
 * of the newest sheet, cleared. Its cells are filled in the same run, and don't count against `maxCells` (a whole
 * week is about 300 cells, onto blank cells, so there is nothing to overwrite); `maxNewCells` is their own, higher limit.
 * applyEdits(edits, newSheets) makes the sheets, then the edits, in one go.
 */
export async function runExport({ workbook, store, fromWeek, currentWeek = getCurrentWeekStart(0), apply = false, maxCells = 60, maxNewCells = 1500, newWeeks = false, applyEdits }) {
  const index = indexWorkbook(workbook)
  if (!index.weeks.size) throw new Error('No weekly schedule sheets found in the workbook.')
  const allWeeks = [...index.weeks.keys()].sort()
  const selected = allWeeks.filter(w => w >= fromWeek)
  const read = w => readPeople(index.weeks.get(w).ws, index.weeks.get(w).layout)
  const weeks = new Map(selected.map(w => [w, { sheet: index.weeks.get(w).sheet, layout: index.weeks.get(w).layout, people: read(w) }]))
  const newestWeek = allWeeks.at(-1)
  const newest = read(newestWeek)

  // Starting next week's sheet is OFF unless asked for (`newWeeks`, the config's "newWeekSheets": true): it made people's copied
  // and mistyped weeks into sheets, several weeks ahead, and people filled in the wrong weeks.
  const ahead = newWeeks ? candidateWeeks(newestWeek, currentWeek) : [] // weeks the workbook has no sheet for yet, that could get one
  const [users, existing] = await Promise.all([store.loadUsers(), store.loadSchedules([...selected, ...ahead])])
  const people = excelPeople(new Map([...weeks].map(([w, v]) => [w, v.people])), newest)
  const matching = matchPeople(people, users)
  const mapping = buildMapping(people, matching, users, { addNew: false, currentKeys: new Set(newest.map(p => nameKey(p.name))) })

  // Weeks to start: blank copies of the newest sheet, planned like any other week so their cells are filled in this run.
  const newSheets = []
  const taken = workbook.worksheets.map(ws => ws.name)
  const source = { layout: index.weeks.get(newestWeek).layout, people: newest }
  for (const weekStart of newWeeks ? planNewWeeks({ newestWeek, currentWeek, schedules: [...existing.values()] }) : []) {
    const name = weekSheetName(weekStart, taken)
    taken.push(name)
    weeks.set(weekStart, blankWeek({ name, source }))
    newSheets.push(newSheetSteps({ name, weekStart, source, sourceSheet: index.weeks.get(newestWeek).sheet, dateCol: headerDateCol(index.weeks.get(newestWeek).ws, source.layout) }))
  }

  const plan = planExport({ weeks, mapping, existing, nameKey })
  const s = plan.stats
  const freshCells = plan.edits.filter(e => e.fresh).length
  const started = newSheets.map(({ name, weekStart }) => ({ name, weekStart }))
  const summary = `${s.cells} cells for ${s.people} people (${s.days} days, ${s.comments} comments); ${s.conflicts} left because the Excel changed too, ${s.unsplittable} with more than two places`
    + (started.length ? `; ${started.length} new week sheet${started.length === 1 ? '' : 's'} to start (${started.map(x => x.name).join(', ')}) with ${freshCells} of those cells` : '')
  if (!plan.edits.length && !newSheets.length) return { status: 'nothing', summary, cells: 0, people: 0, newSheets: [] }
  if (!apply) return { status: 'dry-run', summary, cells: s.cells, people: s.people, edits: plan.edits, newSheets: started, sheetSteps: newSheets }
  if (s.cells - freshCells > maxCells || freshCells > maxNewCells) return { status: 'too-many', summary, cells: s.cells, people: s.people, newSheets: [] }

  const result = await applyEdits(plan.edits, newSheets)
  if (result.state === 'locked') return { status: 'locked', summary, cells: 0, people: 0, newSheets: [] }
  if (result.state !== 'ok') return { status: 'error', summary: result.state, cells: 0, people: 0, newSheets: [] }

  // A person's week is remembered as copied only when every one of its cells went in; the rest is planned again next run.
  const outcome = new Map() // id -> all written?
  plan.edits.forEach((e, i) => outcome.set(e.id, (outcome.get(e.id) ?? true) && result.statuses[i] === 'written'))
  const done = plan.bases.filter(b => outcome.get(b.id))
  if (done.length) await store.commitBases(done)
  const written = result.statuses.filter(x => x === 'written').length
  const sheetWord = started.length ? ` Started the sheet${started.length === 1 ? '' : 's'} for the week of ${started.map(x => x.weekStart).join(', ')}.` : ''
  if (written || started.length) await store.logActivity(`Excel write-back (automatic): ${written} cells for ${done.length} people.${sheetWord}`)
  const skipped = plan.edits.length - written
  return {
    status: skipped ? 'partial' : 'done',
    summary: `${started.length ? `Started ${started.length} new week sheet${started.length === 1 ? '' : 's'} (${started.map(x => x.name).join(', ')}); ` : ''}${written} of ${plan.edits.length} cells written${skipped ? `, ${skipped} left for the next run (changed meanwhile)` : ''}`,
    cells: written, people: done.length, newSheets: started,
  }
}
