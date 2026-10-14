import { collection, doc, getDocs, query, where, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import { importOps } from './excelImportOps.js'

// Firestore's `in` takes up to 30 values; a batch up to 500 writes.
const WEEKS_PER_QUERY = 30
const WRITES_PER_BATCH = 400

/** What the app already holds for these weeks: { schedules: Map(id → doc), onCall: Map(weekStart → doc) }. */
export async function loadExisting(weekStarts) {
  const schedules = new Map()
  for (let i = 0; i < weekStarts.length; i += WEEKS_PER_QUERY) {
    const snap = await getDocs(query(collection(db, 'schedules'), where('weekStart', 'in', weekStarts.slice(i, i + WEEKS_PER_QUERY))))
    snap.docs.forEach(d => schedules.set(d.id, d.data()))
  }
  const onCall = new Map((await getDocs(collection(db, 'oncall'))).docs.map(d => [d.id, d.data()]))
  return { schedules, onCall }
}

/**
 * Saves a plan from planImport. Everything is a merge — nothing is ever
 * deleted — and the writes are idempotent (the plan records what the Excel
 * said, so running the import again finds nothing left to do), so if it
 * stops part-way just run it again.
 *
 * Imported entries deliberately don't touch `submittedAt`: that means "saved
 * in the app", and the Excel copy job (scripts/sync-excel.mjs) uses it to
 * find what to write *to* the Excel — importing shouldn't echo straight back.
 */
export async function applyImportPlan(plan, { editorUid = null, onProgress } = {}) {
  // What to write is worked out in excelImportOps.js, shared with the automatic import on a PC.
  const ops = importOps(plan, { editorUid, now: serverTimestamp })
    .map(op => ({ ref: doc(db, op.collection, op.id), data: op.data, merge: op.merge }))

  let done = 0
  for (let i = 0; i < ops.length; i += WRITES_PER_BATCH) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + WRITES_PER_BATCH)) {
      if (op.merge) batch.set(op.ref, op.data, { merge: true })
      else batch.set(op.ref, op.data)
    }
    await batch.commit()
    done = Math.min(ops.length, i + WRITES_PER_BATCH)
    onProgress?.(done, ops.length)
  }
  return { writes: done }
}
