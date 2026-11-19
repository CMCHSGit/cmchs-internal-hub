import test from 'node:test'
import assert from 'node:assert/strict'
import zlib from 'node:zlib'
import { readZip, isZip } from '../src/zip.js'
import { openFiles, loadFamily, wanted } from '../src/load.js'
import { parseLog, fmtTime } from '../src/lines.js'

const enc = new TextEncoder()
const le16 = (n) => [n & 255, (n >> 8) & 255]
const le32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]

/** A zip the way `zip` writes it: [name, bytes, method] → bytes. */
function makeZip(entries) {
  const parts = [], central = []
  let off = 0
  for (const [name, data, method = 8] of entries) {
    const body = method === 8 ? zlib.deflateRawSync(data) : Buffer.from(data)
    const nm = enc.encode(name)
    const lh = Buffer.from([0x50, 0x4b, 3, 4, ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0), ...le32(0), ...le32(body.length), ...le32(data.length), ...le16(nm.length), ...le16(0), ...nm])
    parts.push(lh, body)
    central.push(Buffer.from([0x50, 0x4b, 1, 2, ...le16(20), ...le16(20), ...le16(0), ...le16(method), ...le16(0), ...le16(0), ...le32(0), ...le32(body.length), ...le32(data.length), ...le16(nm.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0), ...le32(off), ...nm]))
    off += lh.length + body.length
  }
  const cd = Buffer.concat(central)
  const end = Buffer.from([0x50, 0x4b, 5, 6, ...le16(0), ...le16(0), ...le16(entries.length), ...le16(entries.length), ...le32(cd.length), ...le32(off), ...le16(0)])
  return new Uint8Array(Buffer.concat([...parts, cd, end]))
}

/** A tar with one file, the way `tar` writes it. */
function makeTar(name, text) {
  const data = Buffer.from(text)
  const h = Buffer.alloc(512)
  h.write(name, 0); h.write(data.length.toString(8).padStart(11, '0') + '\0', 124); h.write('00000000000\0', 136); h[156] = 48; h.write('ustar\0' + '00', 257)
  h.fill(32, 148, 156)
  let sum = 0; for (const b of h) sum += b
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148)
  return new Uint8Array(Buffer.concat([h, data, Buffer.alloc((512 - (data.length % 512)) % 512), Buffer.alloc(1024)]))
}

const file = (name, bytes) => ({ name, lastModified: Date.UTC(2026, 9, 15), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) })
const LOG = '11/12/26 09:22:06 [123] INFO - hello [A.cpp:1]\n11/12/26 09:22:07 [123] ERROR- boom [A.cpp:2]\n'

test('zip: stored and deflated entries are read; unwanted ones are never unpacked', async () => {
  const zip = makeZip([['x/a.log', enc.encode(LOG)], ['x/b.log', enc.encode('plain'), 0], ['x/shot.jpg', enc.encode('JPEGDATA')], ['x/dir/', new Uint8Array(0), 0]])
  assert.ok(isZip(zip))
  const skipped = []
  const files = await readZip(zip, n => !n.endsWith('.jpg'), n => skipped.push(n))
  assert.deepEqual(files.map(f => f.name), ['x/a.log', 'x/b.log'])
  assert.equal(new TextDecoder().decode(files[0].data), LOG)
  assert.deepEqual(skipped, ['x/shot.jpg'])
})

test('zip: damaged and encrypted files give plain messages', async () => {
  await assert.rejects(readZip(new Uint8Array(100).fill(1)), /not a zip/)
  const z = makeZip([['a.log', enc.encode('x')]])
  const enc2 = Uint8Array.from(z); // set the "encrypted" flag in the central directory entry
  const cd = enc2.findIndex((_, i) => enc2[i] === 0x50 && enc2[i + 1] === 0x4b && enc2[i + 2] === 1 && enc2[i + 3] === 2)
  enc2[cd + 8] = 1
  await assert.rejects(readZip(enc2), /password/)
})

test('open: a service zip with a nested .tar.gz, screenshots and a crash dump', async () => {
  const inner = new Uint8Array(zlib.gzipSync(makeTar('log/DataServer.log', LOG)))
  const zip = makeZip([
    ['svc/systemLog.log', enc.encode(LOG)], ['svc/systemLog.log.1', enc.encode(LOG)], ['svc/MiniAgentLog.tar.gz', inner],
    ['svc/screen.jpg', enc.encode('x')], ['svc/db.blg', enc.encode('x')], ['svc/2026-03-26-Frontend-1.core.lzo', enc.encode('x')], ['svc/coredump/x', enc.encode('x')],
  ])
  const s = await openFiles([file('A5_2026-11-10_Service.zip', zip)])
  assert.deepEqual(s.families.map(f => f.name), ['DataServer', 'systemLog'])
  assert.equal(s.families.find(f => f.name === 'systemLog').files.length, 2)
  assert.equal(s.skipped.length, 4)
  const lines = await loadFamily(s.families[0])
  assert.equal(lines.length, 2)
  assert.equal(fmtTime(lines[0].t), '2026-11-12 09:22:06')
})

test('open: a tar with crash dumps leaves them unread', async () => {
  const s = await openFiles([file('log.tar', makeTar('var/log/A.log', LOG))])
  assert.equal(s.families.length, 1)
  assert.ok(!wanted('var/log/coredump/2026-01-01-Backend-1.core.lzo'))
  assert.ok(!wanted('var/log/x.core'))
  assert.ok(wanted('var/log/sys.log.0.lzo') && wanted('log/sys.log') && wanted('var/log/important_info_log.txt'))
})

test('open: something that is not a log is refused plainly', async () => {
  await assert.rejects(openFiles([file('shot.jpg', enc.encode('x'))]), /No log files/)
})

test('lines: bracketed thread numbers and syslog lines with no year', () => {
  const l = parseLog('05/21/12 14:21:38 [1118633120] INFO - Storage freebytes is5 [StorageRecover.cpp:48]\n', 0)
  assert.deepEqual([l[0].thr, l[0].lvl, l[0].src], ['1118633120', 'INFO', 'StorageRecover.cpp:48'])
  const ref = Date.UTC(2026, 9, 15)
  const sys = parseLog('Oct 14 21:32:54 DUB user.debug Dubhe_Backend: [10-14 21:32:52] WIFI:RSSI:-49 \nDec 30 10:00:00 DUB daemon.warn wpa: oops\nOct 15 09:42:29 DUB user.err kernel: fail', 0, { ref })
  assert.deepEqual(sys.map(x => fmtTime(x.t)), ['2026-10-14 21:32:54', '2025-12-30 10:00:00', '2026-10-15 09:42:29'])
  assert.deepEqual(sys.map(x => x.lvl), ['DEBUG', 'WARN', 'ERROR'])
  assert.match(sys[0].msg, /^Dubhe_Backend:/)
})

import { decodeText } from '../src/load.js'
test('text: GBK bytes (a full-width comma) are read, not shown as replacement characters', () => {
  const gbk = Uint8Array.from([0x56, 0x61, 0x6c, 0xa3, 0xac, 0x6e, 0x46, 0x69]) // "Val", full-width comma in GBK, "nFi"
  assert.equal(decodeText(gbk), 'Val\uff0cnFi')
  assert.equal(decodeText(new TextEncoder().encode('caf\u00e9 \u00b0C')), 'caf\u00e9 \u00b0C') // real UTF-8 is left alone
  assert.ok(!decodeText(gbk).includes('\ufffd'))
})
