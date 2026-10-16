import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

/**
 * The hub's own look (hub.css, and shared/tokens/base.css) applies only inside
 * its own pages, marked .hub-page. The hub is now the shell that other tools
 * open inside (INTEGRATION-PLAN.md step 2), and those tools use the shared kit
 * (shared/ui), which has its own .btn, .badge, .card and so on under the same
 * names. Without this, whichever stylesheet loaded last would restyle the
 * other's buttons. Merging the two looks into one is a later step.
 *
 * Every selector gets .hub-page in front; `body` becomes body[data-section="hub"]
 * (App.jsx sets it); :root (variables) and the light/dark prefix stay outside.
 */
const SCOPED = /[\\/](apps[\\/]hub[\\/]src[\\/]hub\.css|shared[\\/]tokens[\\/]base\.css)$/
function scopeHubCss() {
  const scope = (sel) => {
    const s = sel.trim()
    if (s === ':root' || s === 'html' || s === '*' || s === '*::before' || s === '*::after') return s
    const dark = /^:root\[data-theme="dark"\]\s+/.exec(s)
    if (dark) return dark[0] + scope(s.slice(dark[0].length))
    if (/^body\b/.test(s)) return s.replace(/^body/, 'body[data-section="hub"]')
    return '.hub-page ' + s
  }
  return {
    postcssPlugin: 'scope-hub-css',
    Once(root, { result }) {
      if (!SCOPED.test(result.opts.from || '')) return
      root.walkRules((rule) => {
        if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
        rule.selectors = rule.selectors.map(scope)
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
