/* Opens what a person drops on the page (a device's log.tar, or loose .log /
   .txt / .lzo files) into groups of log "families" (all the rotations of one
   log). Everything stays in this page's memory: nothing is uploaded, and
   nothing is written to storage, so closing the tab forgets it all. */

import { readTar } from './tar.js'
import { isLzop, unlzop } from './lzo.js'
import { familyOf, mergeLines, parseLog, rotationOf } from './lines.js'

/** Entries in an archive that are never text logs. */
const SKIP = /\.(xdb|dat|ini|conf|bin|gz|zip|tar)$|(^|\/)(wtmp|\d+)$/i
const TEXTY = /\.(log|txt|lzo)$|\.\d+$/i

const tick = () => new Promise(r => setTimeout(r, 0))

/**
 * `{ source, families: [{ name, files: [{ name, rotation, size, bytes }] }] }`.
 * `onStatus(text)` is told what is happening. Throws an Error with a plain message.
 */
export async function openFiles(fileList, onStatus = () => {}) {
  const files = [...fileList]
  if (!files.length) throw new Error('No file was chosen.')
  const entries = []
  let source = files.length === 1 ? files[0].name : `${files.length} files`
  for (const f of files) {
    onStatus(`Reading ${f.name}…`)
    await tick()
    const buf = new Uint8Array(await f.arrayBuffer())
    if (/\.tar$/i.test(f.name) || (buf.length > 512 && buf[257] === 0x75 && buf[258] === 0x73)) { // "us" of ustar
      for (const e of readTar(buf)) entries.push({ name: e.name, bytes: e.data })
    } else if (/\.(gz|zip|7z|rar)$/i.test(f.name)) {
      throw new Error(`${f.name} is a compressed archive. Unzip it first, then open the log.tar (or the log files) inside.`)
    } else {
      entries.push({ name: f.name, bytes: buf })
    }
  }
  const by = new Map()
  for (const e of entries) {
    if (SKIP.test(e.name) || !TEXTY.test(e.name.split('/').pop()) && e.name.includes('.')) continue
    const family = familyOf(e.name)
    if (!by.has(family)) by.set(family, [])
    by.get(family).push({ name: e.name.split('/').pop(), rotation: rotationOf(e.name), size: e.bytes.length, bytes: e.bytes })
  }
  const families = [...by].map(([name, fs]) => ({ name, files: fs.sort((a, b) => b.rotation - a.rotation) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  if (!families.length) throw new Error('No log files were found in that.')
  return { source, families }
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
    const parsed = parseLog(dec.decode(bytes), i)
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
