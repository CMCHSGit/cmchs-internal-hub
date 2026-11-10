/* The Firestore side of the shared test status (see bench-status.js). Rules: rules/firestore.rules, `benchTestStatus`: the Bench's teams read and write. */
import { collection, doc, limit, onSnapshot, orderBy, query, writeBatch } from 'firebase/firestore'
import { firestore } from '../../../shared/firestore.js'
import { statusMap } from './bench-status.js'

const LIST_LIMIT = 2000

/** Calls `onMap` with { testId: { sentJobs, downloadedAt } } now and whenever it changes; `onError` if the rules say no (not published yet). Returns a stop function. */
export function watchStatus(onMap, onError) {
  const q = query(collection(firestore(), 'benchTestStatus'), orderBy('updatedAt', 'desc'), limit(LIST_LIMIT))
  return onSnapshot(q, (snap) => onMap(statusMap(snap.docs.map((d) => ({ id: d.id, ...d.data() })))), (e) => onError && onError(e))
}

/** Records what this laptop knows: [{ id, jobs, downloadedAt }] (bench-status.js statusToWrite). `who` is the signed-in engineer's email. */
export async function saveStatus(list, who) {
  const db = firestore(), email = String(who || '').toLowerCase()
  for (let i = 0; i < list.length; i += 400) {
    const b = writeBatch(db)
    for (const s of list.slice(i, i + 400)) b.set(doc(db, 'benchTestStatus', s.id), { sentJobs: s.jobs, ...(s.downloadedAt ? { downloadedAt: s.downloadedAt } : {}), updatedBy: email, updatedAt: Date.now() }, { merge: true })
    await b.commit()
  }
  return list.length
}
