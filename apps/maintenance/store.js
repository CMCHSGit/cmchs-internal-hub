/* Maintenance schedule — data shape, parsing and Firestore access.

   One document per scheduled PM, in the `maintenance` collection of the staff
   schedule's Firebase project. Everyone signed in can read; the Engineers and
   Management teams, plus admins, can write (firestore.rules). */

import {
  collection, doc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../schedule/src/firebase.js'
import { logActivity } from '../../shared/activity.js'
import * as devStore from './store-local.js'

// `npm run dev` without a .env has no Firestore: made-up entries instead
// (store-local.js). In a real build this is always null and drops out.
const local = import.meta.env.DEV && !db ? devStore : null

export const COL = 'maintenance'
// The PM types a site can be scheduled for. Editable from the page, because
// warranties run to different lengths and a third or fourth visit is normal.
// These are only the starting point for a brand new database.
export const DEFAULT_PM_TYPES = ['First PM', 'Second PM', 'Third PM', 'Fourth PM', 'Other']

// The list lives in a document inside this same collection rather than a
// collection of its own, so it is already covered by the maintenance rule.
// A separate collection would have meant another hand-deployed rules change,
// and those have been the slowest part of shipping this page.
export const SETTINGS_ID = '_settings'
const isSettings = (id) => id.startsWith('_')
export const STATUSES = ['Not started', 'In progress', 'Completed', 'Completed by Biomeds', 'On hold']

/**
 * Is this PM finished, however it was finished?
 *
 * There is more than one way to be done — the hospital biomeds do a lot of
 * these under PHARMAC — and every count, filter and the overdue test has to
 * agree on that. Matching the "Completed" prefix rather than listing the
 * statuses means another "Completed by …" can be added to STATUSES alone
 * without a finished PM silently reading as outstanding and overdue.
 */
export const isDone = (status) => String(status || '').startsWith('Completed')

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * The spreadsheet mixes "Mar-26", "1/04/2026" and real dates in one column, so
 * a due date is stored as an ISO day plus a flag saying whether the day part
 * was ever real. Showing "1 Mar 2026" for something the sheet only ever knew
 * as "Mar-26" would be inventing precision that isn't there.
 *
 * Returns { due: 'YYYY-MM-DD', monthOnly: boolean } or null.
 */
export function parseDue(raw) {
  if (raw == null || raw === '') return null

  // A date-formatted cell arrives from the reader as { date: { y, m, d } },
  // not as text. Stringifying it gives "[object Object]", which is how every
  // due date in the first import silently became a default instead.
  //
  // The format code is lost by then, so there is no way to tell a cell shown
  // as "Mar-26" from one shown as "1 Mar 2026" — both are the 1st internally.
  // Treating day 1 as month-only matches how this sheet is actually kept (the
  // column is overwhelmingly mmm-yy); the cost is that a real 1st-of-month
  // date displays as the month, which is a cosmetic loss, not a wrong date.
  if (typeof raw === 'object' && raw.date && raw.date.y) {
    const { y, m, d } = raw.date
    const iso = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
    return { due: iso, monthOnly: d === 1 }
  }

  const s = String(raw).trim()
  if (!s || s === '[object Object]') return null

  // Excel serial date (the reader hands these through as numbers)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const ms = (Number(s) - 25569) * 86400000 // 1899-12-30 epoch -> unix
    const d = new Date(Math.round(ms))
    if (!isNaN(d)) return { due: d.toISOString().slice(0, 10), monthOnly: false }
  }

  // Mar-26 / Mar 26 / March 2026
  let m = /^([a-z]{3,9})[\s\-/]*(\d{2,4})$/i.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase())
    if (mi >= 0) {
      let y = Number(m[2])
      if (y < 100) y += 2000
      return { due: `${y}-${String(mi + 1).padStart(2, '0')}-01`, monthOnly: true }
    }
  }

  // 1/04/2026 or 01-04-26 — day first, which is what NZ writes
  m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s)
  if (m) {
    let [, d, mo, y] = m
    y = Number(y); if (y < 100) y += 2000
    const dd = Number(d), mm = Number(mo)
    if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= 31) {
      return { due: `${y}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`, monthOnly: false }
    }
  }

  // 2026-04-01
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) return { due: s, monthOnly: false }

  return null
}

export function formatDue(due, monthOnly) {
  if (!due) return ''
  const [y, m, d] = due.split('-').map(Number)
  const mon = MONTHS[m - 1] ? MONTHS[m - 1][0].toUpperCase() + MONTHS[m - 1].slice(1) : m
  return monthOnly ? `${mon} ${y}` : `${d} ${mon} ${y}`
}

/** Outstanding and past its due month — the thing the page exists to surface. */
export function isOverdue(e, today = new Date()) {
  if (!e.due || isDone(e.status)) return false
  // A month-only due date isn't late until the month itself has passed.
  const end = e.monthOnly
    ? new Date(Number(e.due.slice(0, 4)), Number(e.due.slice(5, 7)), 0)
    : new Date(e.due + 'T23:59:59')
  return end < today
}

export const yearOf = (e) => (e.due ? Number(e.due.slice(0, 4)) : null)

/** Live feed of every entry, newest-due first handled by the caller. */
export function watchEntries(onChange, onError) {
  if (local) return local.watchEntries(onChange, onError)
  return onSnapshot(
    collection(db, COL),
    // Skip the settings document — it shares the collection but is not a PM.
    (snap) => onChange(snap.docs.filter((d) => !isSettings(d.id)).map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  )
}

const CLEAN = ['site', 'wards', 'models', 'due', 'monthOnly', 'pmType', 'status', 'dateComplete', 'notes', 'extraNotes']

function tidy(entry) {
  const out = {}
  for (const k of CLEAN) if (entry[k] !== undefined) out[k] = entry[k]
  out.site = String(out.site || '').trim()
  out.status = out.status || 'Not started'
  return out
}

const label = (e) => `${e.site || 'a site'}${e.pmType ? ' (' + e.pmType + ')' : ''}`

export async function createEntry(entry, who) {
  if (local) return local.createEntry(tidy(entry), who)
  const r = await addDoc(collection(db, COL), {
    ...tidy(entry),
    createdAt: serverTimestamp(), createdBy: who,
    updatedAt: serverTimestamp(), updatedBy: who,
  })
  logActivity(null, `Added a PM for ${label(entry)}`, { app: 'maintenance' })
  return r
}

export async function saveEntry(id, entry, who) {
  if (local) return local.saveEntry(id, tidy(entry), who)
  const r = await updateDoc(doc(db, COL, id), { ...tidy(entry), updatedAt: serverTimestamp(), updatedBy: who })
  logActivity(null, `Updated the PM for ${label(entry)}${entry.status ? ' — ' + entry.status : ''}`, { app: 'maintenance' })
  return r
}

/** `what` names it in the log ("Waikato (First PM)"); the id alone says nothing to a person reading the log. */
export async function removeEntry(id, what = '') {
  if (local) return local.removeEntry(id)
  await deleteDoc(doc(db, COL, id))
  logActivity(null, `Deleted the PM for ${what || 'a site'}`, { app: 'maintenance' })
}

/** Import writes in batches — 500 is Firestore's hard limit per batch. */
export async function createMany(entries, who, onProgress) {
  if (local) return local.createMany(entries.map(tidy), who, onProgress)
  let done = 0
  for (let i = 0; i < entries.length; i += 400) {
    const chunk = entries.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const e of chunk) {
      batch.set(doc(collection(db, COL)), {
        ...tidy(e),
        createdAt: serverTimestamp(), createdBy: who,
        updatedAt: serverTimestamp(), updatedBy: who,
      })
    }
    await batch.commit()
    done += chunk.length
    onProgress?.(done, entries.length)
  }
  logActivity(null, `Imported ${done} PM${done === 1 ? '' : 's'}`, { app: 'maintenance' })
  return done
}

/** Live feed of the editable lists. Falls back to the defaults when unset. */
export function watchSettings(onChange, onError) {
  if (local) return local.watchSettings(onChange, onError)
  return onSnapshot(
    doc(db, COL, SETTINGS_ID),
    (snap) => {
      const d = snap.exists() ? snap.data() : {}
      const list = Array.isArray(d.pmTypes) ? d.pmTypes.filter(Boolean) : []
      onChange({ pmTypes: list.length ? list : DEFAULT_PM_TYPES })
    },
    onError,
  )
}

export async function savePmTypes(pmTypes, who) {
  if (local) return local.savePmTypes(pmTypes, who)
  await setDoc(
    doc(db, COL, SETTINGS_ID),
    { pmTypes, updatedAt: serverTimestamp(), updatedBy: who },
    { merge: true },
  )
  logActivity(null, `Changed the PM types (${pmTypes.length})`, { app: 'maintenance' })
}

/** Bulk delete, same 400-per-batch limit as the import. */
export async function removeMany(ids, onProgress) {
  // Never let a bulk delete take the settings document with it.
  ids = ids.filter((id) => !isSettings(id))
  if (local) return local.removeMany(ids, onProgress)
  let done = 0
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const id of chunk) batch.delete(doc(db, COL, id))
    await batch.commit()
    done += chunk.length
    onProgress?.(done, ids.length)
  }
  logActivity(null, `Deleted ${done} PM${done === 1 ? '' : 's'}`, { app: 'maintenance' })
  return done
}
