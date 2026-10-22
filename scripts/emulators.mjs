// `npm run emulators`: the test copy's back end (README, "Test copy"). Starts
// the Firebase emulators for sign-in and Firestore, with the real
// rules/firestore.rules, under the made-up project demo-cmchs, then fills them
// with test data (scripts/emulator-seed.mjs). Leave it running; in another
// terminal, `npm run dev:emulators` serves the hub against it. Ctrl+C stops it,
// and the data goes with it. Changing rules/firestore.rules reloads them live.
//
// Needs Java (the emulators run on it). firebase-tools is fetched by npx the
// first time.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECT, HOSTS, seed } from './emulator-seed.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const env = { ...process.env }
// Windows: Java can't open its internal pipe under a long temp path ("Unable to
// establish loopback connection"). Give it a short folder (rules/README.md).
if (process.platform === 'win32' && !/unixdomain\.tmpdir/.test(env.JAVA_TOOL_OPTIONS || '')) {
  const dir = join(homedir(), '.uds')
  mkdirSync(dir, { recursive: true })
  env.JAVA_TOOL_OPTIONS = `${env.JAVA_TOOL_OPTIONS || ''} -Djdk.net.unixdomain.tmpdir=${dir.replace(/\\/g, '/')}`.trim()
  env.TEMP = env.TMP = dir
}

const child = spawn('npx', ['-y', 'firebase-tools@13', 'emulators:start', '--only', 'auth,firestore', '--project', PROJECT],
  { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' })
child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill('SIGINT'))

async function up(host) {
  for (let i = 0; i < 180; i++) {
    try { await fetch(`http://${host}/`); return } catch { await new Promise((r) => setTimeout(r, 1000)) }
  }
  throw new Error(`The emulator at ${host} didn't start.`)
}
try {
  await up(HOSTS.firestore)
  await up(HOSTS.auth)
  await seed()
  console.log('\nTest copy ready. In another terminal: npm run dev:emulators, then sign in as one of the test staff.\n')
} catch (e) {
  console.error('Test copy not ready:', e.message)
}
