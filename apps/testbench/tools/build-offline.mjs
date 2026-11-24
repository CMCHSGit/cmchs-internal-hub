// Builds ONE file, the offline copy of the CHS Test Bench: the bench page with its fonts and every template inside it, so it opens by
// double-click in Chrome or Edge with no internet, no hub and no folder. Reports and settings are kept on that laptop (IndexedDB), as
// they are for the live bench. It is a snapshot: build a new one after the bench or a template changes and hand that out instead.
//
//   node apps/testbench/tools/build-offline.mjs [--out <folder>] [--date YYYY-MM-DD]
//
// Default output: <repo>/dist-offline/CHS-Test-Bench-offline-<date>.html (dist-offline/ is git-ignored). Nothing in the repo or the
// live site changes: bench/index.html is read, never written.
//
// What it does to a copy of the page, and nothing else:
//   1. fonts.css and the .woff2 files it points at become one inline <style> (data: URIs), so no file sits beside it;
//   2. every template (templates/*.json, as the hub publishes them) is embedded, with a small fetch() answer for 'templates/…', so the
//      page's own "published templates" code (Shared.loadPublished) reads them as it does on the live site;
//   3. Shared.init also loads them when no templates folder is connected (the live page only does that for Firefox), and does nothing
//      more when a folder is connected, so Chrome's shared-folder sync works as before;
//   4. a small "Offline copy, built <date>" label, so a stale copy can be told from a fresh one.
// Each step stops the build if the text it patches is not found, so a change to the bench can't silently produce a broken copy.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = (p) => fileURLToPath(new URL(p, import.meta.url))
const BENCH = here('../bench/index.html')
const FONTS_CSS = here('../bench/fonts.css')
const FONTS_DIR = here('../bench/fonts/')
const TEMPLATES = here('../templates/')
const ROOT = here('../../../')

const once = (text, needle, what) => {
  const i = text.indexOf(needle)
  if (i < 0 || text.indexOf(needle, i + needle.length) >= 0) throw new Error(`build-offline: expected exactly one ${what} in bench/index.html; the bench changed, update tools/build-offline.mjs`)
  return i
}
/** Replace the single occurrence of needle (a function, so `$` in the replacement is never special). */
const swap = (text, needle, replacement, what) => { const i = once(text, needle, what); return text.slice(0, i) + replacement + text.slice(i + needle.length) }
/** Text for inside a <script>: a literal "</" or "<!--" would end or confuse the element. */
const scriptSafe = (s) => s.replace(/<\//g, '<\\/').replace(/<!--/g, '<\\!--')

export function inlineFonts(css, readFont) {
  return css.replace(/url\((?:'|")?(fonts\/[^)'"]+\.woff2)(?:'|")?\)/g, (_, f) => `url(data:font/woff2;base64,${readFont(f.slice('fonts/'.length)).toString('base64')})`)
}

export function templatePack(dir = TEMPLATES) {
  const files = readdirSync(dir).filter((n) => /\.json$/i.test(n))
  const layoutName = '_Run a test layout.json'
  const pack = {}
  const entry = (file) => { const data = readFileSync(join(dir, file)); pack[file] = data.toString('utf8'); return { file, v: createHash('sha1').update(data).digest('hex').slice(0, 12) } }
  const index = { generated: 'offline copy', templates: files.filter((n) => !/^[._~]/.test(n)).map(entry), layout: files.includes(layoutName) ? entry(layoutName) : null }
  pack['index.json'] = JSON.stringify(index)
  return { pack, count: index.templates.length }
}

export function buildOffline({ date, bench = readFileSync(BENCH, 'utf8'), fontsCss = readFileSync(FONTS_CSS, 'utf8'), readFont = (f) => readFileSync(join(FONTS_DIR, f)), templates = templatePack() } = {}) {
  let html = bench

  // 1. fonts
  const link = '<link rel="stylesheet" href="fonts.css">'
  html = swap(html, link, `<style>\n${inlineFonts(fontsCss, readFont)}\n</style>`, 'fonts.css link')

  // 2. templates: a fetch() that answers 'templates/…' from the embedded copies and leaves every other request alone
  const shim = `<script>
/* Offline copy: the templates are inside this file. */
(function () {
  var T = ${scriptSafe(JSON.stringify(templates.pack))};
  var real = window.fetch ? window.fetch.bind(window) : null;
  window.fetch = function (url, opts) {
    if (typeof url === 'string' && url.indexOf('templates/') === 0) {
      var key; try { key = decodeURIComponent(url.slice(10)); } catch (e) { key = ''; }
      if (Object.prototype.hasOwnProperty.call(T, key)) return Promise.resolve(new Response(T[key], { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return Promise.resolve(new Response('', { status: 404 }));
    }
    return real ? real(url, opts) : Promise.reject(new Error('fetch is not available'));
  };
})();
</script>`
  const head = '</head>'
  html = swap(html, head, `${shim}\n</head>`, '</head>')

  // 3. load the embedded templates when no folder is connected
  html = swap(html,
    "if (!this.access) { this.state = 'none'; this.render(); return; }",
    "if (!this.access) { this.state = 'none'; this.render(); await this.loadPublished(); return; }",
    'Shared.init "no folder" branch')

  // 4. the stamp: title and a small label
  const stamp = `Offline copy, built ${date}`
  html = html.replace(/<title>([^<]*)<\/title>/i, (_, t) => `<title>${t} (offline ${date})</title>`)
  const label = `<div id="offlineStamp" style="position:fixed;right:8px;bottom:6px;z-index:2147483000;font:11px/1.2 system-ui,sans-serif;color:#888;background:rgba(255,255,255,.75);padding:2px 6px;border-radius:4px;pointer-events:none">${stamp}</div>`
  html = swap(html, '</body>', `${label}\n</body>`, '</body>')
  return html
}

/** What must not be left in the copy: a file or address the page would have to fetch to start. */
export function leftovers(html) {
  const found = []
  if (/href="fonts\.css"/.test(html)) found.push('fonts.css link')
  if (/url\(\s*['"]?fonts\//.test(html)) found.push('font file reference')
  for (const m of html.matchAll(/<(?:script|link|img|iframe)\b[^>]*\b(?:src|href)\s*=\s*["'](https?:)?\/\/[^"']+/gi)) found.push(m[0].slice(0, 80))
  return found
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null }
  const now = new Date()   // the computer's own date, not UTC: a build at 9am in New Zealand must not be dated the day before
  const date = val('--date') || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { console.error('--date must look like 2026-11-25'); process.exit(1) }
  const out = val('--out') || join(ROOT, 'dist-offline')
  const templates = templatePack()
  const html = buildOffline({ date, templates })
  const bad = leftovers(html)
  if (bad.length) { console.error(`build-offline: the copy would still fetch: ${bad.join(', ')}`); process.exit(1) }
  mkdirSync(out, { recursive: true })
  const file = join(out, `CHS-Test-Bench-offline-${date}.html`)
  writeFileSync(file, html)
  console.log(`${file}\n  ${(Buffer.byteLength(html) / 1024 / 1024).toFixed(2)} MB, ${templates.count} templates, fonts inline`)
}
