/* Reads a tar archive that is already in memory (a Uint8Array) and lists the
   files in it. Nothing is written anywhere: each entry's `data` is a view into
   the same bytes. Handles the plain/ustar header, the ustar "prefix" field, GNU
   long names ('L' entries) and pax headers ('x', for long names). */

const dec = new TextDecoder()

const str = (b, from, len) => {
  const s = b.subarray(from, from + len)
  const z = s.indexOf(0)
  return dec.decode(z < 0 ? s : s.subarray(0, z))
}

/** Octal (or GNU base-256) number in a header field. */
function num(b, from, len) {
  if (b[from] & 0x80) { // base-256, for files over 8 GB (never here, but cheap)
    let n = b[from] & 0x7f
    for (let i = 1; i < len; i++) n = n * 256 + b[from + i]
    return n
  }
  const s = str(b, from, len).trim()
  return s ? parseInt(s, 8) : 0
}

/** `[{ name, size, data }]` for the regular files in the archive. Throws if it isn't a tar. */
export function readTar(bytes) {
  const out = []
  let p = 0, longName = null
  const n = bytes.length
  while (p + 512 <= n) {
    const h = bytes.subarray(p, p + 512)
    if (h.every(x => x === 0)) break // end-of-archive marker
    // The checksum is the cheapest way to tell a tar from anything else.
    let sum = 0
    for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i]
    if (sum !== num(h, 148, 8)) throw new Error('This is not a tar archive (or it is damaged).')
    const size = num(h, 124, 12)
    const type = String.fromCharCode(h[156] || 48)
    let name = str(h, 0, 100)
    const magic = str(h, 257, 6)
    if (magic.startsWith('ustar')) {
      const prefix = str(h, 345, 155)
      if (prefix) name = prefix + '/' + name
    }
    const start = p + 512
    if (start + size > n) throw new Error('The tar file is cut short.')
    const data = bytes.subarray(start, start + size)
    p = start + Math.ceil(size / 512) * 512
    if (type === 'L') { longName = str(data, 0, data.length); continue }
    if (type === 'x') { // pax: "len key=value\n" records; only "path" matters
      const m = /\d+ path=([^\n]*)\n/.exec(dec.decode(data))
      if (m) longName = m[1]
      continue
    }
    if (longName) { name = longName; longName = null }
    if (type === '0' || type === '\0' || type === '7') out.push({ name, size, data })
  }
  return out
}
