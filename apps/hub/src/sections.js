// How the shell gets a section's code: `loadSection('testbench')` resolves to that section's module
// (its default export is the screen), for React.lazy in App.jsx.
//
// In `npm run dev` Vite serves the source files and this is a plain import. In a built site each section
// is its own entry (vite.config.js), and the shell does NOT name its file: a hashed name written into
// the shell would make the shell's own file change whenever any section does, and with it the service
// worker, which reloads everyone. Instead the file name comes from /build-info.json (shared/updates.js),
// the one the page started with. That is also what lets a deploy change one section without anyone else
// reloading: see "Updates: only what changed" in the README.
import { loaders } from 'virtual:hub-sections'
import { sectionFiles } from '../../../shared/buildInfo.js'
import { reloadIfStale } from '../../../shared/register-sw.js'
import { refreshStale, startedInfo } from '../../../shared/updates.js'

export function loadSection(id) {
  return loaders ? loaders[id]() : loadBuilt(id)
}

async function loadBuilt(id) {
  const info = await startedInfo()
  // A deploy has changed this section since the page loaded (a section already loaded earlier is caught by
  // App.jsx): reload onto the new version rather than load files the deploy may have removed. The loading
  // state stays up until the page goes.
  if (reloadIfStale(id)) return new Promise(() => {})
  const files = sectionFiles(info, id)
  if (!files) throw new Error(`The hub could not read its list of parts (build-info.json) to open "${id}".`)
  files.preload.forEach(modulePreload)
  await Promise.all(files.css.map(stylesheet))
  const mod = await import(/* @vite-ignore */ files.js)
  // Someone opening a section is a good moment to ask whether it has changed since: if so, the page reloads
  // once they have paused (shared/register-sw.js), instead of staying on the old one until the next check.
  refreshStale({ minGapMs: 15_000 })
  return mod
}

function modulePreload(href) {
  if (document.querySelector(`link[rel="modulepreload"][href="${href}"]`)) return
  const link = document.createElement('link')
  link.rel = 'modulepreload'
  link.href = href
  document.head.appendChild(link)
}

// A section's stylesheets are not loaded for it (nothing import()ed it with Vite's helper): wait for them
// here so it does not show unstyled. A file a deploy has removed fails like Vite's own would, which the
// "didn't load" message (App.jsx) answers with an update.
function stylesheet(href) {
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = href
    link.onload = resolve
    link.onerror = () => reject(new Error(`Unable to preload CSS for ${href}`))
    document.head.appendChild(link)
  })
}
