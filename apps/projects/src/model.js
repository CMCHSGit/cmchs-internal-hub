/* Project tracker — the data model, dates, and every calculation the views
   share. Plain functions with no Firebase or React in them, so
   tests/model.test.mjs can run them under node --test.

   A job is one document in `projectJobs`. Who is where each week is NOT on the
   job: it is one `projectAssignments` record per person, job, week and
   activity, so it can later feed the staff schedule without anyone having to
   read free text. Dates are 'YYYY-MM-DD' strings throughout; the screen shows
   them NZ style, 12-Oct. */

export const PRIORITIES = ['Low', 'Medium', 'High']

/** Where a requested demo unit has got to. Shipped and At site mean it is physically away. */
export const LINE_STATUSES = ['Requested', 'Reserved', 'Packed', 'Shipped', 'At site', 'Returned']
const AWAY = ['Shipped', 'At site']

/** Statuses the app gives meaning to; the rest are labels and colours only. */
export const WAITING = 'Waiting'
export const COMPLETE = 'Complete'

export const DEFAULT_SETTINGS = {
  categories: [
    { id: 'discussion', name: 'Things for group discussion', color: '#747577' },
    { id: 'events', name: 'Conferences / workshops', color: '#ef7d00' },
    { id: 'trials', name: 'Pending trials / demos / loan gear', color: '#80bd01' },
    { id: 'installs', name: 'Installs, upgrades and future planning', color: '#554596' },
  ],
  // `outline` draws the pill as a ring of its colour on the page background,
  // which keeps 11 statuses apart with only three brand colours to work with.
  statuses: [
    { name: 'Planning', color: '#dbd7ed' },
    { name: 'Tentative', color: '#747577', outline: true, dashed: true },
    { name: 'Booked', color: '#554596' },
    { name: 'Waiting', color: '#ef7d00' },
    { name: 'Testing', color: '#fee7d1' },
    { name: 'Tested/ready', color: '#d9ebb2' },
    { name: 'Shipped', color: '#554596', outline: true },
    { name: 'Go-live', color: '#80bd01' },
    { name: 'Support', color: '#5f8c00', outline: true },
    { name: 'Delayed', color: '#c8102e' },
    { name: 'Complete', color: '#575756' },
  ],
  activities: [
    { name: 'Prep', color: '#e8e9ea' },
    { name: 'Training', color: '#dbd7ed' },
    { name: 'Superuser training', color: '#554596' },
    { name: 'Go-live', color: '#80bd01' },
    { name: 'Support', color: '#e9f2da' },
    { name: 'Install', color: '#fddab4' },
    { name: 'Trial', color: '#ef7d00' },
    { name: 'Travel', color: '#a7a9ac', outline: true },
  ],
  staff: [],
  // The demo pool, by model. Stands in for the demo tracker feed until that is
  // connected; `total: null` means nobody has said how many we own yet.
  pool: [
    { model: 'A9', family: 'Anaesthesia', kind: 'Anaesthesia system', total: null },
    { model: 'A7', family: 'Anaesthesia', kind: 'Anaesthesia system', total: null },
    { model: 'N19', family: 'Monitors', kind: 'Bedside monitor', total: null },
    { model: 'ePM12', family: 'Monitors', kind: 'Bedside monitor', total: null },
    { model: 'V200', family: 'Monitors', kind: 'Vital signs monitor', total: null },
    { model: 'D60', family: 'Defibs', kind: 'Defibrillator', total: null },
    { model: 'D30', family: 'Defibs', kind: 'Defibrillator', total: null },
    { model: 'D1 Pro', family: 'Defibs', kind: 'AED', total: null },
    { model: 'Surgical bed', family: 'Beds', kind: 'Bed', total: null },
  ],
  askOnComplete: true,
  autoArchive: false,
  autoArchiveDays: 14,
  feed: { url: '', syncedAt: null },
}

/** Settings as stored, with anything missing filled from the defaults. */
export function withDefaults(stored) {
  const s = { ...DEFAULT_SETTINGS, ...(stored || {}) }
  for (const k of ['categories', 'statuses', 'activities', 'pool', 'staff']) {
    if (!Array.isArray(s[k])) s[k] = DEFAULT_SETTINGS[k]
  }
  s.feed = { ...DEFAULT_SETTINGS.feed, ...(s.feed || {}) }
  return s
}

// ── dates ───────────────────────────────────────────────────────────────
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = (n) => String(n).padStart(2, '0')

/** Midday local time, so adding days never trips over a daylight saving change. */
export function toDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, 12)
}
export const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayISO = (d = new Date()) => toISO(d)
export const isISO = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export function addDays(iso, n) {
  const d = toDate(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** The Monday of the week holding this date — weeks run Monday to Sunday. */
export function mondayOf(iso) {
  const d = toDate(iso)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return toISO(d)
}

export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 86400000)

/** 12-Oct */
export function fmt(iso) {
  if (!isISO(iso)) return ''
  const [, m, d] = iso.split('-').map(Number)
  return `${pad(d)}-${MONTHS[m - 1]}`
}
/** 12-Oct-2026 */
export const fmtY = (iso) => (isISO(iso) ? `${fmt(iso)}-${iso.slice(0, 4)}` : '')

/** "12-Oct – 06-Nov", "From 12-Oct", or "Dates TBC". */
export function fmtRange(start, end) {
  if (isISO(start) && isISO(end)) return `${fmt(start)} – ${fmt(end)}`
  if (isISO(start)) return `From ${fmt(start)}`
  if (isISO(end)) return `Until ${fmt(end)}`
  return 'Dates TBC'
}

/** `count` Mondays starting at `monday`. */
export function weeksFrom(monday, count) {
  return Array.from({ length: count }, (_, i) => addDays(monday, i * 7))
}

/** Both ranges inclusive. A job with no dates overlaps nothing. */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  if (!isISO(aStart) && !isISO(aEnd)) return false
  const s = isISO(aStart) ? aStart : aEnd
  const e = isISO(aEnd) ? aEnd : aStart
  return s <= bEnd && e >= bStart
}

// ── colours ─────────────────────────────────────────────────────────────
/** Near-black or white, whichever reads better on this fill (WCAG luminance). */
export function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return '#1d1d1d'
  const n = parseInt(m[1], 16)
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return (L + 0.05) / (0.0118 + 0.05) > (1.05) / (L + 0.05) ? '#1d1d1d' : '#ffffff'
}

/** Inline style for a status or activity pill from its settings entry. */
export function pillStyle(entry) {
  if (!entry) return { background: 'var(--surface-subtle)', color: 'var(--text-body)' }
  if (entry.outline) {
    return { background: 'transparent', color: 'var(--text-strong)', boxShadow: `inset 0 0 0 1.5px ${entry.color}`, ...(entry.dashed ? { border: `1px dashed ${entry.color}`, boxShadow: 'none' } : {}) }
  }
  return { background: entry.color, color: inkOn(entry.color) }
}

// ── people ──────────────────────────────────────────────────────────────
/** "Peter Lin" -> "PL" */
export function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

const AVATAR = ['#554596', '#80bd01', '#ef7d00', '#968ac1', '#575756', '#b3d767', '#f8b472', '#3f3374']
/** A steady colour per person, so the same initials always look the same. */
export function avatarStyle(key) {
  let h = 0
  for (const c of String(key || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const bg = AVATAR[h % AVATAR.length]
  return { background: bg, color: inkOn(bg) }
}

/** The leave ranges of this person that touch the week starting `monday`. */
export function leaveInWeek(person, monday) {
  const sunday = addDays(monday, 6)
  return (person?.leave || []).filter((l) => overlaps(l.from, l.to, monday, sunday))
}

/**
 * Weeks where someone is booked twice, or booked while on leave.
 * Returns a Map of `${staffId}|${week}` -> 'double' | 'leave'.
 */
export function clashes(assignments, staff, activeJobIds) {
  const out = new Map()
  const byKey = new Map()
  for (const a of assignments) {
    if (activeJobIds && !activeJobIds.has(a.jobId)) continue
    const k = `${a.staffId}|${a.week}`
    if (!byKey.has(k)) byKey.set(k, new Set())
    byKey.get(k).add(a.jobId)
  }
  for (const [k, jobs] of byKey) {
    const [id, week] = k.split('|')
    const person = staff.find((p) => p.id === id)
    if (person && leaveInWeek(person, week).length) out.set(k, 'leave')
    else if (jobs.size > 1) out.set(k, 'double')
  }
  return out
}

// ── demo equipment ──────────────────────────────────────────────────────
/*
 * `loans` below is the demo tracker feed's list (feed.js summarise()): units
 * the demo tracker has out, or booked out ahead, each tagged with the pool
 * model it belongs to. null when the feed has never been read; then only the
 * jobs' own reservations count.
 *
 * A job's equipment line can be linked to one of those loans (`line.loan` =
 * the loan's key) when the units the job asked for are the ones the demo
 * tracker sent. A linked loan is counted once, on the job: as many units as
 * the bigger of the two, out from the moment the tracker says so, due back
 * when the tracker says, and gone once the tracker has them back.
 */

const loanKey = (key, model) => key + '|' + model

/** Loans some job line (not yet Returned) is linked to, as `${key}|${model}`. */
function linkedLoans(jobs) {
  const out = new Map()
  for (const j of jobs) {
    for (const l of j.equipment || []) if (l.loan && l.line !== 'Returned') out.set(loanKey(l.loan, l.model), { job: j, line: l })
  }
  return out
}

/** How a feed loan sits in time: overdue, or the dates it holds a unit for. */
export function loanSpan(x, today) {
  const overdue = Boolean(x.out && x.due && x.due < today)
  const from = x.start || today
  return { overdue, from, to: x.due || '9999-12-31' }
}

/**
 * Every unit of `model` spoken for over [start, end], by jobs other than
 * `excludeJobId` and by the demo tracker's own loans. A unit that has gone out
 * (Shipped or At site, or out in the demo tracker) and is past its due date
 * is overdue: it counts against every range from today on, archived job or
 * not, until it comes back.
 */
export function equipmentUse(jobs, { model, start, end, excludeJobId = null, today, loans = null }) {
  const entries = []
  const byKey = new Map((loans || []).filter((x) => x.model === model).map((x) => [x.key, x]))
  const linked = linkedLoans(jobs)
  for (const j of jobs) {
    if (j.id === excludeJobId) continue
    for (const l of j.equipment || []) {
      if (l.model !== model || l.line === 'Returned') continue
      let qty = Number(l.qty) || 0
      let away = AWAY.includes(l.line)
      let due = dueBack(j, l)
      let loan = null
      if (l.loan && loans) {
        loan = byKey.get(l.loan)
        if (!loan) continue // the demo tracker has these back
        qty = Math.max(qty, loan.qty)
        if (loan.out) away = true
        if (loan.due) due = loan.due
      }
      if (!qty) continue
      const overdue = away && isISO(due) && due < today
      const span = loan && loanSpan(loan, today)
      if (overdue) {
        if (end >= today) entries.push({ job: j, line: l, loan, qty, overdue: true })
      } else if (!j.archived && overlaps(j.start, j.end, start, end)) {
        entries.push({ job: j, line: l, loan, qty, overdue: false })
      } else if (!j.archived && away && !isISO(due) && end >= today) {
        // Out with no return date: assume still out
        entries.push({ job: j, line: l, loan, qty, overdue: false })
      } else if (loan && overlaps(span.from, span.to, start, end)) {
        // The tracker has them out (or booked) beyond the job's own dates
        entries.push({ job: j, line: l, loan, qty, overdue: false })
      }
    }
  }
  for (const x of byKey.values()) {
    if (linked.has(loanKey(x.key, x.model))) continue
    const { overdue, from, to } = loanSpan(x, today)
    if ((overdue && end >= today) || overlaps(from, to, start, end)) {
      entries.push({ job: null, line: null, loan: x, qty: x.qty, overdue, feed: true })
    }
  }
  return { entries, total: entries.reduce((t, e) => t + e.qty, 0) }
}

/**
 * A job's equipment lines that still need a demo tracker loan form: not back
 * yet, not linked to a demo tracker loan, and not marked as not needing one
 * (`noLoan`, e.g. kit borrowed from Mindray). Archived jobs never nag.
 */
export const linesNeedingLoan = (job) => (job.archived ? [] : (job.equipment || []).filter((l) => l.line !== 'Returned' && !l.loan && !l.noLoan && Number(l.qty) > 0))

/** When a unit on this line is due back: its own date if it has one, else the job's end. */
export const dueBack = (job, line) => (isISO(line.due) ? line.due : job.end)

export const poolEntry = (pool, model) => pool.find((p) => p.model === model) || null

/**
 * Can this job have `qty` of `model` for its dates? `owned` is null when the
 * pool size is not known yet, and then nothing is called short.
 */
export function availability(jobs, pool, { model, qty, job, today, loans = null }) {
  const owned = poolEntry(pool, model)?.total ?? null
  if (!isISO(job.start) && !isISO(job.end)) {
    return { owned, used: 0, free: owned, short: 0, entries: [], noDates: true }
  }
  const start = isISO(job.start) ? job.start : job.end
  const end = isISO(job.end) ? job.end : job.start
  const { entries, total } = equipmentUse(jobs, { model, start, end, excludeJobId: job.id, today, loans })
  const free = owned == null ? null : Math.max(0, owned - total)
  const short = owned == null ? 0 : Math.max(0, (Number(qty) || 0) - free)
  return { owned, used: total, free, short, entries, noDates: false }
}

/** Units of `model` booked in the week starting `monday`, and who has them. */
export function bookedInWeek(jobs, model, monday, today, loans = null) {
  return equipmentUse(jobs, { model, start: monday, end: addDays(monday, 6), today, loans })
}

/** 'free' | 'full' | 'short' | 'none' | 'unknown' — the colour of an Equipment cell. */
export function loadLevel(booked, owned) {
  if (owned == null) return booked ? 'unknown' : 'none'
  if (booked > owned) return 'short'
  if (booked === owned && booked > 0) return 'full'
  return booked ? 'free' : 'none'
}

/**
 * Demo units that went out and have not come back, past their due date: job
 * lines, and the demo tracker's own overdue loans (with the job linked to
 * one, if any). With the feed in, a linked line goes by the tracker's dates.
 */
export function overdueReturns(jobs, today, loans = null) {
  const out = []
  for (const j of jobs) {
    for (const l of j.equipment || []) {
      if (loans && l.loan) continue
      const due = dueBack(j, l)
      if (AWAY.includes(l.line) && isISO(due) && due < today) {
        out.push({ job: j, line: l, model: l.model, qty: Number(l.qty) || 0, due, days: daysBetween(due, today) })
      }
    }
  }
  const linked = linkedLoans(jobs)
  for (const x of loans || []) {
    if (!loanSpan(x, today).overdue) continue
    const by = linked.get(loanKey(x.key, x.model))
    out.push({ job: by?.job || null, line: by?.line || null, loan: x, feed: true, model: x.model, qty: x.qty, due: x.due, days: daysBetween(x.due, today) })
  }
  return out.sort((a, b) => b.days - a.days)
}

/** Models that are fully booked or short in any of these weeks. */
export function shortfalls(jobs, pool, weeks, today, loans = null) {
  const out = []
  for (const p of pool) {
    if (p.total == null) continue
    // The first week it is short if it ever is, otherwise the first week it is full.
    let pick = null
    for (const w of weeks) {
      const { total, entries } = bookedInWeek(jobs, p.model, w, today, loans)
      const level = loadLevel(total, p.total)
      if (level === 'short') { pick = { model: p.model, week: w, booked: total, owned: p.total, level, entries }; break }
      if (level === 'full' && !pick) pick = { model: p.model, week: w, booked: total, owned: p.total, level, entries }
    }
    if (pick) out.push(pick)
  }
  return out.sort((a, b) => (a.level === b.level ? a.week.localeCompare(b.week) : a.level === 'short' ? -1 : 1))
}

/** Who holds an entry, in words: the job's name, or where the demo tracker has the units. */
export const entryWho = (e) => (e.job ? e.job.name : [e.loan?.loanTo, e.loan?.location].filter(Boolean).join(', ') || 'Demo tracker loan')

/**
 * The demo tracker's loans of this model that a job line could be linked to:
 * on dates that touch the job's, and not linked to another job already.
 */
export function linkableLoans(jobs, loans, { model, job, today }) {
  const linked = linkedLoans(jobs)
  return (loans || []).filter((x) => {
    if (x.model !== model) return false
    const by = linked.get(loanKey(x.key, x.model))
    if (by && by.job.id !== job.id) return false
    const { overdue, from, to } = loanSpan(x, today)
    return overdue || (!isISO(job.start) && !isISO(job.end)) || overlaps(from, to, job.start, job.end)
  })
}

// ── conferences ─────────────────────────────────────────────────────────
/*
 * Conferences are jobs in the conferences category, with the columns of the
 * team's old "Conferences" sheet kept on the job as `conf`. The ones imported
 * from that sheet carry those details as "Label: value" lines in their first
 * note instead; confOf() reads both, so nothing had to be migrated, and the
 * first edit in the Conferences view saves the lot into `conf`.
 *
 * A conference also shows in the main Table and Timeline only when someone
 * has ticked it in Conferences (`showInMain`). Until anyone has chosen, it
 * shows if anyone is on it, so the conferences the team was already staffing
 * stay where they were.
 */

/** The conferences category: id 'events' (the default list), or any category named like "Conferences". */
export const isConferenceCategory = (cat) => Boolean(cat) && (cat.id === 'events' || /conference/i.test(cat.name || ''))

/** The sheet's columns that aren't already job fields (name, status, dates, venue = customer, city = region, people). */
export const CONF_FIELDS = [
  { key: 'type', label: 'Type' },
  { key: 'modality', label: 'Modality' },
  { key: 'registration', label: 'Registration #' },
  { key: 'regBy', label: 'Register by' },
  { key: 'packIn', label: 'Pack in' },
  { key: 'packOut', label: 'Pack out' },
  { key: 'reps', label: 'Other reps' },
  { key: 'stand', label: 'Stand' },
  { key: 'booth', label: 'Booth #' },
  { key: 'gear', label: 'Equipment' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'sponsorship', label: 'Sponsorship' },
  { key: 'website', label: 'Website' },
  { key: 'comments', label: 'Comments' },
  { key: 'remarks', label: 'Notes' },
]

// The labels the sheet import wrote into the first note, and the field each one is
const SHEET_LABELS = {
  'Status on the sheet': 'sheetStatus', 'Registration #': 'registration', Reps: 'reps', Stand: 'stand', Booth: 'booth',
  'Pack in': 'packIn', 'Pack out': 'packOut', Equipment: 'gear', Delivery: 'delivery', Comments: 'comments',
  Website: 'website', Notes: 'remarks', Sponsorship: 'sponsorship', 'Register by': 'regBy',
}

/** A conference's sheet columns: from the imported note, overridden by anything saved since. */
export function confOf(job) {
  const out = {}
  const note = (job.notes || []).find((n) => /^Status on the sheet:/m.test(n.text || ''))
  if (note) {
    for (const line of String(note.text).split('\n')) {
      const m = /^([^:]+):\s*(.*)$/.exec(line)
      if (!m) continue
      if (m[1] === 'Type') {
        const [type, ...rest] = m[2].split(', ')
        out.type = type
        out.modality = rest.join(', ')
      } else if (SHEET_LABELS[m[1]]) {
        out[SHEET_LABELS[m[1]]] = m[2]
      }
    }
  }
  return { ...out, ...(job.conf || {}) }
}

/** Does this job show in the main Table and Timeline? Every job does except conferences nobody ticked (see above). */
export function inMainViews(job, catById, assignments = []) {
  if (!isConferenceCategory(catById.get(job.category))) return true
  if (typeof job.showInMain === 'boolean') return job.showInMain
  return (job.eng?.length || 0) + (job.apps?.length || 0) > 0 || assignments.some((a) => a.jobId === job.id)
}

// ── archiving ───────────────────────────────────────────────────────────
export function dueForAutoArchive(job, today) {
  return job.status === COMPLETE && !job.archived && isISO(job.autoArchiveOn) && job.autoArchiveOn <= today
}

/** What "Use as template" copies: equipment, team and category, never dates or notes. */
export function templateFrom(job) {
  return {
    name: `${job.name} (copy)`,
    category: job.category,
    customer: '',
    region: '',
    status: 'Planning',
    priority: job.priority || 'Medium',
    start: '', end: '',
    eng: [...(job.eng || [])],
    apps: [...(job.apps || [])],
    equipment: (job.equipment || []).map((l) => ({ ...l, id: rid(), line: 'Requested' })),
  }
}

/** Duplicate: everything that describes the job, for a repeat at another site. */
export function duplicateOf(job) {
  const { id, createdAt, createdBy, updatedAt, updatedBy, archived, archivedAt, completedAt, autoArchiveOn, sample, ...rest } = job
  return {
    ...rest,
    name: `${job.name} (copy)`,
    status: 'Planning',
    notes: [],
    actions: (job.actions || []).map((a) => ({ ...a, id: rid(), done: false })),
    equipment: (job.equipment || []).map((l) => ({ ...l, id: rid(), line: 'Requested' })),
    freight: { tracking: '', eta: '', arrived: false },
  }
}

export const rid = () => Math.random().toString(36).slice(2, 10)

// ── filters and saved views ─────────────────────────────────────────────
export const BUILTIN_VIEWS = [
  { id: 'all', name: 'All jobs', f: {} },
  { id: 'mine', name: 'My jobs', f: { mine: true } },
  { id: 'month', name: 'This month', f: { month: true } },
  { id: 'waiting', name: 'Waiting on something', f: { status: WAITING } },
  { id: 'high', name: 'High priority', f: { priority: 'High' } },
]

/** Staff ids on a job: its teams plus anyone with a week on it. */
export function jobStaff(job, assignments) {
  const ids = new Set([...(job.eng || []), ...(job.apps || [])])
  for (const a of assignments) if (a.jobId === job.id) ids.add(a.staffId)
  return ids
}

/**
 * f: { q, status, priority, region, staff, from, to, mine, month, category }
 * ctx: { me: { name, staffId }, today, assignments }
 */
export function filterJobs(jobs, f, ctx) {
  const q = (f.q || '').trim().toLowerCase()
  const monthStart = ctx.today.slice(0, 8) + '01'
  const monthEnd = addDays(addDays(monthStart, 32).slice(0, 8) + '01', -1)
  return jobs.filter((j) => {
    if (f.status && j.status !== f.status) return false
    if (f.priority && j.priority !== f.priority) return false
    if (f.region && j.region !== f.region) return false
    if (f.category && j.category !== f.category) return false
    if (f.staff && !jobStaff(j, ctx.assignments).has(f.staff)) return false
    if ((f.from || f.to) && !overlaps(j.start, j.end, f.from || '0000-01-01', f.to || '9999-12-31')) return false
    if (f.month && !overlaps(j.start, j.end, monthStart, monthEnd)) return false
    if (f.mine) {
      const mine = (ctx.me?.name && j.owner === ctx.me.name) ||
        (ctx.me?.staffId && jobStaff(j, ctx.assignments).has(ctx.me.staffId)) ||
        (ctx.me?.uid && j.createdBy === ctx.me.uid)
      if (!mine) return false
    }
    if (q) {
      const hay = [j.name, j.customer, j.region, j.status, j.statusNote, j.waitingOn, j.freight?.tracking, j.owner].join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })
}

// ── search ──────────────────────────────────────────────────────────────
export const tokens = (q) => String(q || '').trim().split(/\s+/).filter(Boolean)
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Splits text into pieces, marking the ones that match a search word. */
export function highlight(text, toks) {
  const s = String(text ?? '')
  if (!toks.length || !s) return [{ t: s, hit: false }]
  const re = new RegExp('(' + toks.map(escRe).join('|') + ')', 'ig')
  return s.split(re).filter((x) => x !== '').map((x) => ({ t: x, hit: toks.some((k) => k.toLowerCase() === x.toLowerCase()) }))
}

/** A short window of `text` around the first match, so a long note still shows why it matched. */
export function snippet(text, toks, width = 70) {
  const s = String(text || '').replace(/\s+/g, ' ')
  const low = s.toLowerCase()
  let at = -1
  for (const k of toks) {
    const i = low.indexOf(k.toLowerCase())
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  if (at < 0 || s.length <= width * 2) return s
  const from = Math.max(0, at - width / 2)
  return (from > 0 ? '…' : '') + s.slice(from, from + width * 2).trim() + (from + width * 2 < s.length ? '…' : '')
}

/**
 * Searches active and archived jobs together. Every word is looked for in
 * the name, customer, region, people (names and initials), device models,
 * tracking number, notes, action points and comments. Jobs matching more of
 * the words rank higher; one matching all of several words is a best match.
 */
export function searchJobs(q, jobs, { comments = [], assignments = [], staff = [] } = {}) {
  const toks = tokens(q)
  if (!toks.length) return []
  const low = toks.map((k) => k.toLowerCase())
  const staffById = new Map(staff.map((p) => [p.id, p]))
  const results = []
  for (const j of jobs) {
    const people = [...jobStaff(j, assignments)].map((id) => staffById.get(id)).filter(Boolean)
    const fields = [
      ['Name', j.name],
      ['Customer', [j.customer, j.region].filter(Boolean).join(' · ')],
      ['Staff', people.map((p) => `${p.initials} ${p.name}`).join(', ')],
      ['Equipment', (j.equipment || []).map((l) => `${l.qty}x ${l.model}`).join(', ')],
      ['Tracking', j.freight?.tracking || ''],
      ['Notes', (j.notes || []).map((n) => n.text).join(' · ')],
      ['Action points', (j.actions || []).map((a) => a.text).join(' · ')],
      ['Comments', comments.filter((c) => c.jobId === j.id).map((c) => c.text).join(' · ')],
      ['Waiting on', j.waitingOn || ''],
      ['Status note', j.statusNote || ''],
    ]
    const hay = fields.map((f) => f[1]).join(' ').toLowerCase()
    const matched = low.filter((k) => hay.includes(k))
    if (!matched.length) continue
    // The preview is the first field other than the name that matched.
    const hitField = fields.slice(1).find(([, v]) => v && low.some((k) => v.toLowerCase().includes(k)))
    results.push({
      job: j,
      score: matched.length + (low.some((k) => j.name.toLowerCase().includes(k)) ? 0.5 : 0),
      all: matched.length === low.length,
      field: hitField ? hitField[0] : '',
      preview: hitField ? highlight(snippet(hitField[1], toks), toks) : [],
      title: highlight(j.name, toks),
      people,
    })
  }
  return results.sort((a, b) => b.score - a.score || (b.job.updatedAtMs || 0) - (a.job.updatedAtMs || 0))
}
