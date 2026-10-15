// Breaks a pasted team-update email into separate announcements.
//
// Written for the project team's weekly "Next few weeks of places to be"
// email, whose shape is: a greeting, a few intro lines with links, a feature
// or two (a heading and a few paragraphs), then "The week that's been" and
// "Next week" as bullet lists, then a sign-off and a signature. Each bullet
// becomes its own announcement, filed under its section, with the regions
// and people it mentions picked out. A feature block becomes one
// announcement. The greeting, "And lots more…", the sign-off and the
// signature are dropped; the intro is kept but left unticked.
//
// Nothing here is final: Manage shows the result as drafts to tick, edit,
// merge or split before anything is posted. Pure functions apart from
// htmlToLines(), which needs a DOMParser (the browser's, or one passed in).

// ── Regions ───────────────────────────────────────────────────────────────

export const REGIONS = [
  'Northland', 'Auckland', 'Waikato', 'Bay of Plenty', 'Gisborne', 'Hawke’s Bay', 'Taranaki',
  'Manawatū-Whanganui', 'Wellington', 'Nelson Marlborough', 'West Coast', 'Canterbury', 'Otago', 'Southland',
  'Overseas',
]

// Places, hospitals and the abbreviations the team uses, by region. Matched
// as whole words, ignoring case and macrons. Longest names are tried first,
// so "North Shore" wins over "Shore".
const PLACES = {
  Northland: ['northland', 'whangarei', 'kaitaia', 'bay of islands', 'kawakawa', 'dargaville', 'te tai tokerau'],
  Auckland: ['auckland', 'manukau', 'north shore', 'nsh', 'middlemore', 'mmh', 'starship', 'acute care hub', 'ach', 'dccm', 'cvicu',
    'waitakere', 'franklin', 'waiuku', 'pukekohe', 'botany', 'east tamaki', 'greenlane', 'mercy', 'ascot', 'cass office', 'the office'],
  Waikato: ['waikato', 'hamilton', 'thames', 'tokoroa', 'taumarunui', 'te kuiti', 't hospitals', 'huntly', 'cambridge', 'matamata'],
  'Bay of Plenty': ['bay of plenty', 'bop', 'tauranga', 'rotorua', 'whakatane', 'taupo', 'lakes'],
  Gisborne: ['gisborne', 'tairawhiti'],
  'Hawke’s Bay': ['hawkes bay', 'hawke s bay', 'napier', 'hastings', 'wairoa'],
  Taranaki: ['taranaki', 'new plymouth', 'hawera'],
  'Manawatū-Whanganui': ['manawatu', 'palmerston north', 'palmy', 'whanganui', 'wanganui', 'midcentral', 'mid central', 'levin', 'feilding'],
  Wellington: ['wellington', 'hutt', 'kenepuru', 'wairarapa', 'masterton', 'porirua', 'capital coast', 'ccdhb'],
  'Nelson Marlborough': ['nelson', 'blenheim', 'marlborough', 'wairau', 'motueka', 'tasman'],
  'West Coast': ['west coast', 'greymouth', 'grey base', 'westport', 'hokitika'],
  Canterbury: ['canterbury', 'christchurch', 'timaru', 'ashburton', 'burwood', 'rangiora'],
  Otago: ['otago', 'dunedin', 'clutha', 'balclutha', 'oamaru', 'queenstown', 'lakes district', 'wanaka', 'alexandra', 'dunstan'],
  Southland: ['southland', 'invercargill', 'gore'],
  Overseas: ['overseas', 'china', 'australia', 'sydney', 'melbourne', 'brisbane', 'shenzhen', 'germany', 'singapore', 'usa'],
}

const fold = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'‘`]/g, ' ').replace(/[^a-z0-9]+/g, ' ')
const PLACE_LIST = Object.entries(PLACES).flatMap(([region, names]) => names.map(n => [fold(n).trim(), region]))
  .sort((a, b) => b[0].length - a[0].length)

/** The regions a piece of text mentions, in REGIONS order. */
export function detectRegions(text) {
  let hay = ` ${fold(text || '')} `
  const found = new Set()
  for (const [name, region] of PLACE_LIST) {
    const needle = ` ${name} `
    if (hay.includes(needle)) {
      found.add(region)
      hay = hay.split(needle).join(' ') // so "north shore" isn't also read as something shorter
    }
  }
  return REGIONS.filter(r => found.has(r))
}

// ── People ────────────────────────────────────────────────────────────────

/**
 * The people a piece of text names, as uids. `people` is [{ uid, names: [...] }]
 * where names are what someone might be called (first name, Excel name, "Jess C").
 * A name shared by two people matches neither, unless the text uses a longer form.
 */
export function detectPeople(text, people) {
  const hay = ` ${fold(text || '')} `
  const owners = new Map()
  for (const p of people) {
    for (const n of new Set(p.names.map(x => fold(x).trim()).filter(x => x.length >= 2))) {
      owners.set(n, [...(owners.get(n) || []), p.uid])
    }
  }
  const hits = new Set()
  const names = [...owners.keys()].sort((a, b) => b.length - a.length)
  let rest = hay
  for (const n of names) {
    const uids = owners.get(n)
    if (uids.length !== 1 || !rest.includes(` ${n} `)) continue
    hits.add(uids[0])
    rest = rest.split(` ${n} `).join(' ')
  }
  return [...hits]
}

// ── Pasted text -> lines ──────────────────────────────────────────────────

const BULLET = /^\s*(?:[•·▪◦●○■□➢➤►\-–*]|o(?=\s)|§|\d{1,2}[.)](?=\s))\s*/

/** Plain text (Outlook's text/plain, or typed) -> [{ text, bullet }], '' lines kept as blanks. */
export function textToLines(text) {
  return String(text || '').replace(/\r\n?/g, '\n').split('\n').map(raw => {
    const line = raw.replace(/ /g, ' ').replace(/\t/g, ' ')
    const bullet = BULLET.test(line) && !/^\s*-{2,}/.test(line)
    return { text: (bullet ? line.replace(BULLET, '') : line).replace(/\s+/g, ' ').trim(), bullet }
  })
}

/**
 * Outlook's text/html -> the same lines, keeping links as "label (url)" and
 * knowing a bullet from Outlook's list paragraphs as well as real <li>s.
 */
export function htmlToLines(html, Parser = globalThis.DOMParser) {
  const doc = new Parser().parseFromString(html, 'text/html')
  doc.querySelectorAll('style, script, head, title, meta, xml, o\\:p').forEach(n => n.remove())
  // Outlook's own bullet glyphs: <span style="mso-list:Ignore">·<span>   </span></span>
  doc.querySelectorAll('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]').forEach(n => n.remove())
  doc.querySelectorAll('a[href]').forEach(a => {
    const href = a.getAttribute('href') || ''
    const label = a.textContent.replace(/\s+/g, ' ').trim()
    if (/^(https?:|mailto:)/i.test(href) && !href.startsWith('mailto:') && label && !label.includes(href.replace(/^https?:\/\//, '').slice(0, 20))) {
      a.textContent = `${label} (${href})`
    } else if (/^https?:/i.test(href) && !label) {
      a.textContent = href
    }
  })
  doc.querySelectorAll('br').forEach(br => br.replaceWith('\n'))

  const lines = []
  const BLOCK = /^(P|DIV|LI|H[1-6]|TR|BLOCKQUOTE|UL|OL|TABLE|TBODY|SECTION|ARTICLE|BODY|CENTER)$/
  const push = (text, bullet) => {
    for (const part of text.split('\n')) lines.push({ text: part.replace(/ /g, ' ').replace(/\s+/g, ' ').trim(), bullet })
  }
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType !== 1) continue
      const tag = child.tagName
      const hasBlocks = [...child.children].some(c => BLOCK.test(c.tagName))
      const isList = tag === 'LI' || /MsoListParagraph/i.test(child.className || '') || /mso-list:\s*l\d/i.test(child.getAttribute('style') || '')
      if (BLOCK.test(tag) && hasBlocks && tag !== 'LI') walk(child)
      else if (BLOCK.test(tag) || isList) push(child.textContent, isList)
      else push(child.textContent, false)
    }
  }
  walk(doc.body)
  // Glyph bullets that survived as text ("· Sam was…")
  return lines.map(l => (!l.bullet && /^[•·▪◦●]\s/.test(l.text) ? { text: l.text.replace(BULLET, ''), bullet: true } : l))
}

// ── Lines -> drafts ───────────────────────────────────────────────────────

export const SECTIONS = { been: 'The week that’s been', next: 'Next week' }

const GREETING = /^(hi|hello|hey|kia ora|morning|good morning|afternoon|dear)\b[^.!?]{0,30}[,!.]?$/i
const CLOSING = /^(cheers|regards|kind regards|best regards|many thanks|thanks|thank you|ng[aā] mihi|nga mihi)[\s,!.]*$|^thanks (everyone|all|team)\b/i
const SIGNATURE = /^(web|tel|phone|mob(ile)?|free|fax|email|e)\s*:|cass medical|connected healthcare systems|www\.|^\+?\d[\d\s()-]{7,}$/i
const FILLER = /^(and )?(lots|plenty|heaps) (more|else)\b|^\.{2,}$|^…+$/i
const SECTION_BEEN = /week that.?s been|^last week|^this week|^the week (gone|past)|^what.?s been happening/i
const SECTION_NEXT = /^next week|^coming up|^week ahead|^upcoming|^the week ahead|^next few weeks|^on the road next/i
const INTRO_HINT = /schedule|planner|let me know|missed anything|click on the link|fill(ed)? in/i

const words = s => s.split(/\s+/).filter(Boolean)
const titleCase = s => {
  const w = words(s).filter(x => /^[A-Za-z]/.test(x))
  return w.length >= 3 && w.filter(x => /^[A-Z0-9]/.test(x)).length / w.length >= 0.75
}
const stripEnd = s => s.replace(/[\s:–—-]+$/, '').trim()

/** A short line that labels the bullets after it ("The week that's been:"). */
function isSectionHeading(lines, i) {
  const l = lines[i]
  if (l.bullet || !l.text || l.text.length > 60) return false
  if (SECTION_BEEN.test(l.text) || SECTION_NEXT.test(l.text)) return true
  if (!/:\s*$/.test(l.text)) return false
  for (let j = i + 1; j < lines.length; j++) if (lines[j].text) return lines[j].bullet
  return false
}

/** Up to ~90 characters, cut at a word, for a title. */
export function shortTitle(text, max = 90) {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  return cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:–-]+$/, '') + '…'
}

function draft(fields, people) {
  const text = `${fields.title} ${fields.body || ''}`
  return {
    key: Math.random().toString(36).slice(2, 10),
    include: true,
    category: 'Announcements',
    section: '',
    body: '',
    ...fields,
    regions: detectRegions(text),
    people: people ? detectPeople(text, people) : [],
  }
}

/**
 * Lines -> draft announcements:
 *   [{ key, include, title, body, category, section, regions, people, note? }]
 * `people` (optional) is for detectPeople().
 */
export function splitLines(lines, { people = null } = {}) {
  // Trim the greeting and everything from the sign-off on.
  let start = 0
  while (start < lines.length && (!lines[start].text || GREETING.test(lines[start].text))) start++
  let end = lines.length
  for (let i = start; i < lines.length; i++) {
    const t = lines[i].text
    if (!lines[i].bullet && (CLOSING.test(t) || (SIGNATURE.test(t) && i > start + 2))) { end = i; break }
  }
  const body = lines.slice(start, end)

  const out = []
  let section = null // { key: 'been'|'next'|'', label }
  let block = null   // a run of plain lines: { lines: [], blanks }

  const flushBlock = () => {
    if (!block) return
    const texts = block.lines.filter(Boolean)
    block = null
    if (!texts.length) return
    // A title-case first line is a heading ("StepUp4ICU Challenge"); otherwise the first sentence is the title.
    let title, rest
    if (texts.length > 1 && (titleCase(texts[0]) || texts[0].length <= 70 && !/[.!?,]$/.test(texts[0]))) {
      title = stripEnd(texts[0]); rest = texts.slice(1)
    } else {
      const first = texts[0].match(/^(.{20,}?[.!?])\s+(.*)$/)
      title = shortTitle(first ? first[1] : texts[0]); rest = first ? [first[2], ...texts.slice(1)] : texts.slice(1)
      if (!first && title.endsWith('…')) rest = [texts[0], ...texts.slice(1)]
    }
    const isIntro = !out.length && INTRO_HINT.test(texts.join(' '))
    out.push(draft({
      title, body: rest.join('\n'),
      category: /challenge|fundrais|donat|event|party|conference|expo|function|celebrat/i.test(texts.join(' ')) ? 'Events' : 'Announcements',
      include: !isIntro,
      ...(isIntro ? { note: 'The email’s intro. Usually not needed as an announcement.' } : {}),
    }, people))
  }

  for (let i = 0; i < body.length; i++) {
    const l = body[i]
    if (isSectionHeading(body, i)) {
      flushBlock()
      const t = stripEnd(l.text)
      section = { key: SECTION_BEEN.test(t) ? 'been' : SECTION_NEXT.test(t) ? 'next' : '', label: t }
      continue
    }
    if (l.bullet) {
      flushBlock()
      if (!l.text || FILLER.test(l.text)) continue
      out.push(draft({
        title: shortTitle(l.text, 140),
        body: l.text.length > 140 ? l.text : '',
        category: section?.key ? 'Team news' : 'Announcements',
        section: section?.key || '',
        ...(section && !section.key ? { note: `From “${section.label}”` } : {}),
      }, people))
      continue
    }
    if (!l.text) {
      if (block) block.blanks++
      continue
    }
    if (FILLER.test(l.text)) continue
    // Plain text after a bullet list ends that section.
    if (section && out.length && i > 0) section = null
    // Two blank lines, or a blank then a Title Case line, starts a new block.
    if (block && (block.blanks >= 2 || (block.blanks >= 1 && titleCase(l.text) && !/[.!?]$/.test(l.text)))) flushBlock()
    if (!block) block = { lines: [], blanks: 0 }
    block.lines.push(l.text)
    block.blanks = 0
  }
  flushBlock()
  return out
}

/** The whole job: pasted HTML (preferred) or plain text -> drafts. */
export function splitEmail({ html = '', text = '' }, opts = {}) {
  const lines = html && /<(p|div|li|br|table)\b/i.test(html) ? htmlToLines(html, opts.Parser) : textToLines(text)
  return splitLines(lines, opts)
}
