/* Reads the service order spreadsheet into orders.

   One tab per stage ("In Progress", "Received", "Ready for shipping",
   "Completed or Sent Back", "CHS spare parts order"); the tab name decides
   the stage. Columns are found by header, not position, because the parser's
   copied row never had the Jobs column the sheet has, so some rows have been
   pasted one column out. */

import { XLSXLite } from '../simprosync/reader.js'
import { parseDate, STAGES } from './store.js'

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

// Each field, and the header spellings that mean it.
const HEADERS = [
  ['so', ['so', 'serviceorder', 'sono', 'orderno']],
  ['title', ['sotitle', 'title', 'description']],
  ['sn', ['sn', 'serial', 'serialno', 'serialnumber']],
  ['pn', ['pn', 'partno', 'partnumber']],
  ['partName', ['partname', 'part', 'parts']],
  ['needReturn', ['needreturn', 'return']],
  ['site', ['site', 'customer', 'customername']],
  ['notes', ['notes', 'note']],
  ['jobs', ['jobs', 'job', 'jobno', 'simprojob']],
  ['appliedBy', ['appliedby', 'reporter', 'rmaby', 'applicant']],
  ['dateRaised', ['dateraised', 'raised', 'ordersubmitted']],
  ['receivedDate', ['receiveddate', 'received', 'datereceived']],
  ['oldSo', ['oldso']],
  ['extraNotes', ['additionalnotes', 'extranotes']],
]
const DATES = ['dateRaised', 'receivedDate']

export function stageForTab(name) {
  const n = norm(name)
  if (n.includes('spare')) return 'CHS spare parts order'
  if (n.includes('complete') || n.includes('sentback')) return 'Completed or sent back'
  if (n.includes('ship')) return 'Ready for shipping'
  if (n.includes('receiv')) return 'Received'
  if (n.includes('progress')) return 'In progress'
  return null
}

function readHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(norm)
    const map = {}
    for (const [field, names] of HEADERS) {
      const at = cells.findIndex((c) => c && names.includes(c))
      if (at >= 0) map[field] = at
    }
    // Enough recognised columns that this is the header, not a stray word.
    if (Object.keys(map).length >= 3 && (map.so !== undefined || map.partName !== undefined)) return { headerRow: r, map }
  }
  return null
}

const text = (v) => (v == null ? '' : typeof v === 'object' && v.date ? `${v.date.y}-${v.date.m}-${v.date.d}` : String(v).replace(/\r/g, '').trim())

export function parseSheet(rows, stage) {
  const head = readHeader(rows)
  if (!head) return { orders: [], skipped: 0, error: 'No header row found (expected S.O or Part Name).' }
  const { headerRow, map } = head
  const orders = []
  let skipped = 0

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    const o = { stage }
    for (const [field] of HEADERS) {
      const v = map[field] === undefined ? '' : row[map[field]]
      o[field] = DATES.includes(field) ? parseDate(v) : text(v)
    }
    // The sheet's Jobs column sometimes holds a date: a parser row (which had
    // no Jobs column) pasted in, so everything from Date Raised on landed one
    // column early. Shift those back.
    const jobsRaw = row[map.jobs]
    if (map.jobs !== undefined && (jobsRaw?.date || /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/.test(o.jobs))) {
      const raw = (f) => (map[f] === undefined ? '' : row[map[f]])
      o.jobs = ''
      o.dateRaised = parseDate(jobsRaw)
      o.receivedDate = parseDate(raw('dateRaised'))
      o.oldSo = text(raw('receivedDate'))
      o.extraNotes = [text(raw('oldSo')), text(raw('extraNotes'))].filter(Boolean).join('\n')
    }
    if (!o.so && !o.partName && !o.pn && !o.site && !o.notes) { if (row.some((c) => text(c))) skipped++; continue }
    // The sheet carried a link to the old parser ("C:\Service Order
    // Parser.html") in a cell of its own. A row that is only file paths or
    // links is furniture, not an order.
    const filled = HEADERS.map(([f]) => o[f]).filter(Boolean)
    if (filled.every((v) => /^[a-z]:\\|^\\\\|^https?:\/\/|\.html?$/i.test(v))) { skipped++; continue }
    orders.push(o)
  }
  return { orders, skipped, error: null }
}

/** Reads a whole workbook; one result per tab, in tab order. */
export async function readWorkbook(file) {
  const book = await XLSXLite.read(file)
  const out = []
  for (let i = 0; i < book.sheets.length; i++) {
    const name = book.sheets[i]
    const stage = stageForTab(name)
    if (!stage) { out.push({ name, stage, orders: [], skipped: 0, error: `Not one of the ${STAGES.length} stage tabs — skipped.` }); continue }
    try {
      out.push({ name, stage, ...parseSheet(await book.rows(i), stage) })
    } catch (e) {
      out.push({ name, stage, orders: [], skipped: 0, error: e.message || String(e) })
    }
  }
  return out
}
