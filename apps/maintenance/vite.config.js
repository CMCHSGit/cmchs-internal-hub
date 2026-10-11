import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Maintenance schedule, served at /maintenance/ on internal.chsnz.co.nz.
// Replaces the PM tracking spreadsheet. Reads and writes the `maintenance`
// Firestore collection in the staff schedule's project, the same one every
// other tool on this domain signs in against.
// Stamped into the page so "is this the latest?" is answerable by looking,
// rather than by comparing a deployed bundle against a local one.
const BUILT = new Date().toISOString()

export default defineConfig({
  define: { __BUILT__: JSON.stringify(BUILT) },
  base: '/maintenance/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
})
