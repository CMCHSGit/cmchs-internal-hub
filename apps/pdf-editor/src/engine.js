/* pdf.js for the PDF editor: opens a file and draws its pages onto canvases.
   pdf.js parses and draws in a Web Worker, so the page never freezes however
   long a page takes. Only what is on screen is drawn (Page.jsx, Thumbs.jsx),
   and a page is drawn into a hidden canvas first and copied across, so a zoom
   never flashes blank. */
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { imageBoxes, norm, pickColours, shapeBoxes } from './model.js'

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

/**
 * The pixels of a small box of a page, drawn large: `box` is in page space
 * (points, the page's own orientation, so `rot` is its own /Rotate). Small
 * text drawn at screen size never reaches its true colour (every pixel is
 * partly the background), so colours are read from this instead of the canvas.
 */
export async function sampleRegion(src, n, rot, box, scale = 6) {
  const page = await src.doc.getPage(n + 1)
  const viewport = page.getViewport({ scale, rotation: rot })
  const w = Math.max(1, Math.ceil(box.w * scale)), h = Math.max(1, Math.ceil(box.h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  await page.render({ canvas, viewport, background: '#ffffff', transform: [1, 0, 0, 1, -box.x * scale, -box.y * scale] }).promise
  return canvas.getContext('2d').getImageData(0, 0, w, h).data
}

/**
 * Whether a font of a page is bold and/or italic, by its own name and flags
 * ("Helvetica-Bold"). Only known once pdf.js has loaded the page's fonts, which
 * drawing the page does; null until then or for a font it can't tell.
 */
export async function fontFlags(src, n, fontName) {
  try {
    const page = await src.doc.getPage(n + 1)
    if (!page.commonObjs.has(fontName)) return null
    const f = page.commonObjs.get(fontName)
    const name = String(f.name || '')
    return {
      bold: !!f.bold || /bold|black|heavy|semibold|demi/i.test(name),
      italic: !!f.italic || /italic|oblique/i.test(name),
    }
  } catch { return null }
}

const pictures = new WeakMap()
/** The boxes (page space) of the pictures on page `n` of a source, found from how the page is drawn: read once, then kept. */
export function loadImageBoxes(src, n, geom) {
  if (!pictures.has(src)) pictures.set(src, new Map())
  const pages = pictures.get(src)
  if (!pages.has(n)) {
    pages.set(n, src.doc.getPage(n + 1)
      .then(p => p.getOperatorList())
      .then(l => [...imageBoxes(l.fnArray, l.argsArray, pdfjs.OPS, geom), ...shapeBoxes(l.fnArray, l.argsArray, pdfjs.OPS, geom)]))
  }
  return pages.get(n)
}

/**
 * Takes an area of a page out as a picture: draws it large with a see-through
 * background (so only its own marks are in it) and returns it as a PNG, with the
 * background colour of the page just around it, for the cover that hides the original.
 * `box` is page space (the page's own orientation, `rot` its /Rotate); `size` the page's size there.
 */
export async function liftRegion(src, n, rot, box, size, erase = []) {
  const margin = 4
  const ex = { x: Math.max(0, box.x - margin), y: Math.max(0, box.y - margin) }
  ex.w = Math.min(size.w, box.x + box.w + margin) - ex.x
  ex.h = Math.min(size.h, box.y + box.h + margin) - ex.y
  let scale = Math.min(6, Math.max(2, 2400 / Math.max(box.w, box.h)))
  if (ex.w * ex.h * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (ex.w * ex.h))
  const page = await src.doc.getPage(n + 1)
  const viewport = page.getViewport({ scale, rotation: rot })
  const w = Math.max(1, Math.ceil(ex.w * scale)), h = Math.max(1, Math.ceil(ex.h * scale))
  // Drawn twice, on white and on black: what differs between the two is how see-through each pixel is,
  // which gives the picture a true transparent background whatever the page is made of.
  const draw = async (background) => {
    const canvas = document.createElement('canvas')
    canvas.width = w; canvas.height = h
    await page.render({ canvas, viewport, background, transform: [1, 0, 0, 1, -ex.x * scale, -ex.y * scale] }).promise
    return canvas.getContext('2d').getImageData(0, 0, w, h).data
  }
  const [onWhite, onBlack] = [await draw('#ffffff'), await draw('#000000')]
  // Inside the box is the picture; the ring around it is the page, which tells what colour the page is there.
  const ix = Math.round((box.x - ex.x) * scale), iy = Math.round((box.y - ex.y) * scale)
  const iw = Math.max(1, Math.min(w - ix, Math.round(box.w * scale))), ih = Math.max(1, Math.min(h - iy, Math.round(box.h * scale)))
  const ring = []
  const out = new ImageData(iw, ih)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      if (x >= ix && x < ix + iw && y >= iy && y < iy + ih) {
        const alpha = 1 - ((onWhite[i] - onBlack[i]) + (onWhite[i + 1] - onBlack[i + 1]) + (onWhite[i + 2] - onBlack[i + 2])) / 765
        const o = ((y - iy) * iw + (x - ix)) * 4
        if (alpha > 0.004) {
          out.data[o] = onBlack[i] / alpha; out.data[o + 1] = onBlack[i + 1] / alpha; out.data[o + 2] = onBlack[i + 2] / alpha
          out.data[o + 3] = Math.min(1, alpha) * 255
        }
      } else ring.push(onWhite[i], onWhite[i + 1], onWhite[i + 2], 255)
    }
  }
  const bg = ring.length ? pickColours(Uint8ClampedArray.from(ring)).bg : '#ffffff'
  // Text that is lifted as text of its own (`erase`, boxes in page space) is wiped from the picture, painted
  // over with whatever colour is under it, so it isn't there twice.
  for (const e of erase) {
    const x0 = Math.max(0, Math.floor((e.x - box.x) * scale)), y0 = Math.max(0, Math.floor((e.y - box.y) * scale))
    const x1 = Math.min(iw, Math.ceil((e.x + e.w - box.x) * scale)), y1 = Math.min(ih, Math.ceil((e.y + e.h - box.y) * scale))
    if (x1 <= x0 || y1 <= y0) continue
    const under = []
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = ((iy + y) * w + ix + x) * 4; under.push(onWhite[i], onWhite[i + 1], onWhite[i + 2], 255) }
    const [r, gr, b] = pickColours(Uint8ClampedArray.from(under)).bg.slice(1).match(/../g).map(v => parseInt(v, 16))
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * iw + x) * 4; out.data[o] = r; out.data[o + 1] = gr; out.data[o + 2] = b; out.data[o + 3] = 255 }
  }
  const crop = document.createElement('canvas')
  crop.width = iw; crop.height = ih
  crop.getContext('2d').putImageData(out, 0, 0)
  const blob = await new Promise(res => crop.toBlob(res, 'image/png'))
  return { bytes: new Uint8Array(await blob.arrayBuffer()), url: URL.createObjectURL(blob), bg }
}

const texts = new WeakMap()
/** The text of page `n` (0-based) of a source, as pdf.js gives it: read once, then kept. */
export function loadText(src, n) {
  if (!texts.has(src)) texts.set(src, new Map())
  const pages = texts.get(src)
  if (!pages.has(n)) pages.set(n, src.doc.getPage(n + 1).then(p => p.getTextContent()))
  return pages.get(n)
}

/** Frees a source's worker memory. */
export function closeSource(src) {
  src?.doc?.destroy?.()
}
