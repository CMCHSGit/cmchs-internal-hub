/* Reading a bag's label from a photo for the Stock tab (StockRemoval.jsx). A bag is photographed any way up, and the
   reader only reads upright text, so the photo is read as taken and turned a quarter either way: the turn whose text
   holds the most of the label's own wording (labelEvidence: "Rx Only", "Made in China", Qty, LOT…) is the right way up
   and is read once more in the other layout, because a P/N printed beside a barcode comes back with a digit missing
   in one layout and whole in the other. What each read holds is put together for readLabelText, which checks it
   against the accessory list. Nothing leaves the device (shared/ocr.js). */
import { readPhoto, rotateCanvas } from '../../../shared/ocr.js'
import { labelEvidence } from './model.js'

const TURNS = [0, 270, 90, 180]
const SURE = 3 // this much of the label's wording found: it is the right way up, no need to try the rest

/** The text read from a photo's canvas, the way up that read best. `onProgress(0–1)` is for each read in turn. */
export async function readLabelPhoto(canvas, { onProgress, onStep } = {}) {
  let best = null
  for (const turn of TURNS) {
    onStep?.(best ? 'Turning the photo…' : 'Reading the photo…')
    const c = rotateCanvas(canvas, turn)
    const text = await readPhoto(c, { onProgress, modes: ['11'] })
    const evidence = labelEvidence(text)
    if (!best || evidence > best.evidence) best = { turn, canvas: c, text, evidence }
    if (evidence >= SURE) break
  }
  onStep?.('Checking the label…')
  const more = await readPhoto(best.canvas, { onProgress, modes: ['6'] })
  return `${best.text}\n${more}`
}
