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

/**
 * → { status, summary, cells, people }
 *   status: 'dry-run' | 'nothing' | 'too-many' | 'done' | 'partial' (some cells weren't written: left for the next run) | 'locked' | 'error'
 */
export async function runExport({ workbook, store, fromWeek, apply = false, maxCells = 60, applyEdits }) {
  const index = indexWorkbook(workbook)
  if (!index.weeks.size) throw new Error('No weekly schedule sheets found in the workbook.')
  const allWeeks = [...index.weeks.keys()].sort()
  const selected = allWeeks.filter(w => w >= fromWeek)
  const read = w => readPeople(index.weeks.get(w).ws, index.weeks.get(w).layout)
  const weeks = new Map(selected.map(w => [w, { sheet: index.weeks.get(w).sheet, layout: index.weeks.get(w).layout, people: read(w) }]))
  const newest = read(allWeeks.at(-1))

  const [users, existing] = await Promise.all([store.loadUsers(), store.loadSchedules(selected)])
  const people = excelPeople(new Map([...weeks].map(([w, v]) => [w, v.people])), newest)
  const matching = matchPeople(people, users)
  const mapping = buildMapping(people, matching, users, { addNew: false, currentKeys: new Set(newest.map(p => nameKey(p.name))) })

  const plan = planExport({ weeks, mapping, existing, nameKey })
  const s = plan.stats
  const summary = `${s.cells} cells for ${s.people} people (${s.days} days, ${s.comments} comments); ${s.conflicts} left because the Excel changed too, ${s.unsplittable} with more than two places`
  if (!plan.edits.length) return { status: 'nothing', summary, cells: 0, people: 0 }
  if (!apply) return { status: 'dry-run', summary, cells: s.cells, people: s.people, edits: plan.edits }
  if (s.cells > maxCells) return { status: 'too-many', summary, cells: s.cells, people: s.people }

  const result = await applyEdits(plan.edits)
  if (result.state === 'locked') return { status: 'locked', summary, cells: 0, people: 0 }
  if (result.state !== 'ok') return { status: 'error', summary: result.state, cells: 0, people: 0 }

  // A person's week is remembered as copied only when every one of its cells went in; the rest is planned again next run.
  const outcome = new Map() // id -> all written?
  plan.edits.forEach((e, i) => outcome.set(e.id, (outcome.get(e.id) ?? true) && result.statuses[i] === 'written'))
  const done = plan.bases.filter(b => outcome.get(b.id))
  if (done.length) await store.commitBases(done)
  const written = result.statuses.filter(x => x === 'written').length
  if (written) await store.logActivity(`Excel write-back (automatic): ${written} cells for ${done.length} people.`)
  const skipped = plan.edits.length - written
  return { status: skipped ? 'partial' : 'done', summary: `${written} of ${plan.edits.length} cells written${skipped ? `, ${skipped} left for the next run (changed meanwhile)` : ''}`, cells: written, people: done.length }
}
