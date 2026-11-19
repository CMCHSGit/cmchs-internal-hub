/* Filtering the merged timeline: text or regex, level, time range, with
   context lines around each match. Pure functions, so they are tested without a browser. */

/** A matcher for the search box. `{ test(line) }`, or `{ error }` for a bad regex. */
export function makeMatcher(text, regex = false) {
  const q = (text || '').trim()
  if (!q) return { test: null }
  if (regex) {
    try { const re = new RegExp(q, 'i'); return { test: l => re.test(l.msg) || re.test(l.src) } } catch (e) { return { error: 'That isn’t a valid pattern.' } }
  }
  const lo = q.toLowerCase()
  return { test: l => l.msg.toLowerCase().includes(lo) || l.src.toLowerCase().includes(lo) }
}

/**
 * Indexes into `lines` that pass the filter.
 *   levels: a Set of level names to keep (null/empty = all)
 *   from, to: times (NaN = open ended)
 *   test: from makeMatcher (null = everything)
 *   context: number of lines kept either side of a text match
 *   marked: a function (line) → truthy, to keep only marked lines
 */
export function filterIndexes(lines, { levels, from = NaN, to = NaN, test = null, context = 0, marked = null } = {}) {
  const keepLevel = levels && levels.size ? l => levels.has(l.lvl) : null
  const hasFrom = Number.isFinite(from), hasTo = Number.isFinite(to)
  const base = (l) => (!hasFrom || l.t >= from) && (!hasTo || l.t <= to) && (!keepLevel || keepLevel(l)) && (!marked || marked(l))
  const out = []
  if (!test) {
    for (let i = 0; i < lines.length; i++) if (base(lines[i])) out.push(i)
    return out
  }
  // With a search, keep the matches (and `context` lines around each, inside the time range).
  const hit = new Uint8Array(lines.length)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (base(l) && test(l)) {
      const a = Math.max(0, i - context), b = Math.min(lines.length - 1, i + context)
      for (let k = a; k <= b; k++) if (hit[k] < 2) hit[k] = k === i ? 2 : 1
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (!hit[i]) continue
    const l = lines[i]
    if ((!hasFrom || l.t >= from) && (!hasTo || l.t <= to)) out.push(i)
  }
  return out
}
