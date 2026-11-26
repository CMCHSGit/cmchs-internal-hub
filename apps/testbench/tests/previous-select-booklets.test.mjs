// npm test --prefix apps/testbench: Previous tests are ticked by clicking anywhere on a row, and Print as booklet makes a booklet for each test.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { bookletPdf, bookletsPdf } from '../src/print.js'

const pdf = async (pages) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 700 }); return d.save() }
const sides = async (bytes) => (await PDFDocument.load(bytes)).getPageCount()

test('Print as booklet: each test is a booklet of its own, not one booklet of every test', async () => {
  const a = await pdf(3), b = await pdf(5)
  assert.equal(await sides(await bookletsPdf([a, b])), 2 + 4, 'a 3-page report is 2 sheet sides (4 pages with a blank), a 5-page one 4 sides (8 pages)')
  const joined = await PDFDocument.create()
  for (const src of [a, b]) { const d = await PDFDocument.load(src); for (const p of await joined.copyPages(d, d.getPageIndices())) joined.addPage(p) }
  assert.equal(await sides(await bookletPdf(await joined.save())), 4, 'all the pages in one booklet would be 8 pages, 4 sides: the second test starting on the first one’s sheet')
  assert.equal(await sides(await bookletsPdf([a])), await sides(await bookletPdf(a)), 'one test: the same as before')
  const four = await pdf(4)
  assert.equal(await sides(await bookletsPdf([four, four, four])), 6, 'whole sheets stay whole')
})

test('the hub prints a booklet per ticked test', () => {
  const src = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.match(src, /import \{ bookletsPdf, mergePdfs, printPdf \} from '\.\/print\.js'/)
  assert.match(src, /booklet \? await bookletsPdf\(buffers\) :/)
  assert.ok(!/bookletPdf\(bytes\)/.test(src), 'no longer one booklet of the merged PDF')
})

test('a click anywhere on a test’s row ticks it, buttons and links excepted, and a ticked row is shaded', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8').replaceAll(String.fromCharCode(13), '')
  assert.ok(html.includes(`return \`<tr\${!r.inProgress && this.ticked.has(keyOf(r)) ? ' class="ticked"' : ''}><td>`), 'a ticked row is drawn shaded')
  assert.ok(html.includes("tr.addEventListener('click', (e) => { if (e.target.closest('button, a, input, select, label') || String(window.getSelection()).trim()) return; c.checked = !c.checked; c.dispatchEvent(new Event('change')); });"))
  assert.ok(html.includes("c.closest('tr').classList.toggle('ticked', c.checked); this.postTicks();"), 'the tick and the shading go together')
  assert.ok(html.includes("c.checked = tickAll.checked; c.closest('tr').classList.toggle('ticked', c.checked);"), 'also for Tick all')
  assert.match(html, /\.prev-table tr\.ticked td,\.prev-table tr\.ticked:hover td\{background:var\(--chs-purple-20\)\}/)
  assert.match(html, /\.prev-table input\[type=checkbox\]\{width:20px;height:20px/, 'a bigger tick box too')
  // a row with no tick box (a test in progress) does nothing when clicked
  assert.ok(html.includes("const c = $('[data-tick]', tr); if (!c) return; tr.classList.add('pickable');"))
})
