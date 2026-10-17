/* Service orders — data shape, dates and Firestore access.

   One document per service order line, in the `serviceOrders` collection of
   the staff schedule's Firebase project. Replaces the service order
   spreadsheet: each of its tabs is a `stage` here. Everyone signed in can
   read; the Engineers and Management teams, plus admins, can write
   (firestore.rules). */

import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot,
  serverTimestamp, writeBatch,
} from 'firebase/firestore'
import { db } from '../schedule/src/firebase.js'
import * as devStore from './store-local.js'

// `npm run dev` without a .env has no Firestore: made-up orders instead
// (store-local.js). In a real build this is always null and drops out.
const local = import.meta.env.DEV && !db ? devStore : null

export const COL = 'serviceOrders'

// The spreadsheet's tabs, in its order. The first four are one order's life;
// spare parts ordered for CHS stock sit beside them rather than after.
export const STAGES = ['In progress', 'Received', 'Ready for shipping', 'Completed or sent back', 'CHS spare parts order']
export const FLOW = STAGES.slice(0, 4)

/** The stage after this one, or null at the end of the flow. */
export function nextStage(stage) {
  const i = FLOW.indexOf(stage)
  return i >= 0 && i < FLOW.length - 1 ? FLOW[i + 1] : null
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const pad = (n) => String(n).padStart(2, '0')

/**
 * Any date the sheet or a service order throws at us, as 'YYYY-MM-DD' or ''.
 * The sheet writes "2026.10.04" (year first, how the service order prints
 * it); people typing by hand write NZ day-first "4/10/2026"; the xlsx reader
 * hands real Excel dates over as { date: { y, m, d } }.
 */
export function parseDate(raw) {
  if (raw == null || raw === '') return ''
  if (typeof raw === 'object' && raw.date) return `${raw.date.y}-${pad(raw.date.m)}-${pad(raw.date.d)}`
  const s = String(raw).trim()

  // Year first: 2026.10.04, 2026-10-04, 2026/10/04 10:23
  let m = /^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})/.exec(s)
  if (m) return valid(+m[1], +m[2], +m[3])

  // Day first: 4/10/2026, 04.10.26
  m = /^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/.exec(s)
  if (m) return valid(+m[3] < 100 ? +m[3] + 2000 : +m[3], +m[2], +m[1])

  // An Excel serial that came through as a plain number
  if (/^\d{5}$/.test(s)) {
    const d = new Date((Number(s) - 25569) * 86400000)
    return d.toISOString().slice(0, 10)
  }
  return ''
}

function valid(y, mo, d) {
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${pad(mo)}-${pad(d)}` : ''
}

export function formatDate(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Days an order has been waiting on parts — only meaningful while In progress. */
export function daysWaiting(e, now = new Date()) {
  if (e.stage !== 'In progress' || !e.dateRaised) return null
  return Math.floor((now - new Date(e.dateRaised + 'T00:00:00')) / 86400000)
}

export const LATE_DAYS = 30

/** Live feed of every order. */
export function watchOrders(onChange, onError) {
  if (local) return local.watchOrders(onChange, onError)
  return onSnapshot(
    collection(db, COL),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
    onError,
  )
}

export const FIELDS = ['so', 'title', 'sn', 'pn', 'partName', 'needReturn', 'site', 'notes', 'jobs', 'appliedBy',
  'dateRaised', 'receivedDate', 'oldSo', 'extraNotes', 'stage']

function tidy(order) {
  const out = {}
  for (const k of FIELDS) out[k] = String(order[k] ?? '').trim()
  out.needReturn = /^y/i.test(out.needReturn) ? 'YES' : /^n/i.test(out.needReturn) ? 'NO' : ''
  if (!STAGES.includes(out.stage)) out.stage = STAGES[0]
  return out
}

export async function createOrder(order, who) {
  if (local) return local.createOrder(tidy(order), who)
  return addDoc(collection(db, COL), {
    ...tidy(order),
    stageAt: serverTimestamp(),
    createdAt: serverTimestamp(), createdBy: who,
    updatedAt: serverTimestamp(), updatedBy: who,
  })
}

/** `stageChanged` stamps when it moved, so "how long has it sat here" is answerable later. */
export async function saveOrder(id, order, who, stageChanged = false) {
  if (local) return local.saveOrder(id, tidy(order), who)
  return updateDoc(doc(db, COL, id), {
    ...tidy(order),
    ...(stageChanged ? { stageAt: serverTimestamp() } : {}),
    updatedAt: serverTimestamp(), updatedBy: who,
  })
}

export async function removeOrder(id) {
  if (local) return local.removeOrder(id)
  return deleteDoc(doc(db, COL, id))
}

/** Import writes in batches — 500 is Firestore's hard limit per batch. */
export async function createMany(orders, who, onProgress) {
  if (local) return local.createMany(orders.map(tidy), who, onProgress)
  let done = 0
  for (let i = 0; i < orders.length; i += 400) {
    const chunk = orders.slice(i, i + 400)
    const batch = writeBatch(db)
    for (const o of chunk) {
      batch.set(doc(collection(db, COL)), {
        ...tidy(o),
        stageAt: serverTimestamp(),
        createdAt: serverTimestamp(), createdBy: who,
        updatedAt: serverTimestamp(), updatedBy: who,
      })
    }
    await batch.commit()
    done += chunk.length
    onProgress?.(done, orders.length)
  }
  return done
}
