/* Opening a whole folder: walk it (a dropped folder, or one chosen with the
   "Open folder" button), and sort what is in it into "exports": each log.tar /
   .zip / .tar.gz is one device's export, and loose log files in a folder are
   one more. Nothing is read until a person picks an export, so choosing a big
   folder is quick. Everything stays on this device.

   Items are `{ file, path, size }`, path relative to the folder with "/". */

import { wanted } from './load.js'

/** Folders that never hold device logs. */
const IGNORE_DIR = /(^|\/)(node_modules|\.git|__pycache__|\$RECYCLE\.BIN|System Volume Information)(\/|$)/i
const ARCHIVE = /\.(tar|zip|tgz|tar\.gz)$/i
const LOOSE = /\.(log|txt|lzo)$|\.\d+$/i
const GENERIC = /^(log|logs|log_.*|var)\.(tar|zip|tar\.gz|tgz)$|^log\.tar$/i
const MAX_FILE = 1536 * 1048576 // a browser can't hold a bigger single file in memory
export const MAX_EXPORTS = 300

const base = (p) => p.split('/').pop()
const dirOf = (p) => p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''
const lastDir = (d) => d ? d.split('/').pop() : ''

/**
 * Sorts the files of a folder into exports:
 *   `{ id, name, kind: 'archive' | 'logs', where, files, size }[]` (at most MAX_EXPORTS) and `skipped` (count of files not openable).
 * A folder with one archive in it names the export after the folder when the archive is just "log.tar".
 */
export function findExports(items) {
  const by = new Map() // dir → { archives, logs }
  let skipped = 0
  for (const it of items) {
    const p = it.path.replace(/\\/g, '/')
    const name = base(p)
    if (IGNORE_DIR.test(p) || it.size > MAX_FILE) { skipped++; continue }
    const d = dirOf(p)
    if (ARCHIVE.test(name) && wanted(p)) {
      if (!by.has(d)) by.set(d, { archives: [], logs: [] })
      by.get(d).archives.push({ ...it, path: p })
    } else if (LOOSE.test(name) && wanted(p)) {
      if (!by.has(d)) by.set(d, { archives: [], logs: [] })
      by.get(d).logs.push({ ...it, path: p })
    } else skipped++
  }
  const out = []
  const add = (e) => out.push({ ...e, size: e.files.reduce((n, f) => n + f.size, 0) })
  for (const [d, { archives, logs }] of [...by].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    for (const a of archives.sort((x, y) => x.path.localeCompare(y.path))) {
      const nm = base(a.path)
      add({ kind: 'archive', name: GENERIC.test(nm) && d ? `${lastDir(d)}` : nm, detail: GENERIC.test(nm) && d ? nm : '', where: d, files: [a] })
    }
    if (logs.length) add({ kind: 'logs', name: archives.length ? `Loose log files in ${lastDir(d) || 'the folder'}` : (lastDir(d) || 'Loose log files'), detail: `${logs.length} file${logs.length === 1 ? '' : 's'}`, where: d, files: logs })
  }
  out.forEach((e, i) => { e.id = i })
  return { exports: out.slice(0, MAX_EXPORTS), skipped, more: Math.max(0, out.length - MAX_EXPORTS) }
}

/** Items from a folder chosen with `<input webkitdirectory>` (or any files chosen with an input). */
export const itemsFromInput = (fileList) => [...fileList].map(f => ({ file: f, path: f.webkitRelativePath || f.name, size: f.size }))

const readBatch = (reader) => new Promise((res, rej) => reader.readEntries(res, rej))
const fileOf = (entry) => new Promise((res, rej) => entry.file(res, rej))

/**
 * Items from a drop (files and/or folders). Must be called inside the drop
 * event, before any await: the browser forgets the dropped items after that.
 */
export function itemsFromDrop(dataTransfer) {
  const entries = []
  for (const it of dataTransfer.items || []) {
    const e = it.kind === 'file' && it.webkitGetAsEntry ? it.webkitGetAsEntry() : null
    if (e) entries.push(e)
  }
  if (!entries.length) return Promise.resolve(itemsFromInput(dataTransfer.files || []))
  return (async () => {
    const out = []
    const walk = async (entry, prefix) => {
      if (entry.isFile) {
        const f = await fileOf(entry)
        out.push({ file: f, path: prefix + entry.name, size: f.size })
      } else if (entry.isDirectory) {
        if (IGNORE_DIR.test(prefix + entry.name)) return
        const reader = entry.createReader()
        for (;;) { // readEntries returns a batch at a time (about 100)
          const batch = await readBatch(reader)
          if (!batch.length) break
          for (const child of batch) await walk(child, prefix + entry.name + '/')
        }
      }
    }
    for (const e of entries) await walk(e, '')
    return out
  })()
}
