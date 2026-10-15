import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Asks, served at /asks/ on internal.chsnz.co.nz: quick requests between
// staff, picked up by whoever can do them. Reads and writes the asks and
// askStats Firestore collections in the staff schedule's project, the same one
// every other tool on this domain signs in against.
export default defineConfig({
  base: '/asks/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
})
