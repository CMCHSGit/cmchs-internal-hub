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
import { NetworkFirst } from 'workbox-strategies'

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

// The schedule routes client-side, so /schedule/my and friends have no file
// behind them. Hand back its index.html — the same job /404.html does when the
// network serves the request instead of this worker.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/schedule/index.html'), {
  allowlist: [/^\/schedule\//],
}))

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

  firebase.messaging().onBackgroundMessage((payload) => {
    const { title, body } = payload.notification || {}
    self.registration.showNotification(title || 'CMCHS Staff Schedule', {
      body,
      icon: '/schedule/icons/icon-192.png',
      badge: '/schedule/icons/icon-192.png',
      data: { url: payload.data?.url || '/schedule/' },
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
    // Only a window already inside the app the notification is about. Matching
    // any window on the origin — which is what this did when the schedule had
    // the origin to itself — would now focus the hub home page, or whatever
    // other tool happened to be open, and navigate it away.
    const existing = windows.find(w => new URL(w.url).pathname.startsWith('/schedule/'))
    if (existing) {
      await existing.focus()
      if ('navigate' in existing) await existing.navigate(target.href).catch(() => {})
      return
    }
    await self.clients.openWindow(target.href)
  })())
})
