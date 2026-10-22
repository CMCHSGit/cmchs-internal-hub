// Ctrl+K, the one search across the app (Palette.jsx). Pure, so it is tested
// without Firestore (tests/search.test.mjs).
//
// Each kind of result comes from somewhere different: places to go (every
// section's pages and views, and the tools) are listed here; people come from
// the staff directory (people.js); jobs and asks from those sections' own
// search-source.js, loaded the first time the search opens. They all score the
// same way, so "my week" finds My week and "a9 whanganui" finds the job.

/** The words of a query, lower case. */
export const words = q => String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean)

/**
 * How well `title` (and the other text it is known by, `rest`) matches every
 * word in `toks`: 0 if any word is missing. A word that starts a word of the
 * title counts most, one inside the title next, one only in `rest` least; a
 * title that starts with the whole query beats one that only contains it.
 */
export function scoreOf(toks, title, rest = '') {
  if (!toks.length) return 0
  const t = String(title || '').toLowerCase()
  const all = t + ' ' + String(rest || '').toLowerCase()
  const starts = t.split(/[^a-z0-9]+/).filter(Boolean)
  let score = 0
  for (const w of toks) {
    if (!all.includes(w)) return 0
    score += starts.some(s => s.startsWith(w)) ? 3 : t.includes(w) ? 2 : 1
  }
  if (t.startsWith(toks.join(' '))) score += 2
  return score
}

/**
 * Every page and view in the app, by address, with the other words people
 * might type for it. Kept here rather than read from each section, because
 * reading a section's own list would load the whole section.
 */
export const PAGES = [
  { title: 'Home', sub: 'Internal Hub', href: '/#/', also: 'hub start news' },
  { title: 'People', sub: 'Staff directory', href: '/#/people', also: 'staff directory phone mobile' },
  { title: 'Your profile', sub: 'People', href: '/#/people/me', also: 'me my details photo emergency contact' },
  { title: 'News and announcements', sub: 'Manage', href: '/#/manage', also: 'manage post announcement' },
  { title: 'Tool requests', sub: 'Manage', href: '/#/manage/requests', also: 'manage request new tool' },
  { title: 'Feedback', sub: 'Manage', href: '/#/manage/feedback', also: 'manage rating rate' },
  { title: 'Team week', sub: 'Staff schedule', href: '/schedule/', also: 'schedule roster whereabouts team' },
  { title: 'My week', sub: 'Staff schedule', href: '/schedule/my', also: 'schedule mine roster reminder' },
  { title: 'Day', sub: 'Staff schedule', href: '/schedule/day', also: 'schedule today where is everyone' },
  { title: 'Leave calendar', sub: 'Staff schedule', href: '/schedule/leave', also: 'schedule holiday annual leave away' },
  { title: 'Who’s where by place', sub: 'Staff schedule', href: '/schedule/places', also: 'schedule places site hospital travel near location who is at' },
  { title: 'On call', sub: 'Staff schedule', href: '/schedule/oncall', also: 'schedule oncall roster after hours' },
  { title: 'Out of town', sub: 'Staff schedule', href: '/schedule/out-of-town', also: 'schedule fbt vehicle report travel' },
  { title: 'My asks', sub: 'Asks', href: '/asks/#/mine', also: 'asks requests todo inbox' },
  { title: 'All asks', sub: 'Asks', href: '/asks/#/all', also: 'asks requests' },
  { title: 'Company asks', sub: 'Asks', href: '/asks/#/company', also: 'asks counts' },
  { title: 'Project tracker', sub: 'Projects', href: '/projects/#/home', also: 'projects jobs home' },
  { title: 'Job table', sub: 'Projects', href: '/projects/#/table', also: 'projects jobs register list' },
  { title: 'Timeline', sub: 'Projects', href: '/projects/#/timeline', also: 'projects weekly plan gantt' },
  { title: 'Conferences', sub: 'Projects', href: '/projects/#/conferences', also: 'projects events expo' },
  { title: 'Demo equipment', sub: 'Projects', href: '/projects/#/equipment', also: 'projects devices pool availability loans' },
  { title: 'Archive', sub: 'Projects', href: '/projects/#/archive', also: 'projects completed old jobs' },
  { title: 'Settings', sub: 'Appearance', href: '/settings/', also: 'preferences theme dark light mode start page open on' },
  { title: 'Your notifications', sub: 'Settings', href: '/settings/you/notifications', also: 'push phone reminders alerts turn on off' },
  { title: 'People and access', sub: 'Settings · admins', href: '/settings/people', also: 'admin roles teams simpro access users' },
  { title: 'Everyone’s notifications', sub: 'Settings · admins', href: '/settings/notifications', also: 'admin push reminders who gets' },
  { title: 'Staff schedule settings', sub: 'Settings · admins', href: '/settings/schedule', also: 'schedule locations excel import activity log' },
  { title: 'Project tracker settings', sub: 'Settings', href: '/settings/projects', also: 'projects categories statuses staff equipment pool backup' },
  { title: 'PM types', sub: 'Settings · Maintenance', href: '/settings/maintenance', also: 'maintenance settings first second third pm' },
]

/** Places to go: pages, views and tools (tools.json), best first. */
export function placeHits(q, tools = []) {
  const toks = words(q)
  if (!toks.length) return []
  const seen = new Set()
  const out = []
  for (const p of PAGES) {
    const score = scoreOf(toks, p.title, `${p.sub} ${p.also}`)
    if (score) { out.push({ key: 'page:' + p.href, group: 'places', title: p.title, sub: p.sub, href: p.href, score }); seen.add(p.href) }
  }
  for (const t of tools) {
    if (seen.has(t.link)) continue
    const score = scoreOf(toks, t.name, `${t.short || ''} ${t.description || ''} ${t.category || ''}`)
    if (score) out.push({ key: 'tool:' + t.id, group: 'places', title: t.name, sub: t.description || t.category, tool: t, score })
  }
  return out.sort((a, b) => b.score - a.score)
}

/** People from the staff directory (people.js buildDirectory), by name, team, email or mobile digits. */
export function personHits(directory, q) {
  const toks = words(q)
  if (!toks.length) return []
  const digits = q.replace(/\D/g, '')
  return (directory || [])
    .map(p => {
      let score = scoreOf(toks, p.name, `${p.shortName} ${p.teamName} ${p.email}`)
      if (!score && digits.length >= 3 && (p.workMobile || '').replace(/\D/g, '').includes(digits)) score = 1
      return score && {
        key: 'person:' + p.uid, group: 'people', title: p.name, score,
        sub: [p.teamName, p.where && `Today: ${p.where}`, p.workMobile].filter(Boolean).join(' · '),
        href: `/#/people/${encodeURIComponent(p.uid)}`,
      }
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
}

/** The groups in the order they are shown, and how many of each before "more". */
export const GROUPS = [
  { id: 'places', label: 'Go to', max: 6 },
  { id: 'people', label: 'People', max: 5 },
  { id: 'jobs', label: 'Jobs', max: 6 },
  { id: 'asks', label: 'Asks', max: 5 },
]

/** Results from every source, grouped, each group cut to its size. */
export function grouped(hits) {
  return GROUPS
    .map(g => {
      const all = hits.filter(h => h.group === g.id).sort((a, b) => b.score - a.score)
      return { ...g, hits: all.slice(0, g.max), more: Math.max(0, all.length - g.max) }
    })
    .filter(g => g.hits.length)
}
