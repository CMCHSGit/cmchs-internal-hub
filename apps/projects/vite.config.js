import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Project tracker, served at /projects/ on internal.chsnz.co.nz. Replaces the
// project team's job register and weekly timeline sheets. Reads and writes the
// project* Firestore collections in the staff schedule's project, the same one
// every other tool on this domain signs in against.
export default defineConfig({
  base: '/projects/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
})
