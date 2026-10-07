import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// The hub is served at "/". Two entries:
//  - index.html: the hub itself
//  - src/gate.js: the sign-in check that plain pages (the /service tools)
//    load as /shared/gate.js, so it keeps a fixed, unhashed name.
export default defineConfig({
  base: '/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        gate: fileURLToPath(new URL('./src/gate.js', import.meta.url)),
      },
      output: {
        entryFileNames: chunk => chunk.name === 'gate' ? 'shared/gate.js' : 'assets/[name]-[hash].js',
      },
    },
  },
})
