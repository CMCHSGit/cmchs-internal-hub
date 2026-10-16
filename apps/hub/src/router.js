// The one app's addresses (INTEGRATION-PLAN.md step 2).
//
// The path picks the section: "/" is the hub (home, People, Manage, still on
// their #/ routes), "/asks/" is Asks, and more follow as each tool moves in.
// Inside a section its own #/ routes work exactly as they did when it was a
// separate page, so every old link and notification still lands in the same
// place: /asks/#/mine?ask=… and /#/people/… are unchanged.
//
// Moving between sections is a history push, never a page load: links are
// caught in one place (interceptLinks) rather than every component knowing.
import { useSyncExternalStore } from 'react'

/** Sections that live in this app, by path prefix. Tools not listed are still separate pages. */
export const SECTIONS = [
  { id: 'asks', prefix: '/asks/' },
  { id: 'projects', prefix: '/projects/' },
  { id: 'admin', prefix: '/admin/' },
  // Routes on real paths inside (/schedule/my…), with react-router, not #/.
  { id: 'schedule', prefix: '/schedule/' },
]

/** Which section an address belongs to, or null for a page outside the app (/demo/, /maintenance/…). */
export function sectionOf(path) {
  if (path === '/' || path === '/index.html') return 'hub'
  for (const s of SECTIONS) {
    if (path === s.prefix.slice(0, -1) || path.startsWith(s.prefix)) return s.id
  }
  return null
}

const listeners = new Set()
const emit = () => listeners.forEach(l => l())
window.addEventListener('popstate', emit)
window.addEventListener('hashchange', emit)

const subscribe = (l) => { listeners.add(l); return () => listeners.delete(l) }
const snapshot = () => location.pathname + location.search + location.hash

/** Re-renders on every address change; read location.* for the parts. */
export function useAddress() {
  return useSyncExternalStore(subscribe, snapshot)
}

/** Go to an address in the app without a page load (or with one, if it isn't in the app). */
export function navigate(href, { replace = false } = {}) {
  const url = new URL(href, location.href)
  if (url.origin !== location.origin || !sectionOf(url.pathname)) {
    if (replace) location.replace(url.href)
    else location.assign(url.href)
    return
  }
  // A section's own address without its trailing slash (/asks) gets one, so
  // relative links inside it resolve the same as before.
  const sec = SECTIONS.find(s => url.pathname === s.prefix.slice(0, -1))
  if (sec) url.pathname = sec.prefix
  const samePath = url.pathname === location.pathname
  history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search + url.hash)
  if (url.hash === '' || !samePath) window.scrollTo(0, 0)
  // Announced the way the browser announces Back: this shell hears it (the
  // listener above), and so does a section with a router of its own (the
  // schedule's react-router), which otherwise wouldn't see /schedule/my
  // become /schedule/ when the header's Schedule tab is clicked.
  window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
}

/**
 * Catch clicks on ordinary links into another section and turn them into
 * navigate() instead of a page load. Links within the same page (only the
 * #… part differs) are left to the browser and the section's own router.
 */
export function interceptLinks() {
  const click = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    const a = e.target.closest?.('a[href]')
    if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return
    const url = new URL(a.getAttribute('href'), location.href)
    if (url.origin !== location.origin || !sectionOf(url.pathname)) return
    if (url.pathname === location.pathname && url.search === location.search) return // same page: let #… work as it always has
    e.preventDefault()
    navigate(url.href)
  }
  document.addEventListener('click', click)
  return () => document.removeEventListener('click', click)
}

/**
 * Deep links on a cold load: GitHub Pages has no file at /asks/, so 404.html
 * sends the browser to /?redirect=/asks/…; put the real address back before
 * anything renders. (The service worker answers these itself once installed.)
 */
export function restoreRedirect() {
  const m = /[?&]redirect=([^&]*)/.exec(location.search)
  if (!m) return
  const p = decodeURIComponent(m[1])
  // Same-site paths only: never let a query parameter send anyone elsewhere.
  if (p.charAt(0) !== '/' || p.charAt(1) === '/') return
  history.replaceState(null, '', p)
}

/** /asks → /asks/ on load, so the address is the section's and relative links resolve as before. */
export function normaliseSectionPath() {
  const sec = SECTIONS.find(s => location.pathname === s.prefix.slice(0, -1))
  if (sec) history.replaceState(null, '', sec.prefix + location.search + location.hash)
}
