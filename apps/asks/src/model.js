/* Asks: what an ask is and who it concerns. Kept free of React and Firebase
   so it can be tested on its own (tests/model.test.mjs).

   One ask is one document, asks/{id}:

     title, details              what's needed
     createdBy, createdByName    who asked
     assignees: [uid]            the people it was sent to
     teams: [team]               whole teams it was sent to (anyone on them can pick it up)
     people: [uid]               everyone involved by name: the asker, assignees,
                                 whoever picked it up and anyone @mentioned.
                                 Firestore's rules let these people, the teams
                                 above and admins see it; nobody else.
     owner, ownerName            who picked it up ('' until someone does)
     status                      open | picked | waiting | done
     waitingOn                   with status waiting: "Mindray", "the customer"
     urgent, due                 an Urgent flag and an optional due date (YYYY-MM-DD)
     doneAtMs, doneBy
     photoCount, commentCount, lastCommentAtMs, lastCommentBy
     event                       the last change that notifies people (see notify in
                                 backend-firebase.js): { id, type, by, atMs, to, teams, ref }

   askStats/{id} mirrors the counting fields with no text in them (statsOf), so
   the Company view can show everyone's load without showing anyone's asks. */

import { TEAMS } from '../../schedule/src/utils/teams.js'

export { TEAMS }

export const STATUSES = [
  { id: 'open', label: 'Open', hint: 'Nobody has picked it up yet', tone: 'purple' },
  { id: 'picked', label: 'Picked up', hint: 'Someone is on it', tone: 'orange' },
  { id: 'waiting', label: 'Waiting', hint: 'Waiting on someone else', tone: 'neutral' },
  { id: 'done', label: 'Done', hint: 'Finished', tone: 'green' },
]
export const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0]

// The same limits firestore.rules enforces.
export const LIMITS = { title: 200, details: 4000, comment: 4000, waitingOn: 120, photos: 6, assignees: 40, people: 60 }

const DAY = 86400000

/** Today in this browser's time zone, as YYYY-MM-DD. */
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const isoDays = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY)

export const isOutstanding = (a) => a.status !== 'done'
export const isOverdue = (a, today) => !!a.due && a.status !== 'done' && a.due < today

/** Who can see it: the same test as canSeeAsk() in firestore.rules. */
export function canSee(a, me) {
  if (!me) return false
  return me.role === 'admin' || (a.people || []).includes(me.uid) || (!!me.team && (a.teams || []).includes(me.team))
}

/** Was it sent to me, by name or through my team? */
export function sentTo(a, me) {
  return (a.assignees || []).includes(me.uid) || (!!me.team && (a.teams || []).includes(me.team))
}

/** Is it mine to do right now: picked up by me, or not picked up yet and sent to me. */
export function isMineToDo(a, me) {
  if (a.status === 'done') return false
  return a.owner ? a.owner === me.uid : sentTo(a, me)
}

/** Can I pick it up? Anyone it was sent to, or the person who asked, while nobody has it. */
export function canClaim(a, me) {
  return a.status !== 'done' && !a.owner && (sentTo(a, me) || a.createdBy === me.uid || me.role === 'admin')
}

/** Most pressing first: urgent, then overdue, then by due date, then newest. Done ones last, newest first. */
export function sortAsks(list, today) {
  const rank = (a) => (a.status === 'done' ? 3 : a.urgent ? 0 : isOverdue(a, today) ? 1 : 2)
  return [...list].sort((a, b) =>
    rank(a) - rank(b)
    || (a.status === 'done' ? (b.doneAtMs || 0) - (a.doneAtMs || 0) : 0)
    || (a.due && b.due ? a.due.localeCompare(b.due) : a.due ? -1 : b.due ? 1 : 0)
    || (b.createdAtMs || 0) - (a.createdAtMs || 0))
}

/**
 * The My asks page, in the order it shows them:
 *   toPick  sent to me (or my team), nobody has picked it up
 *   onIt    I've picked it up
 *   asked   I asked, not done yet
 *   done    finished in the last fortnight, that I was part of
 */
export function myBuckets(asks, me, today, now = Date.now()) {
  const out = { toPick: [], onIt: [], asked: [], done: [] }
  for (const a of asks) {
    if (a.status === 'done') {
      if ((a.doneAtMs || 0) > now - 14 * DAY && ((a.people || []).includes(me.uid) || sentTo(a, me))) out.done.push(a)
    } else if (a.owner === me.uid) out.onIt.push(a)
    else if (!a.owner && sentTo(a, me)) out.toPick.push(a)
    else if (a.createdBy === me.uid) out.asked.push(a)
  }
  for (const k of Object.keys(out)) out[k] = sortAsks(out[k], today)
  return out
}

/** What I have outstanding: the number on the tab and in the morning summary. */
export function myCount(asks, me, today) {
  const mine = asks.filter((a) => isMineToDo(a, me))
  return { total: mine.length, overdue: mine.filter((a) => isOverdue(a, today)).length, urgent: mine.filter((a) => a.urgent).length }
}

/** Everyone involved by name, without repeats. */
export function peopleOf(a, extra = []) {
  return [...new Set([a.createdBy, ...(a.assignees || []), a.owner, ...extra].filter(Boolean))]
}

/** The text-free copy kept in askStats/{id} — firestore.rules checks it matches the ask exactly. */
export function statsOf(a) {
  return {
    status: a.status, owner: a.owner || '', assignees: a.assignees || [], teams: a.teams || [],
    due: a.due || '', urgent: !!a.urgent, createdBy: a.createdBy, createdAtMs: a.createdAtMs || 0, doneAtMs: a.doneAtMs || 0,
  }
}

/**
 * The Company page, from askStats. Per person: asks they're on (picked up or
 * waiting), asks sent to them by name that nobody has picked up, and how many
 * of those are overdue. Per team: asks sent to the whole team that nobody has
 * picked up. Done ones only count towards "done this week".
 */
export function companyCounts(stats, users, today, now = Date.now()) {
  const rows = new Map(users.map((u) => [u.uid, { uid: u.uid, name: u.name, team: u.team || '', onIt: 0, waiting: 0, toPick: 0, overdue: 0, asked: 0 }]))
  const teams = new Map(TEAMS.map((t) => [t, { team: t, toPick: 0, overdue: 0 }]))
  const totals = { outstanding: 0, open: 0, picked: 0, waiting: 0, overdue: 0, urgent: 0, doneWeek: 0 }
  for (const s of stats) {
    if (s.status === 'done') {
      if ((s.doneAtMs || 0) > now - 7 * DAY) totals.doneWeek++
      continue
    }
    const late = isOverdue(s, today)
    totals.outstanding++
    totals[s.status] = (totals[s.status] || 0) + 1
    if (late) totals.overdue++
    if (s.urgent) totals.urgent++
    const asker = rows.get(s.createdBy)
    if (asker) asker.asked++
    if (s.owner) {
      const r = rows.get(s.owner)
      if (r) { r.onIt++; if (s.status === 'waiting') r.waiting++; if (late) r.overdue++ }
      continue
    }
    for (const uid of s.assignees || []) {
      const r = rows.get(uid)
      if (r) { r.toPick++; if (late) r.overdue++ }
    }
    for (const t of s.teams || []) {
      const r = teams.get(t)
      if (r) { r.toPick++; if (late) r.overdue++ }
    }
  }
  const people = [...rows.values()]
    .filter((r) => r.onIt || r.toPick || r.asked)
    .sort((a, b) => (b.onIt + b.toPick) - (a.onIt + a.toPick) || b.overdue - a.overdue || a.name.localeCompare(b.name))
  return { people, teams: [...teams.values()], totals }
}

/** "Due today", "Overdue by 3 days", "Due Fri 18 Oct". */
export function dueLabel(due, today) {
  if (!due) return ''
  const d = isoDays(due) - isoDays(today)
  if (d < 0) return `Overdue by ${-d} day${d === -1 ? '' : 's'}`
  if (d === 0) return 'Due today'
  if (d === 1) return 'Due tomorrow'
  const dt = new Date(due + 'T00:00:00')
  return 'Due ' + dt.toLocaleDateString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
export function timeAgo(ms, now = Date.now()) {
  if (!ms) return ''
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  if (s < 2 * 86400) return 'yesterday'
  return new Date(ms).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

/** "Peter Lin" -> "PL" */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
export const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || ''

const AVATAR = ['#554596', '#80bd01', '#ef7d00', '#968ac1', '#575756', '#b3d767', '#f8b472', '#3f3374']
const DARK_INK = new Set(['#80bd01', '#b3d767', '#f8b472', '#ef7d00'])
/** A steady colour per person, so the same initials always look the same. */
export function avatarStyle(key) {
  let h = 0
  for (const c of String(key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const bg = AVATAR[h % AVATAR.length]
  return { background: bg, color: DARK_INK.has(bg) ? '#1d1d1d' : '#fff' }
}

// ── @mentions ────────────────────────────────────────────────────────────

/** The word being typed after an @, if the caret is in one: { start, query }. */
export function mentionAt(text, caret) {
  const m = /(^|\s)@([\p{L}'’-]*)$/u.exec(text.slice(0, caret))
  return m ? { start: caret - m[2].length - 1, query: m[2] } : null
}

/** People whose first or last name starts with what's typed after the @. */
export function mentionMatches(people, query, max = 6) {
  const q = query.toLowerCase()
  return people.filter((p) => !q || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q))).slice(0, max)
}

/** The uids of everyone whose "@Full Name" is in the text. */
export function findMentions(text, people) {
  const t = String(text || '').toLowerCase()
  return people.filter((p) => p.name && t.includes('@' + p.name.toLowerCase())).map((p) => p.uid)
}

// ── checking what's typed ────────────────────────────────────────────────

const str = (v, max) => String(v ?? '').trim().slice(0, max)

/** A new or edited ask's own fields, trimmed and checked. Throws a message to show. */
export function cleanAsk(input) {
  const out = {
    title: str(input.title, LIMITS.title).replace(/\s+/g, ' '),
    details: str(input.details, LIMITS.details),
    assignees: [...new Set(input.assignees || [])].slice(0, LIMITS.assignees),
    teams: [...new Set(input.teams || [])].filter((t) => TEAMS.includes(t)),
    due: /^\d{4}-\d{2}-\d{2}$/.test(input.due || '') ? input.due : '',
    urgent: !!input.urgent,
  }
  if (!out.title) throw new Error('Say what you need in the first box.')
  if (!out.assignees.length && !out.teams.length) throw new Error('Send it to at least one person or team.')
  return out
}

export function cleanComment(text) {
  return str(text, LIMITS.comment)
}

/** A short random id for an event, so the notifier never sends the same one twice. */
export const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

/** The "what happened" note each notifying change leaves on the ask. */
export function eventOf(type, me, extra = {}) {
  return { id: rid(), type, by: me.uid, atMs: Date.now(), to: [], teams: [], ref: '', ...extra }
}
