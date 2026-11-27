// Builds every app and assembles one site in dist/, which GitHub Pages serves
// at internal.chsnz.co.nz. Each app lands at its own path:
//
//   apps/hub            (Vite)    -> /             the one app (+ /shared/gate.js)
//   apps/demo                     -> /demo/        forwards to /equipment/ (the demo tracker
//                                                  moved into the app on 19 Oct 2026)
//
// No build of their own, because they are sections of the hub's one app
// (apps/hub/src/router.js, INTEGRATION-PLAN.md steps 2 and 3): apps/schedule
// (/schedule/), apps/asks (/asks/), apps/projects (/projects/), apps/settings
// (/settings/, with apps/admin's screens), apps/service-orders (/service-orders/),
// apps/maintenance (/maintenance/), apps/checklists (/checklists/), apps/simprosync (/simprosync/) and
// apps/ansurtopdf (/ansurtopdf/) and apps/pdf-editor (/pdf-editor/) and apps/logreader (/logreader/).
//
// Adding an app = one more entry in APPS (and a card in tools.json).
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { injectManifest } from 'workbox-build'
import { SECTION_SOURCES } from '../apps/hub/src/section-sources.js'
import { OCR_BASE, OCR_FILES, OCR_VERSION } from '../shared/ocr-assets.js'
import { buildInfo, closure } from './build-info.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

// The hub stays first: it writes dist/ at the root, so anything copied before
// it would be wiped by its own build output landing on top.
const APPS = [
  { dir: 'apps/hub',        path: '',           build: 'npm run build -w apps/hub',      output: 'dist' },
  { dir: 'apps/demo',       path: 'demo',       build: 'node apps/demo/build.mjs',       output: 'dist' },
  // The Test Bench's own page, shown in a frame by the /testbench/ section (apps/testbench/src/section.jsx). Not under
  // /testbench/, which the worker answers with the app.
  { dir: 'apps/testbench',  path: 'bench-app',  output: 'bench' },
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

// The Test Bench's templates, published beside it (/bench-app/templates/) for browsers that can't use the shared SharePoint folder
// (Firefox has no folder picker): the bench reads index.json, then each file. Copied from apps/testbench/templates by
// apps/testbench/tools/sync-templates.mjs, so SharePoint stays the master. Never precached (the service worker's list is fixed below).
{
  const from = join(ROOT, 'apps/testbench/templates'), to = join(DIST, 'bench-app/templates')
  if (existsSync(from)) {
    mkdirSync(to, { recursive: true })
    const entry = (file) => { const data = readFileSync(join(from, file)); writeFileSync(join(to, file), data); return { file, v: createHash('sha1').update(data).digest('hex').slice(0, 12) } }
    const files = readdirSync(from).filter(n => /.json$/i.test(n))
    const layout = files.find(n => n === '_Run a test layout.json')
    const index = { generated: new Date().toISOString(), templates: files.filter(n => !/^[._~]/.test(n)).map(entry), layout: layout ? entry(layout) : null }
    writeFileSync(join(to, 'index.json'), JSON.stringify(index))
    console.log(`  apps/testbench/templates -> /bench-app/templates (${index.templates.length} templates)`)
  }
}

// The text recognition's own files (Test Bench > MAC reader), published beside the app at /ocr/<version>/
// (shared/ocr-assets.js) so they come from this site, not a CDN. About 12 MB, so never precached (the worker's
// list below is fixed): a phone fetches them the first time someone reads a screen, and the browser keeps them.
{
  const installed = JSON.parse(readFileSync(join(ROOT, 'node_modules/tesseract.js/package.json'), 'utf8')).version
  if (installed !== OCR_VERSION) throw new Error(`tesseract.js ${installed} is installed but shared/ocr-assets.js says ${OCR_VERSION}: change OCR_VERSION (a new address, so phones don't keep the old files).`)
  const to = join(DIST, OCR_BASE.replace(/^\/|\/$/g, ''))
  mkdirSync(to, { recursive: true })
  for (const [name, from] of OCR_FILES) cpSync(join(ROOT, 'node_modules', from), join(to, name))
  console.log(`  tesseract.js -> ${OCR_BASE} (${OCR_FILES.length} files)`)
}

// The site has one service worker, at scope "/", so its precache list has to be
// built from the ASSEMBLED dist/ — no individual app's build can see the other
// apps' files. apps/hub emitted sw-src.js (vite.sw.config.js); this fills in its
// self.__WB_MANIFEST and writes the sw.js that actually ships.
//
// Of the one app's own scripts and styles, only what its start page loads is
// precached: the static imports of its entries, read from the build's
// manifest. The sections (the schedule, Asks, the project tracker…) and
// anything only they use load the first time someone opens one, and are kept
// then (sw.js tool-assets), rather than every phone downloading all of them on
// install. Choosing by the import graph rather than by file name means a piece
// two sections share, which Vite names after one of its modules, can't slip in.
//
// The sections are build entries too (vite.config.js), but not part of the shell: left out here, and
// recorded in build-info.json (written last, below) with a hash each.
const viteManifest = JSON.parse(readFileSync(join(DIST, '.vite', 'manifest.json'), 'utf8'))
// The manifest names files relative to the app's folder (../asks/src/section.jsx).
const manifestKey = (file) => relative(join(ROOT, 'apps/hub'), join(ROOT, file)).split(sep).join('/')
const sectionKeys = Object.fromEntries(Object.entries(SECTION_SOURCES).map(([id, file]) => [id, manifestKey(file)]))
const shellKeys = Object.entries(viteManifest).filter(([key, chunk]) => chunk.isEntry && !Object.values(sectionKeys).includes(key)).map(([key]) => key)
const shellFiles = [...closure(viteManifest, shellKeys, { dynamic: false })].filter(f => f.startsWith('assets/'))
rmSync(join(DIST, '.vite'), { recursive: true, force: true })

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
    ...shellFiles,
    'shared/**/*.js',
    'brand/**/*.png',
    'icons/**/*.png',
    // The tools' entry pages are deliberately NOT here (the sections of the
    // one app have none: the worker hands them index.html). Their scripts and
    // styles are only cached the first time a tool is opened, so a precached
    // page could point at a build's stylesheet that was never cached and that
    // the next deploy deleted from the server — the tool then opened with no
    // styles at all (giant icons, no layout) until a second refresh. Left out,
    // they go through the worker's network-first page route: always this
    // deploy's page when online, and offline the last copy, whose files were
    // cached when it was loaded.
  ],
  globIgnores: [
    'sw-src.js',
    // Big, rarely opened, or wanted fresh rather than cached. Precaching these
    // would make every phone download them up front for no reason.
    '**/exceljs*.js',
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

// build-info.json: what is in this deploy, per section, so a page that is already open can tell which part of
// it a later deploy changed (shared/buildInfo.js; README "Updates: only what changed"). `shell` is the hash of
// sw.js, which lists every file the shell precaches (its scripts, shared/, the page, the icons) and so changes
// when any of them does; a section's hash comes from the file names of everything it loads that the shell does
// not (scripts/build-info.mjs). Written after sw.js and never precached, so a page always reads this deploy's.
// The Test Bench's own page (/bench-app/, shown in a frame by that section) belongs to the testbench section,
// minus its templates, which are data the bench reads fresh.
{
  const digest = (dir, skip = () => false) => {
    const h = createHash('sha1')
    const walk = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const p = join(d, e.name)
        if (skip(relative(dir, p).split(sep).join('/'))) continue
        if (e.isDirectory()) walk(p)
        else h.update(relative(dir, p).split(sep).join('/')).update(readFileSync(p))
      }
    }
    walk(dir)
    return h.digest('hex').slice(0, 12)
  }
  const info = buildInfo({
    manifest: viteManifest,
    sections: sectionKeys,
    mainKey: manifestKey('apps/hub/index.html'),
    entryKeys: shellKeys,
    shell: createHash('sha1').update(readFileSync(join(DIST, 'sw.js'))).digest('hex').slice(0, 12),
    extra: { testbench: 'bench-app:' + digest(join(DIST, 'bench-app'), rel => rel === 'templates') },
  })
  // A page checks build-info.json is the one for the script it is running by this (shared/updates.js).
  if (!/^assets\/main-.+\.js$/.test(info.entry)) throw new Error(`build-info.json has no start-page script (entry "${info.entry}")`)
  // The shell imports each section's default export by name at run time, where the bundler cannot see it
  // (apps/hub/src/sections.js), so a build that left it out would ship an empty section and fail nothing.
  for (const [id, s] of Object.entries(info.sections)) {
    if (!/export\s*\{[^}]*\bas default\b|export default/.test(readFileSync(join(DIST, s.js), 'utf8'))) {
      throw new Error(`Section "${id}" (${s.js}) has no default export: its screen was left out of the build (vite.config.js preserveEntrySignatures).`)
    }
  }
  writeFileSync(join(DIST, 'build-info.json'), JSON.stringify(info, null, 1) + '\n')
  console.log(`  build-info.json: shell ${info.shell}, ${Object.keys(info.sections).length} sections`)
}

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
