/* Opens what a person drops on the page (a device's log.tar or service .zip,
   a .tar.gz, or loose .log / .txt / .lzo files) into groups of log "families"
   (all the rotations of one log). Everything stays in this page's memory:
   nothing is uploaded, and nothing is written to storage, so closing the tab
   forgets it all.

   Only text logs are opened. Screenshots, databases, binary data and crash
   dumps (core files: memory images that can hold anything) are never read;
   they are counted so the page can say so. */

import { readTar } from './tar.js'
import { isLzop, unlzop } from './lzo.js'
import { inflate, isGzip, isZip, readZip } from './zip.js'
import { familyOf, mergeLines, parseLog, rotationOf } from './lines.js'

/** Things that are never read as logs: pictures, databases, binary data, crash dumps. */
const SKIP = /\.(xdb|dat|ini|conf|bin|7z|rar|jpe?g|png|gif|bmp|blg|db|sqlite|pcap|mp4)$|\.core(\.(lzo|gz))?$|(^|\/)coredump\/|(^|\/)(wtmp|\d+)$/i
const TEXTY = /\.(log|txt|lzo)$|\.\d+$/i
const MAX_ENTRY = 300 * 1048576 // a single file bigger than this (compressed or not) is left alone
const tick = () => new Promise(r => setTimeout(r, 0))

const base = (name) => name.split('/').pop()
export const wanted = (name) => !SKIP.test(name) && (TEXTY.test(base(name)) || !base(name).includes('.') || /\.(zip|tar|gz|tgz)$/i.test(name))

const isTar = (name, b) => /\.tar$/i.test(name) || (b.length > 512 && b[257] === 0x75 && b[258] === 0x73 && b[259] === 0x74) // "ust"

/** A date written in an export's name (2026_10_15 or 2026-10-15), as a time; NaN if none. */
export function dateInName(name) {
  const m = /(20\d\d)[-_](\d\d)[-_](\d\d)/.exec(name)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN
}

/**
 * Walks an archive (tar, zip, gz, nested) into `{ name, bytes, ref }` entries.
 * `ref` is roughly when the file was written (for year-less log times).
 */
async function expand(name, bytes, ref, out, skipped, depth = 0) {
  if (depth > 3) { skipped.push(base(name)); return }
  if (isZip(bytes) && /\.zip$/i.test(name)) {
    const entries = await readZip(bytes, (n, size) => wanted(n) && size <= MAX_ENTRY, n => skipped.push(base(n)))
    for (const e of entries) await expand(e.name, e.data, ref, out, skipped, depth + 1)
    return
  }
  if (isGzip(bytes)) {
    if (/\.core\.gz$/i.test(name) || bytes.length > MAX_ENTRY) { skipped.push(base(name)); return }
    const raw = await inflate(bytes, 'gzip')
    await expand(name.replace(/\.gz$/i, '').replace(/\.tgz$/i, '.tar'), raw, ref, out, skipped, depth + 1)
    return
  }
  if (isTar(name, bytes)) {
    for (const e of readTar(bytes)) {
      if (!wanted(e.name) || e.size > MAX_ENTRY) { skipped.push(base(e.name)); continue }
      // a file's own date is better than the archive's, unless the device's clock was never set
      const own = e.mtime * 1000
      await expand(e.name, e.data, own > Date.UTC(2015, 0, 1) && own < Date.now() + 864e5 ? own : ref, out, skipped, depth + 1)
    }
    return
  }
  if (!wanted(name)) { skipped.push(base(name)); return }
  out.push({ name, bytes, ref })
}

/**
 * `{ source, families: [{ name, files }], skipped }`. `onStatus(text)` is told what is happening.
 * Throws an Error with a plain message.
 */
export async function openFiles(fileList, onStatus = () => {}) {
  const files = [...fileList]
  if (!files.length) throw new Error('No file was chosen.')
  const entries = [], skipped = []
  const source = files.length === 1 ? files[0].name : `${files.length} files`
  for (const f of files) {
    onStatus(`Reading ${f.name}…`)
    await tick()
    const buf = new Uint8Array(await f.arrayBuffer())
    const named = dateInName(f.name)
    const ref = Number.isFinite(named) ? named : (f.lastModified || Date.now())
    await expand(f.name, buf, ref, entries, skipped)
  }
  const by = new Map()
  for (const e of entries) {
    const family = familyOf(e.name)
    if (!by.has(family)) by.set(family, [])
    by.get(family).push({ name: base(e.name), rotation: rotationOf(e.name), size: e.bytes.length, bytes: e.bytes, ref: e.ref })
  }
  const families = [...by].map(([name, fs]) => ({ name, files: fs.sort((a, b) => b.rotation - a.rotation) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  if (!families.length) throw new Error('No log files were found in that.')
  return { source, families, skipped }
}

const dec = new TextDecoder('utf-8') // bad bytes become U+FFFD, never an error

/** Decompresses and parses every file of a family, once; the result is kept on the family object (in memory only). */
export async function loadFamily(fam, onStatus = () => {}) {
  if (fam.lines) return fam.lines
  const lists = []
  for (const [i, f] of fam.files.entries()) {
    onStatus(`Reading ${f.name}…`)
    await tick()
    let bytes = f.bytes
    if (isLzop(bytes)) {
      try { bytes = unlzop(bytes) } catch (e) { throw new Error(`${f.name}: ${e.message}`) }
    }
    f.text = bytes.length
    const parsed = parseLog(dec.decode(bytes), i, { ref: f.ref })
    for (const l of parsed) { l.fam = fam.name; l.fileName = f.name }
    lists.push(parsed)
  }
  const lines = mergeLines(lists)
  fam.lines = lines
  fam.range = lines.length ? rangeOf(lines) : null
  return lines
}

/** First and last real (non-1970) times in a list. */
function rangeOf(lines) {
  let a = Infinity, b = -Infinity
  for (const l of lines) if (!l.early && Number.isFinite(l.t)) { if (l.t < a) a = l.t; if (l.t > b) b = l.t }
  return a <= b ? { from: a, to: b } : null
}
