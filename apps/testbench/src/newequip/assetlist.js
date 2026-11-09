/* A customer's asset list as units, and what is known of each: its bench test and its saved report. READ ONLY, and plain functions (no
   Firebase, no React) so the tests run them as they are. The workbook is read with Simpro Asset Sync's own reader (reader.js: the
   unzipped XML, no library that could damage a customer's tables), and the rows through its own rules (core.js), so this page and Asset
   Sync always agree on what a row is: the serial number is the key, blank cells are blank, Excel errors are not values. */
import { XLSXLite } from '../../../simprosync/reader.js'
import { SyncCore } from '../../../simprosync/core.js'
import { splitSerials } from '../bench-tests.js'

const norm = (h) => String(h ?? '').trim().toLowerCase()
export const serialKey = (s) => String(s ?? '').trim().toUpperCase()

/** Which header (as written) holds each thing, or undefined. The spellings these asset lists use, not a guess at others. */
function columns(header) {
  const find = (exact, loose) => header.find((h) => exact.includes(norm(h))) || (loose ? header.find((h) => h && loose.test(norm(h))) : undefined)
  return {
    serial: find(['serial number', 'serial no', 'serial'], /^serial/),
    manufacturer: find(['manufacturer', 'make']),
    type: find(['device type', 'asset type']),
    model: find(['device model', 'model', 'model name', 'model number'], /model/),
    description: find(['description']),
    asset: find(['chs asset number', 'chs asset no', 'chs asset'], /chs.*asset/),
    ward: find(['ward/location', 'ward / location', 'ward', 'location'], /ward|location/),
    site: find(['site id']),
    job: find(['simpro job']),
  }
}

/** The units in one sheet's rows (array of arrays, the first being the header), and that header: no units with `found: false` when the sheet has no serial number column. */
export function unitsOfRows(rows, sheet = '') {
  const { header, recs } = SyncCore.toRecords(rows)
  const c = columns(header)
  if (!c.serial) return { found: false, units: [], header }
  const text = (r, k) => (k ? SyncCore.asText(r[k]).trim() : '')
  const units = []
  for (const { rownum, r } of recs) {
    const serial = text(r, c.serial)
    if (!serial || SyncCore.isErr(serial)) continue
    units.push({
      key: serialKey(serial), serial, sheet, row: rownum,
      manufacturer: text(r, c.manufacturer), type: text(r, c.type), model: text(r, c.model), description: text(r, c.description),
      asset: text(r, c.asset), ward: text(r, c.ward), site: text(r, c.site), job: text(r, c.job),
    })
  }
  return { found: true, units, header }
}

/** Every sheet of a workbook (the bytes, and its file name): { units, sheets: [{ name, count, header }], skipped: [names without a serial number column] }. */
export async function readAssetList(buffer, name = 'assets.xlsx') {
  const book = await XLSXLite.read({ name, arrayBuffer: async () => buffer })
  const units = [], sheets = [], skipped = []
  for (let i = 0; i < book.sheets.length; i++) {
    let rows
    try { rows = await book.rows(i) } catch { skipped.push(book.sheets[i]); continue }
    const got = unitsOfRows(rows, book.sheets[i])
    if (!got.found) { skipped.push(book.sheets[i]); continue }
    sheets.push({ name: book.sheets[i], count: got.units.length, header: got.header })
    units.push(...got.units)
  }
  return { units, sheets, skipped }
}

/** Serial numbers that appear more than once in the list (upper case), so the page can say so. */
export function duplicateSerials(units) {
  const seen = new Set(), dup = new Set()
  for (const u of units) { if (seen.has(u.key)) dup.add(u.key); seen.add(u.key) }
  return [...dup]
}

/**
 * The latest shared bench test of each unit, by serial number: Map key -> { overall: 'pass'|'fail'|'incomplete', finished, count }.
 * `tests` are the Test Bench's shared tests (benchTests: serial, overall, finished). Who ran them is not carried.
 */
export function benchByUnit(units, tests) {
  const want = new Set(units.map((u) => u.key)), out = new Map()
  for (const t of tests || []) {
    for (const k of new Set(splitSerials(t.serial).map(serialKey))) {   // a set tested together counts for each of its devices
      if (!k || !want.has(k)) continue
      const cur = out.get(k), when = Date.parse(t.finished || t.started || '') || 0
      if (!cur) out.set(k, { overall: t.overall, finished: t.finished || t.started || '', when, count: 1 })
      else { cur.count++; if (when >= cur.when) { cur.overall = t.overall; cur.finished = t.finished || t.started || ''; cur.when = when } }
    }
  }
  for (const v of out.values()) delete v.when
  return out
}

/** The reports saved on this PC for each unit: Map key -> { tests, unsent (something not yet sent to Simpro), sentTo (jobs) }. `groups` are reports.js groupReports. */
export function reportsByUnit(units, groups) {
  const want = new Set(units.map((u) => u.key)), out = new Map()
  for (const g of groups || []) {
    for (const k of new Set(splitSerials(g.serial).map(serialKey))) {   // one report for a set counts for each of its devices
      if (!k || !want.has(k)) continue
      const cur = out.get(k) || { tests: 0, unsent: false, sentTo: [] }
      cur.tests++; cur.unsent = cur.unsent || Boolean(g.unsent)
      for (const j of g.sentTo || []) if (!cur.sentTo.includes(j)) cur.sentTo.push(j)
      out.set(k, cur)
    }
  }
  return out
}

/** Counts for the cards: units, how many have a bench test, passed, failed, and how many have a report saved on this PC. */
export function summary(units, bench, reports) {
  let tested = 0, passed = 0, failed = 0, saved = 0
  for (const u of units) {
    const b = bench.get(u.key)
    if (b) { tested++; if (b.overall === 'pass') passed++; else if (b.overall === 'fail') failed++ }
    if (reports.has(u.key)) saved++
  }
  return { units: units.length, tested, passed, failed, saved }
}

/** Units matching a search (any word, in serial, model, type, asset number, ward, site or job) and, when given, one sheet. */
export function filterUnits(units, { text = '', sheet = '' } = {}) {
  const words = String(text).toLowerCase().split(/\s+/).filter(Boolean)
  return units.filter((u) => (!sheet || u.sheet === sheet)
    && words.every((w) => [u.serial, u.manufacturer, u.type, u.model, u.description, u.asset, u.ward, u.site, u.job].join(' ').toLowerCase().includes(w)))
}
