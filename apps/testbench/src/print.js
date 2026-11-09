/* Printing reports straight from Saved reports: the ticked tests' PDFs joined into one (so there is one print dialog, however many
   are ticked) and printed from a hidden frame. pdf-lib is loaded only when more than one report is printed. */

/** One PDF made of the given PDFs, in order. */
export async function mergePdfs(buffers) {
  const { PDFDocument } = await import('pdf-lib')
  const out = await PDFDocument.create()
  for (const b of buffers) {
    const doc = await PDFDocument.load(b, { ignoreEncryption: true })
    for (const page of await out.copyPages(doc, doc.getPageIndices())) out.addPage(page)
  }
  return out.save()
}

/** Opens the browser's print dialog for a PDF. Where the browser won't print from a frame, the PDF opens in a new tab to print from there. */
export function printPdf(blob, win = window) {
  const doc = win.document, url = win.URL.createObjectURL(blob)
  const frame = doc.createElement('iframe')
  frame.title = 'Report to print'
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none'
  const cleanUp = () => { frame.remove(); win.URL.revokeObjectURL(url) }
  return new Promise((resolve) => {
    frame.onload = () => win.setTimeout(() => {
      try { frame.contentWindow.focus(); frame.contentWindow.print(); resolve('dialog') }
      catch { win.open(url, '_blank'); resolve('tab') }
      win.setTimeout(cleanUp, 10 * 60 * 1000)   // kept a while: the print dialog reads the frame until it is closed
    }, 250)
    frame.src = url
    doc.body.appendChild(frame)
  })
}

/** Booklet order for n pages (padded to a multiple of 4 with blanks, shown as -1): each sheet side is [left, right]. Folded down the
    middle and stacked, the sheets read 1, 2, 3 … */
export function bookletOrder(n) {
  const total = Math.max(4, Math.ceil(n / 4) * 4), at = (i) => (i < n ? i : -1), sides = []
  for (let s = 0; s < total / 4; s++) {
    sides.push([at(total - 1 - 2 * s), at(2 * s)])        // front of sheet s
    sides.push([at(2 * s + 1), at(total - 2 - 2 * s)])    // back of sheet s
  }
  return sides
}

/** The pages laid out as a booklet: two to each side of a landscape sheet of the same paper (A4 reports: two A5 halves on A4),
    in booklet order. Print it double-sided, flipping on the short edge, and fold. */
export async function bookletPdf(bytes) {
  const { PDFDocument } = await import('pdf-lib')
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true })
  const pages = src.getPages(), out = await PDFDocument.create()
  const { width: pw, height: ph } = pages[0].getSize()
  const W = Math.max(pw, ph), H = Math.min(pw, ph), half = W / 2   // landscape sheet
  const embedded = []
  for (const pg of pages) { try { embedded.push(await out.embedPage(pg)) } catch { embedded.push(null) } }   // a page with nothing on it can't be embedded: left blank
  for (const [left, right] of bookletOrder(pages.length)) {
    const sheet = out.addPage([W, H])
    for (const [i, x] of [[left, 0], [right, half]]) {
      const e = i < 0 ? null : embedded[i]; if (!e) continue
      const s = Math.min(half / e.width, H / e.height)
      sheet.drawPage(e, { x: x + (half - e.width * s) / 2, y: (H - e.height * s) / 2, width: e.width * s, height: e.height * s })
    }
  }
  return out.save()
}
