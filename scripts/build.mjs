// Builds every app and assembles one site in dist/, which GitHub Pages serves
// at internal.chsnz.co.nz. Each app lands at its own path:
//
//   apps/hub         (Vite)    -> /            (+ /shared/gate.js)
//   apps/schedule    (Vite)    -> /schedule/
//   apps/maintenance (Vite)    -> /maintenance/
//   apps/service-orders (Vite) -> /service-orders/
//   apps/simprosync  (Vite)    -> /simprosync/
//   apps/ansurtopdf  (Vite)    -> /ansurtopdf/
//   apps/admin       (Vite)    -> /admin/     admin settings (people, Simpro access…)
//   apps/projects    (Vite)    -> /projects/  project tracker (job register + weekly timeline)
//   apps/asks        (Vite)    -> /asks/      quick requests between staff, picked up by whoever can
//   apps/demo        (fetched) -> /demo/  read-only copy of demo.chsnz.co.nz,
//                                         built from the chs-equipment repo
//
// Adding an app = one more entry in APPS (and a card in tools.json).
import { execSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  { dir: 'apps/maintenance', path: 'maintenance', build: 'npm run build -w apps/maintenance', output: 'dist' },
  { dir: 'apps/service-orders', path: 'service-orders', build: 'npm run build -w apps/service-orders', output: 'dist' },
  { dir: 'apps/simprosync', path: 'simprosync', build: 'npm run build -w apps/simprosync', output: 'dist' },
  { dir: 'apps/ansurtopdf', path: 'ansurtopdf', build: 'npm run build -w apps/ansurtopdf', output: 'dist' },
  { dir: 'apps/admin',      path: 'admin',      build: 'npm run build -w apps/admin',    output: 'dist' },
  { dir: 'apps/projects',   path: 'projects',   build: 'npm run build -w apps/projects', output: 'dist' },
  { dir: 'apps/asks',       path: 'asks',       build: 'npm run build -w apps/asks',     output: 'dist' },
  { dir: 'apps/demo',       path: 'demo',       build: 'node apps/demo/build.mjs',       output: 'dist' },
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
  // Only the hub's own shell, plus each tool's entry page. Precaching
  // everything meant opening the hub downloaded 3.2 MB, of which 2.6 MB was
  // tools you may never open - four separate Vite builds each shipping their
  // own ~490 KB copy of the Firebase SDK. A tool's assets are cached the first
  // time it is actually opened instead (the runtime route in sw.js), so
  // offline use of anything you have used is unaffected.
  globPatterns: [
    'index.html',
    '404.html',
    'manifest.webmanifest',
    'assets/**/*.{js,css}',
    'shared/**/*.js',
    'brand/**/*.png',
    'icons/**/*.png',
    // The schedule's entry page has to be here: the worker's NavigationRoute
    // hands deep links to it by URL, which only resolves if it is precached.
    //
    // The other tools' entry pages are deliberately NOT. Their scripts and
    // styles are only cached the first time a tool is opened, so a precached
    // page could point at a build's stylesheet that was never cached and that
    // the next deploy deleted from the server — the tool then opened with no
    // styles at all (giant icons, no layout) until a second refresh. Left out,
    // they go through the worker's network-first page route: always this
    // deploy's page when online, and offline the last copy, whose files were
    // cached when it was loaded.
    'schedule/index.html',
  ],
  globIgnores: [
    'sw-src.js',
    // Big, rarely opened, or wanted fresh rather than cached. Precaching these
    // would make every phone download them up front for no reason.
    '**/exceljs*.js',
    'ansurtopdf/**',
    // 600 KB and live-data only: no use offline, and it changes on every
    // tracker deploy, which would churn every installed copy's cache.
    'demo/**',
  ],
  // Vite already content-hashes these, so workbox adding its own revision on
  // top would only make the manifest churn on every build.
  dontCacheBustURLsMatching: /-[A-Za-z0-9_-]{8}\.(js|css|woff2)$/,
})
warnings.forEach(w => console.warn('  workbox: ' + w))
rmSync(join(DIST, 'sw-src.js'))

// The sign-in settings, published for pages that are not part of this build —
// the demo tracker, which lives in the chs-equipment repo and runs on two
// origins. It needs the staff schedule's Firebase web config to pick up the
// hub's Microsoft sign-in, and that config is kept out of repos (it lives in
// Actions secrets). This is the same information already compiled into every
// bundle on this site, which is why publishing it is fine: Firebase web config
// identifies the project, it does not grant anything.
//
// Written AFTER injectManifest so it is never precached: a page asking for it
// should get today's values, not a copy from the last install.
{
  const read = (k) => (process.env[k] || (new RegExp('^' + k + '=(.*)$', 'm').exec(fromFile) || [])[1] || '').trim()
  const cfg = {
    apiKey: read('VITE_FIREBASE_API_KEY'),
    authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
    projectId: read('VITE_FIREBASE_PROJECT_ID'),
    appId: read('VITE_FIREBASE_APP_ID'),
    tenant: read('VITE_AZURE_TENANT_ID'),
  }
  mkdirSync(join(DIST, 'shared'), { recursive: true })
  writeFileSync(join(DIST, 'shared', 'auth-config.json'), JSON.stringify(cfg) + '\n')
  console.log('  shared/auth-config.json ' + (cfg.apiKey ? 'written' : 'written EMPTY (no env) — sign-in will not work from it'))
}
console.log(`  service worker: ${count} files precached, ${(size / 1024 / 1024).toFixed(2)} MB`)

console.log('Site assembled in dist/')
