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
import { precacheAndRoute } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
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
