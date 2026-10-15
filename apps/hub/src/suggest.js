// Announcement suggestions from the project tracker (apps/projects): who is on
// which job this week and next, and who is on leave, phrased like the project
// team's weekly email. Manage offers them while writing or reviewing a pasted
// email; nothing is posted until someone adds it.
import { detectRegions, detectPeople } from './emailSplit.js'
import { addDays, mondayOf, isoToday } from './news.js'

const firstName = n => String(n || '').trim().split(/\s+/)[0]
/** ["Sam", "Teri", "Jo"] -> "Sam, Teri and Jo" */
export const andList = xs => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)

const overlaps = (from, to, a, b) => from <= b && to >= a

/**
 * jobs, assignments ({ jobId, staffId, week, activity }), staff ({ id, name,
 * leave: [{ from, to }] }) -> { been: [...], next: [...] }, each suggestion
 * { key, title, section, category, regions, people, jobId }. `people` is for
 * detectPeople() (hub users), so suggestions link to profiles too.
 *
 * "This week" is the week the email goes out in (Friday's email covers Monday
 * to Friday just gone); at the weekend that is the week just ended.
 */
export function suggestFromProjects({ jobs = [], assignments = [], staff = [], today = isoToday(), people = null }) {
  const thisWeek = mondayOf(today)
  const weeks = { been: thisWeek, next: addDays(thisWeek, 7) }
  const jobById = new Map(jobs.filter(j => !j.archived && !j.sample).map(j => [j.id, j]))
  const staffById = new Map(staff.map(s => [s.id, s]))
  const out = { been: [], next: [] }

  for (const [section, week] of Object.entries(weeks)) {
    const groups = new Map()
    for (const a of assignments) {
      if (a.week !== week || a.sample) continue
      const job = jobById.get(a.jobId)
      if (!job) continue
      const k = `${a.jobId}|${a.activity || ''}`
      if (!groups.has(k)) groups.set(k, { job, activity: a.activity || '', staff: [] })
      const s = staffById.get(a.staffId)
      if (s && !groups.get(k).staff.includes(s)) groups.get(k).staff.push(s)
    }
    for (const g of groups.values()) {
      const who = andList(g.staff.map(s => firstName(s.name)))
      // "at Hutt Hospital", unless the job's name already says so
      const customer = (g.job.customer || '').trim()
      const where = customer && !g.job.name.toLowerCase().includes(customer.toLowerCase().replace(/\s+hospital$/, '')) ? ` at ${customer}` : ''
      const what = g.activity ? `${g.activity.toLowerCase()} for ${g.job.name}` : g.job.name
      const verb = section === 'been' ? (g.staff.length > 1 ? 'were on' : 'was on') : (g.staff.length > 1 ? 'are on' : 'is on')
      const title = who ? `${who} ${verb} ${what}${where}` : `${g.job.name}${where}: ${g.activity || 'scheduled'}`
      out[section].push({
        key: `${section}|${g.job.id}|${g.activity}`,
        title,
        section,
        category: 'Team news',
        regions: detectRegions([g.job.region, g.job.customer, g.job.name].filter(Boolean).join(' ')),
        people: people ? detectPeople(g.staff.map(s => s.name).join(', '), people) : [],
        jobId: g.job.id,
      })
    }
    const onLeave = staff.filter(s => !s.sample && (s.leave || []).some(l => overlaps(week, addDays(week, 4), l.from, l.to)))
    if (onLeave.length) {
      const names = andList(onLeave.map(s => firstName(s.name)))
      out[section].push({
        key: `${section}|leave`,
        title: section === 'been' ? `${names} ${onLeave.length > 1 ? 'were' : 'was'} on leave` : `${names} ${onLeave.length > 1 ? 'have' : 'has'} leave during the week`,
        section,
        category: 'Team news',
        regions: [],
        people: people ? detectPeople(onLeave.map(s => s.name).join(', '), people) : [],
      })
    }
  }
  return out
}

/** Reads what suggestFromProjects needs from the project tracker's Firestore. */
export async function loadProjectSuggestions(people) {
  const today = isoToday()
  const weeks = [mondayOf(today), addDays(mondayOf(today), 7)]
  if (import.meta.env?.DEV && !import.meta.env?.VITE_FIREBASE_API_KEY) {
    const { SAMPLE_JOBS, SAMPLE_ASSIGNMENTS, SAMPLE_STAFF } = await import('../../projects/src/sample.js')
    // The samples are dated around their own weeks; move them onto this one so there's something to see.
    const first = [...new Set(SAMPLE_ASSIGNMENTS.map(a => a.week))].sort()
    const shift = new Map(first.map((w, i) => [w, i % 2 ? weeks[1] : weeks[0]]))
    return suggestFromProjects({
      jobs: SAMPLE_JOBS.map(j => ({ ...j, sample: false })),
      assignments: SAMPLE_ASSIGNMENTS.map(a => ({ ...a, sample: false, week: shift.get(a.week) })),
      staff: SAMPLE_STAFF.map(s => ({ ...s, sample: false })),
      today, people,
    })
  }
  const { fs } = await import('./news.js')
  const { f, db } = await fs()
  const [jobs, assigns, settings] = await Promise.all([
    f.getDocs(f.collection(db, 'projectJobs')),
    f.getDocs(f.query(f.collection(db, 'projectAssignments'), f.where('week', 'in', weeks))),
    f.getDoc(f.doc(db, 'projectSettings', 'main')),
  ])
  return suggestFromProjects({
    jobs: jobs.docs.map(d => ({ id: d.id, ...d.data() })),
    assignments: assigns.docs.map(d => ({ id: d.id, ...d.data() })),
    staff: settings.exists() ? settings.data().staff || [] : [],
    today, people,
  })
}
