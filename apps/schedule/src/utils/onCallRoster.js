/**
 * The on-call roster workbook ("Oncall roster.xlsx", one engineer a week) as the schedule's weekly on-call.
 * Plain functions, no Firebase and no Excel: scripts/oncallSyncJob.mjs reads the two sides and writes.
 *
 * The roster file is the master for who is on call each week: a week where the app says someone else is
 * set to what the file says. A week the file leaves blank, or names someone who can't be matched to exactly one
 * person, is left as it is (and counted); nothing is ever cleared.
 */
import { byYear, personOf } from '../../../oncall/src/roster.js'

const squash = s => String(s ?? '').replace(/[\s ]+/g, ' ').trim()
const lower = s => squash(s).toLowerCase()

/** Every week of the parsed roster once, oldest first: [{ start, engineer (one person's name or '') }]. */
export function rosterWeeks(parsed) {
  const out = new Map()
  for (const year of byYear(parsed.sheets)) for (const w of year.weeks) if (!out.has(w.start)) out.set(w.start, { start: w.start, engineer: personOf(w.engineer) })
  return [...out.values()].sort((a, b) => (a.start < b.start ? -1 : 1))
}

/**
 * The one user a roster name is: the same full name, else the same first name (only one such person, or only one
 * among the Engineers). Anything else (two Mikes, "Ryan / Mike", nobody) is null.
 */
export function matchEngineer(name, users) {
  const n = lower(name)
  if (!n || /[/&,]|\band\b/.test(n)) return null
  const exact = users.filter(u => lower(u.displayName) === n)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const first = users.filter(u => lower(u.displayName).split(' ')[0] === n)
  if (first.length === 1) return first[0]
  const engineers = first.filter(u => lower(u.team) === 'engineers')
  return engineers.length === 1 ? engineers[0] : null
}

/**
 * weeks: rosterWeeks(); users: [{ uid, displayName, team }]; existing: Map(weekStart → the app's `oncall` doc)
 * → { writes: [{ weekStart, uid, displayName }], stats: { weeks, same, set, changed, blank, unmatched } }
 * Only weeks from `fromWeek` on. `set` is a week the app had nobody for, `changed` one it had someone else for.
 */
export function planOnCall({ weeks, users, existing, fromWeek }) {
  const writes = []
  const stats = { weeks: 0, same: 0, set: 0, changed: 0, blank: 0, unmatched: 0 }
  for (const w of weeks) {
    if (w.start < fromWeek) continue
    stats.weeks++
    if (!w.engineer) { stats.blank++; continue }
    const user = matchEngineer(w.engineer, users)
    if (!user) { stats.unmatched++; continue }
    const have = existing.get(w.start)
    if (have?.uid === user.uid) { stats.same++; continue }
    if (have?.uid) stats.changed++; else stats.set++
    writes.push({ weekStart: w.start, uid: user.uid, displayName: user.displayName || w.engineer })
  }
  return { writes, stats }
}
