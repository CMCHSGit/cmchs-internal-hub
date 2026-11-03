/* The Test Bench's saved reports: every file the bench saves (the PDF, the results file, the Ansur record) is also kept
   here, on this laptop, so a day's tests can be downloaded together or attached to a Simpro job together afterwards,
   instead of one file at a time as each test finishes. Kept until someone removes them. Plain functions over a small
   store, so the tests run them with an in-memory one. */

/** A record: { id (= name), name, mime, buffer, size, savedAt, meta: { customer, serial, model, template, testedAt }, sent: [{ job, at }] } */

export function memoryReports() {
  const items = new Map()
  return {
    async put(rec) { items.set(rec.id, { ...rec }) },
    async all() { return [...items.values()].map((x) => ({ ...x })) },
    async remove(id) { items.delete(id) },
    async get(id) { const x = items.get(id); return x ? { ...x } : null },
  }
}

export function idbReports(dbName = 'chs-bench-reports') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('reports', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
  const run = async (mode, fn) => {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('reports', mode)
        let out
        Promise.resolve(fn(tx.objectStore('reports'))).then((v) => { out = v }, reject)
        tx.oncomplete = () => resolve(out)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }
  return {
    put: (rec) => run('readwrite', (s) => req(s.put(rec))),
    all: () => run('readonly', (s) => req(s.getAll())),
    remove: (id) => run('readwrite', (s) => req(s.delete(id))),
    get: (id) => run('readonly', (s) => req(s.get(id))),
  }
}

/** What the file is: "FS6-47000856 - A9 02.11.2026.pdf" -> { base: "FS6-47000856 - A9 02.11.2026", ext: "pdf", kind, serial, model, date }. */
export function describeFile(name) {
  const m = String(name).match(/^(.*?)(?:\.([A-Za-z0-9]{1,8}))?$/)
  const base = m[1], ext = (m[2] || '').toLowerCase()
  const parts = base.match(/^(.*?)(?: - (.*?))? (\d{2}\.\d{2}\.\d{4})$/)
  return {
    base, ext,
    kind: ext === 'pdf' ? 'Report' : ext === 'json' ? 'Results file' : ext === 'mtr' ? 'Ansur record' : ext.toUpperCase() || 'File',
    serial: parts ? parts[1] : base, model: parts?.[2] || '', date: parts?.[3] || '',
  }
}

/** Keeps (or replaces) a file the bench saved. A new copy of a name is a new file, so what it was sent to before is forgotten. */
export async function saveReport(store, { name, mime, buffer, meta }, now = Date.now()) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const text = (v) => String(v ?? '').trim().slice(0, 200)
  const rec = { id: name, name, mime: mime || '', buffer, size: buffer.byteLength, savedAt: now, sent: [],
    meta: { customer: text(m.customer), serial: text(m.serial), model: text(m.model), template: text(m.template), testedAt: text(m.testedAt) } }
  await store.put(rec)
  // The same test saved again under another name (a serial or model corrected, a copy kept) is that test, not a second one: its older copy of this kind goes.
  if (rec.meta.testedAt) {
    const ext = describeFile(name).ext
    for (const o of await store.all()) if (o.id !== rec.id && o.meta && o.meta.testedAt === rec.meta.testedAt && describeFile(o.name).ext === ext) await store.remove(o.id)
  }
  return rec
}

/** Notes that Simpro now has this file, on this job. */
export async function markSent(store, name, job, now = Date.now()) {
  const rec = await store.get(name)
  if (!rec) return
  if (!rec.sent.some((s) => s.job === job)) rec.sent = [...rec.sent, { job, at: now }]
  await store.put(rec)
}

export const NO_CUSTOMER = 'No customer recorded'
const NZ = 'Pacific/Auckland'
/** "2026-11-02" for a moment, as the New Zealand day it was. */
export const nzDay = (ms) => new Intl.DateTimeFormat('en-CA', { timeZone: NZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))

/** The files as tests: one group per base name, newest first. A test's day is when it was run (else when it was saved). */
export function groupReports(list) {
  const m = new Map()
  for (const r of list) {
    const d = describeFile(r.name), meta = r.meta || {}
    if (!m.has(d.base)) m.set(d.base, { base: d.base, serial: meta.serial || d.serial, model: meta.model || d.model, date: d.date, customer: meta.customer || NO_CUSTOMER, template: meta.template || '', files: [], savedAt: 0, testedAt: 0 })
    const g = m.get(d.base)
    g.files.push({ ...r, ext: d.ext, kind: d.kind })
    g.savedAt = Math.max(g.savedAt, r.savedAt)
    const t = Date.parse(meta.testedAt || '') || 0
    g.testedAt = Math.max(g.testedAt, t)
    if (meta.customer) g.customer = meta.customer
  }
  const order = { pdf: 0, json: 1, mtr: 2 }
  for (const g of m.values()) {
    g.files.sort((a, b) => (order[a.ext] ?? 9) - (order[b.ext] ?? 9) || a.name.localeCompare(b.name))
    g.day = nzDay(g.testedAt || g.savedAt)
    g.sentTo = [...new Set(g.files.flatMap((f) => f.sent.map((s) => s.job)))]
    g.unsent = g.files.some((f) => !f.sent.length)
  }
  return oneCustomerPerDevice(mergeSameTest([...m.values()])).sort((a, b) => (b.testedAt || b.savedAt) - (a.testedAt || a.savedAt))
}

/**
 * A test is one run, and a run has one time it started: files with the same start time are the same test even if they were saved under
 * two names (a serial corrected, a copy kept), so they become one group, the newest save leading. Of each kind (PDF, results file, Ansur
 * record) the newest is the one kept in `files`; any older copy is in `stale`, to be removed with the test.
 */
function mergeSameTest(groups) {
  const byRun = new Map(), out = []
  for (const g of groups) {
    if (!g.testedAt) { out.push(g); continue }
    if (!byRun.has(g.testedAt)) byRun.set(g.testedAt, [])
    byRun.get(g.testedAt).push(g)
  }
  for (const list of byRun.values()) {
    if (list.length === 1) { out.push(list[0]); continue }
    list.sort((a, b) => b.savedAt - a.savedAt)
    const [lead, ...rest] = list
    const merged = { ...lead, files: [], stale: [...(lead.stale || [])] }
    const byKind = new Map()
    for (const f of list.flatMap((g) => g.files).sort((a, b) => b.savedAt - a.savedAt)) { if (byKind.has(f.ext)) merged.stale.push(f); else byKind.set(f.ext, f) }
    merged.files = [...byKind.values()]
    merged.files.sort((a, b) => ({ pdf: 0, json: 1, mtr: 2 }[a.ext] ?? 9) - ({ pdf: 0, json: 1, mtr: 2 }[b.ext] ?? 9))
    merged.savedAt = Math.max(...list.map((g) => g.savedAt))
    merged.sentTo = [...new Set(merged.files.flatMap((f) => f.sent.map((s) => s.job)))]
    merged.unsent = merged.files.some((f) => !f.sent.length)
    for (const g of rest) { if (!merged.serial) merged.serial = g.serial; if (!merged.model) merged.model = g.model; if (merged.customer === NO_CUSTOMER) merged.customer = g.customer; if (!merged.template) merged.template = g.template }
    out.push(merged)
  }
  return out
}

/** A device belongs to one customer: every test of a serial number takes the customer of its most recently saved test that has one. */
function oneCustomerPerDevice(groups) {
  const latest = new Map()
  for (const g of groups) {
    const k = String(g.serial || '').trim().toLowerCase()
    if (!k || g.customer === NO_CUSTOMER) continue
    if (!latest.has(k) || g.savedAt > latest.get(k).savedAt) latest.set(k, g)
  }
  for (const g of groups) { const k = String(g.serial || '').trim().toLowerCase(), w = latest.get(k); if (k && w) g.customer = w.customer }
  return groups
}

export const PERIODS = [['all', 'Any time'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['7', 'Last 7 days'], ['30', 'Last 30 days']]
/** Whether a New Zealand day ("2026-11-02") falls in the period, as of `now`. */
export function inPeriod(day, period, now = Date.now()) {
  if (!period || period === 'all') return true
  const today = nzDay(now)
  if (period === 'today') return day === today
  if (period === 'yesterday') return day === nzDay(now - 86400000)
  const n = +period
  return n > 0 ? day >= nzDay(now - (n - 1) * 86400000) && day <= today : true
}

/** Groups matching the search (serial, model, customer, date), the customer and period chosen, and, when asked, only those with something not yet sent. */
export function filterGroups(groups, { text = '', unsentOnly = false, customer = '', period = 'all' } = {}, now = Date.now()) {
  const q = text.trim().toLowerCase()
  return groups.filter((g) => (!unsentOnly || g.unsent) && (!customer || g.customer === customer) && inPeriod(g.day, period, now)
    && (!q || `${g.serial} ${g.model} ${g.customer} ${g.date} ${g.template}`.toLowerCase().includes(q)))
}

/** The customers in these groups, A to Z, "no customer" last. */
export function customersIn(groups) {
  return [...new Set(groups.map((g) => g.customer))].sort((a, b) => (a === NO_CUSTOMER) - (b === NO_CUSTOMER) || a.localeCompare(b))
}

/** "Mon 2 Nov 2026" for "2026-11-02". */
export const dayTitle = (day) => new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'))

/** Sections for the list: by customer (A to Z, each newest first), by day (newest first), or one list. [{ key, title, groups }] */
export function categorise(groups, by = 'customer') {
  if (by === 'none') return [{ key: 'all', title: '', groups }]
  const m = new Map()
  for (const g of groups) { const k = by === 'day' ? g.day : g.customer; if (!m.has(k)) m.set(k, []); m.get(k).push(g) }
  const keys = [...m.keys()].sort(by === 'day' ? (a, b) => b.localeCompare(a) : (a, b) => (a === NO_CUSTOMER) - (b === NO_CUSTOMER) || a.localeCompare(b))
  return keys.map((k) => ({ key: k, title: by === 'day' ? dayTitle(k) : k, groups: m.get(k) }))
}

/** The files of the chosen groups, of the chosen kinds (extensions). */
export function pickFiles(groups, chosenBases, exts) {
  const want = new Set(chosenBases), kinds = new Set(exts)
  return groups.filter((g) => want.has(g.base)).flatMap((g) => g.files).filter((f) => kinds.has(f.ext))
}
