/* Device model names as people write them: "VS600", "VS 600", "VS-600" and "vs600" are one model, "BeneHeart R12" is "Beneheart-R12" and
   "BeneHeart R 12", "TM80 II" is "TM80II". Spaces, hyphens and other punctuation, and capitals, never tell two models apart; the name is
   still shown as it was written. Plain functions (the tests run them), used by orders.js. The bench page (bench/index.html) is a separate
   script and can't import this: its template finder, Layout.wordSets, follows the same rule (tests/model-name.test.mjs checks both). */

/** The words of a model name: lower case, letters and digits only. "BeneHeart R-12" -> ['beneheart', 'r', '12'] */
export const modelWords = (s) => String(s ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** A model name with the writing stripped off, for comparing: "VS-600", "VS 600", "vs600" -> "vs600". '' when it has no letters or digits. */
export const modelId = (s) => modelWords(s).join('')

/** The same model, however it is spelled. "N1" and "N12", "TM80 I" and "TM80 II", "T1" and "T8" are different models. */
export const sameModel = (a, b) => { const x = modelId(a); return x !== '' && x === modelId(b) }

/** Does `tested` (a device's model, e.g. "BeneHeart D30") contain `wanted` ("D30", "D 30", "d-30") as whole words? Whole words, not a start: "N1" is not in "N12". */
export function modelContains(tested, wanted) {
  const w = modelId(wanted), words = modelWords(tested)
  if (!w) return false
  for (let i = 0; i < words.length; i++) {
    let run = ''
    for (let j = i; j < words.length && run.length < w.length; j++) { run += words[j]; if (run === w) return true }
  }
  return false
}

/** Each model once, as first written: ["VS600", "VS 600", "vs-600", "N1"] -> ["VS600", "N1"]. */
export function uniqueModels(list) {
  const seen = new Set(), out = []
  for (const m of list) { const k = modelId(m); if (k && !seen.has(k)) { seen.add(k); out.push(m) } }
  return out
}
