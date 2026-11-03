/**
 * When the automatic app → Excel copy can skip a run without reading Firestore for the whole schedule.
 *
 * A pass reads every person and every recent week's schedule (about a hundred documents) to decide what to write.
 * Run every 5 minutes that is most of a day's reads on a quiet hub, and nearly all of those runs find nothing new.
 * Re-running a pass whose two inputs are the same gives the same answer, so a run may skip when:
 *   - the workbook is the file the last pass left (same modified time and size; the pass's own writes included),
 *   - the last pass didn't ask to be retried (the workbook locked, or Excel failed),
 *   - it was not too long ago (people being added or renamed don't touch a schedule document, so look again now and then), and
 *   - nothing in the app has changed since: one one-document query (the caller's job, see changedSince in excel-export.mjs).
 * Pure, so tests/excelExportSkip.test.mjs can try it.
 */
export const RECHECK_MINUTES = 30
export const SKEW_MS = 5 * 60 * 1000 // this PC's clock against the server's, when asking what changed since the last pass

/** state: what the last pass saved ({ mtimeMs, size, checkedAt, appSeenAt, retry }); stat: the workbook file now. */
export function workbookUnchanged({ state, stat, now, recheckMinutes = RECHECK_MINUTES, force = false }) {
  if (force || !state || typeof state !== 'object') return false
  if (state.retry) return false
  if (state.mtimeMs !== stat.mtimeMs || state.size !== stat.size) return false
  if (!state.checkedAt || now - state.checkedAt >= recheckMinutes * 60 * 1000) return false
  return true
}

/** What to remember after a pass: the workbook as it is now (after the pass's own writes), and when it started. */
export function stateAfter({ stat, passStart, status }) {
  return {
    mtimeMs: stat.mtimeMs, size: stat.size, checkedAt: passStart, appSeenAt: passStart,
    retry: status === 'locked' || status === 'error', // another go next run; "partial" only means the same cells again, which a retry wouldn't change
  }
}
