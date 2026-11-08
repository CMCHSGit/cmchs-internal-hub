/* Text with the words that matched the search marked: <mark class="kb-hit"> for a word that was typed, "kb-hit alt" for one found
   because it means the same. Drawn as React text, never as HTML. */
import { splitHits } from './model.js'

export function Hl({ text, re }) {
  const parts = splitHits(text, re)
  if (parts.length === 1 && !parts[0].hit) return parts[0].text
  return parts.map((p, i) => p.hit ? <mark key={i} className={p.hit === 2 ? 'kb-hit alt' : 'kb-hit'}>{p.text}</mark> : p.text)
}
