// The one service worker for internal.chsnz.co.nz, at scope "/". Every app on
// the site shares it — there is deliberately not one per app, because a second
// worker at a narrower scope would fight this one over the same pages.
//
// Two things about how it gets built are easy to trip over:
//  - It is built on its own (apps/hub/vite.sw.config.js), not as another input
//    of the hub's build. See that file for why.
//  - Its precache list is NOT generated here. The list has to cover the whole
//    assembled site, which no single app's build can see, so scripts/build.mjs
//    runs workbox's injectManifest over dist/ at the end and that is what fills
//    in self.__WB_MANIFEST below.
import { matchPrecache, precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Activate a new deploy immediately instead of waiting for every open tab to
// close first — otherwise people can be stuck on stale cached UI. This is also
// what makes the update banner work: claiming the page fires controllerchange.
self.skipWaiting()
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// Sections of the one app (apps/hub/src/router.js SECTIONS) have no file of
// their own: /asks/ is the app at / opened on Asks, /schedule/my the app opened
// on the schedule's My week. All get the app's page, the job /404.html does
// when the network answers instead of this worker.
// (/admin/ moved into Settings; the app forwards it.)
const APP_SECTIONS = /^\/(schedule|asks|projects|service-orders|maintenance|oncall|simprosync|ansurtopdf|equipment|settings|admin)(\/|$)/
/** An address inside the one app: the hub at / or one of its sections. */
const inApp = (path) => path === '/' || path === '/index.html' || APP_SECTIONS.test(path)

// The app's page comes from the network whenever there is one, and the
// precached copy only offline or when the network takes over 5 s. Until 22 Oct
// 2026 the precached copy came first: a phone whose worker hadn't yet updated
// after a deploy kept getting the old page, which asked for section files the
// deploy had removed ("This part of the hub didn't load"), and reloading only
// got the same old page again. no-cache: GitHub Pages lets browsers keep
// index.html for 10 minutes, which would bring the same problem back.
// Registered before precacheAndRoute, which would otherwise answer / itself.
registerRoute(
  ({ url, request }) => request.mode === 'navigate' && url.origin === self.location.origin && inApp(url.pathname),
  async () => {
    try {
      const res = await Promise.race([
        fetch('/index.html', { cache: 'no-cache' }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('slow network')), 5000)),
      ])
      if (res.ok) return res
    } catch { /* offline or slow: the copy below */ }
    return (await matchPrecache('/index.html')) || fetch('/index.html')
  },
)

precacheAndRoute(self.__WB_MANIFEST)

registerRoute(
  ({ url }) => url.origin === 'https://firestore.googleapis.com',
  new NetworkFirst({ cacheName: 'firestore-cache' })
)

// A tool's own scripts, styles and fonts, kept the first time it is opened
// rather than downloaded up front with everything else. They carry a content
// hash in the filename, so a cached one is never stale — a new build is a new
// URL. This is what lets the precache stay small without losing offline use of
// the tools someone actually opens.
registerRoute(
  ({ url, request }) =>
    url.origin === self.location.origin &&
    ['script', 'style', 'font'].includes(request.destination),
  new CacheFirst({
    cacheName: 'tool-assets',
    plugins: [new ExpirationPlugin({ maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true })],
  }),
)

// A tool's page itself: fresh when there is a network, the last copy when
// there is not. Covers the pages left out of the precache (Ansur, demo).
registerRoute(
  ({ url, request }) => request.mode === 'navigate' && url.origin === self.location.origin,
  new NetworkFirst({ cacheName: 'tool-pages', networkTimeoutSeconds: 4 }),
)

// ── Firebase Cloud Messaging ──────────────────────────────────────────────
// Background push only (app closed, or tab not focused). Foreground messages
// are handled in the schedule's src/utils/push.js via onMessage(), since the
// browser suppresses OS notifications while the tab has focus.
//
// Every sender (Asks, news, the schedule's and demo tracker's reminders) sends
// a `notification` block, and for those the Firebase SDK shows the
// notification itself. It still calls onBackgroundMessage afterwards, so
// showing it there too gave everyone two of each (until 19 Oct 2026).
//
// The SDK also claims clicks on the notifications it shows (a click listener
// that stops the others) and opens nothing, as we send no fcmOptions link. So
// this one is registered before firebase.messaging() and gets there first.
// The link is in data.url either way: on ours directly, on the SDK's inside
// the original message (data.FCM_MSG).
self.addEventListener('notificationclick', (event) => {
  event.stopImmediatePropagation()
  event.notification.close()
  const d = event.notification.data || {}
  const target = new URL(d.url || d.FCM_MSG?.data?.url || '/schedule/', self.location.origin)
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // A window already open on what the notification is about, which then
    // moves to that screen: one in the same section or tool first; failing
    // that, for the one app (the schedule, Asks…), any window of it. For a
    // separate tool (/demo/) only a window inside that tool: matching any
    // window on the origin would navigate whatever other tool happened to be
    // open away from someone's half-finished work.
    const tool = '/' + target.pathname.split('/')[1] + '/'
    const existing = windows.find(w => new URL(w.url).pathname.startsWith(tool))
      || (inApp(target.pathname) ? windows.find(w => inApp(new URL(w.url).pathname)) : undefined)
    if (existing) {
      await existing.focus()
      if ('navigate' in existing) await existing.navigate(target.href).catch(() => {})
      return
    }
    await self.clients.openWindow(target.href)
  })())
})

//
// importScripts is why this worker has to be a classic script — see
// apps/hub/vite.sw.config.js.
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js')
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js')

// Everything above this point — precaching, offline, the schedule's routes —
// matters to everyone. Push matters to whoever opted in. So a messaging failure
// (an unsupported browser, a missing config value) must not take the install
// down with it.
try {
  firebase.initializeApp({
    apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
    authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  })

  // Two senders use this: the staff schedule's reminders, and the demo
  // tracker's (sent by the Simpro proxy, with a link into /equipment/; /demo/ before 19 Oct 2026).
  firebase.messaging().onBackgroundMessage((payload) => {
    // Already shown by the SDK (see above). Only a data-only message needs one.
    if (payload.notification) return
    const { title, body } = payload.data || {}
    const url = payload.data?.url || '/schedule/'
    const demo = /^\/(demo|equipment)\//.test(new URL(url, self.location.origin).pathname)
    // The one app's icon for both: the schedule's own calendar icon went with
    // its separate page.
    self.registration.showNotification(title || (demo ? 'Demo tracker' : 'CMCHS Staff Schedule'), {
      body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
    })
  })
} catch (err) {
  console.warn('[sw] background push unavailable', err)
}
