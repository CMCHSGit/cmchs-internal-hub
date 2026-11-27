import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { OCR_BASE, OCR_FILES } from '../../shared/ocr-assets.js'
import { SECTION_SOURCES } from './src/section-sources.js'

/**
 * Two older looks are kept to their own part of the one app until they are
 * merged into the kit (shared/ui), which has its own .btn, .badge, .card, .page,
 * .tabs and so on under the same names. Without this, whichever stylesheet
 * loaded last would restyle the other's. (INTEGRATION-PLAN.md step 2.)
 *
 *  - The hub's own (hub.css, shared/tokens/base.css): inside its own pages,
 *    marked .hub-page. :root and html stay global (variables, page defaults).
 *  - The staff schedule's (index.css, settings.css), which Settings uses too
 *    (its admin pages are built from it): inside those two sections' element
 *    only, main.section[data-section=…]
 *    (not [data-section] alone: App.jsx puts that on <body> too). Its :root
 *    variables go there too. The kit it @imports is dropped from this copy:
 *    the shell has already loaded it once, and a second, later copy would
 *    beat the hub's.
 *
 * `body` becomes body[data-section=…] (App.jsx sets it); the light/dark
 * prefix stays in front of the scope.
 */
const SCOPES = [
  { file: /[\\/](apps[\\/]hub[\\/]src[\\/]hub\.css|shared[\\/]tokens[\\/]base\.css)$/,
    inside: '.hub-page', body: 'body[data-section="hub"]', globalRoot: true },
  // :where() adds no specificity, so inside these sections the rules win and
  // lose against the kit exactly as they did when each was a page of its own.
  { file: /[\\/]apps[\\/]schedule[\\/]src[\\/](index|settings)\.css$/,
    inside: ':where(main.section:is([data-section="schedule"], [data-section="settings"]))',
    body: 'body:is([data-section="schedule"], [data-section="settings"])', globalRoot: false },
]
function scopeHubCss() {
  const scoper = ({ inside, body, globalRoot }) => function scope(sel) {
    const s = sel.trim()
    if (s === ':root' || s === 'html') return globalRoot ? s : inside
    if (s === '*' || s === '*::before' || s === '*::after') return globalRoot ? s : `${inside} ${s}`
    const dark = /^:root\[data-theme="dark"\]/.exec(s)
    if (dark) {
      const rest = s.slice(dark[0].length).trim()
      return rest ? `${dark[0]} ${scope(rest)}` : (globalRoot ? s : `${dark[0]} ${inside}`)
    }
    if (/^body\b/.test(s)) return s.replace(/^body/, body)
    return `${inside} ${s}`
  }
  const fileOf = (node, result) => node.source?.input?.file || result.opts.from || ''
  return {
    postcssPlugin: 'scope-hub-css',
    Once(root, { result }) {
      const top = SCOPES.find(s => s.file.test(result.opts.from || ''))
      if (!top) return
      // Rules @imported into a scoped file from elsewhere (the kit) are left out.
      root.walk((node) => {
        if ((node.type === 'rule' || node.type === 'atrule') && !SCOPES.some(s => s.file.test(fileOf(node, result)))) node.remove()
      })
      root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
        const scope = SCOPES.find(s => s.file.test(fileOf(rule, result))) || top
        rule.selectors = rule.selectors.map(scoper(scope))
      })
    },
  }
}
scopeHubCss.postcss = true

/**
 * `virtual:hub-sections` (apps/hub/src/sections.js): how the shell gets a section's code.
 * `npm run dev`: a plain import of each section's source, so Vite's usual dev server and hot reload apply.
 * A build: nothing (`null`); each section is its own build entry instead (emitted below) and the shell finds
 * its file in build-info.json, so no section's hashed file name is written into the shell. Entries, not import()s,
 * so that changing one section changes only that section's files and leaves the shell's (and so the service
 * worker) as they were.
 *
 * They are emitted here rather than listed in `input` because of `preserveSignature`: Vite drops an entry's
 * exports that nothing imports, which is right for a page's script and wrong for a section, whose default export
 * the shell imports at run time by a name Rollup cannot see. Keeping every entry's exports
 * (`preserveEntrySignatures`) would have changed how the start page's own script is built; this keeps it to the
 * sections. scripts/build.mjs checks every section file still exports its screen.
 */
const repoFile = (file) => fileURLToPath(new URL('../../' + file, import.meta.url))
function hubSections() {
  const id = 'virtual:hub-sections'
  let serve = false
  return {
    name: 'hub-sections',
    configResolved(config) { serve = config.command === 'serve' },
    buildStart() {
      if (serve) return
      for (const [name, file] of Object.entries(SECTION_SOURCES)) {
        this.emitFile({ type: 'chunk', id: repoFile(file), name: 'section-' + name, preserveSignature: 'strict' })
      }
    },
    resolveId(source) { return source === id ? '\0' + id : undefined },
    load(source) {
      if (source !== '\0' + id) return undefined
      if (!serve) return 'export const loaders = null'
      const lines = Object.entries(SECTION_SOURCES).map(([name, file]) =>
        `  ${JSON.stringify(name)}: () => import(${JSON.stringify('/@fs/' + repoFile(file).replace(/\\/g, '/'))}),`)
      return `export const loaders = {\n${lines.join('\n')}\n}`
    },
  }
}

/** `npm run dev` only: the Test Bench's page at /bench-app/ (scripts/build.mjs copies it there in the real site). */
function serveBench() {
  const root = fileURLToPath(new URL('../testbench/bench', import.meta.url))
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.woff2': 'font/woff2' }
  return {
    name: 'serve-test-bench',
    configureServer(server) {
      server.middlewares.use('/bench-app', (req, res, next) => {
        const rel = normalize(decodeURIComponent((req.url || '/').split('?')[0])).replace(/^([\/])+/, '') || 'index.html'
        const file = join(root, rel.endsWith('/') ? rel + 'index.html' : rel)
        if (rel.includes('..') || !existsSync(file) || !statSync(file).isFile()) return next()
        res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
  }
}

/** `npm run dev` only: the text recognition's files at /ocr/<version>/ (scripts/build.mjs copies them there in the real site). */
function serveOcr() {
  const root = fileURLToPath(new URL('../../node_modules', import.meta.url))
  return {
    name: 'serve-ocr-files',
    configureServer(server) {
      server.middlewares.use(OCR_BASE, (req, res, next) => {
        const name = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '')
        const hit = OCR_FILES.find(([n]) => n === name)
        const file = hit && join(root, hit[1])
        if (!file || !existsSync(file)) return next()
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        createReadStream(file).pipe(res)
      })
    },
  }
}

// The hub is served at "/". Two entries:
//  - index.html: the hub itself, and the shell the moved tools open inside
//  - src/gate.js: the sign-in check that plain pages (the /service tools)
//    load as /shared/gate.js, so it keeps a fixed, unhashed name.
// Plus one entry per section (section-sources.js), which hubSections() emits: the shell finds each one's
// file through build-info.json instead of naming it (sections.js).
export default defineConfig({
  base: '/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react(), hubSections(), serveBench(), serveOcr()],
  css: { postcss: { plugins: [scopeHubCss()] } },
  build: {
    // dist/.vite/manifest.json: scripts/build.mjs reads it to precache only
    // what the start page loads, then deletes it.
    manifest: true,
    rollupOptions: {
      // (The sections are entries too: hubSections() above emits them.)
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        gate: fileURLToPath(new URL('./src/gate.js', import.meta.url)),
      },
      output: {
        entryFileNames: chunk => chunk.name === 'gate' ? 'shared/gate.js' : 'assets/[name]-[hash].js',
        // React is used by the shell and every section. Left to Rollup, it can end up inside a section's own
        // file when that section has little code of its own (the old New equipment redirect did), and then
        // that file is the shell's and a change to the section would change the shell. scripts/build-info.mjs
        // fails the build if any section is ever folded into shared code like that.
        manualChunks: (id) => /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined,
      },
    },
  },
})
