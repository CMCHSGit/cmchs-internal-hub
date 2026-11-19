/* Reads a .zip held in memory, and gunzips a .gz, using the browser's own
   decompression (DecompressionStream). Nothing is written anywhere. Only the
   plain zip format (stored or deflated entries, not encrypted, no zip64): that
   is what a device's service export uses. */

const u16 = (b, p) => b[p] | (b[p + 1] << 8)
const u32 = (b, p) => (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0
const dec = new TextDecoder()

/** Decompresses `bytes` ('deflate-raw' for a zip entry, 'gzip' for a .gz). */
export async function inflate(bytes, format) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser can’t unpack zip files. Use a current Chrome, Edge or Firefox.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

export const isZip = (b) => b.length > 22 && b[0] === 0x50 && b[1] === 0x4b && (b[2] === 3 || b[2] === 5)
export const isGzip = (b) => b.length > 18 && b[0] === 0x1f && b[1] === 0x8b

/**
 * `[{ name, size, data }]` for the files in a zip. `want(name, size)` says whether an
 * entry is wanted: unwanted ones (screenshots, huge crash dumps) are never decompressed.
 * `skipped(name)` is told about those.
 */
export async function readZip(bytes, want = () => true, skipped = () => {}) {
  // the end-of-central-directory record is within the last 64 KB
  let e = -1
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { e = i; break }
  }
  if (e < 0) throw new Error('This is not a zip file (or it is damaged).')
  const count = u16(bytes, e + 10)
  let p = u32(bytes, e + 16)
  if (count === 0xffff || p === 0xffffffff) throw new Error('This zip is too big a format for the Log Reader (zip64). Unzip it first.')
  const out = []
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error('The zip file is damaged.')
    const flags = u16(bytes, p + 8), method = u16(bytes, p + 10)
    const csize = u32(bytes, p + 20), usize = u32(bytes, p + 24)
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32)
    const local = u32(bytes, p + 42)
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue
    if (!want(name, usize)) { skipped(name); continue }
    if (flags & 1) throw new Error('This zip is password protected. Unzip it first.')
    if (local + 30 > bytes.length || u32(bytes, local) !== 0x04034b50) throw new Error('The zip file is damaged.')
    const start = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28)
    if (start + csize > bytes.length) throw new Error('The zip file is cut short.')
    const raw = bytes.subarray(start, start + csize)
    let data
    if (method === 0) data = raw
    else if (method === 8) data = await inflate(raw, 'deflate-raw')
    else throw new Error('This zip uses a compression the Log Reader doesn’t know. Unzip it first.')
    out.push({ name, size: data.length, data })
  }
  return out
}
