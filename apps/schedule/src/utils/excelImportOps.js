import { readPeople } from './excelSchedule.js'
import { excelPeople, matchPeople, buildMapping, planImport, nameKey } from './excelPlan.js'

/**
 * The writes an import plan (from planImport) turns into, as plain data:
 * [{ collection, id, data, merge }]. Shared by Settings → Staff schedule → Excel in the browser
 * (excelImportWrite.js) and the automatic import that runs on a PC
 * (scripts/excel-import.mjs), so both write exactly the same thing. `now()`
 * returns the timestamp to store — each side passes its own SDK's server time.
 *
 * Everything is a merge — nothing is ever deleted — and the plan records what
 * the Excel said, so applying the same plan twice changes nothing more.
 * Imported entries deliberately don't touch `submittedAt`: that means "saved
 * in the app", and the app → Excel copy uses it to find what to write *to* the
 * Excel — importing shouldn't echo straight back.
 */
export function importOps(plan, { editorUid = null, now }) {
  const ops = []

  for (const person of plan.newPeople.values()) {
    ops.push({
      collection: 'users', id: person.id, merge: false,
      data: { displayName: person.displayName, team: person.team, role: 'user', excelName: person.excelName, pending: true, importedFromExcel: true, createdAt: now() },
    })
  }
  for (const [uid, update] of plan.userUpdates) ops.push({ collection: 'users', id: uid, merge: true, data: update })

  for (const s of plan.schedules) {
    const excelBase = { ...s.base, at: now() }
    const days = s.days.map(d => ({ location: d.location, onCall: !!d.onCall }))
    let data
    if (s.isNew) {
      data = { uid: s.uid, displayName: s.displayName, email: s.email, team: s.team, weekStart: s.weekStart, days, comments: s.comments, needsConfirm: false, importedFromExcel: true, importedAt: now(), excelBase }
    } else if (s.contentChanged) {
      // An existing week keeps its owner, team and "needs checking" flag.
      data = { days, comments: s.comments, importedFromExcel: true, importedAt: now(), excelBase }
    } else {
      data = { excelBase } // only remembering what the Excel says, for next time
    }
    ops.push({ collection: 'schedules', id: s.id, merge: true, data })
  }

  for (const o of plan.onCall) {
    // `calls` (customer-calls cover) is left alone; a roster doc without it reads as no cover.
    ops.push({ collection: 'oncall', id: o.weekStart, merge: true, data: { uid: o.uid, displayName: o.displayName, updatedBy: editorUid, updatedAt: now(), importedFromExcel: true } })
  }
  return ops
}

/**
 * The import that runs by itself, with nobody there to answer questions — so it only does what Admin → Excel
 * would do without being asked:
 *  - only names it matches with certainty (an Excel name set on the person, full name, or first name within
 *    the same team). Anyone ambiguous, close-but-not-sure or not in the app is left out and counted, for an
 *    admin to sort out in Settings → Staff schedule → Excel — once picked there, the person's Excel name is remembered and they
 *    match here from then on;
 *  - never adds people;
 *  - the app wins a conflict (a cell changed in both places since the last import).
 *
 * `index` is from indexWorkbook, `fromWeek` the first week to import (a Monday, YYYY-MM-DD), `users` everyone
 * in the app ({ uid, ...doc }), `existing` / `existingOnCall` what the app holds for those weeks (see planImport).
 * → { plan, selected, left: { ambiguous, maybe, none } } — `left` counts the Excel names left out, by reason.
 */
export function autoImportPlan({ index, fromWeek, users, existing, existingOnCall }) {
  const allWeeks = [...index.weeks.keys()].sort()
  const selected = allWeeks.filter(w => w >= fromWeek)
  const read = w => readPeople(index.weeks.get(w).ws, index.weeks.get(w).layout)
  const newest = allWeeks.length ? read(allWeeks.at(-1)) : []
  const weeks = new Map(selected.map(w => [w, read(w)]))
  const people = excelPeople(weeks, newest)
  const matching = matchPeople(people, users)
  const mapping = buildMapping(people, matching, users, { addNew: false, currentKeys: new Set(newest.map(p => nameKey(p.name))) })
  const left = { ambiguous: 0, maybe: 0, none: 0 }
  for (const p of people) {
    const m = matching.get(p.key)
    if (m && m.status !== 'matched' && mapping.get(p.key)?.kind !== 'user') left[m.status]++
  }
  const plan = planImport({ weeks, selected, mapping, users, existing, existingOnCall, excelWins: false })
  return { plan, selected, left }
}

/** One line for the log and the activity record, counts only. */
export function describeRun({ plan, selected, left }) {
  const s = plan.stats
  const entries = s.added + s.updated + s.replaced
  const leftOut = left.ambiguous + left.maybe + left.none
  return [
    `${entries} ${entries === 1 ? 'entry' : 'entries'} brought in for ${s.people} ${s.people === 1 ? 'person' : 'people'} across ${selected.length} ${selected.length === 1 ? 'week' : 'weeks'}`,
    `${s.conflict} kept as the app has them (changed in both)`,
    plan.onCall.length ? `${plan.onCall.length} on-call set` : null,
    leftOut ? `${leftOut} Excel ${leftOut === 1 ? 'name' : 'names'} left for Settings → Staff schedule → Excel (${left.ambiguous} several fit, ${left.maybe} to check, ${left.none} not in the app)` : null,
    plan.warnings.length ? `${plan.warnings.length} ${plan.warnings.length === 1 ? 'warning' : 'warnings'}` : null,
  ].filter(Boolean).join(' · ')
}
