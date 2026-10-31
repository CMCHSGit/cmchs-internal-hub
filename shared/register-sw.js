import { shouldCheck, shouldReload, startGuard } from './updateGuard.js'

// Registers the single service worker for this origin, at scope "/", and tells
// people when a newer version of the site is ready.
//
// Every app calls this. Whichever page someone lands on first installs the
// worker; the rest just keep it fresh. Registering the same URL and scope more
// than once is a no-op, so there's no harm in calling it from everywhere — and
// real benefit: a person who only ever opens /maintenance/ still gets
// the update check.
//
// A new deploy: sw.js takes over at once (skipWaiting + clients.claim), which
// fires controllerchange here. The page still shows the copy it loaded, so the
// app reloads onto the new one, by itself, as soon as it is safe (updateGuard.js):
//   - when the person has left it alone for 10 minutes, and
//   - each time they come back to it (an installed phone app is resumed from the
//     background, not loaded afresh, so this is when it checks).
// It never reloads from under work in progress: an open dialog, a form with
// something typed in it, a PDF with unsaved edits, a loan being made, a SimproSync
// run. It waits, and reloads once that is finished and they have paused for a moment.
// On computers a banner ("A new version is ready" with Update now / Later) also
// shows while it waits; phones get none.
// Nothing is lost by updating: everything else saves as it goes.
//
// It also asks for a new version when the page comes back into view (at most every
// 15 seconds), after 10 idle minutes, and every 30 minutes.
export function registerServiceWorker() {
  // In `npm run dev` there is no built /sw.js — registering would only log a
  // failure. `npm run preview` serves a real build, so it still registers.
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  // A first-ever install also "takes over" an uncontrolled page. That's not
  // an update, and prompting (or reloading) on it would be pointless.
  const hadController = !!navigator.serviceWorker.controller
  const phone = matchMedia('(pointer: coarse)').matches
  const guard = startGuard()
  let ready = false
  let waiting = 0
  // Reload if a new version is ready and nobody is in the middle of anything.
  const reloadWhenSafe = () => {
    if (shouldReload({ ready, busy: guard.busy(), sinceActiveMs: guard.sinceActive() })) window.location.reload()
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || ready) return
    ready = true
    if (!phone) showUpdateBanner(guard.running)
    reloadWhenSafe()
    // Held back by something in progress: look again until it is done.
    if (!waiting) waiting = setInterval(reloadWhenSafe, 2000)
  })
  document.addEventListener('visibilitychange', reloadWhenSafe)

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        // Browsers only re-check sw.js on navigation, and an installed app can go
        // days without one. Ask on load, on coming back into view, after 10 idle
        // minutes, and now and then.
        let last = 0
        const check = (resumed = false) => {
          if (ready || !shouldCheck({ resumed, sinceActiveMs: guard.sinceActive(), sinceCheckMs: Date.now() - last })) return
          last = Date.now()
          reg.update().catch(() => {})
        }
        last = Date.now()
        reg.update().catch(() => {})
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(true) })
        window.addEventListener('focus', () => check(true))
        window.addEventListener('pageshow', () => check(true)) // iOS: back from the page cache
        setInterval(check, 30_000) // idle check; the 30-minute check is below
        setInterval(() => { last = 0; check(true) }, 30 * 60_000)
      })
      .catch((err) => console.warn('[sw] registration failed', err))
  })
}

// Reload onto the newest deploy. A plain reload isn't enough when a page asks
// for a file a deploy has removed: until the new sw.js has taken over, the old
// one hands back its cached copy of the old page, which asks for the same
// missing file (only Ctrl+Shift+R, which skips the worker, got past it). So
// fetch the new worker first and wait for it to take over, then reload. If
// there is no newer one (a real fault, not a deploy), it reloads straight away.
// The new worker downloads about 1 MB before it takes over, which on a phone's
// mobile data can take a while (8 s was too short), hence `timeout`.
export async function reloadOntoLatest(timeout = 30000) {
  try {
    const sw = navigator.serviceWorker
    const reg = sw && await sw.getRegistration('/')
    if (reg) {
      const tookOver = new Promise((resolve) => sw.addEventListener('controllerchange', resolve, { once: true }))
      await Promise.race([
        (async () => {
          await reg.update()
          if (reg.installing || reg.waiting) await tookOver
        })(),
        new Promise((resolve) => setTimeout(resolve, timeout)),
      ])
    }
  } catch { /* offline, or no worker: a plain reload is all there is */ }
  window.location.reload()
}

// The banner: plain DOM, so it works on every page (the React app and the
// plain /service tools alike), in the site's colours where the page has its
// tokens and sensible ones where it doesn't. Below the header, where it can't
// cover a phone's bottom bar or the notifications card.
function showUpdateBanner(working) {
  if (document.getElementById('sw-update')) return
  const css = document.createElement('style')
  css.textContent = `
#sw-update{position:fixed;z-index:2147483600;left:50%;top:calc(var(--shell-header-h,64px) + 12px);transform:translateX(-50%);
  box-sizing:border-box;width:min(440px,calc(100vw - 24px));display:flex;align-items:center;gap:12px;padding:12px 12px 12px 16px;
  border-radius:14px;background:var(--surface-inverse,#1d1d1d);color:var(--text-inverse,#fff);box-shadow:0 12px 32px rgba(0,0,0,.28);
  font:400 14px/1.35 "Source Sans 3","Segoe UI",system-ui,sans-serif;animation:sw-in .28s cubic-bezier(.2,.8,.2,1)}
#sw-update .sw-icon{flex:0 0 auto;display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--chs-purple,#554596);color:#fff}
#sw-update .sw-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
#sw-update strong{font-weight:600;font-size:15px}
#sw-update .sw-sub{opacity:.75;font-size:13px}
#sw-update button{flex:0 0 auto;min-height:36px;padding:0 14px;border:0;border-radius:999px;font:600 14px/1 inherit;font-family:inherit;cursor:pointer}
#sw-update .sw-go{background:var(--chs-white,#fff);color:var(--chs-black,#1d1d1d)}
#sw-update .sw-go:disabled{opacity:.6;cursor:default}
#sw-update .sw-later{background:transparent;color:inherit;opacity:.8;padding:0 8px}
#sw-update .sw-later:hover{opacity:1;text-decoration:underline}
@keyframes sw-in{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}
@media (max-width:480px){#sw-update{gap:10px;padding:10px 10px 10px 12px}#sw-update .sw-sub{display:none}#sw-update .sw-icon{width:30px;height:30px}#sw-update .sw-later{padding:0 4px}}
@media (prefers-reduced-motion:reduce){#sw-update{animation:none}}
@media print{#sw-update{display:none}}`
  const el = document.createElement('div')
  el.id = 'sw-update'
  el.setAttribute('role', 'status')
  el.innerHTML = `
<span class="sw-icon" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/></svg></span>
<span class="sw-text"><strong>A new version is ready</strong><span class="sw-sub">Update to get the latest changes.</span></span>
<button type="button" class="sw-later">Later</button>
<button type="button" class="sw-go">Update now</button>`
  const go = el.querySelector('.sw-go')
  go.addEventListener('click', () => {
    if (working()) {
      // A SimproSync run or an upload: update the moment it's done.
      go.disabled = true
      go.textContent = 'After this finishes…'
      const wait = setInterval(() => { if (!working()) { clearInterval(wait); window.location.reload() } }, 1000)
      return
    }
    window.location.reload()
  })
  // Later: out of the way; it updates by itself next time the app is in the background.
  el.querySelector('.sw-later').addEventListener('click', () => el.remove())
  document.head.appendChild(css)
  document.body.appendChild(el)
}
