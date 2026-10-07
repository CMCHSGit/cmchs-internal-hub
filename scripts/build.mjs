// Builds every app and assembles one site in dist/, which GitHub Pages serves
// at internal.chsnz.co.nz. Each app lands at its own path:
//
//   apps/hub      (Vite)    -> /            (+ /shared/gate.js)
//   apps/service  (static)  -> /service/
//
// Adding an app = one more entry in APPS (and a card in tools.json).
import { execSync } from 'node:child_process'
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(ROOT, 'dist')

const APPS = [
  { dir: 'apps/hub',     path: '',        build: 'npm run build -w apps/hub', output: 'dist' },
  { dir: 'apps/service', path: 'service', output: '.' },
]

// A real build without the Firebase config would ship a hub nobody can sign
// in to. Refuse in CI; locally it's allowed so `npm run build` works offline.
const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_AZURE_TENANT_ID']
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

console.log('Site assembled in dist/')
