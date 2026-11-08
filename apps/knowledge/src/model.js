/* The knowledge base's plain logic: no Firebase, no React, so the tests run it outside Vite.

   Four kinds of record, each its own Firestore collection of small flat documents (rules/firestore.rules):
     article  kbArticles  a quirk, fault, fix or how-to: title, body, category, tags, parts (part numbers)
     part     kbParts     a part: partNo, name, aliases (the other names people use), fits (models), notes, diagram
     device   kbDevices   an installed device: site, dept, model, serial, version, options, and any other column
     job      kbJobs      a past job, from a Simpro export: jobNo, title, notes, model, parts, site, date

   Every record carries `search`, a lower-case string of its words (and its part numbers with the dashes and
   spaces taken out, so "AB-123", "ab 123" and "ab123" all find each other). Searching is every word of the
   question being somewhere in that string: instant on the device, no server and no AI. */
import { SYNONYM_GROUPS } from './synonyms.js'

export const KINDS = {
  article: { col: 'kbArticles', label: 'Articles', one: 'article' },
  part: { col: 'kbParts', label: 'Parts', one: 'part' },
  device: { col: 'kbDevices', label: 'Installed devices', one: 'device' },
  job: { col: 'kbJobs', label: 'Past jobs', one: 'job' },
}
export const KIND_IDS = Object.keys(KINDS)

// What each kind holds: text fields (with their length caps), list fields, and the fields that count most in a search.
const SHAPE = {
  article: { text: { title: 200, body: 20000, category: 80, reviewedAt: 10 }, list: ['tags', 'parts'], main: ['title', 'tags', 'parts'] },
  part: { text: { partNo: 80, name: 200, notes: 4000, diagram: 500 }, list: ['aliases', 'fits'], main: ['partNo', 'name', 'aliases'] },
  device: { text: { site: 120, dept: 120, model: 120, serial: 120, version: 80, options: 1000, notes: 1000 }, list: [], main: ['model', 'site', 'dept', 'serial'] },
  job: { text: { jobNo: 40, title: 300, notes: 20000, site: 120, date: 10 }, list: ['parts', 'model'], main: ['title', 'jobNo', 'parts'] },
}
const MAX_LIST = 60, MAX_ITEM = 80, MAX_EXTRA = 24, MAX_EXTRA_VALUE = 200

const clean = (s, max) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
/** Body text keeps its line breaks. */
const cleanBody = (s, max) => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim().slice(0, max)
const cleanList = (v) => {
  const items = Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/)
  return [...new Set(items.map((x) => clean(x, MAX_ITEM)).filter(Boolean))].slice(0, MAX_LIST)
}

/** Words only: lower case, anything that is not a letter or digit is a space. */
export const words = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
/** A part number with no dashes or spaces: AB-123/4 → ab1234. */
export const compact = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** The record as it is stored: trimmed, capped, with `search` made. Only the kind's own fields. */
export function buildRecord(kind, input = {}) {
  const shape = SHAPE[kind]
  if (!shape) throw new Error('Unknown kind ' + kind)
  const out = {}
  for (const [f, max] of Object.entries(shape.text)) out[f] = (f === 'body' || f === 'notes') ? cleanBody(input[f], max) : clean(input[f], max)
  for (const f of shape.list) out[f] = cleanList(input[f])
  if (kind === 'device') out.extra = cleanExtra(input.extra)
  out.search = searchOf(kind, out)
  return out
}

function cleanExtra(extra) {
  const out = {}
  for (const [k, v] of Object.entries(extra || {})) {
    const key = clean(k, 60), val = clean(v, MAX_EXTRA_VALUE)
    if (key && val && Object.keys(out).length < MAX_EXTRA) out[key] = val
  }
  return out
}

/** The mark a Word import leaves where a picture was: [Picture], [3 pictures], and the page it was on: [Picture p.3], [2 pictures p.3-4]. */
export const PICTURE_MARK = /\[(?:(\d+) pictures|Picture)(?: p\.(\d+)(?:-\d+)?)?\]/g
/** The link to an article's original PDF, from its "Original PDF: https://…" line; '' when it has none. */
export const sourceLink = (body) => /^Original PDF: (https?:\/\/\S+)\s*$/m.exec(String(body || ''))?.[1] || ''

/** Every searchable word of a record, in one string; capped so a long article stays a small document. */
export function searchOf(kind, rec) {
  const shape = SHAPE[kind]
  const parts = []
  for (const f of Object.keys(shape.text)) parts.push(rec[f])
  for (const f of shape.list) parts.push(...(rec[f] || []))
  if (kind === 'device') for (const [k, v] of Object.entries(rec.extra || {})) parts.push(k, v)
  // Each word once (a long guide says "the" a hundred times), and the [Picture] marks a Word import leaves are not words to find.
  const w = [...new Set(words(parts.join(' ').replace(PICTURE_MARK, ' ')).split(' '))].join(' ')
  // Part numbers, with the dashes gone, so a number typed any way finds it.
  const codes = [rec.partNo, rec.serial, rec.jobNo, ...(rec.parts || []), ...(rec.aliases || [])].filter(Boolean).map(compact).filter(Boolean)
  return (w + ' ' + [...new Set(codes)].join(' ')).trim().slice(0, 9000)
}

/** The question as words, ignoring filler a person types ("the", "in", "how many"). */
const FILLER = new Set(['the', 'a', 'an', 'in', 'at', 'of', 'for', 'do', 'does', 'they', 'have', 'has', 'what', 'which', 'is', 'are', 'how', 'many', 'to', 'on', 'with', 'use', 'using', 'total', 'and'])
export function queryWords(q) {
  const all = words(q).split(' ').filter(Boolean)
  const kept = all.filter((w) => !FILLER.has(w))
  return kept.length ? kept : all
}

const indexes = new WeakMap()
/**
 * term (as words) → what searching it also looks for, for a list of synonym groups ([name, kind, same, narrower]). A "same" term
 * finds every same term and every narrower one of its group; a narrower term finds only itself, but is still a unit, so
 * "nibp pump" is not split into "nibp" and "pump". Built once per list.
 */
function synonymIndex(groups) {
  let ix = indexes.get(groups)
  if (!ix) {
    ix = new Map()
    const norm = (ts) => [...new Set((ts || []).map(words).filter(Boolean))]
    for (const [, , same, narrower] of groups) {
      const s = norm(same), n = norm(narrower)
      for (const t of s) ix.set(t, [...new Set([...(ix.get(t) || []), ...s, ...n])])
      for (const t of n) if (!ix.has(t)) ix.set(t, [t])
    }
    indexes.set(groups, ix)
  }
  return ix
}

/**
 * The question as things to find: each is { alts }, the word (or phrase of up to three words) first, then every term that means
 * the same in the synonym groups. A record matches when it holds any of the alternatives of every term.
 */
export function queryTerms(q, groups = SYNONYM_GROUPS) {
  const ws = queryWords(q)
  const ix = synonymIndex(groups)
  const out = []
  for (let i = 0; i < ws.length;) {
    let took = 1, alts = [ws[i]]
    for (let n = Math.min(3, ws.length - i); n >= 1; n--) {
      const phrase = ws.slice(i, i + n).join(' ')
      if (ix.has(phrase)) { took = n; alts = [phrase, ...ix.get(phrase).filter((t) => t !== phrase)]; break }
    }
    out.push({ alts })
    i += took
  }
  return out
}

/** The other words a question is also being searched with (for "also matching: display, lcd …" under the box). */
export function alsoMatching(q, groups = SYNONYM_GROUPS) {
  return [...new Set(queryTerms(q, groups).flatMap((t) => t.alts.slice(1)))]
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * A pattern that finds, in any text, the words of the question and the words that mean the same, to highlight them. Group 1 is a
 * word that was typed, group 2 a word found only because it means the same. Words match across dashes and spaces ("li ion" finds
 * "Li-ion"), and a long number typed without dashes finds it with them (115102963 finds 115-102963-00). null for an empty question.
 */
export function highlightRegex(q, groups = SYNONYM_GROUPS) {
  const terms = queryTerms(q, groups)
  if (!terms.length) return null
  const typed = new Set(), same = new Set()
  for (const { alts } of terms) alts.forEach((a, i) => (i ? same : typed).add(a))
  for (const t of typed) same.delete(t)
  // The whole question, so a part number typed with its dashes is marked in one piece, not as 115 and 102963 and 00.
  const whole = queryWords(q)
  if (whole.length > 1) typed.add(whole.join(' '))
  const piece = (a) => {
    const flexible = a.split(' ').map(escapeRe).join('[^a-z0-9]+')
    return a.length >= 5 && !a.includes(' ') && /\d/.test(a) ? `${flexible}|${[...a].map(escapeRe).join('[^a-z0-9]?')}` : flexible
  }
  const group = (set) => [...set].sort((x, y) => y.length - x.length).map(piece).join('|')
  return new RegExp(`(${group(typed)})` + (same.size ? `|(${group(same)})` : ''), 'gi')
}

/** Text cut into pieces { text, hit }: hit 1 for a word that was typed, 2 for one that only means the same, 0 for the rest. */
export function splitHits(text, re) {
  const s = String(text ?? '')
  if (!re || !s) return [{ text: s, hit: 0 }]
  const out = []
  let last = 0
  for (const m of s.matchAll(re)) {
    if (!m[0]) continue
    if (m.index > last) out.push({ text: s.slice(last, m.index), hit: 0 })
    out.push({ text: m[0], hit: m[1] != null ? 1 : 2 })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ text: s.slice(last), hit: 0 })
  return out
}

/** A short piece of `text` for a result row: from the start, unless the first match is further on, then around it. */
export function snippet(s, n = 150, re) {
  const t = String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  const at = re ? t.search(re) : -1
  if (at >= n - 25) {
    const start = Math.max(0, at - 40)
    return '…' + t.slice(start, start + n).trim() + (start + n < t.length ? '…' : '')
  }
  return t.slice(0, n).trimEnd() + '…'
}

/** Records matching every word of the question (or a word that means the same), best first. Empty question: everything, as stored. */
export function searchRecords(kind, records, q, groups = SYNONYM_GROUPS) {
  const terms = queryTerms(q, groups)
  if (!terms.length) return records
  const main = SHAPE[kind].main
  const joined = queryWords(q).join('')
  const scored = []
  for (const r of records) {
    const hay = r.search || ''
    if (!terms.every((t) => t.alts.some((a) => hay.includes(a)))) continue
    let score = 0
    const lead = main.flatMap((f) => (Array.isArray(r[f]) ? r[f] : [r[f]])).filter(Boolean).map(words)
    for (const { alts } of terms) {
      const [w] = alts
      if (lead.some((t) => t.split(' ').includes(w))) score += 10
      else if (lead.some((t) => t.includes(w))) score += 6
      else if (hay.includes(w)) score += 1
      else score += alts.some((a) => lead.some((t) => t.includes(a))) ? 3 : 0.5 // only a word that means the same
    }
    if (lead.some((t) => compact(t) === joined)) score += 100
    scored.push([score, r])
  }
  return scored.sort((a, b) => b[0] - a[0]).map((x) => x[1])
}

/** How many devices fall under each value of a field ("site", "dept", "model", "version", or an extra column), most first. */
export function countBy(devices, field) {
  const tally = new Map()
  for (const d of devices) {
    const v = (field in d ? d[field] : d.extra?.[field]) || '(blank)'
    tally.set(v, (tally.get(v) || 0) + 1)
  }
  return [...tally].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n || a.value.localeCompare(b.value))
}

/** The fields a device list can be grouped by: the fixed ones, then every other column that was imported. */
export function groupFields(devices) {
  const extra = new Set()
  for (const d of devices) for (const k of Object.keys(d.extra || {})) extra.add(k)
  return ['site', 'dept', 'model', 'version', ...[...extra].sort()]
}

/** Parts a record names that exist in the catalogue (by number or alias), for "related parts" links. */
export function relatedParts(rec, parts) {
  const wanted = new Set([...(rec.parts || []), ...(rec.aliases || []), rec.partNo].filter(Boolean).map(compact))
  return parts.filter((p) => wanted.has(compact(p.partNo)) || (p.aliases || []).some((a) => wanted.has(compact(a))))
}

/** Records that name this part by its number or an alias: articles and past jobs. */
export function mentioning(part, records) {
  const codes = [part.partNo, ...(part.aliases || [])].filter(Boolean).map(compact).filter(Boolean)
  return records.filter((r) => codes.some((c) => (r.parts || []).some((p) => compact(p) === c)))
}

// ── Import: a spreadsheet or CSV into records ─────────────────────────────────────────────────────

/** The headings each field is found under (matched as words), plus any a person types. */
const HEADINGS = {
  part: {
    partNo: ['part number', 'part no', 'part', 'part #', 'p n', 'pn', 'number', 'code', 'item', 'item code', 'stock code', 'catalogue number', 'catalog number'],
    name: ['name', 'description', 'part name', 'item name'],
    aliases: ['aliases', 'alias', 'also called', 'other names', 'aka', 'also known as', 'alternative names', 'synonyms'],
    fits: ['fits', 'models', 'model', 'used on', 'compatible', 'compatible with', 'suits', 'equipment'],
    notes: ['notes', 'note', 'comments', 'comment', 'info'],
    diagram: ['diagram', 'figure', 'image', 'picture', 'drawing', 'link', 'manual', 'page'],
  },
  device: {
    site: ['site', 'customer', 'hospital', 'location', 'facility', 'client'],
    dept: ['dept', 'department', 'ward', 'ward location', 'ward/location', 'area', 'unit'],
    model: ['model', 'device model', 'equipment', 'description', 'device'],
    serial: ['serial', 'serial number', 'serial no', 's n', 'sn'],
    version: ['version', 'software', 'software version', 'firmware', 'sw version'],
    options: ['options', 'option', 'configuration', 'config'],
    notes: ['notes', 'note', 'comments', 'comment'],
  },
  job: {
    jobNo: ['job', 'job number', 'job no', 'job #', 'number', 'id'],
    title: ['fault summary', 'title', 'name', 'job name', 'description', 'summary'],
    notes: ['notes', 'job notes', 'work done', 'work performed', 'details', 'comments', 'report', 'job description', 'invoice notes'],
    model: ['model', 'models', 'device', 'equipment'],
    parts: ['parts pns', 'parts used', 'part numbers', 'parts', 'part', 'materials'],
    site: ['site', 'customer', 'hospital', 'location'],
    date: ['date', 'completed', 'completed date', 'job date', 'closed', 'created'],
  },
}

/** Column index for each field of the kind, by the first heading that matches; a heading is used once. */
export function mapHeaders(kind, headers) {
  const map = {}, taken = new Set()
  const wanted = HEADINGS[kind] || {}
  const hw = headers.map(words)
  for (const [field, names] of Object.entries(wanted)) {
    for (const name of names) {
      const i = hw.findIndex((h, idx) => h === words(name) && !taken.has(idx))
      if (i >= 0) { map[field] = i; taken.add(i); break }
    }
  }
  return { map, taken }
}

/** The first row with at least two recognised headings is the header row (people put titles above it). */
export function findHeaderRow(kind, rows) {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const { map } = mapHeaders(kind, (rows[i] || []).map(String))
    if (Object.keys(map).length >= 2 || (kind === 'part' && 'partNo' in map)) return i
  }
  return -1
}

const tidy = (s, max = 700) => String(s ?? '').replace(/\s*\|\s*/g, '; ').replace(/[ \t]+/g, ' ').trim().slice(0, max)
const flat = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const headed = (head) => { const t = String(head).replace(/[_]+/g, ' ').trim(); return t.charAt(0).toUpperCase() + t.slice(1) }

// A parts list's other columns become "Label: value" lines in the notes (so they are searchable and shown), in this order.
const PART_LINES = { status: 'Status', 'superseded by': 'Replaced by', supersedes: 'Replaces', 'conflict note': 'Note', category: 'Category', 'typical faults': 'Typical faults', 'job refs': 'Used on jobs' }
const PART_ORDER = ['Status', 'Replaced by', 'Replaces', 'Note', 'Category', 'Typical faults', 'Seen', 'Used on jobs']
// Columns that only repeat what is already there, or are bookkeeping.
const PART_SKIP = new Set(['search text', 'date basis', 'conflict ids', 'conflict confidence', 'keywords', 'first seen', 'last seen', 'jobs count', 'pn variants seen', 'name confidence'])

/** A part row's extra columns: status, what replaced it, a warning, typical faults and the jobs it was used on, in `notes`; mistyped spellings of its number in `aliases`. */
function enrichPart(input, row, headers, taken) {
  const lines = new Map()
  const col = (name) => { const i = headers.findIndex((h) => words(h) === name); return i >= 0 ? cell(row[i]) : '' }
  headers.forEach((head, i) => {
    const key = words(head), v = tidy(cell(row[i]))
    if (taken.has(i) || !head || !v || PART_SKIP.has(key)) return
    lines.set(PART_LINES[key] || headed(head), v)
  })
  const seen = [col('first seen'), col('last seen')].filter(Boolean)
  const jobs = Number(col('jobs count'))
  if (seen.length || jobs) lines.set('Seen', [seen.length ? (seen[0] === seen[1] || seen.length === 1 ? seen[0] : seen.join(' to ')) : '', jobs ? `${jobs} job${jobs === 1 ? '' : 's'}` : ''].filter(Boolean).join(', '))
  if (/^low$/i.test(col('name confidence'))) lines.set('Name confidence', 'Low')
  const ordered = [...PART_ORDER.filter((l) => lines.has(l)), ...[...lines.keys()].filter((l) => !PART_ORDER.includes(l))]
  input.notes = [input.notes, ...ordered.map((l) => `${l}: ${lines.get(l)}`)].filter(Boolean).join('\n')
  const variants = col('pn variants seen').replace(/\s*\(x\d+\)/g, '').replace(/\s*\|\s*/g, '; ') // "115-050780 (x4)" is a count of how often it was written that way
  if (variants) input.aliases = [input.aliases, variants].filter(Boolean).join('; ')
}

/** A part's notes read back into what the page shows apart: its status, what replaced it, a warning and the jobs; the rest stays text. */
export function partInfo(notes) {
  const info = { status: '', replacedBy: [], replaces: [], note: '', jobs: [], rest: [] }
  const list = (s) => s.split(/[;,]/).map((x) => x.trim()).filter(Boolean)
  for (const line of String(notes || '').split('\n')) {
    const m = /^(Status|Replaced by|Replaces|Note|Used on jobs): (.*)$/.exec(line)
    if (!m) { info.rest.push(line); continue }
    if (m[1] === 'Status') info.status = m[2].trim()
    else if (m[1] === 'Replaced by') info.replacedBy = list(m[2])
    else if (m[1] === 'Replaces') info.replaces = list(m[2])
    else if (m[1] === 'Note') info.note = m[2].trim()
    else info.jobs = list(m[2])
  }
  info.rest = info.rest.join('\n').trim()
  return info
}

const JOB_LINES = { 'job type': 'Type', 'stage status': 'Stage', 'parts named': 'Parts named', serials: 'Serials' }
const JOB_SKIP = new Set(['date basis', 'description', 'work done'])

/** A job row: the short fault as the title, the description and work done (where the notes don't already say it) then the notes, and type, stage, parts named and serials as lines under them. */
function enrichJob(input, row, headers, taken) {
  const col = (name) => { const i = headers.findIndex((h) => words(h) === name); return i >= 0 ? cell(row[i]) : '' }
  const notes = input.notes || ''
  const has = (text) => flat(notes).includes(flat(text))
  const description = col('description'), work = col('work done')
  const body = []
  if (description && flat(description) !== flat(input.title) && !has(description)) body.push(description)
  if (work && !has(work) && !flat(description).includes(flat(work))) body.push('Work done: ' + work)
  if (notes) body.push(notes)
  const meta = []
  headers.forEach((head, i) => {
    const key = words(head), v = tidy(cell(row[i]), 300)
    if (taken.has(i) || !head || !v || JOB_SKIP.has(key)) return
    meta.push(`${JOB_LINES[key] || headed(head)}: ${v}`)
  })
  input.notes = [...body, ...(body.length && meta.length ? [''] : []), ...meta].join('\n')
}

/**
 * Rows (arrays of cells, header row first) into records of the kind.
 * Devices keep every unrecognised column as `extra`, so an SpO2 type or a WiFi column is searchable and can be grouped on.
 * `defaults` fills a field a row leaves blank (a customer workbook has no Site column: the file's name is the site), and its
 * `extra` adds columns to every device (the sheet's name).
 * Returns { records, skipped } where skipped counts rows with nothing usable.
 */
export function rowsToRecords(kind, rows, defaults = {}) {
  const h = findHeaderRow(kind, rows)
  if (h < 0) return { records: [], skipped: 0, error: 'Could not find a heading row. Expected headings like: ' + Object.values(HEADINGS[kind]).map((n) => n[0]).join(', ') + '.' }
  const headers = rows[h].map((c) => String(c ?? '').trim())
  const { map, taken } = mapHeaders(kind, headers)
  const records = []
  let skipped = 0
  for (const row of rows.slice(h + 1)) {
    const input = {}
    for (const [field, i] of Object.entries(map)) input[field] = cell(row[i])
    for (const [field, v] of Object.entries(defaults)) if (field !== 'extra' && !input[field]) input[field] = v
    if (kind === 'part') enrichPart(input, row, headers, taken)
    else if (kind === 'job') enrichJob(input, row, headers, taken)
    if (kind === 'device') {
      input.extra = { ...(defaults.extra || {}) }
      headers.forEach((head, i) => { if (!taken.has(i) && head && cell(row[i])) input.extra[head] = cell(row[i]) })
    }
    const rec = buildRecord(kind, input)
    const key = kind === 'part' ? rec.partNo : kind === 'job' ? rec.jobNo || rec.title : rec.model || rec.serial
    if (!key) { skipped++; continue }
    records.push(rec)
  }
  return { records, skipped }
}

/**
 * An article's body as blocks to draw, never as HTML: paragraphs, "- " bullet lines, "1. " numbered ones, **bold** and http(s) links.
 * The page draws each piece as React text, so nothing a person types can inject markup.
 */
export function richBlocks(body) {
  const inline = (text) => {
    const out = []
    const re = new RegExp(String.raw`\*\*([^*]+)\*\*|(https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)])|(${PICTURE_MARK.source})`, 'g')
    let last = 0, m
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ t: 'text', text: text.slice(last, m.index) })
      out.push(m[1] != null ? { t: 'bold', text: m[1] } : m[2] != null ? { t: 'link', text: m[2], href: m[2] } : { t: 'pic', text: m[3], page: Number(m[5]) || 0 })
      last = m.index + m[0].length
    }
    if (last < text.length) out.push({ t: 'text', text: text.slice(last) })
    return out
  }
  const blocks = []
  for (const raw of String(body || '').split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { blocks.push({ type: 'gap' }); continue }
    // "- step" or "1. step" ("a. step" only when indented, so a sentence starting "I." is not a list); two spaces a level.
    const item = /^(\s*)(?:[-*•]|(\d{1,3}|[a-z]|[ivxl]{1,5})([.)]))\s+(.*)$/.exec(line)
    if (item && (!item[2] || /^\d/.test(item[2]) || item[1].length >= 2)) {
      blocks.push({ type: 'li', level: Math.min(Math.floor(item[1].length / 2), 5), marker: item[2] ? item[2] + item[3] : null, parts: inline(item[4]) })
    } else blocks.push({ type: 'p', parts: inline(line) })
  }
  return blocks.filter((b, i) => b.type !== 'gap' || (i > 0 && blocks[i - 1].type !== 'gap' && i < blocks.length - 1))
}

/** A cell as text: dates as 2026-11-06, rich text and formulas as what they show. */
export function cell(v) {
  if (v == null) return ''
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('result' in v) return cell(v.result)
    if ('text' in v) return String(v.text)
    if ('richText' in v) return v.richText.map((r) => r.text).join('')
    return ''
  }
  return String(v).trim()
}

/** A CSV file's text into rows; quoted fields, doubled quotes and line breaks inside quotes are handled. */
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', quoted = false
  const s = String(text).replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++ } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((x) => x !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((x) => x !== '')) rows.push(row)
  return rows
}

/** The Firestore id of a record: what makes it the same record when a file is imported again. Articles get a random one in the store. */
export function recordId(kind, rec) {
  const slug = (s) => compact(s).slice(0, 60)
  if (kind === 'part') return 'p-' + slug(rec.partNo)
  if (kind === 'job') return 'j-' + slug(rec.jobNo || rec.title)
  if (kind === 'device') return 'd-' + slug(rec.site) + '-' + (rec.serial ? slug(rec.serial) : slug(rec.model + rec.dept) + '-' + hash(rec.search))
  return null
}
function hash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return h.toString(36)
}

/** Whether this person can change the knowledge base: an admin, or anyone an admin gave the editor switch. */
export const canEditKb = (profile) => !!profile && (profile.role === 'admin' || profile.kbEditor === true)
