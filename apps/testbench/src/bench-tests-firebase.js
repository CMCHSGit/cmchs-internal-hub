/* The Firestore side of the Test Bench's shared previous tests (see bench-tests.js). Rules: rules/firestore.rules, `benchTests` and
   `benchTestData`: engineers (and admins) read; the person who shared a test, or an admin, changes or removes it. */
import { collection, doc, getDoc, limit, onSnapshot, orderBy, query, writeBatch } from 'firebase/firestore'
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
  await b.commit()
  return s
}

/** The whole test (as the JSON string), or null if it has gone. */
export async function loadTest(id) {
  const snap = await getDoc(doc(firestore(), 'benchTestData', String(id)))
  return snap.exists() ? snap.data().json : null
}

export async function removeTest(id) {
  const db = firestore(), b = writeBatch(db)
  b.delete(doc(db, 'benchTests', String(id))); b.delete(doc(db, 'benchTestData', String(id)))
  await b.commit()
}
