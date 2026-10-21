/* Counts of things that need someone, shown on a section's tab (the header,
   the phone's bottom tabs) and on the installed app's home-screen icon.

   The demo tracker's is the first (old: mpActionRequiredCount and
   mpUpdateAppBadge): its bookings waiting on a transfer and its overdue loans,
   your own if you're an account manager, everyone's for Service & Projects.
   A section sets its count when it has worked it out (setBadge); the header
   reads it (useBadge). It's kept in this browser, so the tab still shows it
   on other pages after leaving the section, until the section next looks.
   Signing out clears it (shared/session.js), as the old one did.

   The icon badge is the Badging API: Chrome and Edge (Android, desktop) and
   iPhones on iOS 16.4+ with the app added to the home screen. It only
   changes while the app is open; elsewhere nothing happens. */
// No React here: shared/session.js (which plain pages use) clears it on sign-out. The header's hook is useBadge in apps/hub/src/Header.jsx.

export const KEY = 'chs_badges'
export const EVENT = 'chs-badges'

export function readAll() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {} } catch { return {} }
}

function showOnIcon(all) {
  if (typeof navigator === 'undefined' || !('setAppBadge' in navigator)) return
  const total = Object.values(all).reduce((n, v) => n + (Number(v) || 0), 0)
  try { (total > 0 ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => {}) } catch { /* not here */ }
}

/** A section's count now (0 clears it). */
export function setBadge(id, n) {
  const all = readAll()
  const next = Math.max(0, Math.floor(Number(n) || 0))
  if ((all[id] || 0) === next) { showOnIcon(all); return }
  if (next) all[id] = next; else delete all[id]
  try { localStorage.setItem(KEY, JSON.stringify(all)) } catch { /* private mode: this page only */ }
  showOnIcon(all)
  window.dispatchEvent(new CustomEvent(EVENT))
}

/** Every count gone (signing out). */
export function clearBadges() {
  try { localStorage.removeItem(KEY) } catch { /* nothing kept */ }
  showOnIcon({})
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT))
}

/** How a count is shown: "9+" past nine, as the old tab badge. */
export const badgeText = (n) => (n > 9 ? '9+' : String(n))
