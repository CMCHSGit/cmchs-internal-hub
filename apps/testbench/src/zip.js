/* A zip file, made here (no library): files stored as they are, which is right for PDFs and the bench's other files
   (they are already compressed or small). Names that would clash get a number. Plain functions, so the tests run them. */

const TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()

export function crc32(bytes) {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Names made unique inside the zip: "a.pdf", "a (2).pdf". */
export function uniqueNames(names) {
  const seen = new Map()
  return names.map((n) => {
    const k = seen.get(n) || 0
    seen.set(n, k + 1)
    if (!k) return n
    const m = n.match(/^(.*?)(\.[^.]+)?$/)
    return `${m[1]} (${k + 1})${m[2] || ''}`
  })
}

/** files: [{ name, bytes: Uint8Array }] -> Uint8Array of the zip. `date` is stamped on every file. */
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder()
  const names = uniqueNames(files.map((f) => f.name))
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1)
  const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  const chunks = [], central = []
  let offset = 0
  files.forEach((f, i) => {
    const name = enc.encode(names[i]), crc = crc32(f.bytes), size = f.bytes.length
    const local = new DataView(new ArrayBuffer(30))
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true) // 0x0800: names are UTF-8
    local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true)
    local.setUint32(14, crc, true); local.setUint32(18, size, true); local.setUint32(22, size, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true)
    chunks.push(new Uint8Array(local.buffer), name, f.bytes)
    const dir = new DataView(new ArrayBuffer(46))
    dir.setUint32(0, 0x02014b50, true); dir.setUint16(4, 20, true); dir.setUint16(6, 20, true); dir.setUint16(8, 0x0800, true)
    dir.setUint16(10, 0, true); dir.setUint16(12, dosTime, true); dir.setUint16(14, dosDate, true)
    dir.setUint32(16, crc, true); dir.setUint32(20, size, true); dir.setUint32(24, size, true); dir.setUint16(28, name.length, true)
    dir.setUint32(42, offset, true)
    central.push(new Uint8Array(dir.buffer), name)
    offset += 30 + name.length + size
  })
  const dirSize = central.reduce((n, c) => n + c.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true)
  end.setUint32(12, dirSize, true); end.setUint32(16, offset, true)
  const all = [...chunks, ...central, new Uint8Array(end.buffer)]
  const out = new Uint8Array(all.reduce((n, c) => n + c.length, 0))
  let at = 0
  for (const c of all) { out.set(c, at); at += c.length }
  return out
}
