import allTools from '../../../tools.json'
import { navigate } from './router.js'

// Category order and the two stripe colours each section header shows.
// Unknown categories are appended after these; empty ones are hidden.
const PURPLE = '#554596', GREEN = '#80bd01', ORANGE = '#ef7d00', GREY = '#a7a9ac'
const CATEGORIES = [
  // The two apps most people open every day, in one row rather than two
  // single-card sections stacked on top of each other.
  ['Everyday',      PURPLE, GREEN],
  // Kept below so a tool still filed under either name keeps a home; an
  // empty category is dropped from the page, so neither shows while both
  // tools sit in Everyday.
  ['Demo',          PURPLE, GREEN],
  ['Service',       PURPLE, ORANGE],
  ['Schedule',      GREEN,  ORANGE],
  ['Sales',         ORANGE, PURPLE],
  ['Clinical',      GREEN,  PURPLE],
  ['Admin',         PURPLE, PURPLE],
  ['Microsoft 365', GREY,   GREY],
]

export const tools = allTools.filter(t => t.visible !== false)

/** The service team's tools: the Service menu in the header lists them, so the home page's grid doesn't. */
export const SERVICE_TOOL_IDS = ['service-orders', 'ansur', 'simpro', 'maintenance']
export const serviceTools = SERVICE_TOOL_IDS.map(id => tools.find(t => t.id === id)).filter(Boolean)

export function toolGroups() {
  const known = CATEGORIES.map(([name, c1, c2]) => ({ name, c1, c2 }))
  const extra = [...new Set(tools.map(t => t.category))]
    .filter(c => !CATEGORIES.some(([name]) => name === c))
    .map(name => ({ name, c1: PURPLE, c2: GREY }))
  return [...known, ...extra]
    .map(g => ({ ...g, tools: tools.filter(t => t.category === g.name && !SERVICE_TOOL_IDS.includes(t.id)) }))
    .filter(g => g.tools.length)
}

/** Opens in a new tab: anything marked "tab" (other sites, Microsoft 365). */
export const opensInTab = tool => tool.opens === 'tab'

// On a phone, Outlook and Teams open in their own apps. Their web versions
// don't work there: opened from the installed hub they land in its in-app
// browser, which Microsoft rejects as "browser version is unsupported" (and
// Teams on the web doesn't support phones at all). If the app isn't
// installed, nothing takes over the screen, and the web version opens after
// a moment instead.
const PHONE_APPS = { outlook: 'ms-outlook://', teams: 'msteams://' }
const IS_PHONE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) // iPadOS reports as a Mac

/** True if it handled the tool by opening its phone app. */
export function openPhoneApp(tool) {
  const app = IS_PHONE && PHONE_APPS[tool.id]
  if (!app) return false
  const fallback = setTimeout(() => {
    if (!document.hidden) window.open(tool.link, '_blank', 'noopener')
  }, 1500)
  document.addEventListener('visibilitychange', () => clearTimeout(fallback), { once: true })
  location.href = app
  return true
}

/** "internal.chsnz.co.nz/service-orders" — shown in mono under each tool. */
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

/** An announcement's `image`: a full URL, or a path in apps/hub/public ("news/x.jpg"). */
export const newsImage = a => (!a.image ? '' : /^(https?:)?\/\//.test(a.image) || a.image.startsWith('/') ? a.image : '/' + a.image)

/** Open a tool from a card, a search or a link: its phone app, a new tab, or in place. */
export function openTool(tool) {
  markUsed(tool)
  if (openPhoneApp(tool)) return
  if (opensInTab(tool)) window.open(tool.link, '_blank', 'noopener')
  else navigate(tool.link) // in the app when it has moved in, a page load when not
}
