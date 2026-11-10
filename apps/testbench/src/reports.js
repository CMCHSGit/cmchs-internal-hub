/* The Test Bench's saved reports: every file the bench saves (the PDF, the results file, the Ansur record) is also kept
   here, on this laptop, so a day's tests can be downloaded together or attached to a Simpro job together afterwards,
   instead of one file at a time as each test finishes. Kept until someone removes them. Plain functions over a small
   store, so the tests run them with an in-memory one. */

import { splitSerials } from './bench-tests.js'

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
  const parts = base.match(/^(.*?)(?: - (.*?))? (\d{2}\.\d{2}\.\d{4})(?: \(rerun (\d+)\))?$/)   // a test run again the same day is "… dd.mm.yyyy (rerun 2)", so it keeps the first one's files
  return {
    base, ext,
    kind: ext === 'pdf' ? 'Report' : ext === 'json' ? 'Results file' : ext === 'mtr' ? 'Ansur record' : ext.toUpperCase() || 'File',
    serial: parts ? parts[1] : base, model: parts?.[2] || '', date: parts?.[3] || '', rerun: +(parts?.[4] || 0),
  }
}

/** Keeps (or replaces) a file the bench saved. A new copy of a name is a new file, so what it was sent to before is forgotten. */
export async function saveReport(store, { name, mime, buffer, meta }, now = Date.now()) {
  const m = meta && typeof meta === 'object' ? meta : {}
  const text = (v) => String(v ?? '').trim().slice(0, 200)
  const rec = { id: name, name, mime: mime || '', buffer, size: buffer.byteLength, savedAt: now, sent: [],
    meta: { customer: text(m.customer), serial: String(m.serial ?? '').trim().slice(0, 600), model: text(m.model), template: text(m.template), testedAt: text(m.testedAt), ...(m.uploaded ? { uploaded: true } : {}) } }
  await store.put(rec)
  // The same test saved again under another name (a serial or model corrected, a copy kept) is that test, not a second one: its older copy of this kind goes.
  // (Not for a file someone added themselves: that never deletes what the bench saved.)
  if (rec.meta.testedAt && !rec.meta.uploaded) {
    const ext = describeFile(name).ext
    for (const o of await store.all()) if (o.id !== rec.id && o.meta && o.meta.testedAt === rec.meta.testedAt && describeFile(o.name).ext === ext) await store.remove(o.id)
  }
  return rec
}

/** Notes that these files have been downloaded (saved to a folder, or as a zip, or one at a time), so the list can say which tests have been and which not. */
export async function markDownloaded(store, names, now = Date.now()) {
  for (const name of names) { const rec = await store.get(name); if (rec) { rec.downloadedAt = now; await store.put(rec) } }
}

/** Notes that Simpro now has this file, on this job. */
export async function markSent(store, name, job, now = Date.now()) {
  const rec = await store.get(name)
  if (!rec) return
  if (!rec.sent.some((s) => s.job === job)) rec.sent = [...rec.sent, { job, at: now }]
  await store.put(rec)
}

/* ---- Files someone adds themselves (an Ansur record, a PDF or a results file from anywhere), to pick from beside the bench's own ---- */

export const UPLOAD_EXTS = ['mtr', 'pdf', 'json']
export const UPLOAD_MAX = 30 * 1048576
const MIME = { pdf: 'application/pdf', mtr: 'application/xml', json: 'application/json' }
const unxml = (v) => String(v).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()

/** What an Ansur record says about the test: { customer, serial, model, template, testedAt } (the same picks the bench makes), or null if it isn't one. */
export function mtrMeta(text) {
  if (!/<FLUKEFile[\s>]/.test(text)) return null
  const dut = {}
  const block = (text.match(/<DUT>([\s\S]*?)<\/DUT>/) || [])[1] || ''
  for (const m of block.matchAll(/<Item\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Item>)/g)) {
    const cap = (m[1].match(/\bCaption="([^"]*)"/) || m[1].match(/\bName="([^"]*)"/) || [])[1]
    if (cap) dut[unxml(cap)] = unxml(m[2] || '')
  }
  const pick = (re) => { const k = Object.keys(dut).find((x) => re.test(x) && dut[x]); return k ? dut[k] : '' }
  const rec = (text.match(/<Record\b[\s\S]*?<TestData>([\s\S]*?)<\/TestData>/) || [])[1] || ''
  const d = (rec.match(/<Date\b([^>]*)\/?>/) || [])[1] || ''
  const num = (k) => +((d.match(new RegExp(k + '="(\\d+)"')) || [])[1] || 0)
  const when = num('Year') ? new Date(num('Year'), num('Month') - 1, num('Day'), num('Hour'), num('Min'), num('Sec')) : null
  return {
    customer: pick(/^(customer|client|hospital|site|owner)/i), serial: pick(/^serial/i), model: pick(/^model$/i),
    template: unxml(((text.match(/<Template\b[^>]*\bName="([^"]*)"/) || [])[1] || '').replace(/\.mt[tr]$/i, '')),
    testedAt: when && !isNaN(when) ? when.toISOString() : '',
  }
}

/** Keeps a file someone added: an Ansur record is read for its serial, model, customer and date; others are told apart by their name. Returns the record, or throws why not. */
export async function saveUpload(store, { name, buffer }, now = Date.now()) {
  const d = describeFile(name)
  if (!UPLOAD_EXTS.includes(d.ext)) throw new Error('only Ansur records (.mtr), PDFs and results files (.json) can be added')
  if (!buffer.byteLength) throw new Error('the file is empty')
  if (buffer.byteLength > UPLOAD_MAX) throw new Error('the file is over 30 MB')
  let meta = { serial: d.serial === d.base ? '' : d.serial, model: d.model }
  if (d.ext === 'mtr') {
    const head = new TextDecoder('ascii').decode(new Uint8Array(buffer).slice(0, 200))
    const text = new TextDecoder(/encoding="(iso-?8859-1|windows-1252)"/i.test(head) ? 'windows-1252' : 'utf-8').decode(buffer)
    const m = mtrMeta(text)
    if (!m) throw new Error('this isn’t an Ansur record')
    meta = { ...meta, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v)) }
  } else if (d.ext === 'pdf' && new TextDecoder('ascii').decode(new Uint8Array(buffer).slice(0, 5)) !== '%PDF-') throw new Error('this isn’t a PDF')
  return saveReport(store, { name, mime: MIME[d.ext], buffer, meta: { ...meta, uploaded: true } }, now)
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
    if (!m.has(d.base)) m.set(d.base, { base: d.base, serial: meta.serial || d.serial, model: meta.model || d.model, date: d.date, rerun: d.rerun, customer: meta.customer || NO_CUSTOMER, template: meta.template || '', files: [], savedAt: 0, testedAt: 0, downloadedAt: 0 })
    const g = m.get(d.base)
    g.files.push({ ...r, ext: d.ext, kind: d.kind })
    g.savedAt = Math.max(g.savedAt, r.savedAt)
    g.downloadedAt = Math.max(g.downloadedAt, r.downloadedAt || 0)
    const t = Date.parse(meta.testedAt || '') || 0
    g.testedAt = Math.max(g.testedAt, t)
    if (meta.customer) g.customer = meta.customer
  }
  const order = { pdf: 0, json: 1, mtr: 2 }
  for (const g of m.values()) {
    g.files.sort((a, b) => (order[a.ext] ?? 9) - (order[b.ext] ?? 9) || a.name.localeCompare(b.name))
    g.day = nzDay(g.testedAt || g.savedAt)
    g.sentTo = [...new Set(g.files.flatMap((f) => f.sent.map((s) => s.job)))]
    g.unsent = !g.sentTo.length || g.files.some((f) => f.ext !== 'json' && !f.sent.length)   // a results file never goes to Simpro
    g.uploaded = g.files.some((f) => f.meta && f.meta.uploaded)
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
    merged.downloadedAt = Math.max(0, ...merged.files.map((f) => f.downloadedAt || 0))
    merged.sentTo = [...new Set(merged.files.flatMap((f) => f.sent.map((s) => s.job)))]
    merged.unsent = !merged.sentTo.length || merged.files.some((f) => f.ext !== 'json' && !f.sent.length)
    merged.uploaded = merged.files.some((f) => f.meta && f.meta.uploaded)
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

/* ---- Tests other engineers finished (the shared finished tests, bench-tests.js) that have no files on this laptop ---- */

/** "03.11.2026" for a moment, as the New Zealand day it was. */
export const nzDmy = (iso) => { const d = new Date(iso); if (isNaN(d)) return ''; const p = Object.fromEntries(new Intl.DateTimeFormat('en-NZ', { timeZone: NZ, day: '2-digit', month: '2-digit', year: 'numeric' }).formatToParts(d).map((x) => [x.type, x.value])); return `${p.day}.${p.month}.${p.year}` }
const safeName = (x) => String(x ?? '').replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim()
/** The name the files of a shared test get here, as the bench names its own: "serial - model dd.mm.yyyy" (the day it was finished; a set: its main device's serial). */
export const sharedFileBase = (s) => `${safeName(splitSerials(s.serial).join(', ')) || 'Device'}${s.model ? ` - ${safeName(s.model)}` : ''} ${nzDmy(s.finished || s.started)}`

/**
 * Groups for the tests that other engineers (or this one, on another laptop) have finished and shared, and that this laptop has no files
 * for yet. They have no files to show: their report and Ansur record are made from the shared test when they are downloaded or attached.
 * A test already here (its start time is on a saved file) is not listed twice.
 */
export function sharedGroups(reports, shared) {
  const here = new Set(reports.map((r) => r.meta && r.meta.testedAt).filter(Boolean))
  return (shared || []).filter((t) => t && t.id && t.started && !here.has(t.started)).map((t) => {
    const finished = Date.parse(t.finished || t.started) || 0, tested = Date.parse(t.started) || finished
    return {
      base: 'shared:' + t.id, shared: true, sharedId: t.id, sharedBy: t.byName || t.by || '', sharedByEmail: t.by || '', order: t.order || '', rawCustomer: t.customer || '', overall: t.overall,
      serial: t.serial || t.id, model: t.model || '', date: nzDmy(t.finished || t.started), rerun: 0, customer: t.customer || NO_CUSTOMER, template: t.template || '',
      files: [], savedAt: finished, testedAt: tested, downloadedAt: 0, day: nzDay(tested || finished), sentTo: [], unsent: true, uploaded: false, started: t.started, finished: t.finished,
    }
  })
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
export function filterGroups(groups, { text = '', unsentOnly = false, notDownloaded = false, customer = '', period = 'all', serials = null } = {}, now = Date.now()) {
  const q = text.trim().toLowerCase()
  const only = serials && serials.length ? new Set(serials.map((s) => String(s).trim().toUpperCase())) : null   // an asset list's devices
  return groups.filter((g) => (!unsentOnly || g.unsent) && (!notDownloaded || !g.downloadedAt) && (!customer || g.customer === customer) && inPeriod(g.day, period, now)
    && (!only || splitSerials(g.serial).some((s) => only.has(s.toUpperCase())))   // a set's report: any of its devices
    && (!q || `${g.serial} ${g.model} ${g.customer} ${g.date} ${g.template}`.toLowerCase().includes(q)))
}

/** The customers in these groups, A to Z, "no customer" last. */
export function customersIn(groups) {
  return [...new Set(groups.map((g) => g.customer))].sort((a, b) => (a === NO_CUSTOMER) - (b === NO_CUSTOMER) || a.localeCompare(b))
}

/** "Mon 2 Nov 2026" for "2026-11-02". */
export const dayTitle = (day) => new Intl.DateTimeFormat('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T00:00:00Z'))

export const NO_MODEL = 'No model recorded'
/** The device model of a test, as the list shows it. */
export const modelOf = (g) => String(g.model || '').trim() || NO_MODEL

/** Sections for the list: by customer (A to Z, each newest first), by device model (A to Z), by day (newest first), or one list. [{ key, title, groups }] */
export function categorise(groups, by = 'customer') {
  if (by === 'none') return [{ key: 'all', title: '', groups }]
  const m = new Map()
  for (const g of groups) { const k = by === 'day' ? g.day : by === 'model' ? modelOf(g) : g.customer; if (!m.has(k)) m.set(k, []); m.get(k).push(g) }
  const last = by === 'model' ? NO_MODEL : NO_CUSTOMER
  const keys = [...m.keys()].sort(by === 'day' ? (a, b) => b.localeCompare(a) : (a, b) => (a === last) - (b === last) || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
  return keys.map((k) => ({ key: k, title: by === 'day' ? dayTitle(k) : k, groups: m.get(k) }))
}

/**
 * What has been tested, per customer and model: [{ customer, devices, tests, rows: [{ model, devices (different serial numbers), tests, downloaded, sent }] }].
 * A device tested twice (a rerun, another day) is one device and two tests. Customers A to Z ("none" last), models A to Z.
 */
export function modelTotals(groups) {
  const byCust = new Map()
  for (const g of groups) {
    if (!byCust.has(g.customer)) byCust.set(g.customer, new Map())
    const models = byCust.get(g.customer), k = modelOf(g)
    if (!models.has(k)) models.set(k, { model: k, serials: new Set(), tests: 0, downloaded: 0, sent: 0 })
    const r = models.get(k)
    r.serials.add(String(g.serial || g.base).trim().toUpperCase()); r.tests++
    if (g.downloadedAt) r.downloaded++
    if (g.sentTo && g.sentTo.length) r.sent++
  }
  const cmp = (last) => (a, b) => (a === last) - (b === last) || a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
  return [...byCust.keys()].sort(cmp(NO_CUSTOMER)).map((customer) => {
    const rows = [...byCust.get(customer).values()].sort((a, b) => cmp(NO_MODEL)(a.model, b.model)).map((r) => ({ model: r.model, devices: r.serials.size, tests: r.tests, downloaded: r.downloaded, sent: r.sent }))
    return { customer, devices: new Set(groups.filter((g) => g.customer === customer).map((g) => String(g.serial || g.base).trim().toUpperCase())).size, tests: rows.reduce((n, r) => n + r.tests, 0), rows }
  })
}

/** The files of the chosen groups, of the chosen kinds (extensions). */
export function pickFiles(groups, chosenBases, exts) {
  const want = new Set(chosenBases), kinds = new Set(exts)
  return groups.filter((g) => want.has(g.base)).flatMap((g) => g.files).filter((f) => kinds.has(f.ext))
}

/* ---- "Reports to add": the link from Simpro Asset Sync to the saved reports of the devices in its asset list ---- */

const serialKey = (s) => String(s ?? '').trim().toUpperCase()
/** Most serials that go in the address; a longer list opens Saved reports on everything not yet sent instead. */
export const LINK_SERIALS_MAX = 200

/**
 * Of the devices in an asset list (their serial numbers), what the saved reports cover: how many devices have a saved test, how many
 * of those still have something not sent to Simpro, and which have none. Counts and serials only.
 */
export function reportsToAdd(groups, serials) {
  const want = [...new Set([...serials].map(serialKey).filter(Boolean))]
  const have = new Map()
  for (const g of groups) { const k = serialKey(g.serial); if (!have.has(k)) have.set(k, []); have.get(k).push(g) }
  const withReport = want.filter((s) => have.has(s))
  const toAdd = withReport.filter((s) => have.get(s).some((g) => g.unsent))
  return { devices: want.length, withReport: withReport.length, toAdd: toAdd.length, toAddSerials: toAdd, missing: want.filter((s) => !have.has(s)) }
}

/** The address of Saved reports for these devices: only their tests, only what is not yet sent. */
export function reportsLink(serials) {
  const list = [...new Set([...serials].map(serialKey).filter(Boolean))]
  const q = new URLSearchParams({ tab: 'reports' })
  if (list.length && list.length <= LINK_SERIALS_MAX) q.set('serials', list.join(','))
  q.set('unsent', '1')
  return '/testbench/?' + q.toString()
}

/** What an address asks Saved reports to show: { open, serials (array, empty for no filter), unsent }. */
export function reportsFromSearch(search) {
  const p = new URLSearchParams(search || '')
  return {
    open: p.get('tab') === 'reports',
    serials: (p.get('serials') || '').split(',').map(serialKey).filter(Boolean).slice(0, LINK_SERIALS_MAX),
    unsent: p.get('unsent') === '1',
  }
}

/* ---- What Simpro already has: "Sent" is otherwise only known for files sent from this laptop's hub. A job's attached files are read
   (listJobFiles) and every test whose file is there counts as sent to that job, however it got there. Kept on this laptop by serial
   number and test day ("TP1-1|09.11.2026", or "TP1-1|" for a file name with no date), in localStorage `testbench.onJob`. ---- */
export const ON_JOB_KEY = 'testbench.onJob'
const ON_JOB_MAX = 3000
const onJobKey = (serial, date) => `${String(serial ?? '').trim().toUpperCase()}|${date || ''}`
/** The job's file names -> keys of the tests they are ("SERIAL|dd.mm.yyyy"). */
export function testsInFiles(names) {
  const out = new Set()
  for (const n of names || []) { const d = describeFile(n); for (const s of splitSerials(d.serial)) if (s) out.add(onJobKey(s, d.date)) }
  return out
}
/** `known` ({ key: ['#209653'] }) with a job's files added; the oldest entries go past ON_JOB_MAX. */
export function addOnJob(known, job, names) {
  const out = { ...(known || {}) }
  for (const k of testsInFiles(names)) { const jobs = out[k] || []; delete out[k]; out[k] = jobs.includes(job) ? jobs : [...jobs, job] }
  const keys = Object.keys(out)
  for (const k of keys.slice(0, Math.max(0, keys.length - ON_JOB_MAX))) delete out[k]
  return out
}
/** Groups with what Simpro is known to have: such a test is sent to that job, and is no longer "not sent". */
export function withOnJob(groups, known) {
  if (!known || !Object.keys(known).length) return groups
  return groups.map((g) => {
    const jobs = splitSerials(g.serial).flatMap((s) => [...(known[onJobKey(s, g.date)] || []), ...(known[onJobKey(s, '')] || [])])
    if (!jobs.length) return g
    return { ...g, sentTo: [...new Set([...(g.sentTo || []), ...jobs])], unsent: false }
  })
}
export function loadOnJob() { try { return JSON.parse(localStorage.getItem(ON_JOB_KEY) || '{}') || {} } catch { return {} } }
export function saveOnJob(known) { try { localStorage.setItem(ON_JOB_KEY, JSON.stringify(known)) } catch { /* private mode: known this session only */ } }
