// What changed in a build, per section, for build-info.json (scripts/build.mjs writes it; the README's
// "Updates: only what changed" explains why). Pure: the manifest in, plain data out, so tests can feed it
// made-up manifests. Node only (hashes); the page's side of it is shared/buildInfo.js.
import { createHash } from 'node:crypto'

const sha = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12)

/**
 * Every file a set of chunks needs, from Vite's manifest: the chunk itself, its stylesheets and the chunks
 * it imports. `dynamic` also follows `import()`s from inside it (a chunk a section loads on demand).
 */
export function closure(manifest, keys, { dynamic = true } = {}) {
  const files = new Set()
  const seen = new Set()
  const visit = (key) => {
    const chunk = manifest[key]
    if (!chunk || seen.has(key)) return
    seen.add(key)
    files.add(chunk.file)
    for (const css of chunk.css || []) files.add(css)
    for (const imp of chunk.imports || []) visit(imp)
    if (dynamic) for (const imp of chunk.dynamicImports || []) visit(imp)
  }
  keys.forEach(visit)
  return files
}

/**
 * build-info.json's content.
 *
 *  manifest   Vite's manifest for the app (dist/.vite/manifest.json)
 *  sections   { id: the manifest key of the section's entry }
 *  mainKey    the manifest key of the start page's script
 *  entryKeys  the manifest keys of the shell: that, and anything else that is not a section (shared/gate.js)
 *  shell      a short string that changes when anything in the shell does (build.mjs passes the hash of sw.js,
 *             which lists every file the shell precaches)
 *  extra      { id: string } for files that belong to one section but are not in the manifest
 *
 * A section's hash is made from the hashed file names of its chunk and everything it loads, minus what the
 * shell already loads. Vite puts a content hash in every file name, so a section whose code, styles or any
 * chunk it uses changed gets a new hash, and one that did not keeps its old one. A chunk two sections share
 * is in both of them, so changing it marks both.
 */
export function buildInfo({ manifest, sections, mainKey, entryKeys, shell, extra = {} }) {
  const shellAll = closure(manifest, entryKeys)
  const shellStatic = closure(manifest, entryKeys, { dynamic: false })
  const out = {}
  for (const id of Object.keys(sections).sort()) {
    const key = sections[id]
    const entry = manifest[key]
    if (!entry) throw new Error(`build-info: no chunk for section "${id}" (${key}) in the manifest`)
    // Rollup can fold an entry with little code of its own into a chunk everything shares. Then the section's
    // file is the shell's, a change to it would reload everyone, and the hash below would be of nothing.
    if (shellAll.has(entry.file)) throw new Error(`build-info: section "${id}" (${key}) was merged into a chunk the shell loads (${entry.file}); give it code of its own or keep what it shares in a named chunk (vite.config.js manualChunks)`)
    const own = [...closure(manifest, [key])].filter((f) => !shellAll.has(f)).sort()
    // What the page must fetch before the section can start: its own stylesheets (nothing injects them
    // for a chunk that was not imported with import()) and the chunks it imports first.
    const needed = closure(manifest, [key], { dynamic: false })
    const css = [...needed].filter((f) => f.endsWith('.css') && !shellStatic.has(f)).sort()
    const preload = [...needed].filter((f) => f.endsWith('.js') && f !== entry.file && !shellStatic.has(f)).sort()
    out[id] = { hash: sha(own.join('\n') + '\n' + (extra[id] || '')), js: entry.file, css, preload }
  }
  return {
    v: 1,
    shell,
    // The start page's own script: a page checks it is the one this file describes (shared/updates.js).
    entry: manifest[mainKey]?.file || '',
    sections: out,
  }
}
