/* Maintenance schedule — data shape, parsing and Firestore access.

   One document per scheduled PM, in the `maintenance` collection of the staff
   schedule's Firebase project. Everyone signed in can read; the Engineers and
   Management teams, plus admins, can write (firestore.rules). */

import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../schedule/src/firebase.js'

export const COL = 'maintenance'
export const PM_TYPES = ['First PM', 'Second PM', 'Other']
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
  return onSnapshot(
    collection(db, COL),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
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

export async function createEntry(entry, who) {
  return addDoc(collection(db, COL), {
    ...tidy(entry),
    createdAt: serverTimestamp(), createdBy: who,
    updatedAt: serverTimestamp(), updatedBy: who,
  })
}

export async function saveEntry(id, entry, who) {
  return updateDoc(doc(db, COL, id), { ...tidy(entry), updatedAt: serverTimestamp(), updatedBy: who })
}

export async function removeEntry(id) {
  return deleteDoc(doc(db, COL, id))
}

/** Import writes in batches — 500 is Firestore's hard limit per batch. */
export async function createMany(entries, who, onProgress) {
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
  return done
}

/** Bulk delete, same 400-per-batch limit as the import. */
export async function removeMany(ids, onProgress) {
  let done = 0
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const id of chunk) batch.delete(doc(db, COL, id))
    await batch.commit()
    done += chunk.length
    onProgress?.(done, ids.length)
  }
  return done
}
