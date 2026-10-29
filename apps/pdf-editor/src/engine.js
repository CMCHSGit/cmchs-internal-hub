/* pdf.js for the PDF editor: opens a file and draws its pages onto canvases.
   pdf.js parses and draws in a Web Worker, so the page never freezes however
   long a page takes. Only what is on screen is drawn (Page.jsx, Thumbs.jsx),
   and a page is drawn into a hidden canvas first and copied across, so a zoom
   never flashes blank. */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { norm } from './model.js'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

/** Past this many pixels a canvas gets too big for phones (and Safari refuses it). */
const MAX_PIXELS = 16_000_000

export class PasswordError extends Error {}

/**
 * Opens a PDF. Keeps the original bytes (pdf-lib copies pages out of them on
 * Save) and each page's geometry (see model.js geometry()). pdf.js takes
 * ownership of the buffer it is given, so it gets a copy.
 */
export async function openSource(bytes) {
  let doc
  try {
    doc = await pdfjs.getDocument({ data: bytes.slice(0) }).promise
  } catch (e) {
    if (e?.name === 'PasswordException') throw new PasswordError('This PDF is password protected. Open it in a PDF reader, save an unprotected copy, and open that here.')
    throw new Error('That file didn’t open as a PDF.')
  }
  const geoms = new Array(doc.numPages)
  for (let i = 0; i < doc.numPages; i += 40) {
    await Promise.all(Array.from({ length: Math.min(40, doc.numPages - i) }, async (_, k) => {
      const page = await doc.getPage(i + k + 1)
      const [x0, y0, x1, y1] = page.view
      geoms[i + k] = { x0, y0, w: x1 - x0, h: y1 - y0, rot: norm(page.rotate) }
    }))
  }
  return { bytes, doc, geoms }
}

/**
 * Draws page `n` (0-based) of a source onto `target` at `scale` (canvas pixels
 * per point), turned by `rotation` degrees in all (its own plus the person's).
 * Returns { done, cancel }: `done` resolves true once drawn, false if cancelled.
 */
export function drawPage(src, n, rotation, scale, target) {
  let cancelled = false, task = null
  const done = (async () => {
    const page = await src.doc.getPage(n + 1)
    if (cancelled) return false
    let viewport = page.getViewport({ scale, rotation })
    const px = viewport.width * viewport.height
    if (px > MAX_PIXELS) viewport = page.getViewport({ scale: scale * Math.sqrt(MAX_PIXELS / px), rotation })
    const off = document.createElement('canvas')
    off.width = Math.max(1, Math.floor(viewport.width))
    off.height = Math.max(1, Math.floor(viewport.height))
    task = page.render({ canvas: off, viewport, background: '#ffffff' })
    try {
      await task.promise
    } catch (e) {
      if (e?.name === 'RenderingCancelledException') return false
      throw e
    }
    if (cancelled) return false
    target.width = off.width
    target.height = off.height
    target.getContext('2d').drawImage(off, 0, 0)
    return true
  })()
  return { done, cancel() { cancelled = true; task?.cancel() } }
}

/** Frees a source's worker memory. */
export function closeSource(src) {
  src?.doc?.destroy?.()
}
