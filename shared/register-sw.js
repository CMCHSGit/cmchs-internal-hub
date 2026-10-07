// Registers the single service worker for this origin, at scope "/".
//
// Every app calls this. Whichever page someone lands on first installs the
// worker; the rest just keep it fresh. Registering the same URL and scope more
// than once is a no-op, so there's no harm in calling it from everywhere — and
// real benefit: a person who only ever opens /service/order-parser/ still gets
// the update check.
export function registerServiceWorker() {
  // In `npm run dev` there is no built /sw.js — registering would only log a
  // failure. `npm run preview` serves a real build, so it still registers.
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      // Browsers only re-check sw.js on navigation, and an installed app can go
      // days without one. Ask on every load so a deploy lands the same day.
      .then((reg) => reg.update())
      .catch((err) => console.warn('[sw] registration failed', err))
  })
}
