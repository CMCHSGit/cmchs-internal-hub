// Registers the single service worker for this origin, at scope "/".
//
// Every app calls this. Whichever page someone lands on first installs the
// worker; the rest just keep it fresh. Registering the same URL and scope more
// than once is a no-op, so there's no harm in calling it from everywhere — and
// real benefit: a person who only ever opens /maintenance/ still gets
// the update check.
export function registerServiceWorker({ reloadOnUpdate = false } = {}) {
  // In `npm run dev` there is no built /sw.js — registering would only log a
  // failure. `npm run preview` serves a real build, so it still registers.
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  // Pages that are safe to pull out from under someone can opt into reloading
  // the moment a new worker takes over. Without this the page keeps showing the
  // copy it loaded from the precache — so a deploy looks like it didn't happen
  // until someone thinks to refresh. Only for pages with nothing to lose: NOT
  // SimproSync (a reload part-way through a sync) and NOT the schedule, which
  // has its own handling in utils/appUpdates.js that waits for an idle page.
  //
  // reloadOnUpdate: 'idle' (the one app) waits until nobody is typing or has a
  // dialog open, or they switch away from the tab: every change is saved as it
  // is made, so a reload then loses nothing.
  if (reloadOnUpdate) {
    const hadController = !!navigator.serviceWorker.controller
    let waiting = false
    let reloaded = false
    const busy = () => document.activeElement?.matches?.('input, textarea, select, [contenteditable="true"]') || document.querySelector('[role="dialog"]')
    const reloadIfReady = () => {
      if (!waiting || reloaded) return
      if (reloadOnUpdate === 'idle' && busy() && document.visibilityState === 'visible') return
      reloaded = true
      window.location.reload()
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // A first-ever install also "takes over" an uncontrolled page. That's not
      // an update, and reloading on it would be one pointless refresh per
      // person — or a loop, if anything went wrong.
      if (!hadController) return
      waiting = true
      reloadIfReady()
    })
    if (reloadOnUpdate === 'idle') {
      document.addEventListener('visibilitychange', reloadIfReady)
      document.addEventListener('focusout', () => setTimeout(reloadIfReady, 500))
    }
  }

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      // Browsers only re-check sw.js on navigation, and an installed app can go
      // days without one. Ask on every load so a deploy lands the same day.
      .then((reg) => reg.update())
      .catch((err) => console.warn('[sw] registration failed', err))
  })
}
