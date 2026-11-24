/* Text recognition for a photo, in the browser (tesseract.js, a worker and a WebAssembly core).
   Nothing is uploaded: the photo is read on this phone or PC, and the library's files come from this
   site (/ocr/<version>/, shared/ocr-assets.js), not from a CDN. The library is loaded the first time
   it is needed (about 7 MB with its English data, kept by the browser after), so opening the app or
   the Scan view costs nothing.

   readPhoto(source, onProgress) -> the text read, for macRead.js to pick the addresses from. */
import { OCR_BASE } from '../../../shared/ocr-assets.js'

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

/** Read the text in a canvas. `enough(text)` says whether it holds what was wanted; if not, a second pass
    looks for scattered text instead of one block (a label, a screen with a lot around it). */
export async function readPhoto(canvas, { onProgress, enough = () => true } = {}) {
  progress = onProgress || (() => {})
  const w = await worker()
  let text = ''
  for (const psm of ['6', '11']) { // 6: one block of text (a screen's lines); 11: sparse text anywhere
    await w.setParameters({ tessedit_pageseg_mode: psm })
    text += '\n' + (await w.recognize(canvas)).data.text
    if (enough(text)) break
  }
  return text.trim()
}
