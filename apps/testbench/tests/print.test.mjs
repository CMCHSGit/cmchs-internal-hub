// npm test --prefix apps/testbench — printing reports from Saved reports: the ticked tests' PDFs joined into one, one print dialog.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { bookletOrder, bookletPdf, mergePdfs, printPdf } from '../src/print.js'

const pdf = async (pages) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([595, 842]).drawText(`Page ${i + 1}`, { x: 50, y: 700 }); return d.save() }

test('several reports print as one PDF, every page in order', async () => {
  const out = await PDFDocument.load(await mergePdfs([await pdf(2), await pdf(3)]))
  assert.equal(out.getPageCount(), 5)
})

test('the print dialog opens from a hidden frame; where it can’t, the PDF opens in a tab', async () => {
  const opened = [], frames = []
  const fakeWin = (canPrint) => ({
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }, setTimeout: (f, ms) => (ms < 1000 ? f() : 0), open: (u) => opened.push(u),
    document: { createElement: () => { const f = { style: {}, remove() {}, contentWindow: { focus() {}, print() { if (!canPrint) throw new Error('blocked'); f.printed = true } } }; frames.push(f); return f }, body: { appendChild: (f) => f.onload() } },
  })
  assert.equal(await printPdf(new Blob(['%PDF']), fakeWin(true)), 'dialog')
  assert.ok(frames[0].printed && frames[0].src === 'blob:x')
  assert.equal(await printPdf(new Blob(['%PDF']), fakeWin(false)), 'tab')
  assert.deepEqual(opened, ['blob:x'])
})

test('Saved reports has a Print button for the ticked tests’ reports, and logs it with a count only', () => {
  const src = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  assert.match(src, /onClick=\{\(\) => print\(\)\}/)
  assert.match(src, /onClick=\{\(\) => print\(true\)\}[^>]*>Print as booklet</)
  assert.match(src, /`Print \$\{attachCount\} reports`/)
  assert.match(src, /logActivity\(null, `Printed \$\{list\.length\} test report/)
})

test('the bench page’s finished-test screen has Print as booklet, laid out exactly as the hub’s', async () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.match(html, /id="sumPrint"[^\n]*Print<\/button>\s*<button[^>]*id="sumBooklet"[^\n]*Print as booklet<\/button>/)
  assert.match(html, /\$\('#sumBooklet'\)\.addEventListener\('click', \(\) => Runner\.printBooklet\(\)\)/)
  // the bench's own copy of the layout, run here against the real pdf-lib
  const grab = (re) => { const m = html.match(re); assert.ok(m, String(re)); return m[0] }
  const code = [grab(/function bookletOrder\(n\) \{[\s\S]*?\n\}\r?\n/), grab(/async function bookletPdfBytes\(bytes\) \{[\s\S]*?\n\}\r?\n/)].join('\n')
  const bench = new Function('PDFLib', `${code}\nreturn { bookletOrder, bookletPdfBytes }`)({ PDFDocument })
  for (let n = 1; n <= 13; n++) assert.deepEqual(JSON.parse(JSON.stringify(bench.bookletOrder(n))), bookletOrder(n), `${n} pages`)
  const out = await PDFDocument.load(await bench.bookletPdfBytes(await pdf(5)))
  assert.equal(out.getPageCount(), 4)
  assert.ok(out.getPage(0).getSize().width > out.getPage(0).getSize().height, 'landscape')
})

test('the test on the summary page is ticked for the hub’s bar when it finishes or is opened', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.match(html, /async tickOnly\(run\) \{[\s\S]*?this\.ticked = new Set\(\[k\]\);[\s\S]*?this\.postTicks\(\);/)
  assert.match(html, /\$\('#runActive'\)\.hidden = true; \$\('#runSummary'\)\.hidden = false;\s*\n\s*this\.renderSummary\(\); window\.scrollTo\(\{ top: 0 \}\); Records\.tickOnly\(run\);\s*\n\s*if \(!stopped/)
  assert.match(html, /\$\('#runSummary'\)\.hidden = false;\s*\n\s*this\.renderSummary\(\); window\.scrollTo\(\{ top: 0 \}\); Records\.tickOnly\(run\);\s*\n\s*\},/)
})

test('a booklet: pages in fold order, two to a landscape sheet side, blanks at the end', async () => {
  assert.deepEqual(bookletOrder(4), [[3, 0], [1, 2]])
  assert.deepEqual(bookletOrder(5), [[-1, 0], [1, -1], [-1, 2], [3, 4]], '5 pages: 8 slots, three blanks')
  assert.deepEqual(bookletOrder(8), [[7, 0], [1, 6], [5, 2], [3, 4]])
  const out = await PDFDocument.load(await bookletPdf(await pdf(5)))
  assert.equal(out.getPageCount(), 4, 'two sheets, both sides')
  const { width, height } = out.getPage(0).getSize()
  assert.ok(width > height, 'landscape')
})
