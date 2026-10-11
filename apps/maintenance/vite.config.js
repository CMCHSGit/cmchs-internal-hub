import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Maintenance schedule, served at /maintenance/ on internal.chsnz.co.nz.
// Replaces the PM tracking spreadsheet. Reads and writes the `maintenance`
// Firestore collection in the staff schedule's project, the same one every
// other tool on this domain signs in against.
export default defineConfig({
  base: '/maintenance/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
})
