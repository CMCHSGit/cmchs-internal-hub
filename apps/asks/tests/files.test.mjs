// npm test -w apps/asks — files on an ask (src/files.js): split into parts the
// rules accept, joined back byte for byte, and only safe types opened in the
// browser. And the push for a comment that is only a file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { MAX_BYTES, MAX_PARTS, PART_CHARS, canView, sizeLabel, splitParts, toBlob } from '../src/files.js'

test('the biggest file allowed fits the parts the rules allow', () => {
  const b64 = 'A'.repeat(Math.ceil(MAX_BYTES / 3) * 4)
  const parts = splitParts(b64)
  assert.equal(parts.length, MAX_PARTS)
  assert.ok(parts.every((p) => p.length <= PART_CHARS && p.length <= 700000)) // firestore.rules: data.size() <= 700000
  assert.equal(parts.join(''), b64)
  assert.ok(MAX_PARTS <= 10) // firestore.rules: parts <= 10
})

test('a small file is one part', () => {
  assert.deepEqual(splitParts('QUJD'), ['QUJD'])
})

test('parts join back to the same bytes', async () => {
  const bytes = Uint8Array.from({ length: 1500000 }, (_, i) => (i * 7) % 256)
  const parts = splitParts(Buffer.from(bytes).toString('base64'))
  assert.ok(parts.length > 1)
  const back = new Uint8Array(await toBlob(parts, 'application/pdf').arrayBuffer())
  assert.deepEqual(back, bytes)
})

test('only PDFs and ordinary pictures are opened in the browser; the rest download', () => {
  assert.equal(toBlob(['QUJD'], 'application/pdf').type, 'application/pdf')
  assert.equal(toBlob(['QUJD'], 'image/png').type, 'image/png')
  for (const t of ['text/html', 'image/svg+xml', 'application/xhtml+xml', 'application/javascript', '']) {
    assert.equal(canView(t), false, t)
    assert.equal(toBlob(['QUJD'], t).type, 'application/octet-stream', t)
  }
})

test('sizes read naturally', () => {
  assert.equal(sizeLabel(300), '1 KB')
  assert.equal(sizeLabel(350 * 1024), '350 KB')
  assert.equal(sizeLabel(MAX_BYTES), '5.0 MB')
})

test('the push for a comment that is only a file says so', () => {
  const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const i = code.indexOf('function askMessage_(')
  const ctx = vm.createContext({})
  vm.runInContext(code.slice(i, code.indexOf('\n}\n', i) + 3), ctx)
  const ask = { title: 'Quote', cc: [], assignees: [] }
  const body = (comment) => ctx.askMessage_(ask, { type: 'comment' }, 'Jess Reid', 'mike', comment).body
  assert.equal(body({ text: '', photoIds: [], fileIds: ['f1'] }), 'Added a file')
  assert.equal(body({ text: '', photoIds: ['p1'] }), 'Added a photo')
  assert.equal(body({ text: 'See attached', photoIds: [], fileIds: ['f1'] }), 'See attached')
})
