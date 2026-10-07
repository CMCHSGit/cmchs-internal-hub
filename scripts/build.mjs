// Builds every app and assembles one site in dist/, which GitHub Pages serves
// at internal.chsnz.co.nz. Each app lands at its own path:
//
//   apps/hub         (Vite)    -> /            (+ /shared/gate.js)
//   apps/schedule    (Vite)    -> /schedule/
//   apps/simprosync  (Vite)    -> /simprosync/
//   apps/ansurtopdf  (static)  -> /ansurtopdf/
//   apps/service     (static)  -> /service/
//
// Adding an app = one more entry in APPS (and a card in tools.json).
import { execSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { injectManifest } from 'workbox-build'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

// The hub stays first: it writes dist/ at the root, so anything copied before
// it would be wiped by its own build output landing on top.
const APPS = [
  { dir: 'apps/hub',        path: '',           build: 'npm run build -w apps/hub',      output: 'dist' },
  { dir: 'apps/schedule',   path: 'schedule',   build: 'npm run build -w apps/schedule', output: 'dist' },
  { dir: 'apps/simprosync', path: 'simprosync', build: 'npm run build -w apps/simprosync', output: 'dist' },
  { dir: 'apps/ansurtopdf', path: 'ansurtopdf', output: '.' },
  { dir: 'apps/service',    path: 'service',    output: '.' },
]

// A real build without the Firebase config would ship a hub nobody can sign
// in to. Refuse in CI; locally it's allowed so `npm run build` works offline.
// VAPID is in here now that the schedule ships push: left empty, the SDK falls
// back to a default application server key and still mints working tokens, so
// push looks fine right up until the real key is added and every token silently
// rotates. Better to refuse the build.
const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_VAPID_KEY', 'VITE_AZURE_TENANT_ID']
const envFile = join(ROOT, '.env')
const fromFile = existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''
const missing = REQUIRED.filter(k => !process.env[k] && !new RegExp(`^${k}=.+`, 'm').test(fromFile))
if (missing.length) {
  const msg = `Missing ${missing.join(', ')} (repo Settings -> Secrets and variables -> Actions).`
  if (process.env.CI) { console.error('Build stopped: ' + msg); process.exit(1) }
  console.warn('Warning: ' + msg + ' This build will not be able to sign anyone in.')
}

rmSync(DIST, { recursive: true, force: true })

for (const app of APPS) {
  if (app.build) execSync(app.build, { cwd: ROOT, stdio: 'inherit' })
  const from = join(ROOT, app.dir, app.output)
  cpSync(from, join(DIST, app.path), {
    recursive: true,
    // Static apps are copied as-is, minus anything that must never be published
    filter: src => !/[\\/](node_modules|dist)([\\/]|$)/.test(src.slice(from.length)) && !/simpro_key\.js$/.test(src),
  })
  console.log(`  ${app.dir} -> /${app.path}`)
}

// The site has one service worker, at scope "/", so its precache list has to be
// built from the ASSEMBLED dist/ — no individual app's build can see the other
// apps' files. apps/hub emitted sw-src.js (vite.sw.config.js); this fills in its
// self.__WB_MANIFEST and writes the sw.js that actually ships.
const { count, size, warnings } = await injectManifest({
  swSrc: join(DIST, 'sw-src.js'),
  swDest: join(DIST, 'sw.js'),
  globDirectory: DIST,
  globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,webmanifest}'],
  globIgnores: [
    'sw-src.js',
    // Big, rarely opened, or wanted fresh rather than cached. Precaching these
    // would make every phone download them up front for no reason.
    '**/exceljs*.js',
    'ansurtopdf/**',
  ],
  // Vite already content-hashes these, so workbox adding its own revision on
  // top would only make the manifest churn on every build.
  dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.(js|css|woff2)$/,
})
warnings.forEach(w => console.warn('  workbox: ' + w))
rmSync(join(DIST, 'sw-src.js'))
console.log(`  service worker: ${count} files precached, ${(size / 1024 / 1024).toFixed(2)} MB`)

console.log('Site assembled in dist/')
