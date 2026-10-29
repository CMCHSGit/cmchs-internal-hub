/* The planning workbook ("Planning resources for install"), read into the
   tracker's terms, and compared with what the tracker holds.

   What the team does with the workbook: the Team Planning sheet is a grid of
   jobs down the side and weeks (Mondays) across. A job's week is ONE coloured
   cell. The colour is from the legend on its Team Names sheet (Prep week,
   Go-live week, Apps support, Infrastructure, Demo /Trial, EST Testing…), the
   people are written in it as "MH/TF" ("?" before a name: not confirmed) and
   sometimes a few words ("Superuser", "Wifi survey", "Eng x2"). That is the
   same shape the Timeline shows now (model.js weekColourOf / peopleText).

   Reading: fills are theme colours with a tint in the file, turned into hex
   here. The grid doesn't always use the legend's exact colours (go-live green
   is 92D050 in the cells, A9D18E in the legend; "support" is gold), so a few
   are named by hand (GRID) and anything else by the nearest legend colour.
   Pure apart from readPlanSheet, which needs exceljs. Tests: tests/plan-sheet.test.mjs. */

import { weekColourOf, weekNoteOf, mondayOf, isISO } from './model.js'

/** The legend, as the workbook's Team Names sheet has it. */
export const LEGEND = {
  'Prep week': 'BDD7EE', 'Go-live week': 'A9D18E', 'Apps support': 'F4B183', Infrastructure: 'FFCCFF', 'Biomed Training': 'D0CECE',
  'Demo /Trial': 'FFF2CC', Conference: 'FFD966', 'Apps Training': 'E2F0D9', Upgrade: 'FF3399', 'EST Testing': 'FFFF00',
  'Change Freeze': '7030A0', Workshop: '0070C0',
}
// Colours the grid uses that the legend spells differently. FFE699 (the group header gold) is Conference on a conference row, else Demo /Trial.
const GRID = { '92D050': 'Go-live week', FFC000: 'Apps support', C5E0B4: 'Apps Training', FFE699: null }

const OFFICE_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']
const rgb = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) }

/** A theme colour with Excel's tint (lighter above 0, darker below) as hex. */
export function themeHex(theme, tint = 0) {
  const base = OFFICE_THEME[theme] || 'FFFFFF'
  if (!tint) return base
  const [r, g, b] = rgb(base).map((x) => x / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b)
  let l = (mx + mn) / 2, s = 0, h = 0
  if (mx !== mn) {
    const d = mx - mn
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn)
    h = mx === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6 : mx === g ? ((b - r) / d + 2) / 6 : ((r - g) / d + 4) / 6
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
  const out = s === 0 ? [l, l, l] : [f(h + 1 / 3), f(h), f(h - 1 / 3)]
  return out.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

/** The legend name for a cell's fill, '' for none or white, or '?HEX' when it matches nothing. */
export function colourName(hex, group = '') {
  if (!hex || hex === 'FFFFFF') return ''
  if (hex in GRID) return GRID[hex] || (/conference/i.test(group) ? 'Conference' : 'Demo /Trial')
  let best = '', d = Infinity
  for (const [name, h] of Object.entries(LEGEND)) { const x = dist(hex, h); if (x < d) { d = x; best = name } }
  return d < 40 ? best : '?' + hex
}

// ── the cell's text ──────────────────────────────────────────────────────
/**
 * "?JC/MH (GH weekend)" → people [{ i: 'JC', t: true }, { i: 'MH', t: false }] and note "(GH weekend)".
 * known: the initials that are people here; other two-letter words ("IT", "BD") stay in the note, listed in unknown.
 */
export function parseCell(text, known) {
  const people = [], notes = [], unknown = []
  const rest = String(text || '').replace(/\(([^)]*)\)/g, (_, x) => { notes.push('(' + x + ')'); return '' })
  for (const raw of rest.split(/[\/,]/)) {
    const tok = raw.trim()
    if (!tok) continue
    const m = /^(\?)?([A-Z]{2})$/.exec(tok)
    if (m && known.has(m[2])) people.push({ i: m[2], t: !!m[1] })
    else {
      // "TF Superuser": initials followed by words
      const m2 = /^(\?)?([A-Z]{2})\s+(.+)$/.exec(tok)
      if (m2 && known.has(m2[2])) { people.push({ i: m2[2], t: !!m2[1] }); notes.push(m2[3]) } else { if (m && m[2] !== 'IT') unknown.push(tok); notes.push(tok) }
    }
  }
  // no initials at all ("Wifi survey", "?Go/live"): the whole cell is the note, as written
  return { people, note: people.length ? notes.join(' ').trim() : String(text || '').trim(), unknown }
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

/** Which staff member each set of initials is: unique ones directly, a shared one by the workbook's Team Names sheet. */
export function initialsMap(staff, teamNames = []) {
  const by = new Map()
  for (const p of staff) { const k = (p.initials || '').toUpperCase(); if (!by.has(k)) by.set(k, []); by.get(k).push(p) }
  const out = new Map(), ambiguous = []
  for (const [i, list] of by) {
    if (list.length === 1) { out.set(i, list[0]); continue }
    const named = teamNames.find((t) => t.initials === i)
    const hit = named && list.find((p) => norm(p.name) === norm(named.name) || norm(p.name.split(' ')[0]) === norm(named.name.split(' ')[0]))
    if (hit) out.set(i, hit); else { out.set(i, list[0]); ambiguous.push(i) }
  }
  return { map: out, ambiguous }
}

// ── the file ─────────────────────────────────────────────────────────────
const cellText = (c) => {
  let x = c.value
  if (x instanceof Date) return isNaN(x) ? '' : x.toISOString().slice(0, 10)
  if (x && typeof x === 'object') x = x.richText ? x.richText.map((r) => r.text).join('') : x.result ?? x.text ?? ''
  if (x instanceof Date) return isNaN(x) ? '' : x.toISOString().slice(0, 10)
  return x == null ? '' : String(x).replace(/\s+/g, ' ').trim()
}
const cellFill = (c) => {
  const f = c.fill
  if (!f || f.type !== 'pattern' || f.pattern === 'none' || !f.fgColor) return ''
  return f.fgColor.argb ? f.fgColor.argb.slice(-6).toUpperCase() : f.fgColor.theme !== undefined ? themeHex(f.fgColor.theme, f.fgColor.tint || 0) : ''
}

/**
 * The workbook's Team Planning sheet as rows: { name, status, start, end, group, cells: [{ week, colour, text }] },
 * its weeks (Mondays), and the Team Names sheet's people ({ name, initials }). buffer: an ArrayBuffer of the .xlsx.
 */
export async function readPlanSheet(buffer) {
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.getWorksheet('Team Planning') || wb.worksheets.find((w) => /install \/ trial/i.test(cellText(w.getRow(1).getCell(1))))
  if (!ws) throw new Error('No "Team Planning" sheet in this file. Is it the planning workbook?')
  const weeks = []
  for (let c = 5; c <= ws.columnCount; c++) {
    const v = ws.getRow(1).getCell(c).value
    if (v instanceof Date && !isNaN(v)) weeks.push([c, mondayOf(v.toISOString().slice(0, 10))])
  }
  if (!weeks.length) throw new Error('The Team Planning sheet has no week dates along its first row.')
  const rows = []
  let group = ''
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), name = cellText(row.getCell(1))
    if (!name) continue
    const status = cellText(row.getCell(2)), start = cellText(row.getCell(3)), end = cellText(row.getCell(4))
    if (!status && !start && !end && cellFill(row.getCell(1)) === 'FFE699') { group = name; continue }
    const cells = []
    for (const [c, week] of weeks) {
      const cell = row.getCell(c), text = cellText(cell), colour = colourName(cellFill(cell), group)
      if (text || colour) cells.push({ week, colour, text })
    }
    rows.push({ name, status, start: isISO(start) ? start : '', end: isISO(end) ? end : '', group, cells })
  }
  const teamNames = []
  const tn = wb.getWorksheet('Team Names')
  if (tn) for (let r = 1; r <= tn.rowCount; r++) for (const c of [2, 3]) {
    const t = cellText(tn.getRow(r).getCell(c)), m = /^(.*?)\s*[-=]?\s*([A-Z]{2})\s*$/.exec(t)
    if (m && m[1]) teamNames.push({ name: m[1].trim(), initials: m[2] })
  }
  return { rows, weeks: weeks.map(([, w]) => w), teamNames }
}

// ── comparing with the tracker ───────────────────────────────────────────
const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1))
/** The tracker's job for a workbook row: same name, else the same start, else most words in common. null if none is close. */
export function matchJob(name, jobs) {
  const n = norm(name)
  const exact = jobs.find((j) => norm(j.name) === n)
  if (exact) return exact
  const pre = jobs.find((j) => n.length >= 12 && (norm(j.name).startsWith(n.slice(0, 20)) || n.startsWith(norm(j.name).slice(0, 20))))
  if (pre) return pre
  const w = words(name)
  let best = null, score = 0
  for (const j of jobs) {
    const x = words(j.name)
    const common = [...w].filter((k) => x.has(k)).length
    const s = common / Math.max(1, Math.min(w.size, x.size))
    if (s > score) { score = s; best = j }
  }
  return score >= 0.75 ? best : null
}

/**
 * What would make the tracker's weeks read like the workbook's.
 * ctx: { jobs, assignments, staff, teamNames, weeks, choices } where choices[rowName] = jobId for rows matched by hand
 * ('' or missing: skipped). Returns { changes, unmatched, notes } where each change is
 *   { jobId, job, week, kind: 'colour' | 'note' | 'add' | 'tentative' | 'remove' | 'clear-note', ... , optional }
 * 'optional' ones (removals, clearing) are things the workbook no longer says; they start unticked.
 */
export function diffPlan(rows, ctx) {
  const { jobs, assignments, staff, teamNames = [], weeks, choices = {} } = ctx
  const { map: who, ambiguous } = initialsMap(staff, teamNames)
  const known = new Set(who.keys())
  const changes = [], unmatched = [], notes = []
  if (ambiguous.length) notes.push(`${ambiguous.join(', ')} ${ambiguous.length === 1 ? 'is' : 'are'} shared by more than one person on the staff list; the first was used.`)
  const live = jobs.filter((j) => !j.archived)
  const weekSet = new Set(weeks)
  for (const row of rows) {
    const job = choices[row.name] ? jobs.find((j) => j.id === choices[row.name]) : matchJob(row.name, live)
    const hasWeeks = row.cells.length > 0
    if (!job) { if (hasWeeks) unmatched.push(row); continue }
    for (const week of weeks) {
      const cell = row.cells.find((c) => c.week === week)
      const mine = assignments.filter((a) => a.jobId === job.id && a.week === week)
      const colourNow = weekColourOf(job, week, assignments), noteNow = weekNoteOf(job, week)
      const base = { jobId: job.id, job: job.name, week }
      if (!cell) {
        // nothing in the workbook this week: what the tracker has is extra
        for (const a of mine) changes.push({ ...base, kind: 'remove', assignment: a, who: staff.find((p) => p.id === a.staffId)?.initials || '?', optional: true })
        if (colourNow) changes.push({ ...base, kind: 'colour', from: colourNow, to: '', optional: true })
        if (noteNow) changes.push({ ...base, kind: 'clear-note', from: noteNow, optional: true })
        continue
      }
      const e = parseCell(cell.text, known)
      if (cell.colour && !cell.colour.startsWith('?') && cell.colour !== colourNow) changes.push({ ...base, kind: 'colour', from: colourNow, to: cell.colour })
      if (e.note && e.note !== noteNow) changes.push({ ...base, kind: 'note', from: noteNow, to: e.note })
      else if (!e.note && noteNow) changes.push({ ...base, kind: 'clear-note', from: noteNow, optional: true })
      const want = new Map(e.people.map((p) => [who.get(p.i).id, p]))
      for (const [staffId, p] of want) {
        const a = mine.find((x) => x.staffId === staffId)
        if (!a) changes.push({ ...base, kind: 'add', staffId, who: p.i, tentative: p.t })
        else if (!!a.tentative !== p.t) changes.push({ ...base, kind: 'tentative', assignment: a, who: p.i, to: p.t })
      }
      for (const a of mine) if (!want.has(a.staffId)) changes.push({ ...base, kind: 'remove', assignment: a, who: staff.find((p) => p.id === a.staffId)?.initials || '?', optional: true })
      if (e.unknown.length) notes.push(`${row.name.slice(0, 40)}, week of ${week}: ${e.unknown.join(', ')} ${e.unknown.length === 1 ? 'isn\'t' : 'aren\'t'} on the staff list (kept as a note).`)
    }
  }
  return { changes, unmatched, notes: [...new Set(notes)] }
}

/** One change in words, for the list. */
export function describeChange(c) {
  switch (c.kind) {
    case 'colour': return c.to ? `colour ${c.from ? c.from + ' → ' : ''}${c.to}` : `colour ${c.from} cleared`
    case 'note': return `note “${c.to}”`
    case 'clear-note': return `note “${c.from}” cleared`
    case 'add': return `add ${c.tentative ? '?' : ''}${c.who}`
    case 'tentative': return `${c.who} ${c.to ? 'not confirmed (?)' : 'confirmed'}`
    case 'remove': return `remove ${c.who}`
    default: return c.kind
  }
}
