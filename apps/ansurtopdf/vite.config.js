import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// The Ansur PVT report builder, at /ansurtopdf/.
//
// This was a plain static page until it gained the Simpro panel, which needs a
// Firebase ID token to talk to the Apps Script proxy. The report building
// itself is still entirely offline: the parser, pdf-lib and the whole UI remain
// inline in index.html and Vite leaves those classic scripts alone.
//
// simpro.js loads Firebase through a dynamic import, so the ~110 KB SDK is
// fetched only when someone actually clicks to sign in. Anyone converting a
// file and downloading the PDF never pays for it.
export default defineConfig({
  base: '/ansurtopdf/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  build: {
    // index.html is ~590 KB of inlined vendor code by design; the warning is
    // noise here, not a finding.
    chunkSizeWarningLimit: 1200,
  },
})
