import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Simpro asset sync, served at /simprosync/ on internal.chsnz.co.nz.
//
// Its own build rather than another input of the schedule's, which is what it
// was before the move. The cost is a duplicated Firebase SDK (~110 KB gzipped)
// — separate Vite builds can't share chunks — and for an admin-only tool opened
// now and then that's a fair price for the tidy top-level URL.
//
// It still imports the schedule's firebase.js. That's a build-time relative
// import, so the two apps share the config without sharing a bundle.
export default defineConfig({
  base: '/simprosync/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
})
