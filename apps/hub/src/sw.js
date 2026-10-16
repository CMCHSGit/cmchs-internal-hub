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
import { createHandlerBoundToURL, precacheAndRoute } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'
import { CacheFirst, NetworkFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'

// Activate a new deploy immediately instead of waiting for every open tab to
// close first — otherwise people can be stuck on stale cached UI. This is also
// what makes the update banner work: claiming the page fires controllerchange.
self.skipWaiting()
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

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

// Sections of the one app (apps/hub/src/router.js SECTIONS) have no file of
// their own: /asks/ is the app at / opened on Asks, /schedule/my the app opened
// on the schedule's My week. Hand back the app's page, the job /404.html does
// when the network answers instead of this worker. Before the route below,
// which would otherwise take these navigations first.
const APP_SECTIONS = /^\/(schedule|asks|projects|admin)(\/|$)/
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), {
  allowlist: [APP_SECTIONS],
}))
/** An address inside the one app: the hub at / or one of its sections. */
const inApp = (path) => path === '/' || path === '/index.html' || APP_SECTIONS.test(path)

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
  // tracker's (sent by the Simpro proxy, with a link into /demo/).
  firebase.messaging().onBackgroundMessage((payload) => {
    const { title, body } = payload.notification || {}
    const url = payload.data?.url || '/schedule/'
    const demo = new URL(url, self.location.origin).pathname.startsWith('/demo/')
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

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/schedule/', self.location.origin)
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
