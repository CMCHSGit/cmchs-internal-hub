/* Simpro's descriptions and notes are rich text (HTML). This turns one into a small, safe tree that the page draws as
   React elements, so raw HTML is never put on the page: only the tags listed here survive, no attribute but a link's
   address, and nothing from <script>, <style> and the like. No React and no DOM here, so the tests run it as it is. */

const TAGS = new Set(['p', 'div', 'span', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'a', 'hr', 'sub', 'sup'])
const VOID = new Set(['br', 'hr'])
const BLOCK = new Set(['p', 'div', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'table', 'tr', 'hr'])
// Dropped with everything inside them.
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'head', 'title', 'textarea', 'select', 'button', 'form'])
const MAX_DEPTH = 24
const MAX_NODES = 6000

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', bull: '•', deg: '°', copy: '©', reg: '®', plusmn: '±', micro: 'µ' }

/** &amp; &#39; &#x27; and the common named ones; anything else is left as written. */
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      if (!Number.isFinite(code) || code < 32 && code !== 9 && code !== 10 || code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) return ''
      return String.fromCodePoint(code)
    }
    const v = NAMED[e.toLowerCase()]
    return v === undefined ? m : v
  })
}

/** A link's address if it is one we'll draw as a link (http, https, mailto, tel), else ''. */
export function safeHref(raw) {
  // Browsers ignore tabs, newlines and other control characters inside a scheme ("java\tscript:"), so strip them first.
  const v = decodeEntities(String(raw || '')).replace(/[\u0000- \u007f-\u009f]+/g, '').trim()
  return /^(https?:|mailto:|tel:)/i.test(v) ? v.slice(0, 2000) : ''
}

const hrefOf = (attrs) => {
  const m = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(attrs)
  return m ? safeHref(m[1] ?? m[2] ?? m[3]) : ''
}

/**
 * HTML (or plain text) to a tree of { t: 'text', v } and { t: 'el', tag, href?, kids } nodes.
 * Never throws: whatever it can't understand becomes text or is dropped.
 */
export function htmlToTree(input) {
  const src = String(input ?? '')
  if (!src.trim()) return []
  // Plain text with line breaks (older notes): keep the lines.
  if (!/<[a-z!/]/i.test(src)) {
    const out = []
    src.replace(/\r\n?/g, '\n').split('\n').forEach((line, i) => { if (i) out.push({ t: 'el', tag: 'br', kids: [] }); if (line) out.push({ t: 'text', v: decodeEntities(line) }) })
    return out
  }
  const root = { kids: [] }
  const stack = [root]
  let nodes = 0
  let dropping = null // the tag whose contents are being thrown away
  const top = () => stack[stack.length - 1]
  const add = (n) => { if (nodes++ < MAX_NODES) top().kids.push(n) }
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:"[^"]*"|'[^']*'|[^'">])*)>|<!?[^>]*>|[^<]+|</g
  let m
  while ((m = re.exec(src))) {
    const [all, close, rawTag, attrs = ''] = m
    if (!rawTag) {
      if (dropping || all.startsWith('<')) continue // comments, doctype, a stray "<" and anything inside a dropped tag
      add({ t: 'text', v: decodeEntities(all) })
      continue
    }
    const tag = rawTag.toLowerCase()
    if (dropping) {
      if (close && tag === dropping.tag && --dropping.depth === 0) dropping = null
      else if (!close && tag === dropping.tag) dropping.depth++
      continue
    }
    if (DROP.has(tag)) { if (!close && !/\/\s*$/.test(attrs)) dropping = { tag, depth: 1 }; continue }
    if (!TAGS.has(tag)) continue // unknown tags are unwrapped: their text stays
    if (close) {
      // Close the nearest open tag of that name, and anything left open inside it.
      for (let i = stack.length - 1; i > 0; i--) if (stack[i].tag === tag) { stack.length = i; break }
      continue
    }
    const el = { t: 'el', tag, kids: [] }
    if (tag === 'a') { const href = hrefOf(attrs); if (href) el.href = href }
    add(el)
    if (!VOID.has(tag) && !/\/\s*$/.test(attrs) && stack.length < MAX_DEPTH) stack.push(el)
  }
  return root.kids
}

/** Plain text of a tree, with a line break at each block, for searching and for snippets. */
export function treeToText(tree) {
  let out = ''
  const walk = (nodes) => {
    for (const n of nodes) {
      if (n.t === 'text') { out += n.v; continue }
      if (n.tag === 'br') { out += '\n'; continue }
      const block = BLOCK.has(n.tag) || n.tag === 'td' || n.tag === 'th'
      if (block && out && !out.endsWith('\n')) out += n.tag === 'td' || n.tag === 'th' ? '\t' : '\n'
      walk(n.kids)
      if (block && n.tag !== 'td' && n.tag !== 'th' && out && !out.endsWith('\n')) out += '\n'
    }
  }
  walk(tree)
  return out.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export const htmlToText = (html) => treeToText(htmlToTree(html))

/** Splits text around every (case-insensitive) occurrence of any of `terms` (a string or a list): [{ text, hit }]. */
export function splitByTerms(text, terms) {
  const s = String(text ?? '')
  const needles = [...new Set((Array.isArray(terms) ? terms : [terms]).map((t) => String(t ?? '').trim().toLowerCase()).filter(Boolean))]
    .sort((a, b) => b.length - a.length) // the longest first, so "north shore" wins over "north"
  if (!needles.length) return s ? [{ text: s, hit: false }] : []
  const out = []
  const lower = s.toLowerCase()
  let at = 0
  while (at < s.length) {
    let best = -1, len = 0
    for (const n of needles) {
      const i = lower.indexOf(n, at)
      if (i >= 0 && (best < 0 || i < best)) { best = i; len = n.length }
    }
    if (best < 0) break
    if (best > at) out.push({ text: s.slice(at, best), hit: false })
    out.push({ text: s.slice(best, best + len), hit: true })
    at = best + len
  }
  if (at < s.length) out.push({ text: s.slice(at), hit: false })
  return out
}

export const splitByTerm = splitByTerms

/** A short piece of `text` around the first occurrence of `term`: { before, hit, after, cutStart, cutEnd }, or null if it isn't there. */
export function snippetAround(text, term, radius = 70) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim()
  const t = String(term ?? '').trim()
  if (!s || !t) return null
  const i = s.toLowerCase().indexOf(t.toLowerCase())
  if (i < 0) return null
  const from = Math.max(0, i - radius), to = Math.min(s.length, i + t.length + radius)
  return { before: s.slice(from, i), hit: s.slice(i, i + t.length), after: s.slice(i + t.length, to), cutStart: from > 0, cutEnd: to < s.length }
}
