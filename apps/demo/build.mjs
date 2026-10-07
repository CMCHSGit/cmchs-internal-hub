// Builds /demo/: the real demo tracker (chs-equipment repo, the page served
// at demo.chsnz.co.nz) made read-only by apps/demo/readonly.js.
//
// Nothing of the tracker is kept in this repo. Every build takes the current
// index.html from GitHub, so /demo/ follows the tracker's changes on the next
// hub deploy (deploy.yml also runs on a timer for this).
//
// Set DEMO_SRC to a local chs-equipment folder to build from that instead.
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const OUT = join(HERE, 'dist')
const RAW = 'https://raw.githubusercontent.com/CMCHSGit/chs-equipment/main/'
const FILES = ['index.html', 'icon-180.png', 'icon-192.png', 'icon-512.png']

async function source(name) {
  if (process.env.DEMO_SRC) return readFileSync(join(process.env.DEMO_SRC, name))
  const res = await fetch(RAW + name)
  if (!res.ok) throw new Error(`Couldn't fetch ${RAW + name}: HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

let html = (await source('index.html')).toString('utf8')

// readonly.js must run before ANY of the tracker's scripts, so it goes straight
// after <head>. Then the hub's sign-in check (same two lines as every tool).
const INJECT = `
<!-- Added by cmchs-internal-hub apps/demo/build.mjs: read-only copy of demo.chsnz.co.nz -->
<script src="/demo/readonly.js"></script>
<script>document.documentElement.style.visibility='hidden'</script>
<script type="module" src="/shared/gate.js"></script>
`
const head = html.search(/<head[^>]*>/i)
if (head < 0) throw new Error('Tracker index.html has no <head>; refusing to build /demo/')
const headEnd = html.indexOf('>', head) + 1
html = html.slice(0, headEnd) + INJECT + html.slice(headEnd)

// The hub's manifest is the site's only one; a second would be a second app.
html = html.replace(/<link[^>]+rel=["']manifest["'][^>]*>\s*/gi, '')
html = html.replace(/<title>[^<]*<\/title>/i, '<title>Demo tracker (read-only) · CMCHS Internal Hub</title>')

// Never ship /demo/ without the lock: the readonly script must be the first
// script on the page. If the tracker's markup ever changes so this doesn't
// hold, the build fails rather than publishing a writable copy.
const firstScript = html.search(/<script\b/i)
if (html.indexOf('<script src="/demo/readonly.js"></script>') !== firstScript) {
  throw new Error('readonly.js is not the first script in /demo/; refusing to build')
}
if (/rel=["']manifest["']/i.test(html)) throw new Error('A manifest link survived; refusing to build /demo/')

writeFileSync(join(OUT, 'index.html'), html)
copyFileSync(join(HERE, 'readonly.js'), join(OUT, 'readonly.js'))
for (const name of FILES.slice(1)) {
  try { writeFileSync(join(OUT, name), await source(name)) } catch (e) { console.warn('  demo: ' + e.message) }
}
console.log(`  demo: tracker ${process.env.DEMO_SRC ? 'from ' + process.env.DEMO_SRC : 'from GitHub main'}, ${(html.length / 1024).toFixed(0)} KB, read-only`)
