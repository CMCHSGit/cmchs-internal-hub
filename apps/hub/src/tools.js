import allTools from '../../../tools.json'
import allAnnouncements from '../../../announcements.json'

// Category order and the two stripe colours each section header shows.
// Unknown categories are appended after these; empty ones are hidden.
const PURPLE = '#554596', GREEN = '#80bd01', ORANGE = '#ef7d00', GREY = '#a7a9ac'
const CATEGORIES = [
  ['Demo',          PURPLE, GREEN],
  ['Service',       PURPLE, ORANGE],
  ['Schedule',      GREEN,  ORANGE],
  ['Sales',         ORANGE, PURPLE],
  ['Clinical',      GREEN,  PURPLE],
  ['Admin',         PURPLE, PURPLE],
  ['Microsoft 365', GREY,   GREY],
]

export const tools = allTools.filter(t => t.visible !== false)

export function toolGroups() {
  const known = CATEGORIES.map(([name, c1, c2]) => ({ name, c1, c2 }))
  const extra = [...new Set(tools.map(t => t.category))]
    .filter(c => !CATEGORIES.some(([name]) => name === c))
    .map(name => ({ name, c1: PURPLE, c2: GREY }))
  return [...known, ...extra]
    .map(g => ({ ...g, tools: tools.filter(t => t.category === g.name) }))
    .filter(g => g.tools.length)
}

/** Opens in a new tab: anything marked "tab" (other sites, Microsoft 365). */
export const opensInTab = tool => tool.opens === 'tab'

/** "internal.chsnz.co.nz/order-parser" — shown in mono under each tool. */
export function hostOf(tool) {
  try {
    const url = new URL(tool.link, location.origin)
    return (url.host + url.pathname).replace(/\/$/, '')
  } catch {
    return tool.link
  }
}

export function searchTools(query) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return tools.filter(t => (t.name + ' ' + t.description + ' ' + t.category).toLowerCase().includes(q))
}

// Recently used: per browser, most recent first. Keys are prefixed "hub:"
// because every app shares this origin's localStorage.
const RECENT_KEY = 'hub:recent'

export function recentTools() {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return ids.map(id => tools.find(t => t.id === id)).filter(Boolean).slice(0, 4)
  } catch {
    return []
  }
}

export function markUsed(tool) {
  try {
    const ids = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter(id => id !== tool.id)
    localStorage.setItem(RECENT_KEY, JSON.stringify([tool.id, ...ids].slice(0, 8)))
  } catch { /* private mode etc. — recent list just stays empty */ }
}

export const announcements = [...allAnnouncements].sort((a, b) =>
  (b.pinned === true) - (a.pinned === true) || String(b.date).localeCompare(String(a.date)))
