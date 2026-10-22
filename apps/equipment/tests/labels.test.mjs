// npm test -w apps/equipment — QR labels (labels.js) and what a scanned label means (model.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import jsQR from 'jsqr'

import { assetNoFromScan, findByIdOrNo, labelUrl } from '../src/model.js'
import { LAYOUTS, labelPages, qrSvg, sheetHtml } from '../src/labels.js'

const items = Array.from({ length: 25 }, (_, i) => ({ id: 'id' + i, CHSAssetNo: 'CHS' + String(i + 1).padStart(3, '0'), Model: i === 0 ? 'Bed <Pro> & "co"' : 'Monitor', SerialNo: 'SN' + i }))

test('a label links to the asset record by asset number', () => {
  assert.equal(labelUrl('CHS 001'), 'https://internal.chsnz.co.nz/equipment/#/equipment?item=CHS%20001')
})

test('a scan is read as the link\'s asset number, or as typed for the older labels', () => {
  assert.equal(assetNoFromScan(labelUrl('CHS 001')), 'CHS 001')
  assert.equal(assetNoFromScan('https://internal.chsnz.co.nz/equipment/?item=CHS002'), 'CHS002')
  assert.equal(assetNoFromScan(' CHS003 '), 'CHS003')
  assert.equal(assetNoFromScan('https://example.com/elsewhere'), 'https://example.com/elsewhere')
  assert.equal(assetNoFromScan(null), '')
})

test('the record opens from an id (a loan\'s row) or an asset number (a label)', () => {
  assert.equal(findByIdOrNo(items, 'id3').CHSAssetNo, 'CHS004')
  assert.equal(findByIdOrNo(items, 'chs004').id, 'id3')
  assert.equal(findByIdOrNo(items, 'nope'), undefined)
  assert.equal(findByIdOrNo(items, ''), undefined)
})

test('sheets: 21 to a page, and a part-used sheet starts further along', () => {
  assert.deepEqual(labelPages(items, 'l7160').map((p) => p.length), [21, 4])
  const part = labelPages(items.slice(0, 3), 'l7160', 5)
  assert.equal(part.length, 1)
  assert.deepEqual(part[0].map((x) => x && x.CHSAssetNo), [null, null, null, null, null, 'CHS001', 'CHS002', 'CHS003'])
  assert.equal(labelPages(items.slice(0, 20), 'l7160', 99)[0].length >= 20, true, 'skip never goes past the sheet')
  assert.deepEqual(labelPages([], 'l7160'), [])
})

test('the printable page: millimetre boxes inside the sheet, text escaped, one section per sheet', () => {
  const html = sheetHtml(items, { layout: 'l7160' })
  assert.equal((html.match(/class="pg"/g) || []).length, 2)
  assert.equal((html.match(/class="lb"/g) || []).length, 25)
  assert.ok(html.includes('Bed &lt;Pro&gt; &amp; &quot;co&quot;'))
  assert.ok(!html.includes('<script>'), 'no print script unless asked')
  assert.ok(sheetHtml(items, { autoPrint: true }).includes('window.print()'))
  assert.ok(sheetHtml(items, { guides: true }).includes('class="lb guide"'))
  for (const [k, L] of Object.entries(LAYOUTS)) {
    const right = L.left + (L.cols - 1) * L.pitchX + L.w, bottom = L.top + (L.rows - 1) * L.pitchY + L.h
    assert.ok(right <= 210 + 0.01 && bottom <= 297 + 0.01, `${k} fits an A4 sheet`)
  }
})

test('the QR really decodes to the link (rendered to pixels and read back with jsQR)', () => {
  const url = labelUrl('CHS 001')
  const svg = qrSvg(url)
  const view = Number(/viewBox="0 0 (\d+) /.exec(svg)[1])
  const dark = new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`))
  const scale = 6, px = view * scale
  const data = new Uint8ClampedArray(px * px * 4).fill(255)
  for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
    if (dark.has(`${Math.floor(x / scale)},${Math.floor(y / scale)}`)) { const i = (y * px + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0 }
  }
  assert.equal(jsQR(data, px, px)?.data, url)
})
