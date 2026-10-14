/**
 * One run of the automatic Excel → schedule import, with the database passed in as `store` so it can be
 * tested without Firebase. scripts/excel-import.mjs runs it on a PC every 5 minutes against the
 * OneDrive-synced copy of the company workbook — no Microsoft (Graph) permission needed, so no IT.
 *
 * The rules are Admin → Excel's (src/utils/excelPlan.js), applied the way an unattended run should:
 * certain matches only, nobody added, the app wins a conflict — see autoImportPlan in
 * src/utils/excelImportOps.js. Nothing is written unless `apply` is set.
 *
 * store: {
 *   loadUsers()             → [{ uid, ...user }]
 *   loadSchedules(weeks)    → Map(`${weekStart}_${uid}` → schedule) for those weeks
 *   loadOnCall(weeks)       → Map(weekStart → on-call doc) for those weeks
 *   commit(ops)             writes importOps(...) output
 *   logActivity(summary)    one line in the admin activity log
 *   now()                   the timestamp to store (the SDK's server time)
 * }
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import { indexWorkbook } from '../src/utils/excelSchedule.js'
import { autoImportPlan, describeRun, importOps } from '../src/utils/excelImportOps.js'

/** Reads the workbook from a private copy, so Excel or OneDrive having the file open can't get in the way. */
export async function readWorkbook(file) {
  const copy = path.join(os.tmpdir(), `cmchs-excel-import-${process.pid}-${Date.now()}.xlsx`)
  try {
    fs.copyFileSync(file, copy)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.readFile(copy)
    return wb
  } finally {
    fs.rmSync(copy, { force: true })
  }
}

/**
 * → { status, summary, changes, writes }
 *   status: 'dry-run' (nothing written), 'done', 'nothing' (already up to date), or 'too-many' (more changes than
 *   `maxChanges` — nothing written, so a damaged or wrongly-edited file can't overwrite the schedule wholesale).
 *   changes: entries, on-call and Excel names that would change; writes: documents written (or that would be).
 */
export async function runImport({ workbook, store, fromWeek, apply = false, maxChanges = 150 }) {
  const index = indexWorkbook(workbook)
  if (!index.weeks.size) throw new Error('No weekly schedule sheets found in the workbook.')
  const weeks = [...index.weeks.keys()].filter(w => w >= fromWeek).sort()
  const [users, existing, existingOnCall] = await Promise.all([store.loadUsers(), store.loadSchedules(weeks), store.loadOnCall(weeks)])

  const run = autoImportPlan({ index, fromWeek, users, existing, existingOnCall })
  const { plan } = run
  const ops = importOps(plan, { editorUid: null, now: store.now })
  const changes = plan.schedules.filter(s => s.isNew || s.contentChanged).length + plan.onCall.length + plan.userUpdates.size
  const summary = describeRun(run)

  if (!apply) return { status: 'dry-run', summary, changes, writes: ops.length }
  if (!ops.length) return { status: 'nothing', summary, changes, writes: 0 }
  if (changes > maxChanges) return { status: 'too-many', summary, changes, writes: 0 }

  await store.commit(ops)
  // Only real changes go in the activity log — a run that just remembered what the Excel says is noise.
  if (changes) await store.logActivity(`Excel import (automatic): ${summary}.`)
  return { status: 'done', summary, changes, writes: ops.length }
}
