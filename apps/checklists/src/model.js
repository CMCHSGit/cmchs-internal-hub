/* Project checklists — reading a device export, and everything the list does with its devices.
   Plain functions with no screen and no database, so tests can run them (tests/checklists.test.mjs).

   Written for the Mindray central-station export of BeneVision N1 monitors (one row a device,
   25 columns, every value starting with a tab), but columns are found by header, not position,
   and the common spellings of each are accepted, so another export of devices can be loaded. */

export const STATUS_ORDER = ['Working', 'Standby', 'Offline', 'Shutdown', 'Unknown']

const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '')

// Each field of a device and the header spellings that mean it.
const HEADERS = [
  ['deviceId', ['deviceid', 'id']],
  ['category', ['devicecategory', 'category', 'devicetype', 'type']],
  ['model', ['devicemodel', 'model']],
  ['serial', ['deviceserialnumber', 'serialnumber', 'serialno', 'serial', 'sn']],
  ['name', ['devicename', 'name']],
  ['asset', ['assetnumber', 'assetno', 'asset']],
  ['statusText', ['devicestatus', 'status']],
  ['location', ['location', 'lastlocation']],
  ['facility', ['facility', 'site', 'hospital']],
  ['department', ['department', 'dept', 'ward']],
  ['room', ['roomno', 'room']],
  ['bed', ['bedno', 'bed']],
  ['version', ['version', 'softwareversion']],
  ['ip', ['ipaddress', 'ip']],
  ['wirelessMac', ['wirelessmacaddress']],
  ['wiredMac', ['wiredmacaddress']],
  ['history', ['locationdetailinfo', 'locationhistory']],
  ['error', ['errorinformation']],
]

/** A cell as plain text: the export pads every value with a tab and leaves control characters in some. */
export function cell(v) {
  if (v == null) return ''
  if (typeof v === 'object') {
    if (v.date) return `${v.date.y}-${String(v.date.m).padStart(2, '0')}-${String(v.date.d).padStart(2, '0')}`
    if (v.err) return ''
    return String(v.text ?? v.result ?? '')
  }
  return String(v).replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function readHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const cells = (rows[r] || []).map(norm)
    const map = {}
    for (const [field, names] of HEADERS) {
      const at = cells.findIndex((c) => c && names.includes(c))
      if (at >= 0) map[field] = at
    }
    // Enough recognised columns that this is the header row, not a stray word, and a way to tell devices apart.
    if (Object.keys(map).length >= 3 && (map.serial !== undefined || map.deviceId !== undefined)) return { headerRow: r, map }
  }
  return null
}

/** "Offline ( 2026-10-27  11:43:00 )" -> { status: 'Offline', since: '2026-10-27 11:43' }. */
export function parseStatus(text) {
  const t = cell(text)
  if (!t) return { status: 'Unknown', since: '' }
  const m = /^([A-Za-z][A-Za-z ]*?)\s*(?:\(\s*(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})(?::\d{2})?\s*\))?$/.exec(t)
  if (!m) return { status: t, since: '' }
  const word = m[1].trim()
  const status = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  return { status, since: m[2] ? `${m[2]} ${m[3].padStart(5, '0')}` : '' }
}

/**
 * The export's "Location Detail Info" is a log, newest first: "2026-10-23 12:02:57  Transit 7; 2026-10-22 ...".
 * The first entry is where the monitor was last seen.
 */
export function lastSeen(history) {
  const first = cell(history).split(';').map((s) => s.trim()).find(Boolean)
  if (!first) return { at: '', place: '' }
  const m = /^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})(?::\d{2})?\s*(.*)$/.exec(first)
  return m ? { at: `${m[1]} ${m[2].padStart(5, '0')}`, place: m[3].trim() } : { at: '', place: first }
}

const firstWord = (s) => cell(s).split(/\s+/)[0] || ''

/**
 * Where the monitor is, for sorting and for finding it: the export's Department when it has one, and when it
 * doesn't (6 of 218 in the first file) the first word of its location ("EDW W-ED RES02" -> EDW), marked as
 * a guess so the screen can say so.
 */
export function departmentOf({ department, location, lastPlace }) {
  const d = cell(department)
  if (d) return { department: d, guessed: false }
  const g = firstWord(location) || firstWord(lastPlace)
  return { department: g, guessed: !!g }
}

/** A Firestore-safe id for a device: its Device ID (the wired MAC) or, without one, its serial number. */
export function idFor(d) {
  const safe = (s) => cell(s).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  const id = safe(d.deviceId)
  if (id) return id
  const sn = safe(d.serial)
  return sn ? 'sn-' + sn : ''
}

/**
 * Turns a sheet's rows (the first row, or one near the top, is the header) into devices.
 * Returns { devices, skipped, duplicates, error }: `skipped` rows had no way to tell the device apart,
 * `duplicates` repeated a Device ID already in the file (the later row wins).
 */
export function parseDevices(rows) {
  const head = readHeader(rows)
  if (!head) return { devices: [], skipped: 0, duplicates: 0, error: 'No header row found. Expected columns such as Device Serial Number, Device Status and Department.' }
  const { headerRow, map } = head
  const byId = new Map()
  let skipped = 0
  let duplicates = 0
  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || []
    if (!row.some((c) => cell(c))) continue
    const get = (f) => (map[f] === undefined ? '' : cell(row[map[f]]))
    const { status, since } = parseStatus(get('statusText'))
    const seen = lastSeen(get('history'))
    const location = get('location') || seen.place
    const dep = departmentOf({ department: get('department'), location: get('location'), lastPlace: seen.place })
    const d = {
      deviceId: get('deviceId'), category: get('category'), model: get('model'), serial: get('serial'),
      name: get('name'), asset: get('asset'), status, statusSince: since,
      location, facility: get('facility'), department: dep.department, deptGuessed: dep.guessed,
      room: get('room'), bed: get('bed'), version: get('version').split(' ')[0],
      versionFull: get('version'), ip: get('ip'), wirelessMac: get('wirelessMac'), wiredMac: get('wiredMac'),
      lastSeenAt: seen.at, lastSeenIn: seen.place, error: get('error').replace(/^Error\s*\(\s*|\s*\)\s*$/g, '').trim(),
    }
    const id = idFor(d)
    if (!id) { skipped++; continue }
    if (byId.has(id)) duplicates++
    byId.set(id, { id, ...d })
  }
  return { devices: [...byId.values()], skipped, duplicates, error: null }
}

// ── What the list shows ────────────────────────────────────────────────────────────────────────────

export const RESULTS = { done: 'done', notfound: 'notfound' }

const isDone = (it) => it.result === RESULTS.done
const isLost = (it) => it.result === RESULTS.notfound

/** Counts for the top of the list. `items` are the list's devices, ticked or not. */
export function summarise(items) {
  const bySerial = new Map()
  const byStatus = {}
  const byDept = new Map()
  const byVersion = new Map()
  let done = 0
  let notfound = 0
  for (const it of items) {
    if (isDone(it)) done++
    else if (isLost(it)) notfound++
    const sn = (it.serial || '').toLowerCase()
    if (sn) bySerial.set(sn, (bySerial.get(sn) || 0) + 1)
    byStatus[it.status || 'Unknown'] = (byStatus[it.status || 'Unknown'] || 0) + 1
    const dn = it.department || ''
    const dep = byDept.get(dn) || { name: dn, total: 0, done: 0, notfound: 0 }
    dep.total++
    if (isDone(it)) dep.done++
    else if (isLost(it)) dep.notfound++
    byDept.set(dn, dep)
    const vn = it.version || ''
    byVersion.set(vn, (byVersion.get(vn) || 0) + 1)
  }
  const departments = [...byDept.values()].sort(byName)
  return {
    total: items.length,
    done, notfound, todo: items.length - done - notfound,
    uniqueSerials: bySerial.size,
    sharedSerials: [...bySerial.values()].filter((n) => n > 1).length,
    byStatus,
    departments,
    versions: [...byVersion].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }
}

/** Serial numbers that more than one device in the list carries. */
export function sharedSerials(items) {
  const n = new Map()
  for (const it of items) { const s = (it.serial || '').toLowerCase(); if (s) n.set(s, (n.get(s) || 0) + 1) }
  return new Set([...n].filter(([, c]) => c > 1).map(([s]) => s))
}

const collate = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true, sensitivity: 'base' })
// Devices with no department go last, as "No department" in the group headers.
const byName = (a, b) => (!a.name ? (b.name ? 1 : 0) : !b.name ? -1 : collate(a.name, b.name))

const SORT_VALUE = {
  department: (it) => it.department || '',
  status: (it) => { const i = STATUS_ORDER.indexOf(it.status); return i < 0 ? STATUS_ORDER.length : i },
  serial: (it) => it.serial || '',
  name: (it) => it.name || '',
  location: (it) => it.location || '',
  version: (it) => it.version || '',
  lastSeen: (it) => it.lastSeenAt || '',
  result: (it) => (isDone(it) ? 2 : isLost(it) ? 1 : 0),
}
export const SORT_KEYS = Object.keys(SORT_VALUE)

/** A copy of `items` sorted by `key` (department, status, serial, name, location, version, lastSeen, result). Blanks last either way; ties by department then name. */
export function sortItems(items, key = 'department', dir = 1) {
  const val = SORT_VALUE[key] || SORT_VALUE.department
  const blank = (v) => v === '' || v == null
  return [...items].sort((a, b) => {
    const av = val(a), bv = val(b)
    if (blank(av) !== blank(bv)) return blank(av) ? 1 : -1
    if (!blank(av)) {
      const c = typeof av === 'number' ? av - bv : collate(av, bv)
      if (c) return c * dir
    }
    return collate(a.department || '￿', b.department || '￿') || collate(a.name || '', b.name || '') || collate(a.id || '', b.id || '')
  })
}

/** Narrows the list. f: { q, status, department, show: all|todo|done|notfound, version } — blank means no filter. */
export function filterItems(items, f = {}) {
  const toks = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((it) => {
    if (f.status && it.status !== f.status) return false
    if (f.department !== undefined && f.department !== '' && (it.department || '') !== (f.department === NO_DEPARTMENT ? '' : f.department)) return false
    if (f.version && (it.version || '') !== f.version) return false
    if (f.show === 'todo' && (isDone(it) || isLost(it))) return false
    if (f.show === 'done' && !isDone(it)) return false
    if (f.show === 'notfound' && !isLost(it)) return false
    if (toks.length) {
      const hay = [it.name, it.serial, it.deviceId, it.location, it.department, it.ip, it.wirelessMac, it.wiredMac, it.note, it.doneByName, it.category, it.model].join(' ').toLowerCase()
      if (!toks.every((t) => hay.includes(t))) return false
    }
    return true
  })
}

/** The department filter's value for devices that have none. */
export const NO_DEPARTMENT = '__none__'

/** Consecutive runs of one department, for the headers between them: [{ department, items }]. */
export function groupByDepartment(sorted) {
  const out = []
  for (const it of sorted) {
    const d = it.department || ''
    const last = out[out.length - 1]
    if (last && last.department === d) last.items.push(it)
    else out.push({ department: d, items: [it] })
  }
  return out
}

// ── Export ──────────────────────────────────────────────────────────────────────────────────────────

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')

/** A Date or Firestore Timestamp as "27-Oct-2026 14:05" (NZ style), or ''. */
export function stamp(t) {
  const d = t?.toDate ? t.toDate() : t instanceof Date ? t : t ? new Date(t) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** "2026-10-27 11:43" as "27-Oct-2026 11:43". */
export function niceStamp(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?$/.exec(s || '')
  return m ? `${m[3]}-${MONTHS[+m[2] - 1]}-${m[1]}${m[4] ? ' ' + m[4] : ''}` : s || ''
}

export const RESULT_LABEL = { done: 'Done', notfound: 'Couldn’t find', '': '' }

export const EXPORT_HEADERS = [
  'Department', 'Device type', 'Model', 'Device name', 'Serial number', 'Status', 'Status since', 'Last location',
  'Last seen', 'Software version', 'Result', 'Done by', 'Done at', 'Note', 'Facility', 'Room', 'Bed',
  'IP address', 'Wireless MAC', 'Wired MAC', 'Device ID', 'Shares a serial with another device',
]

/** One row of cells per device, in EXPORT_HEADERS order. */
export function exportRows(items) {
  const shared = sharedSerials(items)
  return items.map((it) => [
    it.department || '', it.category || '', it.model || '', it.name || '', it.serial || '', it.status || '', niceStamp(it.statusSince),
    it.location || '', niceStamp(it.lastSeenAt), it.version || '', RESULT_LABEL[it.result || ''] ?? '', it.doneByName || '', stamp(it.doneAt),
    it.note || '', it.facility || '', it.room || '', it.bed || '', it.ip || '', it.wirelessMac || '', it.wiredMac || '', it.deviceId || '',
    shared.has((it.serial || '').toLowerCase()) ? 'Yes' : '',
  ])
}

/** CSV text (with the BOM Excel wants for UTF-8, and a spreadsheet's formula characters defused). */
export function toCsv(headers, rows) {
  const q = (v) => {
    let s = String(v ?? '')
    if (/^[=+\-@]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return '﻿' + [headers, ...rows].map((r) => r.map(q).join(',')).join('\r\n')
}

/** A file name from a list's name: letters, digits, spaces and dashes. */
export function fileSafe(name) {
  return String(name || 'checklist').replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '-') || 'checklist'
}
