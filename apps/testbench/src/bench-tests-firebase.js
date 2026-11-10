/* The Firestore side of the Test Bench's shared previous tests (see bench-tests.js). Rules: rules/firestore.rules, `benchTests` and
   `benchTestData`: engineers (and admins) read; the person who shared a test, or an admin, changes or removes it. */
import { collection, deleteDoc, doc, getDoc, limit, onSnapshot, orderBy, query, writeBatch } from 'firebase/firestore'
import { firestore } from '../../../shared/firestore.js'
import { forBench, packRun, summaryOf } from './bench-tests.js'

const LIST_LIMIT = 500

/** Calls `onList` with the most recent shared tests now and whenever they change; `onError` if the rules say no. Returns a function that stops it. */
export function watchTests(onList, onError) {
  const q = query(collection(firestore(), 'benchTests'), orderBy('finished', 'desc'), limit(LIST_LIMIT))
  return onSnapshot(q, (snap) => onList(forBench(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), (e) => onError && onError(e))
}

/** Shares (or updates) a finished test. Returns the summary, or null when the test is too big to share. */
export async function saveTest(run, who) {
  const json = packRun(run); if (!json) return null
  const s = summaryOf(run, who), db = firestore(), b = writeBatch(db)
  b.set(doc(db, 'benchTests', s.id), { ...s, size: json.length })
  b.set(doc(db, 'benchTestData', s.id), { by: s.by, json })
  try { await b.commit() } catch (e) {
    // The rules that allow an `order` on a summary may not be published yet: share the test without it (it still counts for its customer's order).
    if (!s.order || e?.code !== 'permission-denied') throw e
    const { order, ...plain } = s, b2 = writeBatch(db)
    b2.set(doc(db, 'benchTests', s.id), { ...plain, size: json.length }); b2.set(doc(db, 'benchTestData', s.id), { by: s.by, json })
    await b2.commit()
  }
  return s
}

/** The whole test (as the JSON string), or null if it has gone. */
export async function loadTest(id) {
  const snap = await getDoc(doc(firestore(), 'benchTestData', String(id)))
  return snap.exists() ? snap.data().json : null
}

/** Frees the storage of finished tests: the whole record (`benchTestData`, the bulk) is deleted and the one-line summary is kept with `size: 0`,
    so orders still count the test and nothing needs a rules change. Only the engineer who shared a test (or an admin) can; returns how many were cleared. */
export async function clearTestData(ids) {
  const db = firestore(), list = [...new Set(ids.map(String))]
  for (let i = 0; i < list.length; i += 200) {
    const b = writeBatch(db)
    for (const id of list.slice(i, i + 200)) { b.update(doc(db, 'benchTests', id), { size: 0 }); b.delete(doc(db, 'benchTestData', id)) }
    await b.commit()
  }
  return list.length
}

export async function removeTest(id) {
  const db = firestore(), b = writeBatch(db)
  b.delete(doc(db, 'benchTests', String(id))); b.delete(doc(db, 'benchTestData', String(id)))
  await b.commit()
  try { await deleteDoc(doc(db, 'benchTestStatus', String(id))) } catch { /* its rules may not be published yet: an orphan status line is harmless */ }
}
