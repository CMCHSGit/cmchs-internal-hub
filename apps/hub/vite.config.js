import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * Two older looks are kept to their own part of the one app until they are
 * merged into the kit (shared/ui), which has its own .btn, .badge, .card, .page,
 * .tabs and so on under the same names. Without this, whichever stylesheet
 * loaded last would restyle the other's. (INTEGRATION-PLAN.md step 2.)
 *
 *  - The hub's own (hub.css, shared/tokens/base.css): inside its own pages,
 *    marked .hub-page. :root and html stay global (variables, page defaults).
 *  - The staff schedule's (index.css, settings.css), which Admin settings uses:
 *    inside that section's element only, main.section[data-section="admin"]
 *    (not [data-section] alone: App.jsx puts that on <body> too). Its :root
 *    variables go there too. The kit it @imports is dropped from this copy:
 *    the shell has already loaded it once, and a second, later copy would
 *    beat the hub's.
 *
 * `body` becomes body[data-section="…"] (App.jsx sets it); the light/dark
 * prefix stays in front of the scope.
 */
const SCOPES = [
  { file: /[\\/](apps[\\/]hub[\\/]src[\\/]hub\.css|shared[\\/]tokens[\\/]base\.css)$/,
    inside: '.hub-page', section: 'hub', globalRoot: true },
  // :where() adds no specificity, so inside Admin these rules win and lose
  // against the kit exactly as they did when it was a page of its own.
  { file: /[\\/]apps[\\/]schedule[\\/]src[\\/](index|settings)\.css$/,
    inside: ':where(main.section[data-section="admin"])', section: 'admin', globalRoot: false },
]
function scopeHubCss() {
  const scoper = ({ inside, section, globalRoot }) => function scope(sel) {
    const s = sel.trim()
    if (s === ':root' || s === 'html') return globalRoot ? s : inside
    if (s === '*' || s === '*::before' || s === '*::after') return globalRoot ? s : `${inside} ${s}`
    const dark = /^:root\[data-theme="dark"\]/.exec(s)
    if (dark) {
      const rest = s.slice(dark[0].length).trim()
      return rest ? `${dark[0]} ${scope(rest)}` : (globalRoot ? s : `${dark[0]} ${inside}`)
    }
    if (/^body\b/.test(s)) return s.replace(/^body/, `body[data-section="${section}"]`)
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

// The hub is served at "/". Two entries:
//  - index.html: the hub itself, and the shell the moved tools open inside
//  - src/gate.js: the sign-in check that plain pages (the /service tools)
//    load as /shared/gate.js, so it keeps a fixed, unhashed name.
export default defineConfig({
  base: '/',
  // One .env at the repo root for every app
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  plugins: [react()],
  css: { postcss: { plugins: [scopeHubCss()] } },
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
