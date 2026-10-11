import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Service orders, served at /service-orders/ on internal.chsnz.co.nz.
// Replaces the service order spreadsheet and takes over from the Service Order
// Parser. Reads and writes the `serviceOrders` Firestore collection in the
// staff schedule's project, the same one every other tool on this domain
// signs in against.
export default defineConfig({
  base: '/service-orders/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
})
