/* Checklists — reading a device export, and everything the list does with its devices.
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

// ── Steps: what has to be ticked on each device ─────────────────────────────────────────────────────

/** A list with no steps of its own has one, so every list from before steps still works. */
export const DEFAULT_STEPS = [{ id: 'done', label: 'Done' }]
export const MAX_STEPS = 12

export const stepsOf = (list) => (Array.isArray(list?.steps) && list.steps.length ? list.steps : DEFAULT_STEPS)

/** A new step's id: its words, plus a few random characters so two steps never share one. Field paths in Firestore, so letters and digits only. */
export function newStepId(label, taken = [], rand = Math.random()) {
  const base = cell(label).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 12) || 'step'
  let id = base
  let n = 0
  while (taken.includes(id)) id = base + Math.floor(rand * 36 ** 3 + ++n).toString(36)
  return id
}

/** Lines of text as steps ("Software upgraded", "Changed config"): blanks and repeats dropped, up to MAX_STEPS. */
export function stepsFromText(text, rand = Math.random) {
  const seen = new Set()
  const out = []
  for (const line of String(text || '').split(/\r?\n/)) {
    const label = cell(line).slice(0, 60)
    if (!label || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    out.push({ id: label.toLowerCase() === 'done' && !out.some((x) => x.id === 'done') ? 'done' : newStepId(label, out.map((x) => x.id), rand()), label })
    if (out.length >= MAX_STEPS) break
  }
  return out
}

const millis = (t) => (t?.toMillis ? t.toMillis() : t?.toDate ? t.toDate().getTime() : t instanceof Date ? t.getTime() : Number(t) || 0)

/** The tick for one step on a device — { by, byName, at } — or null. A device ticked before steps existed carries result 'done', which is its 'done' step. */
export function tickOf(it, stepId) {
  const c = it.checks?.[stepId]
  if (c) return c
  return stepId === 'done' && it.result === 'done' ? { by: it.doneBy || '', byName: it.doneByName || '', at: it.doneAt || null } : null
}

/** The list's main step, if the owner chose one: ticking it is what makes a device done. Marked `main: true` on the step. */
export const mainOf = (steps) => steps.find((st) => st.main) || null

/** 'lost' (couldn't find it), 'done' (the main step is ticked, or with none, every step), 'partial', or 'todo'. */
export function stateOf(it, steps = DEFAULT_STEPS) {
  if (it.result === 'notfound') return 'lost'
  const n = steps.filter((st) => tickOf(it, st.id)).length
  const main = mainOf(steps)
  if (main) return tickOf(it, main.id) ? 'done' : n === 0 ? 'todo' : 'partial'
  return n === 0 ? 'todo' : n === steps.length ? 'done' : 'partial'
}

/** { ticked, total } steps on a device. */
export function progressOf(it, steps = DEFAULT_STEPS) {
  return { ticked: steps.filter((st) => tickOf(it, st.id)).length, total: steps.length }
}

/** The newest tick on a device: { byName, at } or null — who last did something to it. */
export function latestTick(it, steps = DEFAULT_STEPS) {
  let best = null
  for (const st of steps) {
    const t = tickOf(it, st.id)
    if (t && (!best || millis(t.at) >= millis(best.at))) best = t
  }
  if (it.result === 'notfound' && (!best || millis(it.doneAt) >= millis(best.at))) return { byName: it.doneByName || '', at: it.doneAt || null }
  return best
}

// ── What the list shows ────────────────────────────────────────────────────────────────────────────

export const RESULTS = { done: 'done', notfound: 'notfound' }

/** Counts for the top of the list. `items` are the list's devices, ticked or not; a device is done when every step is ticked. */
export function summarise(items, steps = DEFAULT_STEPS) {
  const bySerial = new Map()
  const byStatus = {}
  const byDept = new Map()
  const byVersion = new Map()
  const byFacility = new Map()
  const stepCounts = Object.fromEntries(steps.map((st) => [st.id, 0]))
  let done = 0
  let notfound = 0
  for (const it of items) {
    const state = stateOf(it, steps)
    if (state === 'done') done++
    else if (state === 'lost') notfound++
    for (const st of steps) if (tickOf(it, st.id)) stepCounts[st.id]++
    const sn = (it.serial || '').toLowerCase()
    if (sn) bySerial.set(sn, (bySerial.get(sn) || 0) + 1)
    byStatus[it.status || 'Unknown'] = (byStatus[it.status || 'Unknown'] || 0) + 1
    const dn = it.department || ''
    const dep = byDept.get(dn) || { name: dn, total: 0, done: 0, notfound: 0 }
    dep.total++
    if (state === 'done') dep.done++
    else if (state === 'lost') dep.notfound++
    byDept.set(dn, dep)
    const vn = it.version || ''
    byVersion.set(vn, (byVersion.get(vn) || 0) + 1)
    const fn = it.facility || ''
    byFacility.set(fn, (byFacility.get(fn) || 0) + 1)
  }
  const departments = [...byDept.values()].sort(byName)
  return {
    total: items.length,
    done, notfound, todo: items.length - done - notfound,
    stepCounts,
    uniqueSerials: bySerial.size,
    sharedSerials: [...bySerial.values()].filter((n) => n > 1).length,
    byStatus,
    departments,
    facilities: [...byFacility].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
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

const RANK = { todo: 0, partial: 1, lost: 2, done: 3 }
const SORT_VALUE = {
  department: (it) => it.department || '',
  facility: (it) => it.facility || '',
  status: (it) => { const i = STATUS_ORDER.indexOf(it.status); return i < 0 ? STATUS_ORDER.length : i },
  serial: (it) => it.serial || '',
  name: (it) => it.name || '',
  location: (it) => it.location || '',
  version: (it) => it.version || '',
  lastSeen: (it) => it.lastSeenAt || '',
  result: (it, steps) => RANK[stateOf(it, steps)],
}
export const SORT_KEYS = Object.keys(SORT_VALUE)

/** A copy of `items` sorted by `key` (department, status, serial, name, location, version, lastSeen, result). Blanks last either way; ties by department then name. */
export function sortItems(items, key = 'department', dir = 1, steps = DEFAULT_STEPS) {
  const val = SORT_VALUE[key] || SORT_VALUE.department
  const blank = (v) => v === '' || v == null
  return [...items].sort((a, b) => {
    const av = val(a, steps), bv = val(b, steps)
    if (blank(av) !== blank(bv)) return blank(av) ? 1 : -1
    if (!blank(av)) {
      const c = typeof av === 'number' ? av - bv : collate(av, bv)
      if (c) return c * dir
    }
    return collate(a.department || '\uffff', b.department || '\uffff') || collate(a.name || '', b.name || '') || collate(a.id || '', b.id || '')
  })
}

const asList = (v) => (Array.isArray(v) ? v : v ? [v] : [])
/** Whether a device's value is one of the chosen ones (or nothing is chosen). A single value is accepted as a list of one. */
const anyOf = (chosen, value) => {
  const c = asList(chosen)
  return !c.length || c.includes(value || '') || (c.includes(NO_DEPARTMENT) && !value)
}

/** Narrows the list. f: { q, status, department, facility, version, missing: lists of choices (or one), show: all|todo|done|notfound } — blank means no filter. */
export function filterItems(items, f = {}, steps = DEFAULT_STEPS) {
  const toks = String(f.q || '').toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((it) => {
    const state = stateOf(it, steps)
    // Each filter takes several choices (a device matches if it is any of them); the filters together all have to match.
    // NO_DEPARTMENT stands for "blank" in any of them.
    if (!anyOf(f.status, it.status)) return false
    if (!anyOf(f.department, it.department)) return false
    if (!anyOf(f.facility, it.facility)) return false
    if (!anyOf(f.version, it.version)) return false
    if (f.show === 'todo' && (state === 'done' || state === 'lost')) return false
    if (f.show === 'done' && state !== 'done') return false
    if (f.show === 'notfound' && state !== 'lost') return false
    const miss = asList(f.missing)
    if (miss.length && (state === 'lost' || miss.every((id) => tickOf(it, id)))) return false // missing at least one of the chosen steps
    if (toks.length) {
      const who = steps.map((st) => tickOf(it, st.id)?.byName || '').join(' ')
      const hay = [it.name, it.serial, it.deviceId, it.location, it.department, it.facility, it.ip, it.wirelessMac, it.wiredMac, it.note, who, it.category, it.model].join(' ').toLowerCase()
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

// ── A device found on site ───────────────────────────────────────────────────────────────────────────

export const STATUSES = ['Working', 'Standby', 'Offline', 'Shutdown', 'Unknown']

/** A device nobody listed: the form's fields as a device, or { error } when there is too little to go on. */
export function newDevice(form, { category = '', model = '', now = Date.now(), rand = Math.random() } = {}) {
  const t = (v) => cell(v)
  const name = t(form.name)
  const serial = t(form.serial)
  if (!name && !serial) return { error: 'Give it a name or a serial number, so the next person can find it.' }
  // A status left blank on purpose (an item on a list made by hand has none) stays blank; anything else unknown is 'Unknown'.
  const status = STATUSES.includes(form.status) ? form.status : form.status === '' ? '' : 'Unknown'
  const department = t(form.department)
  return {
    device: {
      id: 'found-' + now.toString(36) + '-' + Math.floor(rand * 1679616).toString(36).padStart(4, '0'),
      deviceId: '', category: t(form.category) || category, model: t(form.model) || model, serial, name, status, statusSince: '',
      location: t(form.location), department, deptGuessed: false, version: t(form.version), lastSeenAt: '', lastSeenIn: '',
    },
    note: String(form.note || '').trim().slice(0, 1000),
  }
}

/**
 * Items typed or pasted, one a line, for a list made by hand: name, then serial number, department and location, split
 * by tabs (pasted from Excel) or commas. A line with only a name is an item. A first line that is column titles is
 * skipped. Returns devices with ids that are not found-… (they are the owner's, not found on site).
 */
export function parseManualLines(text, { category = '', model = '', now = Date.now(), rand = Math.random } = {}) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 500)
  const out = []
  lines.forEach((line, i) => {
    const cols = (line.includes('\t') ? line.split('\t') : line.split(/\s*[,;]\s*/)).map((c) => cell(c))
    if (i === 0 && /^(device )?name$/i.test(cols[0]) && cols.some((c) => /serial|department|location/i.test(c))) return
    const [name = '', serial = '', department = '', location = ''] = cols
    if (!name && !serial) return
    out.push({
      id: 'manual-' + now.toString(36) + '-' + String(out.length).padStart(3, '0') + Math.floor(rand() * 1296).toString(36).padStart(2, '0'),
      deviceId: '', category, model, serial, name: name || serial, status: '', statusSince: '', location, department, deptGuessed: false,
      version: '', lastSeenAt: '', lastSeenIn: '',
    })
  })
  return out
}

/** The devices not already on the list (same serial number, or with none the same name), ignoring case. */
export function newOnly(devices, items) {
  const have = new Set(items.map((it) => (it.serial || it.name || '').toLowerCase()))
  return devices.filter((d) => {
    const key = (d.serial || d.name || '').toLowerCase()
    if (!key || have.has(key)) return false
    have.add(key)
    return true
  })
}

/** The one device on the list that has this serial number, or the first, ignoring case. */
export function findBySerial(items, serial) {
  const s = cell(serial).toLowerCase()
  return s ? items.find((it) => (it.serial || '').toLowerCase() === s) || null : null
}

// ── Finding a device from a scanned code ─────────────────────────────────────────────────────────────

/** Letters and digits only, upper case: "N1-WHA303756" and "n1 wha303756" are the same. */
const alnum = (s) => cell(s).toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * The devices a scanned or typed code could be, best first: [{ item, score }]. A barcode on the device rarely says
 * what the list says: the asset number on the label is WHA303756, the list calls it N1-WHA303756. So a code is
 * compared with each device's name, serial number, Device ID, MACs and asset number ignoring punctuation and case.
 *   3  the same as one of them
 *   2  one ends with or contains the other (WHA303756 against N1-WHA303756), when the shorter has 6+ characters
 *   1  a long piece of the code is somewhere in one of them (a label that carries more than the number)
 * Whole code first, then each run of letters and digits in it that has a digit and 5+ characters.
 */
export function matchScan(items, raw) {
  const whole = alnum(raw)
  const parts = String(raw ?? '').toUpperCase().split(/[^A-Z0-9]+/).filter((t) => t.length >= 5 && /\d/.test(t))
  const tokens = [...new Set([whole, ...parts])].filter((t) => t.length >= 5)
  if (!tokens.length) return []
  const out = []
  for (const it of items) {
    const fields = [it.name, it.serial, it.deviceId, it.wirelessMac, it.wiredMac, it.asset].map(alnum).filter((f) => f.length >= 5)
    let best = 0
    for (const f of fields) {
      for (const t of tokens) {
        const short = Math.min(f.length, t.length)
        if (f === t) best = Math.max(best, 3)
        else if (short >= 6 && (f.endsWith(t) || t.endsWith(f) || f.startsWith(t) || t.startsWith(f))) best = Math.max(best, 2)
        else if (short >= 6 && (f.includes(t) || t.includes(f))) best = Math.max(best, 1)
      }
    }
    if (best) out.push({ item: it, score: best })
  }
  return out.sort((a, b) => b.score - a.score || collate(a.item.name || '', b.item.name || ''))
}

/** The devices to offer for a code: the best ones only, so one clear match opens straight away. */
export function bestMatches(items, raw) {
  const all = matchScan(items, raw)
  return all.filter((m) => m.score === all[0]?.score).map((m) => m.item)
}

/**
 * What to call a device that is not on the list, from the code on its label. The list's names share a prefix
 * ("N1-WHA303756", "N1-WHA304525"), so a label that only carries WHA303756 becomes N1-WHA303756.
 */
export function suggestName(items, raw) {
  const code = cell(raw)
  if (!/^[A-Za-z]{2,5}\d{4,}$/.test(code)) return code
  const prefixes = new Map()
  let n = 0
  for (const it of items.slice(0, 40)) {
    const m = /^(.+?[-_ ])[A-Za-z]{2,5}\d{4,}$/.exec(cell(it.name))
    if (m) { prefixes.set(m[1], (prefixes.get(m[1]) || 0) + 1); n++ }
  }
  const top = [...prefixes].sort((a, b) => b[1] - a[1])[0]
  return top && top[1] >= Math.max(2, n * 0.6) ? top[0] + code : code
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

/** The export's columns: the device, how far along it is, then each step (done, by, at), then the rest. */
export function exportHeaders(steps = DEFAULT_STEPS) {
  return [
    'Department', 'Device type', 'Model', 'Device name', 'Serial number', 'Status', 'Status since', 'Last location',
    'Last seen', 'Software version', 'Progress',
    ...steps.flatMap((st) => [st.label, st.label + ' by', st.label + ' at']),
    'Note', 'Facility', 'Room', 'Bed',
    'IP address', 'Wireless MAC', 'Wired MAC', 'Device ID', 'Shares a serial with another device', 'Added on site', 'Added by',
  ]
}

/** "Done", "Couldn’t find", "2 of 3" or "". */
export function progressLabel(it, steps = DEFAULT_STEPS) {
  const state = stateOf(it, steps)
  if (state === 'lost') return 'Couldn’t find'
  if (state === 'done') return 'Done'
  if (state === 'partial') { const p = progressOf(it, steps); return p.ticked + ' of ' + p.total }
  return ''
}

/** One row of cells per device, in exportHeaders order. */
export function exportRows(items, steps = DEFAULT_STEPS) {
  const shared = sharedSerials(items)
  return items.map((it) => [
    it.department || '', it.category || '', it.model || '', it.name || '', it.serial || '', it.status || '', niceStamp(it.statusSince),
    it.location || '', niceStamp(it.lastSeenAt), it.version || '', progressLabel(it, steps),
    ...steps.flatMap((st) => { const t = tickOf(it, st.id); return t ? ['Yes', t.byName || '', stamp(t.at)] : ['', '', ''] }),
    it.note || '', it.facility || '', it.room || '', it.bed || '', it.ip || '', it.wirelessMac || '', it.wiredMac || '', it.deviceId || '',
    shared.has((it.serial || '').toLowerCase()) ? 'Yes' : '',
    it.addedOnSite ? 'Yes' : '', it.addedByName || '',
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
