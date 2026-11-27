import { shouldCheck, shouldReload, startGuard, workInProgress } from './updateGuard.js'
import { enablePullToRefresh } from './pullToRefresh.js'
import { mattersHere } from './buildInfo.js'
import { hasShellMismatch, isStale, refreshStale, staleSections, startBuildInfo, subscribe } from './updates.js'

// Registers the single service worker for this origin, at scope "/", and tells
// people when a newer version of the site is ready.
//
// Every app calls this. Whichever page someone lands on first installs the
// worker; the rest just keep it fresh. Registering the same URL and scope more
// than once is a no-op, so there's no harm in calling it from everywhere — and
// real benefit: a person who only ever opens /maintenance/ still gets the update
// check.
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
//
// The one app (main.jsx passes `app`) is more selective. A deploy that changed only some of its
// sections does not replace sw.js, so nothing fires controllerchange; what changed is read from
// /build-info.json instead (shared/updates.js, shared/buildInfo.js), on the same checks as above. The shell
// changing reloads exactly as described. Only sections changing doesn't reload anyone: they are marked
// stale, and the page reloads when someone opens a stale section (reloadIfStale, from sections.js and
// App.jsx), or, if they are already in one, when the guard says it is safe. The banner only shows for a
// change that matters to the page they are on. Plain pages (the gate's) pass nothing and reload on any
// new version, as before.
//
//   app.entry    the app's own script path ("assets/main-<hash>.js"), to tell build-info.json belongs to it
//   app.section  () => the id of the section the person is in now ('hub' for the hub's own pages)
export function registerServiceWorker({ app = null } = {}) {
  const guard = startGuard()
  // Phones: drag down at the top of a page to refresh (pullToRefresh.js). Before the
  // dev-mode return below, so it can be tried in `npm run dev` too.
  enablePullToRefresh({ refresh: () => reloadOntoLatest(), busy: guard.busy })

  // In `npm run dev` there is no built /sw.js — registering would only log a
  // failure. `npm run preview` serves a real build, so it still registers.
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return

  if (app) {
    startBuildInfo(app.entry)
      // A deploy landed between this page and its build-info.json loading: they do not belong together.
      .then(() => { if (hasShellMismatch()) reloadOnce('hub:infoReload') })
    // A file a deploy has removed (an old section's script, a stylesheet) while the page was open: the
    // same recovery as the "didn't load" message, without waiting for something to fail visibly.
    window.addEventListener('vite:preloadError', () => reloadOnce('hub:preloadReload'))
  }

  // A first-ever install also "takes over" an uncontrolled page. That's not
  // an update, and prompting (or reloading) on it would be pointless.
  const hadController = !!navigator.serviceWorker.controller
  const phone = matchMedia('(pointer: coarse)').matches
  let ready = false   // the shell changed: every page needs the new version
  let waiting = 0
  let dismissed = false
  // Does the new version matter to the page they are on? The shell changing does; so does their own section.
  const matters = () => mattersHere({ shellChanged: ready, stale: staleSections(), section: app?.section() })
  // Reload if a new version is ready and nobody is in the middle of anything.
  const reloadWhenSafe = () => {
    if (shouldReload({ ready: matters(), busy: guard.busy(), sinceActiveMs: guard.sinceActive() })) window.location.reload()
  }
  // The banner shows only while it matters to this page (computers only).
  const syncBanner = () => {
    if (phone) return
    if (!matters()) { dismissed = false; hideUpdateBanner(); return }
    if (!dismissed) showUpdateBanner(guard.running, () => { dismissed = true })
  }
  const announce = () => {
    syncBanner()
    reloadWhenSafe()
    // Held back by something in progress: look again until it is done.
    if (matters() && !waiting) waiting = setInterval(() => { syncBanner(); reloadWhenSafe() }, 2000)
  }
  navigator.serviceWorker.addEventListener('controllerchange', async () => {
    if (!hadController || ready) return
    if (app) {
      // A new worker means a new shell, but make sure: build-info.json says whether it is only sections.
      // Unreadable (offline, or the page never got one) counts as the shell, as it always did.
      const seen = await refreshStale()
      if (seen.known && !seen.shell) return announce()
    }
    ready = true
    announce()
  })
  if (app) {
    subscribe(announce)                             // an update check found sections changed
    window.addEventListener('popstate', syncBanner) // moved to another section (router.js announces it)
  }
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
          if (app) refreshStale()
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

// Reload onto the newest deploy, at most once a minute per `key`, never from under a run in progress. For
// failures that point at a deploy (a build-info.json that is not this page's, a missing file), where reloading
// again straight away would only loop if the cause is a real fault.
function reloadOnce(key) {
  let last = 0
  try { last = Number(sessionStorage.getItem(key)) || 0 } catch { /* private mode */ }
  if (Date.now() - last < 60_000 || workInProgress()) return
  try { sessionStorage.setItem(key, String(Date.now())) } catch { /* private mode */ }
  reloadOntoLatest()
}

/**
 * Someone is opening section `id`. If a deploy has changed it since this page loaded, reload onto the new
 * version (nothing there has started, so nothing is lost) and return true: the caller then shows its loading
 * state rather than the old section. A run in progress elsewhere on the page holds the reload until it ends.
 */
export function reloadIfStale(id) {
  if (!isStale(id)) return false
  const go = () => {
    if (workInProgress()) return setTimeout(go, 1000)
    reloadOntoLatest()
  }
  go()
  return true
}

// Reload onto the newest deploy. A plain reload isn't enough when a page asks
// for a file a deploy has removed: until the new sw.js has taken over, the old
// one hands back its cached copy of the old page, which asks for the same
// missing file (only Ctrl+Shift+R, which skips the worker, got past it). So
// fetch the new worker first and wait for it to take over, then reload. If
// there is no newer one (a real fault, not a deploy), it reloads straight away.
// The new worker downloads about 1 MB before it takes over, which on a phone's
// mobile data can take a while (8 s was too short), hence `timeout`.
// Called again while one is under way (a missing file can be reported twice: by the page's
// preload-error listener and by the "didn't load" message), it is the same reload.
let reloading = null
export function reloadOntoLatest(timeout = 30000) {
  if (!reloading) reloading = reload(timeout)
  return reloading
}
async function reload(timeout) {
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
  // Still here a moment later (a "leave this page?" prompt was declined): a later call may try again.
  setTimeout(() => { reloading = null }, 5000)
}

function hideUpdateBanner() {
  document.getElementById('sw-update')?.remove()
}

// The banner: plain DOM, so it works on every page (the React app and the
// plain /service tools alike), in the site's colours where the page has its
// tokens and sensible ones where it doesn't. Below the header, where it can't
// cover a phone's bottom bar or the notifications card.
function showUpdateBanner(working, onLater = () => {}) {
  if (document.getElementById('sw-update')) return
  if (!document.getElementById('sw-update-css')) {
    const css = document.createElement('style')
    css.id = 'sw-update-css'
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
    document.head.appendChild(css)
  }
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
  el.querySelector('.sw-later').addEventListener('click', () => { onLater(); el.remove() })
  document.body.appendChild(el)
}
