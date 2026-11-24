// QR codes and barcodes (apps/codes): the rules, and a round trip through the same readers the hub's Scan screens use
// (ZXing for barcodes, jsQR for QR codes), so a code that is drawn wrongly fails here, not on a label.
// Lives with the hub's tests because the hub's test run is the one every pull request already runs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { code128Problem, code128Svg, code128Values, code128Widths, MAX_LENGTH, _internals } from '../../codes/src/code128.js'
import { qrMatrix, qrSvg, LEVELS } from '../../codes/src/qr.js'
import { looksLikeNhi } from '../../codes/src/privacy.js'
import { fileNameFor } from '../../codes/src/download.js'

const require = createRequire(import.meta.url)
const jsQR = require('jsqr')
const Z = require('@zxing/library')

// ---- Code 128 ----

test('every Code 128 symbol is 11 modules wide (Stop is 13), made of three bars and three spaces, and none repeat', () => {
  const P = _internals.PATTERNS
  assert.equal(P.length, 107)
  assert.equal(new Set(P).size, 107)
  P.forEach((p, v) => {
    const digits = [...p].map(Number)
    assert.equal(digits.reduce((a, b) => a + b, 0), v === 106 ? 13 : 11, `symbol ${v}`)
    assert.equal(digits.length, v === 106 ? 7 : 6)
    assert.ok(digits.every((d) => d >= 1 && d <= 4))
  })
})

test('Code 128: start, data, check symbol and stop (worked by hand)', () => {
  // Start B (104) + P(48)*1 + J(42)*2 + J(42)*3 + 1(17)*4 + 2(18)*5 + 3(19)*6 + C(35)*7 = 879; 879 mod 103 = 55
  assert.deepEqual(code128Values('PJJ123C'), [104, 48, 42, 42, 17, 18, 19, 35, 55, 106])
  // Start C (105) + 12*1 + 34*2 + 56*3 = 353; 353 mod 103 = 44
  assert.deepEqual(code128Values('123456'), [105, 12, 34, 56, 44, 106])
})

test('Code 128 switches to set C for runs of four or more digits, and back', () => {
  // WHA then six digits: B ... then Code C switch (99) and three pairs
  const v = code128Values('WHA303756')
  assert.equal(v[0], 104)
  assert.deepEqual(v.slice(1, 4), ['W', 'H', 'A'].map((c) => c.charCodeAt(0) - 32))
  assert.deepEqual(v.slice(4, 8), [99, 30, 37, 56])
  // an odd run keeps its last digit in set B, after a switch back (100)
  assert.deepEqual(code128Values('1234567').slice(0, 6), [105, 12, 34, 56, 100, 23])
  // three digits are not worth a switch
  assert.deepEqual(code128Values('A123').slice(0, 5), [104, 33, 17, 18, 19])
})

test('Code 128 refuses what it cannot hold, in plain words', () => {
  assert.match(code128Problem(''), /Type something/)
  assert.match(code128Problem('Māori'), /letters, digits/)
  assert.match(code128Problem('line\nbreak'), /letters, digits/)
  assert.match(code128Problem('x'.repeat(MAX_LENGTH + 1)), /too long/)
  assert.equal(code128Problem('WHA303756'), '')
  assert.throws(() => code128Values('é'))
})

/** Paint a run of bar and space widths as a luminance image, `scale` pixels a module, and read it with ZXing. */
function readBarcode(widths, { scale = 3, quiet = 10, rows = 24 } = {}) {
  const total = widths.reduce((a, b) => a + b, 0)
  const width = (total + quiet * 2) * scale
  const row = new Uint8ClampedArray(width).fill(255)
  let x = quiet * scale
  widths.forEach((w, i) => { if (i % 2 === 0) row.fill(0, x, x + w * scale); x += w * scale })
  const lum = new Uint8ClampedArray(width * rows)
  for (let r = 0; r < rows; r++) lum.set(row, r * width)
  const bitmap = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, width, rows)))
  const hints = new Map([[Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.CODE_128]]])
  const reader = new Z.MultiFormatReader()
  reader.setHints(hints)
  return reader.decode(bitmap).getText()
}

test('Code 128 round trip: ZXing reads back what was typed', () => {
  for (const text of ['WHA303756', 'PJJ123C', '123456', '1234567', 'abc', 'Hello World-1', 'SN: 4F/12_9#', 'A1234B', '0000', '  x ', 'a'.repeat(40) + '9'.repeat(30)]) {
    assert.equal(readBarcode(code128Widths(text)), text, text)
  }
})

test('the Code 128 SVG has the bars, the label under them, and escapes the text', () => {
  const svg = code128Svg('A<B&"C', { module: 2, height: 60 })
  assert.match(svg, /^<svg /)
  assert.match(svg, /A&lt;B&amp;&quot;C<\/text>/)
  assert.ok(!svg.includes('A<B'))
  assert.ok(!code128Svg('ABC', { label: false }).includes('<text'))
  // quiet zone: the first bar starts 10 modules in
  assert.match(code128Svg('ABC', { module: 3, label: false }), /d="M30 0h/)
})

// ---- QR ----

/** Paint a QR matrix as RGBA pixels, `scale` pixels a module with a 4-module border, and read it with jsQR. */
function readQr(text, level, scale = 6) {
  const m = qrMatrix(text, level)
  const n = (m.size + 8) * scale
  const data = new Uint8ClampedArray(n * n * 4).fill(255)
  for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
    if (!m.isDark(r, c)) continue
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + 4) * scale + y) * n + (c + 4) * scale + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 0
    }
  }
  const res = jsQR(data, n, n)
  return res && res.data
}

test('QR round trip at every error correction level: jsQR reads back what was typed', () => {
  const urls = ['https://internal.chsnz.co.nz/equipment/#/equipment?item=WHA303756', 'WHA303756', 'a']
  for (const level of Object.keys(LEVELS)) for (const t of urls) assert.equal(readQr(t, level), t, `${level} ${t}`)
})

test('QR keeps macrons and other non-ASCII text intact (UTF-8)', () => {
  for (const t of ['Māori Ōtaki Whānau', 'Café ☕', '日本語']) assert.equal(readQr(t, 'M'), t, t)
})

test('QR says so when there is nothing to encode or too much', () => {
  assert.throws(() => qrMatrix(''), /Type something/)
  assert.throws(() => qrMatrix('x'.repeat(5000), 'H'), /too much text/)
  assert.ok(qrMatrix('x'.repeat(1000), 'M').size > 21)
  // an unknown level falls back to the default rather than failing
  assert.ok(qrMatrix('abc', 'Z').size >= 21)
})

test('the QR SVG is square, black on white, and scales with px', () => {
  const a = qrSvg('hello', { px: 4 }), b = qrSvg('hello', { px: 8 })
  const size = (s) => Number(s.match(/ width="(\d+)"/)[1])
  assert.equal(size(b), size(a) * 2)
  assert.match(a, /fill="#fff"/)
  assert.match(a, /fill="#000"/)
  const m = qrMatrix('hello', 'M')
  assert.equal(size(a), (m.size + 8) * 4)
})

// ---- The page's small helpers ----

test('looksLikeNhi spots NHI-shaped text and leaves asset and serial numbers alone', () => {
  assert.ok(looksLikeNhi('ZAA0016'))
  assert.ok(looksLikeNhi('zaa0016'))
  assert.ok(looksLikeNhi('Patient ZZZ99AB here'))
  assert.ok(looksLikeNhi('ZAC12AB'))
  assert.ok(!looksLikeNhi('WHA303756'))
  assert.ok(!looksLikeNhi('https://internal.chsnz.co.nz/equipment/#/equipment?item=WHA303756'))
  assert.ok(!looksLikeNhi('SN 12345678'))
  assert.ok(!looksLikeNhi('IOI1234')) // I and O are never in an NHI
  assert.ok(!looksLikeNhi(''))
  assert.ok(!looksLikeNhi(null))
})

test('file names come from the text: plain, short, never empty of its kind', () => {
  assert.equal(fileNameFor('qr', 'WHA303756'), 'qr-WHA303756')
  assert.equal(fileNameFor('barcode', 'https://internal.chsnz.co.nz/x?a=1'), 'barcode-https-internal-chsnz-co-nz-x-a-1')
  assert.equal(fileNameFor('qr', 'Māori'), 'qr-Maori')
  assert.equal(fileNameFor('qr', ''), 'qr')
  assert.ok(fileNameFor('qr', 'x'.repeat(200)).length <= 43)
})
