/* Keeping the tracker's data on screen up to date (db.js watch, store.jsx). Pure: no Firebase here, so the
   tests can run it (tests/stale-view.test.mjs).

   Which database to watch for changes depends on the cutover switch (db.js: the old Realtime Database, or
   Firestore since 4 Nov 2026), and the switch is read when the tracker opens. Until 24-Nov-2026 the watch was
   started at once, before that read had finished, so on every fresh page load (the "Update now" reload, the
   app's own update reload, swipe down to refresh, or just opening it) it picked the old database, frozen since
   the cutover. Nothing anyone else saved then reached the screen until a reload, and the first read came from
   the copy kept on the device, which can be minutes or days old: a loan's 29 accessories, saved minutes
   before, stayed missing for over ten minutes. */

/**
 * Starts a watch only once `known` (a promise: the switch has been read) has settled, never before; a failed
 * read still starts it, on whatever the switch says. Returns stop(), which also works before it has started.
 */
export function watchWhenKnown(known, start) {
  let stop = null, stopped = false
  Promise.resolve(known).catch(() => {}).then(() => { if (!stopped) stop = start() })
  return () => {
    stopped = true
    if (stop) { const s = stop; stop = null; s() }
  }
}
