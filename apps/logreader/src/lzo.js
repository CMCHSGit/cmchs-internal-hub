/* lzop (.lzo) files: the device rotates its big logs into these. `unlzop` reads
   the container and decompresses each block with LZO1X (a port of the small
   decompressor Jonathan's earlier hand-over note used, tested against it on a
   real export). Everything is in memory; nothing is written. Corrupt input
   throws instead of returning something plausible. */

const MAGIC = [0x89, 0x4c, 0x5a, 0x4f, 0x00, 0x0d, 0x0a, 0x1a, 0x0a]

const be32 = (b, p) => ((b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]) >>> 0
const be16 = (b, p) => (b[p] << 8) | b[p + 1]

export const isLzop = (b) => b.length > 9 && MAGIC.every((m, i) => b[i] === m)

/** Decompresses one LZO1X block into `out` (exactly `outLen` bytes are expected). */
export function lzo1x(src, out, outLen) {
  const n = src.length
  let ip = 0, op = 0
  // 0 = main, 1 = after literals ("lit"), 2 = after a match that carried 1-3 trailing literals ("trail")
  let state = 0
  const need = (k) => { if (ip + k > n) throw new Error('The compressed data is cut short.') }
  const copyLit = (k) => {
    need(k)
    if (op + k > outLen) throw new Error('The compressed data is damaged (too long).')
    out.set(src.subarray(ip, ip + k), op); op += k; ip += k
  }
  need(1)
  let t = src[0]
  if (t > 17) { ip = 1; t -= 17; copyLit(t); state = t < 4 ? 2 : 1 }
  for (;;) {
    need(1)
    t = src[ip++]
    let m, len, trail
    if (t < 16) {
      if (state === 0) {
        if (t === 0) {
          while (true) { need(1); if (src[ip] !== 0) break; t += 255; ip++ }
          t += 15 + src[ip++]
        }
        copyLit(t + 3); state = 1
        continue
      }
      need(1)
      if (state === 1) { m = op - 0x801 - (t >> 2) - (src[ip++] << 2); len = 3 }
      else { m = op - 1 - (t >> 2) - (src[ip++] << 2); len = 2 }
      trail = t & 3
    } else if (t >= 64) {
      need(1)
      m = op - 1 - ((t >> 2) & 7) - (src[ip++] << 3)
      len = (t >> 5) + 1
      trail = t & 3
    } else if (t >= 32) {
      let l = t & 31
      if (l === 0) {
        while (true) { need(1); if (src[ip] !== 0) break; l += 255; ip++ }
        l += 31 + src[ip++]
      }
      need(2)
      m = op - 1 - (src[ip] >> 2) - (src[ip + 1] << 6)
      trail = src[ip] & 3
      ip += 2
      len = l + 2
    } else {
      let l = t & 7
      const base = op - ((t & 8) << 11)
      if (l === 0) {
        while (true) { need(1); if (src[ip] !== 0) break; l += 255; ip++ }
        l += 7 + src[ip++]
      }
      need(2)
      m = base - (src[ip] >> 2) - (src[ip + 1] << 6)
      trail = src[ip] & 3
      ip += 2
      if (m === op) { // end-of-stream marker
        if (op !== outLen) throw new Error('The compressed data is damaged (wrong length).')
        return
      }
      m -= 0x4000
      len = l + 2
    }
    if (m < 0 || op + len > outLen) throw new Error('The compressed data is damaged.')
    for (let i = 0; i < len; i++) out[op++] = out[m + i]
    if (trail) { copyLit(trail); state = 2 } else state = 0
  }
}

/** The decompressed bytes of an lzop file. */
export function unlzop(data) {
  if (!isLzop(data)) throw new Error('Not an lzop file.')
  let p = 9
  const ver = be16(data, p); p += 4
  if (ver >= 0x0940) p += 2
  p += 1 // method
  if (ver >= 0x0940) p += 1 // level
  const flags = be32(data, p); p += 4
  if (flags & 0x800) p += 4 // filter
  p += 4 // mode
  p += 4 // mtime (low)
  if (ver >= 0x0940) p += 4 // mtime (high)
  p += 1 + data[p] // name
  p += 4 // header checksum
  const dsum = (flags & 0x1) || (flags & 0x100)
  const csum = (flags & 0x2) || (flags & 0x200)
  const blocks = []
  let total = 0
  for (;;) {
    if (p + 4 > data.length) throw new Error('The lzop file is cut short.')
    const u = be32(data, p); p += 4
    if (u === 0) break
    if (p + 4 > data.length) throw new Error('The lzop file is cut short.')
    const c = be32(data, p); p += 4
    if (dsum) p += 4
    if (csum && c < u) p += 4
    if (p + c > data.length) throw new Error('The lzop file is cut short.')
    const blk = data.subarray(p, p + c); p += c
    if (c === u) blocks.push(blk)
    else { const o = new Uint8Array(u); lzo1x(blk, o, u); blocks.push(o) }
    total += u
  }
  if (blocks.length === 1) return blocks[0]
  const out = new Uint8Array(total)
  let o = 0
  for (const b of blocks) { out.set(b, o); o += b.length }
  return out
}
