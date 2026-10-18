/* The demo tracker's data in Firestore (step 5B, STEP-5-PLAN.md), beside
   db.js, which reaches the Realtime Database. NOT USED YET: store.jsx moves
   onto this at the cutover.

   The screens keep the shapes they have now (fs-shape.js turns documents into
   them and back). What changes is how a change is saved: instead of the whole
   /data written back with an ETag, the tracker's rule (model.js) is run on the
   state as it is, the documents it changes are worked out, and only those are
   written, in one transaction that first checks each is still as it was. If
   someone else has changed one, their version is taken and the rule run again.

   `npm run dev` without a .env has no Firestore: the same calls then work on a
   copy kept in this browser, started from db-local.js's made-up data. */
import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, runTransaction, setDoc, writeBatch } from 'firebase/firestore'
import { db as firestore } from '../../schedule/src/firebase.js'
import * as devDb from './db-local.js'
import { CHUNKS_PER_WRITE, COLLECTIONS, SETTINGS_DOC, chunksOf, diffDocs, fromDocs, same, toDocs, writesProblem } from './fs-shape.js'
import { nzDate } from './model.js'

const local = import.meta.env?.DEV && !firestore
export const isLocal = !!local

/* ── The documents as they are now, kept up to date ── */
const NAMES = Object.keys(COLLECTIONS)
const empty = () => ({ ...Object.fromEntries(NAMES.map((n) => [n, new Map()])), settings: null })
let docs = empty()
let loaded = null      // resolves once every collection has arrived
const listeners = new Set()
let stopAll = null
const tell = () => { const s = fromDocs(docs); listeners.forEach((l) => l(s)) }

function startRemote() {
  const seen = new Set()
  let ready
  loaded = new Promise((r) => { ready = r })
  const arrived = (name) => { seen.add(name); if (seen.size === NAMES.length + 1) ready() }
  const stops = NAMES.map((name) => onSnapshot(collection(firestore, COLLECTIONS[name]), (snap) => {
    const m = new Map(docs[name])
    for (const ch of snap.docChanges()) {
      if (ch.type === 'removed') m.delete(ch.doc.id)
      else m.set(ch.doc.id, ch.doc.data())
    }
    docs = { ...docs, [name]: m }
    arrived(name); if (seen.size > NAMES.length) tell()
  }, (err) => console.warn('[equipment] ' + name + ' stopped updating', err)))
  stops.push(onSnapshot(doc(firestore, ...SETTINGS_DOC), (snap) => {
    docs = { ...docs, settings: snap.exists() ? snap.data() : null }
    arrived('settings'); if (seen.size > NAMES.length) tell()
  }))
  return () => stops.forEach((s) => s())
}

/* The dev stand-in: the documents in this browser. */
const LOCAL_KEY = 'dev:equipment-fs'
async function startLocal() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null')
    if (saved) { docs = { ...Object.fromEntries(NAMES.map((n) => [n, new Map(saved[n] || [])])), settings: saved.settings }; return }
  } catch { /* fresh */ }
  const { data: r } = await devDb.read('')
  docs = toDocs({
    equipment: r.data.equipment, history: r.data.history, loanMeta: r.data.loanMeta || {}, loanDocs: r.loanDocs || {},
    upcoming: Object.values(r.upcomingLoans || {}), retired: r.retired || [], kits: r.kitGroups || {},
    demoTypes: r.customDemoTypes || [], simproConfig: r.simproConfig || {},
  }, { today: nzDate() })
  saveLocal()
}
function saveLocal() {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...Object.fromEntries(NAMES.map((n) => [n, [...docs[n]]])), settings: docs.settings })) } catch { /* private mode */ }
}

function ensure() {
  if (!loaded) {
    if (local) loaded = startLocal()
    else stopAll = startRemote()
  }
  return loaded
}

/**
 * Calls onChange(state) with the tracker's state ({ equipment, history,
 * loanMeta, loanDocs, upcoming, retired, kits, simproConfig, demoTypes }) once
 * everything has arrived, and again whenever anything changes. Returns stop().
 */
export function watchTracker(onChange) {
  listeners.add(onChange)
  ensure().then(() => listeners.has(onChange) && onChange(fromDocs(docs)))
  return () => {
    listeners.delete(onChange)
    if (!listeners.size && stopAll) { stopAll(); stopAll = null; loaded = null; docs = empty() }
  }
}

/** The tracker's state now (waiting for it the first time). */
export async function current() { await ensure(); return fromDocs(docs) }

/* ── Saving a change ── */
class Conflict extends Error {
  constructor(fresh) { super('Changed by someone else'); this.fresh = fresh }
}
// A document as it was in a given set (the one a change was worked out from:
// never the live one, which the listeners may have moved on meanwhile).
const docIn = (set, w) => (w.col === SETTINGS_DOC[0] ? set.settings : set[NAMES.find((n) => COLLECTIONS[n] === w.col)].get(w.id)) ?? null
const refOf = (w) => doc(firestore, w.col, w.id)
function apply(writes) {
  const next = { ...docs }
  for (const w of writes) {
    if (w.col === SETTINGS_DOC[0]) { next.settings = w.data; continue }
    const name = NAMES.find((n) => COLLECTIONS[n] === w.col)
    next[name] = new Map(next[name])
    if (w.data) next[name].set(w.id, w.data); else next[name].delete(w.id)
  }
  docs = next
}

/**
 * A change saved: change(state) returns the parts of the state it changes
 * (any of equipment, history, loanMeta, loanDocs, upcoming, retired, kits,
 * simproConfig, demoTypes), as model.js's rules do. Resolves with whatever
 * change returned, so the caller sees what was done. A change that throws
 * saves nothing.
 */
export async function commit(change, { tries = 5 } = {}) {
  await ensure()
  for (let i = 0; i < tries; i++) {
    const before = docs
    const state = fromDocs(before)
    const parts = change(state)
    const after = toDocs({ ...state, ...parts }, { prev: before, today: nzDate() })
    const writes = diffDocs(before, after)
    const problem = writesProblem(writes, before)
    if (problem) throw new Error(problem)
    if (!writes.length) return parts
    if (local) { apply(writes); saveLocal(); tell(); return parts }
    try {
      await runTransaction(firestore, async (tx) => {
        const snaps = await Promise.all(writes.map((w) => tx.get(refOf(w))))
        const stale = writes.map((w, k) => [w, snaps[k].exists() ? snaps[k].data() : null]).filter(([w, now]) => !same(docIn(before, w), now))
        if (stale.length) throw new Conflict(stale)
        writes.forEach((w) => (w.data ? tx.set(refOf(w), w.data) : tx.delete(refOf(w))))
      })
      apply(writes) // the listeners will say the same shortly
      tell()
      return parts
    } catch (e) {
      if (!(e instanceof Conflict)) throw e
      // Someone else's change: take theirs, run the rule again on it.
      apply(e.fresh.map(([w, now]) => ({ ...w, data: now })))
    }
  }
  throw new Error('Too many changes at once from other people: nothing was saved. Try again.')
}

/* ── The audit log: added to, never changed ── */
const localAudit = []
export async function addAudit(entry) {
  if (local) { localAudit.unshift(entry); return }
  await setDoc(doc(firestore, 'equipmentAudit', entry.id), entry)
}
/** The newest entries, newest first (300, as the old log reads). */
export async function loadAudit(n = 300) {
  if (local) return localAudit.slice(0, n)
  const snap = await getDocs(query(collection(firestore, 'equipmentAudit'), orderBy('ts', 'desc'), limit(n)))
  return snap.docs.map((d) => d.data())
}

/* ── Test reports: kept with the loan, the file in chunks ── */
const localReports = new Map()
const reportsOf = (key) => collection(firestore, 'loans', key, 'reports')

/** A loan's reports, newest first: { id, filename, mimeType, size, uploadedAt, uploadedBy }. */
export async function listReports(key) {
  const all = local ? [...(localReports.get(key) || new Map()).entries()].map(([id, r]) => ({ id, ...r.meta }))
    : (await getDocs(reportsOf(key))).docs.map((d) => ({ id: d.id, ...d.data() }))
  return all.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')))
}

/**
 * A report saved: its details, then the file (a data: URL) in chunks, four to
 * a write (a write carries at most 10 MiB). If a part fails, what was saved
 * of it is removed again.
 */
export async function uploadReport(key, id, meta, dataUrl) {
  const parts = chunksOf(dataUrl)
  const full = { ...meta, chunks: parts.length }
  if (local) { if (!localReports.has(key)) localReports.set(key, new Map()); localReports.get(key).set(id, { meta: full, parts }); return }
  const ref = doc(firestore, 'loans', key, 'reports', id)
  await setDoc(ref, full)
  try {
    for (let from = 0; from < parts.length; from += CHUNKS_PER_WRITE) {
      const b = writeBatch(firestore)
      parts.slice(from, from + CHUNKS_PER_WRITE).forEach((c, k) => b.set(doc(ref, 'chunks', String(from + k)), { data: c }))
      await b.commit()
    }
  } catch (e) {
    await deleteReport(key, id, parts.length).catch(() => {})
    throw e
  }
}

/** A report's file as the data: URL it was uploaded as. */
export async function reportFile(key, id) {
  if (local) return (localReports.get(key)?.get(id)?.parts || []).join('')
  const ref = doc(firestore, 'loans', key, 'reports', id)
  const [meta, chunks] = await Promise.all([getDoc(ref), getDocs(collection(ref, 'chunks'))])
  if (!meta.exists()) throw new Error('That report has gone: someone may have deleted it.')
  const parts = chunks.docs.map((d) => [Number(d.id), d.data().data]).sort((a, b) => a[0] - b[0])
  if (parts.length !== meta.data().chunks) throw new Error('That report didn’t finish uploading. Upload it again.')
  return parts.map(([, c]) => c).join('')
}

export async function deleteReport(key, id, chunks = null) {
  if (local) { localReports.get(key)?.delete(id); return }
  const ref = doc(firestore, 'loans', key, 'reports', id)
  const n = chunks ?? (await getDoc(ref)).data()?.chunks ?? 0
  const b = writeBatch(firestore)
  for (let k = 0; k < n; k++) b.delete(doc(ref, 'chunks', String(k)))
  b.delete(ref)
  await b.commit()
}
