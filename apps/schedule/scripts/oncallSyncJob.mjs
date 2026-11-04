/**
 * One run of the on-call roster sync, with the database passed in so it can be tested without Firebase.
 * scripts/oncall-sync.mjs runs it on a PC (see EXCEL-IMPORT.md, "On-call roster").
 *
 * Reads "Oncall roster.xlsx" and writes it to both places the app keeps on-call:
 *   - the hub's On-call roster page (`oncallHistory`: a document a sheet, as an admin's import there would),
 *   - the schedule's weekly on-call (`oncall/{Monday}`, who "Name - OnCall" is on the Team week), from `fromWeek` on.
 * The roster file wins where the two disagree (src/utils/onCallRoster.js). Nothing is written unless `apply` is set.
 *
 * store: { loadUsers(), loadOnCall(weeks), saveHistory(parsed), commitOnCall(writes), logActivity(summary) }
 * `history`: also rewrite the hub's roster page (the file changed); the schedule's weeks are checked every run.
 */
import { parseWorkbook, sheetsFromExcelJS } from '../../oncall/src/parse.js'
import { rosterWeeks, planOnCall } from '../src/utils/onCallRoster.js'

/** → { status: 'dry-run' | 'nothing' | 'done', summary, writes, weeks } */
export async function runOnCallSync({ workbook, store, fromWeek, apply = false, history = true }) {
  const parsed = parseWorkbook(sheetsFromExcelJS(workbook))
  if (!parsed.sheets.length) throw new Error('No year sheets found in the on-call roster workbook.')
  const weeks = rosterWeeks(parsed)
  const wanted = weeks.filter(w => w.start >= fromWeek).map(w => w.start)

  const [users, existing] = await Promise.all([store.loadUsers(), store.loadOnCall(wanted)])
  const { writes, stats } = planOnCall({ weeks, users, existing, fromWeek })
  const hub = `${parsed.sheets.length} roster sheet${parsed.sheets.length === 1 ? '' : 's'}`
  const summary = `${stats.weeks} weeks from ${fromWeek}: ${stats.same} already right, ${stats.set} to set, ${stats.changed} to change to the roster's; ${stats.unmatched} left (name not one person), ${stats.blank} blank`
    + (history ? `; hub roster page: ${hub}` : '')
  if (!writes.length && !history) return { status: 'nothing', summary, writes: 0, weeks: stats.weeks }
  if (!apply) return { status: 'dry-run', summary, writes: writes.length, weeks: stats.weeks, plan: writes }

  if (history) await store.saveHistory(parsed)
  if (writes.length) await store.commitOnCall(writes)
  if (writes.length || history) {
    await store.logActivity(`On-call roster sync (automatic): ${writes.length} week${writes.length === 1 ? '' : 's'} written to the schedule${history ? `, ${hub} written to the hub's roster page` : ''}.`)
  }
  return { status: 'done', summary, writes: writes.length, weeks: stats.weeks }
}
