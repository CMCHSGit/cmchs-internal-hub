/* Text recognition for a photo, in the browser (tesseract.js, a worker and a WebAssembly core). Shared by the Test
   Bench's MAC reader (apps/testbench/src/ocr.js re-exports this) and the demo tracker's Stock removal (Form 39) screen.
   Nothing is uploaded: the photo is read on this phone or PC, and the library's files come from this
   site (/ocr/<version>/, shared/ocr-assets.js), not from a CDN. The library is loaded the first time
   it is needed (about 7 MB with its English data, kept by the browser after), so opening an app or
   a screen that uses it costs nothing.

   readPhoto(source, onProgress) -> the text read. */
import { OCR_BASE } from './ocr-assets.js'

let loading = null // the worker, once asked for
let progress = () => {}

/** The worker, made once and kept for the next photo; closeOcr() lets it go. */
function worker() {
  if (!loading) {
    loading = import('tesseract.js').then(async (mod) => {
      const T = mod.default || mod
      const w = await T.createWorker('eng', 1, {
        workerPath: OCR_BASE + 'worker.min.js',
        corePath: OCR_BASE, // it picks the core this device can run (relaxed SIMD, SIMD or plain)
        langPath: OCR_BASE,
        gzip: true,
        workerBlobURL: false, // a worker straight from this site's address, so the service worker can keep it
        logger: (m) => { if (m.status === 'recognizing text') progress(m.progress || 0) },
      })
      return w
    }).catch((e) => { loading = null; throw e })
  }
  return loading
}

/** Free the worker (and its memory) when the screen that uses it is left. */
export function closeOcr() {
  const w = loading
  loading = null
  progress = () => {}
  if (w) w.then((x) => x.terminate()).catch(() => {})
}

/** A photo or camera frame as a canvas no bigger than `max` on its long side: a phone photo is 4000+ px
    wide, which is slow to read and no more legible. */
export function toCanvas(source, max = 1800) {
  const w = source.videoWidth || source.naturalWidth || source.width
  const h = source.videoHeight || source.naturalHeight || source.height
  const k = Math.min(1, max / Math.max(w, h))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w * k); canvas.height = Math.round(h * k)
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

/** A canvas turned a quarter, half or three-quarter turn clockwise (a label photographed sideways). */
export function rotateCanvas(canvas, degrees) {
  const turn = ((degrees % 360) + 360) % 360
  if (!turn) return canvas
  const sideways = turn === 90 || turn === 270
  const out = document.createElement('canvas')
  out.width = sideways ? canvas.height : canvas.width
  out.height = sideways ? canvas.width : canvas.height
  const g = out.getContext('2d')
  g.translate(out.width / 2, out.height / 2)
  g.rotate((turn * Math.PI) / 180)
  g.drawImage(canvas, -canvas.width / 2, -canvas.height / 2)
  return out
}

/** Read the text in a canvas. `enough(text)` says whether it holds what was wanted; if not, a second pass
    looks for scattered text instead of one block (a label, a screen with a lot around it). `modes` are the
    layouts tried in turn (tesseract's page segmentation modes: 6 one block of text, 11 sparse text anywhere). */
export async function readPhoto(canvas, { onProgress, enough = () => true, modes = ['6', '11'] } = {}) {
  progress = onProgress || (() => {})
  const w = await worker()
  let text = ''
  for (const psm of modes) { // 6: one block of text (a screen's lines); 11: sparse text anywhere
    await w.setParameters({ tessedit_pageseg_mode: psm })
    text += '\n' + (await w.recognize(canvas)).data.text
    if (enough(text)) break
  }
  return text.trim()
}
