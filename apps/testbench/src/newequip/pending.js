/* Assets recorded on the new-equipment page while testing, before they are in the customer's workbook ("pending rows"). The page can't
   write into a OneDrive workbook, so the rows wait in the hub (Firestore `pendingAssets`) and come out as a block to paste under the
   asset list's last row, or as a .csv, laid out in the columns of the sheet they are going into. Plain functions (no Firebase, no
   React) so the tests run them as they are. */

/** The details recorded for an asset: [key, the column's usual heading, [other headings it goes by], loose match for a heading]. */
export const FIELDS = [
  ['site', 'Site ID', ['site id', 'site']],
  ['type', 'Device Type', ['device type', 'asset type']],
  ['manufacturer', 'Manufacturer', ['manufacturer', 'make']],
  ['model', 'Device Model', ['device model', 'model', 'model name', 'model number'], /model/],
  ['description', 'Description', ['description']],
  ['serial', 'Serial Number', ['serial number', 'serial no', 'serial'], /^serial/],
  ['asset', 'CHS Asset Number', ['chs asset number', 'chs asset no', 'chs asset'], /chs.*asset/],
  ['ward', 'Ward/Location', ['ward/location', 'ward / location', 'ward', 'location'], /ward|location/],
  ['installed', 'Install Date', ['install date', 'date installed', 'installed'], /install/],
  ['manufactured', 'Manufacture Date', ['manufacture date', 'date manufactured', 'manufactured'], /manufactur/],
  ['warranty', 'Warranty Expiry', ['warranty expiry', 'warranty expiry date', 'warranty end', 'warranty'], /warranty.*(expir|end)|expir.*warranty/],
  ['ecg', 'ECG Configuration', ['ecg configuration', 'ecg config', 'ecg'], /\becg\b/],
  ['co2', 'CO2 Configuration', ['co2 configuration', 'co2 config', 'co2'], /\bco2\b/],
  ['spo2', 'SPO2 Configuration', ['spo2 configuration', 'spo2 config', 'spo2'], /\bspo2\b/],
  ['software', 'Software Version', ['software version', 'software'], /software/],
  ['service', 'Service Agreement Level', ['service agreement level', 'service agreement', 'service level'], /service.*(agreement|level)/],
  ['job', 'Simpro Job', ['simpro job']],
]
export const FIELD_KEYS = FIELDS.map(([k]) => k)
export const MAX_VALUE = 200

const norm = (h) => String(h ?? '').trim().toLowerCase()
const oneLine = (v) => String(v ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_VALUE)
export const serialKey = (s) => String(s ?? '').trim().toUpperCase()

/** { row, errors }: the form's values tidied (one line each, trimmed) into a row holding exactly the known fields; the serial number is needed. */
export function cleanPending(form) {
  const row = {}
  for (const k of FIELD_KEYS) row[k] = oneLine(form?.[k])
  const errors = []
  if (!row.serial) errors.push('The serial number is needed.')
  return { row, errors }
}

/** What stops this row being added: [] when fine. A serial number already on the asset list, or already pending, is not added twice. */
export function clashes(row, units = [], pending = []) {
  const k = serialKey(row.serial)
  if (!k) return []
  const out = []
  if (units.some((u) => u.key === k)) out.push(`${row.serial} is already on the asset list.`)
  if (pending.some((p) => serialKey(p.serial) === k)) out.push(`${row.serial} is already waiting in the pending rows.`)
  return out
}

/**
 * What stops an edit being saved: [] when fine. The row's own entry (`original`, with its `id`) isn't a clash with itself; with the serial
 * number unchanged nothing clashes (it may be in the workbook by now, and the other details still want correcting).
 */
export function editClashes(row, original, units = [], pending = []) {
  if (serialKey(row.serial) === serialKey(original?.serial)) return []
  return clashes(row, units, pending.filter((p) => p.id !== original?.id))
}

/** The fields of a row that an edit changed, by their usual heading (for the confirmation, never the values). */
export const changedFields = (before, after) => FIELDS.filter(([k]) => String(before?.[k] ?? '') !== String(after?.[k] ?? '')).map(([, label]) => label)

/** The pending row as stored (from a form): the fields only. */
export const rowOf = (doc) => { const r = {}; for (const k of FIELD_KEYS) r[k] = String(doc?.[k] ?? ''); return r }

/** For each heading of a sheet, which field it holds (or null): by the usual names first, then the looser match. Each field is used once. */
export function mapHeaders(headers) {
  const used = new Set()
  return (headers || []).map((h) => {
    const n = norm(h)
    if (!n) return null
    let f = FIELDS.find(([k, , names]) => !used.has(k) && names.includes(n))
    if (!f) f = FIELDS.find(([k, , , loose]) => !used.has(k) && loose && loose.test(n))
    if (f) used.add(f[0])
    return f ? f[0] : null
  })
}

const cellText = (v) => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

/**
 * The rows laid out for pasting under a sheet's last row: tab-separated, one line per row, in that sheet's own column order (a column
 * the sheet has and the page doesn't record is left blank). With no `headers`, the usual order. `withHeader` puts the headings first.
 */
export function toTsv(rows, headers = null, withHeader = false) {
  const cols = headers && headers.length ? mapHeaders(headers) : FIELD_KEYS
  const names = headers && headers.length ? headers : FIELDS.map(([, label]) => label)
  const lines = rows.map((r) => cols.map((k) => (k ? cellText(r[k]) : '')).join('\t'))
  return (withHeader ? [names.map(cellText).join('\t'), ...lines] : lines).join('\n')
}

/** The same as a .csv file's text (headings first; quoted where needed; a leading = + - @ is made safe against being read as a formula). */
export function toCsv(rows, headers = null) {
  const cols = headers && headers.length ? mapHeaders(headers) : FIELD_KEYS
  const names = headers && headers.length ? headers : FIELDS.map(([, label]) => label)
  const q = (v) => {
    let s = String(v ?? '')
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  return [names.map(q).join(','), ...rows.map((r) => cols.map((k) => (k ? q(r[k]) : '')).join(','))].join('\r\n') + '\r\n'
}

/** The address of the Test Bench for a unit, as the asset list's "Test this device" links make it (device-link.js): device facts only. */
export function testLink(u, customerName = '') {
  const p = new URLSearchParams()
  const set = (k, v) => { const s = String(v ?? '').trim(); if (s) p.set(k, s) }
  set('model', u.model || u.description); set('serial', u.serial); set('manufacturer', u.manufacturer); set('customer', customerName)
  set('site', u.site); set('asset', u.asset); set('ward', u.ward)
  return '/testbench/?' + p.toString()
}

/** Serial numbers of rows with no Site ID: Simpro Asset Sync matches an asset within its site, so these can't be placed. */
export const missingSite = (rows) => rows.filter((r) => !String(r.site || '').trim()).map((r) => r.serial)

/** The boxes that drop down what the asset list (and the pending rows) already have, so a model or type is spelt the same way. */
export const CHOICE_KEYS = ['model', 'type', 'manufacturer']
/** The different values of one field across the asset list's units and the pending rows, sorted: ['BeneVision N1', 'TDS', …]. */
export function choicesFor(key, units = [], pending = []) {
  const seen = new Map()
  for (const r of [...units, ...pending]) { const v = oneLine(r && r[key]); if (v && v !== '-' && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v) }
  return [...seen.values()].sort((a, b) => a.localeCompare(b)).slice(0, 400)
}
/** A model picked that the list already has: the device type, description and manufacturer of one of them, for the boxes still empty. */
export function fillFromModel(form, units = []) {
  const m = oneLine(form && form.model).toLowerCase(); if (!m) return form
  const like = units.find((u) => oneLine(u.model).toLowerCase() === m); if (!like) return form
  const out = { ...form }
  for (const k of ['type', 'description', 'manufacturer']) if (!oneLine(out[k]) && oneLine(like[k]) && oneLine(like[k]) !== '-') out[k] = oneLine(like[k])
  return out
}
