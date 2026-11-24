// Where the text recognition's own files live on this site. The page (apps/equipment/src/ocr.js),
// the build (scripts/build.mjs copies them into dist/) and `npm run dev` (apps/hub/vite.config.js
// serves them) all read this one list, so they can't drift apart.
//
// The files are served from here, never from a CDN: tesseract.js would otherwise fetch them from
// cdn.jsdelivr.net, which would mean a photo's reader being loaded from a third party. (The photo
// itself never leaves the device either way: it is read in a worker in the browser.)
//
// The version is in the path: the service worker keeps scripts for good, so a new tesseract.js
// must be a new address. When tesseract.js or its data are upgraded, change OCR_VERSION; the build
// checks it against what is installed.

export const OCR_VERSION = '7.0.0'
export const OCR_BASE = `/ocr/${OCR_VERSION}/`

/** What goes in /ocr/<version>/: [name, package path under node_modules]. Only the LSTM cores (the
    three the library chooses between by what the phone supports) and the small English data
    (3 MB; the full one is 11 MB and read the same photo no better). Nothing here is precached. */
export const OCR_FILES = [
  ['worker.min.js', 'tesseract.js/dist/worker.min.js'],
  ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js'],
  ['tesseract-core-simd-lstm.wasm.js', 'tesseract.js-core/tesseract-core-simd-lstm.wasm.js'],
  ['tesseract-core-lstm.wasm.js', 'tesseract.js-core/tesseract-core-lstm.wasm.js'],
  ['eng.traineddata.gz', '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'],
]
