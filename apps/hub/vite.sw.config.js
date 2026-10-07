import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

// Builds src/sw.js on its own, as a second pass over the same output folder.
//
// Why it can't just be another input of vite.config.js: Rollup is free to split
// code shared between entries into a chunk, and a worker that has to `import`
// one is a module worker. `importScripts` — which the Firebase compat SDK needs
// for background push — throws in a module worker. A separate build with
// format:'iife' is the only way to guarantee one self-contained classic script.
//
// The output is sw-src.js, not sw.js: it still has an empty self.__WB_MANIFEST.
// scripts/build.mjs fills that in over the assembled site and writes the real
// sw.js. Nothing should ever register sw-src.js.
export default defineConfig({
  base: '/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  build: {
    // vite.config.js has already written this folder — don't wipe it
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./src/sw.js', import.meta.url)),
      output: {
        format: 'iife',
        entryFileNames: 'sw-src.js',
        inlineDynamicImports: true,
      },
    },
  },
})
