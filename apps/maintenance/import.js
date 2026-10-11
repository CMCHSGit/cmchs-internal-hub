/* Reads the PM tracking spreadsheet into maintenance entries.

   Tolerant on purpose. The sheet is a working document, not an export: the
   header row isn't always first, columns have been renamed over the years,
   Site is often merged down a block of rows (so lower rows read as blank), and
   the due-date column mixes "Mar-26", "1/04/2026" and real Excel dates. The
   importer accepts all of that rather than making someone tidy the sheet
   before they can use the page. */

import { XLSXLite } from '../simprosync/reader.js'
import { parseDue, STATUSES } from './store.js'

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

// Each field, and the header spellings seen across the year tabs.
const FIELDS = [
  ['site', ['site', 'customer', 'sitecustomer']],
  ['wards', ['wards', 'ward', 'department', 'dept', 'location']],
  ['models', ['model', 'models', 'equipment', 'device', 'devices']],
  ['dueRaw', ['duedate', 'due', 'datedue', 'pmdue']],
  ['pmType', ['pmtype', 'type', 'pm']],
  ['status', ['status']],
  ['completeRaw', ['datecomplete', 'datecompleted', 'completed', 'completiondate']],
  ['notes', ['notes', 'note', 'comment', 'comments']],
  ['extraNotes', ['additionalnotes', 'extranotes', 'additionalnote', 'furthernotes']],
]

/** Finds the header row and maps each field to a column index. */
function readHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(norm)
    if (!cells.some((c) => c === 'site' || c === 'customer')) continue
    const map = {}
    for (const [field, names] of FIELDS) {
      const at = cells.findIndex((c) => c && names.includes(c))
      if (at >= 0) map[field] = at
    }
    // A row that only happens to contain the word "site" isn't a header.
    if (map.site !== undefined && (map.dueRaw !== undefined || map.models !== undefined)) {
      return { headerRow: r, map }
    }
  }
  return null
}

const cell = (row, i) => (i === undefined || row[i] == null ? '' : String(row[i]).replace(/\r/g, '').trim())
// Date cells arrive as { date: { y, m, d } }. They must reach parseDue as-is:
// String() on one yields "[object Object]", which parses as nothing.
const raw = (row, i) => (i === undefined ? null : row[i] ?? null)

function pickStatus(raw, dateComplete) {
  const s = norm(raw)
  if (!s) return dateComplete ? 'Completed' : 'Not started'
  // "PACU - Completed" and similar: the sheet qualifies the status with which
  // part is done. Treat it as completed and keep the original wording in notes.
  // The sheet records who did it in the same breath as whether it is done.
  if (s.includes('complete')) return s.includes('biomed') ? 'Completed by Biomeds' : 'Completed'
  if (s.includes('progress')) return 'In progress'
  if (s.includes('hold')) return 'On hold'
  return STATUSES.includes(String(raw).trim()) ? String(raw).trim() : 'Not started'
}

function pickPmType(raw) {
  const s = norm(raw)
  if (!s) return ''
  // Ordinals rather than just the first two: warranties run to different
  // lengths, so a third or fourth visit is ordinary. Anything unrecognised is
  // passed through as written rather than flattened to "Other" — a type the
  // sheet uses is worth keeping, and the list is editable on the page.
  const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth']
  for (let i = 0; i < ORDINALS.length; i++) {
    const word = ORDINALS[i]
    const nth = `${i + 1}${['st', 'nd', 'rd'][i] || 'th'}`
    if (s.includes(word) || s === nth || s === String(i + 1)) {
      return `${word[0].toUpperCase()}${word.slice(1)} PM`
    }
  }
  return String(raw).trim()
}

/**
 * Parses one sheet into entries.
 * `fallbackYear` comes from the tab name, used only when a row has no usable
 * due date at all — otherwise the date in the row always wins.
 */
export function parseSheet(rows, fallbackYear) {
  const head = readHeader(rows)
  if (!head) return { entries: [], skipped: 0, error: 'No header row found (expected a "Site" column).' }

  const { headerRow, map } = head
  const entries = []
  let skipped = 0
  let lastSite = ''
  const unreadable = []   // raw values of due cells we could not parse

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    if (!row.length) continue

    // Site is merged down a block in the sheet, so a blank one means "same as
    // the row above", not "no site".
    const site = cell(row, map.site) || lastSite
    if (cell(row, map.site)) lastSite = cell(row, map.site)

    const wards = cell(row, map.wards)
    const models = cell(row, map.models)
    const dueRaw = raw(row, map.dueRaw)
    const statusRaw = cell(row, map.status)
    const notes = cell(row, map.notes)
    const extraNotes = cell(row, map.extraNotes)

    // A row with nothing but an inherited site is spreadsheet padding.
    if (!wards && !models && dueRaw == null && !statusRaw && !notes && !extraNotes) { skipped++; continue }
    if (!site) { skipped++; continue }

    const due = parseDue(dueRaw)
    if (!due && dueRaw != null && String(dueRaw).trim() !== '') {
      unreadable.push(typeof dueRaw === 'object' ? JSON.stringify(dueRaw) : String(dueRaw))
    }
    const complete = parseDue(raw(row, map.completeRaw))
    const status = pickStatus(statusRaw, complete?.due)

    // Keep the sheet's own wording when it said more than our four statuses do
    // ("PACU - Completed") rather than flattening it away.
    const original = String(statusRaw || '').trim()
    const keptStatus = original && norm(original) !== norm(status) ? `Sheet status: ${original}` : ''
    const allNotes = [notes, keptStatus].filter(Boolean).join('\n')

    entries.push({
      site,
      wards,
      models,
      // No fallback. Defaulting an unreadable date to the sheet's year made
      // 58 rows all claim they were due in January, which looked like real
      // data. Blank is honest and the import preview counts these.
      due: due?.due || '',
      monthOnly: due ? due.monthOnly : true,
      pmType: pickPmType(cell(row, map.pmType)),
      status,
      dateComplete: complete?.due || '',
      notes: allNotes,
      extraNotes,
    })
  }

  return { entries, skipped, unreadable, columns: map, error: null }
}

/** Reads a whole workbook; one result per sheet, in sheet order. */
export async function readWorkbook(file) {
  const book = await XLSXLite.read(file)
  const out = []
  for (let i = 0; i < book.sheets.length; i++) {
    const name = book.sheets[i]
    const year = /(20\d{2})/.exec(name)?.[1]
    let rows = []
    let error = null
    try {
      rows = await book.rows(i)
    } catch (e) {
      error = e.message || String(e)
    }
    const parsed = error ? { entries: [], skipped: 0, unreadable: [], columns: {}, error } : parseSheet(rows, year ? Number(year) : null)
    out.push({ name, ...parsed })
  }
  return out
}
