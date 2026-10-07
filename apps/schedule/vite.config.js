import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The staff schedule, served at /schedule/ on internal.chsnz.co.nz.
//
// There is deliberately NO VitePWA block here, unlike the standalone app this
// came from. The site has exactly one manifest and one service worker, both
// owned by the hub (see apps/hub/src/sw.js). VitePWA would emit a competing
// /schedule/sw.js, a second manifest — which would make the schedule a second
// installable app, the opposite of the point — and a precache list built at
// Vite time that can't see the rest of the assembled site.
//
// Dropping it also stops the automatic registerSW.js injection. Registration is
// now the explicit registerServiceWorker() call in src/main.jsx.
export default defineConfig({
  base: '/schedule/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
})
