import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Admin settings, served at /admin/ on internal.chsnz.co.nz. People, teams,
// roles and Simpro access, the schedule's locations, the Excel import and the
// activity log. It moved here from the staff schedule's own Admin page, and
// still reads and writes the schedule's Firestore, reusing its code from
// apps/schedule/src rather than keeping a second copy.
export default defineConfig({
  base: '/admin/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
})
