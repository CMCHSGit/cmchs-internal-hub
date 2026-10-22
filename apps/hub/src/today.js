// Who's where today, read straight from the staff schedule's Firestore.
//
// No feed or API in between: the hub signs in to the same Firebase project as
// /schedule/, whose rules let any signed-in person read `users`, `schedules`
// and `oncall`. What a day's text MEANS ("Tauranga" = on site, "Annual Leave"
// = out) comes from the schedule's own code in apps/schedule/src/utils, so the
// home page and the schedule can never disagree.
//
// Firestore is imported on demand, so it doesn't slow the first paint, and is
// left out of the page entirely when the schedule can't be read (signed-out
// dev builds, offline): loadToday() resolves to null and the home page hides
// the blocks that need it.
import { describeDay, STATUS, PLAIN } from '../../schedule/src/utils/status.js'
import { daysWithCalls, toISO, weekDates, WEEK_DAYS } from '../../schedule/src/utils/week.js'
import { holidayOn } from '../../schedule/src/utils/holidays.js'
import { shortNames } from '../../schedule/src/utils/names.js'
import { TEAMS, teamLabel } from '../../schedule/src/utils/teams.js'

/** On call, as the schedule shows it ("Bryan - OnCall"). */
export const ONCALL_BG = '#FF7C80'

/** Departments for the filter tags, in the schedule's (Excel's) order. */
export const DEPARTMENTS = TEAMS.map(t => ({ id: t, name: teamLabel(t) }))

/** How many weeks after this one the On call card lists. */
const UPCOMING_WEEKS = 9

// The four "At a glance" groups, by schedule status.
export const GLANCE = [
  { key: 'office', label: 'In the office',  icon: 'building',   accent: 'purple',  statuses: ['office', 'calls'] },
  { key: 'site',   label: 'On site',        icon: 'map-pin',    accent: 'green',   statuses: ['site'] },
  { key: 'remote', label: 'Remote or home', icon: 'laptop',     accent: 'orange',  statuses: ['remote', 'wfh'] },
  { key: 'out',    label: 'Out today',      icon: 'calendar-x', accent: 'stripes', statuses: ['leave', 'nwd'] },
]

// The schedule's getCurrentWeekStart(), but for any date (it only does "now").
function getCurrentWeekStart(offset, now = new Date()) {
  const d = new Date(now)
  const day = d.getDay() // 0 = Sun … 6 = Sat; a weekend counts as the coming week
  d.setDate(d.getDate() + (day === 0 ? 1 : day === 6 ? 2 : 1 - day) + offset * 7)
  return toISO(d)
}

function initials(name) {
  return name.split(/[\s-]+/).filter(Boolean).map(x => x[0]).join('').slice(0, 2).toUpperCase()
}

/**
 * The home page's view of one day, from raw schedule data. Pure, so it can be
 * tested without Firestore: users = the `users` docs (with uid), schedules =
 * { [uid]: that week's schedule doc }, oncall = the week's `oncall` doc.
 */
export function buildToday({ users, schedules, oncall, later = [], now = new Date() }) {
  // The schedule is Monday–Friday. On a weekend getCurrentWeekStart() is
  // already next Monday, so show that day's plan and say so.
  const weekStart = getCurrentWeekStart(0, now)
  const idx = weekDates(weekStart).indexOf(toISO(now))
  const dayIdx = idx < 0 ? 0 : idx
  const holiday = holidayOn(weekDates(weekStart)[dayIdx])
  const names = shortNames(users)

  const people = users.map(u => {
    const name = names.get(u.uid)
    const day = describeDay(daysWithCalls(schedules[u.uid]?.days, oncall, u.uid)[dayIdx], holiday)
    return {
      uid: u.uid,
      name,
      fullName: u.displayName || name,
      initials: initials(u.displayName || name),
      dept: u.team || '',
      deptName: u.team ? teamLabel(u.team) : '',
      status: day.status || 'none',
      where: day.empty ? 'No entry' : (day.note || STATUS[day.status].label),
      // The schedule's "plain" colour is a theme variable there; white here.
      swatch: day.empty ? '#f4f4f5' : (day.bg === PLAIN ? '#ffffff' : day.bg),
      onCall: !!oncall?.uid && oncall.uid === u.uid,
    }
  }).sort((a, b) => a.name.localeCompare(b.name))

  const onCallPerson = people.find(p => p.onCall)
  return {
    weekStart,
    people,
    weekend: idx < 0,
    dayName: WEEK_DAYS[dayIdx],
    holiday,
    onCallName: onCallPerson ? onCallPerson.name : (oncall?.displayName || ''),
    // The following weeks' on-call, soonest first: [{ weekStart, name }]
    upcoming: later.filter(w => w.doc?.uid || w.doc?.displayName).map(w => ({ weekStart: w.weekStart, name: names.get(w.doc.uid) || w.doc.displayName || '' })),
    glance: GLANCE.map(g => ({ ...g, people: people.filter(p => g.statuses.includes(p.status)) })),
  }
}

export async function loadToday() {
  // `npm run dev` without a .env (the pretend "Dev User"): sample people, so
  // the layout can be worked on. Dropped from real builds.
  if (import.meta.env.DEV && !import.meta.env.VITE_FIREBASE_API_KEY) return buildToday(await import('./dev-fixture.js').then(m => m.default()))

  let fs, app
  try {
    const [{ getApp }, firestore] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
    app = getApp() // the one shared/session.js signed in with; throws when sign-in isn't configured
    fs = firestore
  } catch {
    return null
  }
  const db = (await import('../../../shared/firestore.js')).firestore(app)
  const weekStart = getCurrentWeekStart(0)

  const laterStarts = Array.from({ length: UPCOMING_WEEKS }, (_, i) => getCurrentWeekStart(i + 1))
  const [usersSnap, schedSnap, oncallSnap, ...laterSnaps] = await Promise.all([
    fs.getDocs(fs.collection(db, 'users')),
    fs.getDocs(fs.query(fs.collection(db, 'schedules'), fs.where('weekStart', '==', weekStart))),
    fs.getDoc(fs.doc(db, 'oncall', weekStart)).catch(() => null),
    // The coming weeks' on-call, from the same documents the Schedule's On-call roster sets
    ...laterStarts.map(w => fs.getDoc(fs.doc(db, 'oncall', w)).catch(() => null)),
  ])
  const schedules = {}
  for (const d of schedSnap.docs) { const x = d.data(); schedules[x.uid] = x }
  return buildToday({
    users: usersSnap.docs.map(d => ({ uid: d.id, ...d.data() })),
    schedules,
    oncall: oncallSnap?.exists() ? oncallSnap.data() : null,
    later: laterStarts.map((w, i) => ({ weekStart: w, doc: laterSnaps[i]?.exists() ? laterSnaps[i].data() : null })),
  })
}
