import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PDFDocument, degrees } from 'pdf-lib'
import { blankPage, sourcePage, newText, newBox, newLine, newPen, newImage, addObject, rotatePages, duplicatePages } from '../src/model.js'
import { buildPdf } from '../src/save.js'

const require = createRequire(import.meta.url)
const D = { size: 14, color: '#112233', family: 'Helvetica', bold: false, italic: false, fill: '#ffffff', stroke: '#ff0000', highlight: '#ffeb3b', sw: 2 }

// a one-pixel PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))

async function source(w, h, count = 2) {
  const d = await PDFDocument.create()
  for (let i = 0; i < count; i++) d.addPage([w, h])
  return { bytes: await d.save(), geoms: Array.from({ length: count }, () => ({ x0: 0, y0: 0, w, h, rot: 0 })) }
}

test('pages come out in the edited order, rotated, with blanks', async () => {
  const src = await source(200, 100, 3)
  let pages = [sourcePage(0, 0), sourcePage(0, 1), sourcePage(0, 2), blankPage(300, 400)]
  pages = [pages[2], pages[0], pages[3], pages[1]]
  pages = rotatePages(pages, [pages[1].id], 90)
  const out = await PDFDocument.load(await buildPdf({ pages, sources: [src] }))
  assert.equal(out.getPageCount(), 4)
  assert.equal(out.getPage(1).getRotation().angle, 90)
  assert.equal(out.getPage(0).getRotation().angle, 0)
  assert.deepEqual(out.getPage(2).getSize(), { width: 300, height: 400 })
})

test('a duplicated page is saved twice', async () => {
  const src = await source(200, 100, 1)
  const pages = duplicatePages([sourcePage(0, 0)], [])
  const dup = duplicatePages(pages, [pages[0].id])
  const out = await PDFDocument.load(await buildPdf({ pages: dup, sources: [src] }))
  assert.equal(out.getPageCount(), 2)
})

test('every kind of object saves, on a turned source page too', async () => {
  const d = await PDFDocument.create()
  d.addPage([200, 100]).setRotation(degrees(90))
  const src = { bytes: await d.save(), geoms: [{ x0: 0, y0: 0, w: 200, h: 100, rot: 90 }] }
  let pages = [sourcePage(0, 0)]
  const id = pages[0].id
  pages = addObject(pages, id, { ...newText(10, 10, D), text: 'Kia ora\nsecond line' })
  pages = addObject(pages, id, newBox('rect', 5, 5, 40, 20, D))
  pages = addObject(pages, id, newBox('ellipse', 5, 5, 40, 20, D))
  pages = addObject(pages, id, newBox('highlight', 5, 5, 40, 20, D))
  pages = addObject(pages, id, newLine(0, 0, 30, 30, D))
  pages = addObject(pages, id, newPen([[0, 0], [5, 9], [9, 3]], D))
  pages = addObject(pages, id, newImage(10, 10, 20, 20, 'img1'))
  const bytes = await buildPdf({ pages, sources: [src], images: new Map([['img1', { bytes: PNG, type: 'png' }]]) })
  const out = await PDFDocument.load(bytes)
  assert.equal(out.getPageCount(), 1)
  assert.equal(out.getPage(0).getRotation().angle, 90) // the page's own /Rotate is kept
  // and turned further by the person's rotation
  const turned = await PDFDocument.load(await buildPdf({ pages: rotatePages(pages, [id], 90), sources: [src], images: new Map([['img1', { bytes: PNG, type: 'png' }]]) }))
  assert.equal(turned.getPage(0).getRotation().angle, 180)
})

test('letters the standard fonts lack use the fallback font, or become ? without one', async () => {
  const font = readFileSync(require.resolve('@fontsource/source-sans-3/files/source-sans-3-latin-ext-400-normal.woff'))
  const withText = [{ ...blankPage(300, 300), objects: [{ ...newText(10, 10, D), text: 'Māori ā ē ī ō ū' }] }]
  let asked = 0
  const a = await buildPdf({ pages: withText, sources: [], loadFallbackFont: async () => { asked++; return font } })
  assert.ok(asked >= 1)
  assert.ok((await PDFDocument.load(a)).getPageCount() === 1)
  const b = await buildPdf({ pages: withText, sources: [] })
  assert.ok((await PDFDocument.load(b)).getPageCount() === 1)
  assert.ok(a.length > b.length, 'the fallback font is embedded')

  // and reading the saved file back gives the same letters, macrons and all
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const read = async (bytes) => {
    const doc = await pdfjs.getDocument({ data: bytes.slice(0), useSystemFonts: false, verbosity: 0 }).promise
    const text = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str).join('')
    return text.replace(/\s+/g, '')
  }
  assert.equal(await read(a), 'Māoriāēīōū')
  assert.equal(await read(b), 'M?ori?????', 'without the fallback font they become ?')
})
