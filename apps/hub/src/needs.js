// The home page's "Needs you" strip: one line gathering what's waiting on the
// signed-in person. It reads only what already exists: the section counts the
// header tabs show (shared/badges.js; the demo tracker's is overdue loans plus
// bookings waiting on a transfer, set when someone last opened the tracker in
// this browser) and the asks panel's summary (asks.js). Pure, for the tests.

// Where each section's count lives, and how to say it. A count from a section
// not listed here still shows, linked to the section's own path.
const SECTIONS = {
  equipment: { icon: 'package', link: '/equipment/#/overview', one: 'demo loan needs you', many: 'demo loans need you', hint: 'overdue or waiting on a transfer' },
}

/** The items to show, most pressing first; an empty list hides the strip. */
export function needsYou({ badges = {}, asks = null } = {}) {
  const items = []
  const n = Number(badges.equipment) || 0
  if (n > 0) items.push({ id: 'equipment', ...SECTIONS.equipment, count: n, text: `${n} ${n === 1 ? SECTIONS.equipment.one : SECTIONS.equipment.many}` })
  const a = asks?.mine?.length || 0
  if (a > 0) {
    const hint = [asks.overdue && `${asks.overdue} overdue`, asks.toPick && `${asks.toPick} to pick up`].filter(Boolean).join(' · ')
    items.push({ id: 'asks', icon: 'inbox', link: '/asks/#/mine', count: a, text: `${a} ask${a === 1 ? '' : 's'} waiting for you`, hint, urgent: !!asks.overdue })
  }
  for (const [id, v] of Object.entries(badges)) {
    const c = Number(v) || 0
    if (c > 0 && id !== 'equipment' && id !== 'asks') items.push({ id, icon: 'bell', link: `/${encodeURIComponent(id)}/`, count: c, text: `${c} need${c === 1 ? 's' : ''} you in ${id}`, hint: '' })
  }
  // Overdue things first
  return items.sort((x, y) => (y.urgent ? 1 : 0) - (x.urgent ? 1 : 0))
}
