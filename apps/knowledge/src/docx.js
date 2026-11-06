/* Word (.docx) how-to guides into knowledge base articles. Pure text in, text out (no Firebase, no React), so the tests run it
   outside Vite; readDocx opens the file in the browser.

   A .docx is a zip; the text is in word/document.xml, the numbering of steps in word/numbering.xml and the web addresses in
   word/_rels/document.xml.rels. What comes through: paragraphs, bold, headings (as bold lines), bulleted and numbered
   steps (with their numbers, nested ones indented), tables (a row a line, cells split with " | ") and links (as the address
   after the words). Pictures do not come through: they stay in the Word file, and a "[Picture]" marks where each was. */
import { buildRecord, compact } from './model.js'

// ── A small XML reader (no DOMParser, which node does not have) ────────────────────────────────────

const ENTITY = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
  if (e[0] !== '#') return ENTITY[e.toLowerCase()]
  const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
  try { return String.fromCodePoint(code) } catch { return '' }
})

const TOKEN = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([^\s>/]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g
const ATTR = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** XML into { n: name, a: attributes, c: children }; text is { n: '#text', t }. Whitespace between tags is dropped. */
export function parseXml(xml) {
  const root = { n: '#root', a: {}, c: [] }
  const stack = [root]
  for (const m of String(xml).matchAll(TOKEN)) {
    const [, cdata, close, name, attrs, self, text] = m
    const top = stack[stack.length - 1]
    if (name) {
      if (close) { if (stack.length > 1) stack.pop(); continue }
      const a = {}
      for (const x of attrs.matchAll(ATTR)) a[x[1]] = unescapeXml(x[2] ?? x[3] ?? '')
      const node = { n: name, a, c: [] }
      top.c.push(node)
      if (!self) stack.push(node)
    } else if (cdata != null) top.c.push({ n: '#text', t: cdata })
    else if (text != null && (top.n === 'w:t' || text.trim())) top.c.push({ n: '#text', t: unescapeXml(text) })
  }
  return root
}

const kids = (node, name) => (node?.c || []).filter((x) => x.n === name)
const first = (node, name) => (node?.c || []).find((x) => x.n === name)
const attr = (node, name = 'w:val') => node?.a?.[name]
const isOn = (node) => !!node && !['0', 'false', 'off', 'none'].includes(String(attr(node) ?? '1').toLowerCase())
const textOf = (node) => (node.n === '#text' ? node.t : (node.c || []).map(textOf).join(''))
/** Pictures inside a node: a drawing's image or an old-style picture, the Fallback copy of the same one not counted twice. */
const countPictures = (node) => node.n === 'mc:Fallback' ? 0 : node.n === 'a:blip' || node.n === 'v:imagedata' ? 1 : (node.c || []).reduce((n, c) => n + countPictures(c), 0)

// ── Numbering: "1.", "a.", bullets ─────────────────────────────────────────────────────────────────────────

const letters = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(97 + ((n - 1) % 26)) + s; return s }
const roman = (n) => { let s = ''; for (const [v, r] of [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']]) while (n >= v) { s += r; n -= v } return s }
function markerFor(fmt, n) {
  switch (fmt) {
    case 'bullet': return '-'
    case 'none': return ''
    case 'lowerLetter': return letters(n) + '.'
    case 'upperLetter': return letters(n).toUpperCase() + '.'
    case 'lowerRoman': return roman(n) + '.'
    case 'upperRoman': return roman(n).toUpperCase() + '.'
    default: return n + '.'
  }
}

/** word/numbering.xml as { abs: abstract list → level → {fmt, start}, nums: list id → {abs, over: level → restart number} }. */
function readNumbering(xml) {
  const abs = {}, nums = {}
  const root = xml ? first(parseXml(xml), 'w:numbering') : null
  for (const a of kids(root, 'w:abstractNum')) {
    const levels = {}
    for (const l of kids(a, 'w:lvl')) levels[Number(attr(l, 'w:ilvl'))] = { fmt: attr(first(l, 'w:numFmt')) || 'decimal', start: Number(attr(first(l, 'w:start')) ?? 1) }
    abs[attr(a, 'w:abstractNumId')] = levels
  }
  for (const n of kids(root, 'w:num')) {
    const over = {}
    for (const o of kids(n, 'w:lvlOverride')) { const s = first(o, 'w:startOverride'); if (s) over[Number(attr(o, 'w:ilvl'))] = Number(attr(s)) }
    nums[attr(n, 'w:numId')] = { abs: attr(first(n, 'w:abstractNumId')), over }
  }
  return { abs, nums }
}

/** Counts steps as paragraphs go by: each list keeps its own count per level, and a new step at one level restarts the deeper ones. */
function makeCounter(numbering) {
  const counts = {}, seen = new Set()
  return (numId, lvl) => {
    const num = numbering.nums[numId]
    const levels = numbering.abs[num?.abs] || {}
    const key = num?.abs ?? 'n' + numId
    const c = (counts[key] ||= [])
    if (!seen.has(numId)) { seen.add(numId); for (const [l, start] of Object.entries(num?.over || {})) c[l] = start - 1 }
    c[lvl] = (c[lvl] ?? ((levels[lvl]?.start ?? 1) - 1)) + 1
    c.length = lvl + 1
    return markerFor(levels[lvl]?.fmt || 'decimal', c[lvl])
  }
}

// ── Paragraphs, tables ───────────────────────────────────────────────────────────────────────────────────────────

const PICTURE = '[Picture]'
const pictures = (n) => (n > 1 ? `[${n} pictures]` : PICTURE)

/** Runs and links in a paragraph as { segs: [{ t, b }], pics }: text with whether it is bold. */
function inlines(node, ctx, acc) {
  for (const c of node.c) {
    switch (c.n) {
      case 'w:r': {
        const bold = isOn(first(first(c, 'w:rPr'), 'w:b'))
        for (const x of c.c) {
          if (x.n === 'w:t') acc.segs.push({ t: textOf(x), b: bold })
          else if (x.n === 'w:tab' || x.n === 'w:br' || x.n === 'w:cr') acc.segs.push({ t: ' ', b: false })
          else if (x.n === 'w:noBreakHyphen') acc.segs.push({ t: '-', b: bold })
          else if (x.n === 'w:drawing' || x.n === 'w:pict' || x.n === 'w:object' || x.n === 'mc:AlternateContent') acc.pics += countPictures(x)
        }
        break
      }
      case 'w:hyperlink': {
        const inner = { segs: [], pics: 0 }
        inlines(c, ctx, inner)
        acc.segs.push(...inner.segs)
        acc.pics += inner.pics
        const href = ctx.rels[attr(c, 'r:id')] || ''
        const label = inner.segs.map((s) => s.t).join('').trim()
        if (/^https?:\/\//i.test(href) && label && label.replace(/\/$/, '').toLowerCase() !== href.replace(/\/$/, '').toLowerCase()) acc.segs.push({ t: ` (${href})`, b: false })
        break
      }
      case 'w:sdt': inlines(first(c, 'w:sdtContent') || { c: [] }, ctx, acc); break
      case 'w:ins': case 'w:fldSimple': case 'w:smartTag': case 'w:customXml': case 'w:moveTo': inlines(c, ctx, acc); break
      default: break // w:del (deleted text), proofing marks, bookmarks, paragraph properties
    }
  }
}

/** Segments as one line: bold runs as **bold**, spaces tidied. */
function render(segs) {
  let out = '', buf = '', bold = false
  const flush = () => {
    if (!buf) return
    if (bold && buf.trim()) out += buf.match(/^\s*/)[0] + '**' + buf.trim().replace(/\*+/g, '') + '**' + buf.match(/\s*$/)[0]
    else out += buf.replace(/\*{2,}/g, '*')
    buf = ''
  }
  for (const s of segs) { if (s.b !== bold) { flush(); bold = s.b } buf += s.t }
  flush()
  return out.replace(/[ \t   ]+/g, ' ').replace(/\*\* \*\*/g, ' ').trim()
}

/** One paragraph: { kind: 'p' | 'h' | 'li', text, level }. Text carries any [Picture] marker; a list step carries its number or "-". */
function paragraph(p, ctx) {
  const ppr = first(p, 'w:pPr')
  const style = attr(first(ppr, 'w:pStyle')) || ''
  const numPr = first(ppr, 'w:numPr')
  const numId = attr(first(numPr, 'w:numId'))
  const lvl = Math.min(Number(attr(first(numPr, 'w:ilvl')) ?? 0) || 0, 5)
  const acc = { segs: [], pics: 0 }
  inlines(p, ctx, acc)
  let text = render(acc.segs)
  if (acc.pics) text = (text ? text + ' ' : '') + pictures(acc.pics)
  if (/^(heading\s*\d|title|subtitle)/i.test(style)) return { kind: 'h', text: text.replace(/\*\*/g, '').trim() }
  let marker = null
  if (numId && numId !== '0') marker = ctx.count(numId, lvl)
  else if (/^list\s*bullet/i.test(style)) marker = '-'
  else if (/^list\s*number/i.test(style)) marker = ctx.count('style:' + style, 0)
  if (marker != null) return { kind: 'li', text, level: lvl, marker }
  return { kind: 'p', text }
}

/** A table as lines: a row a line, its cells split with " | ". A table of one column (used to box something) is just its paragraphs. */
function table(tbl, ctx) {
  const rows = kids(tbl, 'w:tr').map((tr) => kids(tr, 'w:tc').map((tc) => {
    const parts = []
    walk(tc, ctx, (b) => { if (b.kind === 'line') parts.push(b.text); else if (b.text) parts.push(b.text.replace(/^\*\*|\*\*$/g, '')) })
    return parts.filter(Boolean).join(' ')
  }))
  const lines = rows.map((cells) => cells.filter((c, i) => c || i < cells.length - 1).join(' | ').replace(/^( \| )+|( \| )+$/g, '')).filter(Boolean)
  return lines
}

/** Walks body-like content (the body, a table cell, a content control), calling `emit` with each block. */
function walk(node, ctx, emit) {
  for (const c of node.c) {
    if (c.n === 'w:p') emit(paragraph(c, ctx))
    else if (c.n === 'w:tbl') { emit({ kind: 'gap' }); for (const l of table(c, ctx)) emit({ kind: 'line', text: l }); emit({ kind: 'gap' }) }
    else if (c.n === 'w:sdt') walk(first(c, 'w:sdtContent') || { c: [] }, ctx, emit)
    else if (c.n === 'w:ins' || c.n === 'w:customXml') walk(c, ctx, emit)
  }
}

/** The guide as lines of body text (see richBlocks in model.js for what the page draws), and how many pictures it had. */
export function docxText({ document, numbering = '', rels = '' }) {
  const relMap = {}
  for (const r of kids(first(parseXml(rels), 'Relationships'), 'Relationship')) if (r.a.TargetMode === 'External') relMap[r.a.Id] = r.a.Target
  const ctx = { rels: relMap, count: makeCounter(readNumbering(numbering)) }
  const body = first(first(parseXml(document), 'w:document'), 'w:body')
  const lines = []
  let pictureCount = 0
  walk(body || { c: [] }, ctx, (b) => {
    pictureCount += (b.text?.match(/\[(\d+ pictures|Picture)\]/g) || []).reduce((n, m) => n + (parseInt(m.slice(1), 10) || 1), 0)
    if (b.kind === 'gap') lines.push('')
    else if (b.kind === 'line') lines.push(b.text)
    else if (b.kind === 'h') { if (b.text) lines.push('', '**' + b.text + '**') }
    else if (b.kind === 'li') { if (b.text) lines.push('  '.repeat(b.level) + (b.marker ? b.marker + ' ' : '') + b.text) }
    else lines.push(b.text)
  })
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  return { text, pictures: pictureCount }
}

// ── Into articles ─────────────────────────────────────────────────────────────────────────────────────────────

const MAX_BODY = 18000 // an article holds 20000 characters; some room for the source line

/** A file name as a title: "- CMS Version Testing_v2.docx" → "CMS Version Testing v2". */
export const titleFromFile = (name) => String(name || '').replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/^[\s\-–]+/, '').replace(/\s+/g, ' ').trim()

/** Lines split into chunks no longer than `max`, cutting at a heading when there is one in the back half, else at a line. */
function chunks(lines, max) {
  const out = []
  let cur = [], len = 0, lastHeading = -1
  for (const line of lines) {
    if (len + line.length + 1 > max && cur.length) {
      const at = lastHeading > cur.length / 2 ? lastHeading : cur.length
      out.push(cur.slice(0, at))
      cur = cur.slice(at); len = cur.reduce((n, l) => n + l.length + 1, 0); lastHeading = -1
    }
    if (/^\*\*[^*]+\*\*$/.test(line)) lastHeading = cur.length
    cur.push(line); len += line.length + 1
  }
  if (cur.length) out.push(cur)
  return out.map((c) => c.join('\n').trim()).filter(Boolean)
}

/**
 * A .docx's parts (from readDocx) as the articles it makes: usually one, titled from the file name, with the guide as its
 * text (buildArticles adds "Source file: …" last). A very long document is cut into parts at its headings. `id` is the same every time the
 * same file is imported, so importing it again replaces the article instead of adding another.
 */
export function articlesFromDocx(parts, fileName) {
  const { text, pictures: pics } = docxText(parts)
  const title = titleFromFile(fileName) || 'Untitled'
  let lines = text.split('\n')
  // A heading line that only repeats the title is dropped.
  const firstAt = lines.findIndex((l) => l.trim())
  if (firstAt >= 0) {
    const w = (s) => s.toLowerCase().replace(/\*\*/g, '').replace(/[^a-z0-9]+/g, ' ').trim()
    const a = w(lines[firstAt]), b = w(title)
    if (a && a.length < 120 && (a === b || (a.length > 4 && b.includes(a)) || (b.length > 4 && a.includes(b) && a.length < b.length + 20))) lines = lines.slice(firstAt + 1)
  }
  const readable = lines.join('\n').replace(/\[(\d+ pictures|Picture)\]/g, '').trim()
  if (readable.length < 8) return { articles: [], pictures: pics, problem: pics ? 'It is only pictures: nothing to read.' : 'It has no text.' }
  const body = chunks(lines, MAX_BODY)
  const base = 'w-' + (compact(title).slice(0, 60) || 'untitled')
  const articles = body.map((text, i) => ({
    id: i ? `${base}-${i + 1}` : base,
    title: body.length > 1 ? `${title} (part ${i + 1} of ${body.length})` : title,
    text,
    source: fileName,
  }))
  return { articles, pictures: pics }
}

/** Reads a .docx File in the browser into the parts articlesFromDocx wants. Throws for anything that is not a Word document. */
export async function readDocx(file) {
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const get = (p) => (zip.file(p) ? zip.file(p).async('string') : Promise.resolve(''))
  const document = await get('word/document.xml')
  if (!document) throw new Error('not a Word document')
  if (document.length > 12_000_000) throw new Error('too large')
  return { document, numbering: await get('word/numbering.xml'), rels: await get('word/_rels/document.xml.rels') }
}

/** The article records (built, with `search`) ready for importRecords. `where` is a link to the folder the Word files are kept in, so a reader can find the pictures. */
export const buildArticles = (articles, { category = '', where = '' } = {}) => articles.map((a) => buildRecord('article', {
  title: a.title,
  body: `${a.text}\n\nSource file: ${a.source}${where ? `\nPictures and the original Word file: ${where}` : ''}`,
  category,
}))
