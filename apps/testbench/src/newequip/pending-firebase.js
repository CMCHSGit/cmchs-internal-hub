/* The Firestore side of the pending assets (see pending.js). Rules: rules/firestore.rules, `pendingAssets`: the Bench's teams read, add
   and remove; nobody adds one under another person's email. One query by customer (a single equality: no index needed). */
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, where } from 'firebase/firestore'
import { auth } from '../../../../shared/firebase.js'
import { firestore } from '../../../../shared/firestore.js'
import { rowOf } from './pending.js'

/** Calls `onList` with a customer's pending rows (oldest first: { id, by, ...fields }) now and whenever they change. Returns a function that stops it. */
export function watchPending(customerId, onList, onError) {
  const q = query(collection(firestore(), 'pendingAssets'), where('customerId', '==', String(customerId)))
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, by: d.data().by || '', at: d.data().createdAt?.toMillis?.() || Date.now(), ...rowOf(d.data().row) }))
    onList(list.sort((a, b) => a.at - b.at))
  }, (e) => onError && onError(e))
}

/** Records an asset for a customer (`row` from pending.js cleanPending). Returns its id. */
export async function addPending(customerId, row) {
  const by = (auth?.currentUser?.email || '').toLowerCase()
  const ref = await addDoc(collection(firestore(), 'pendingAssets'), { customerId: String(customerId), row, by, createdAt: serverTimestamp() })
  return ref.id
}

export const removePending = (id) => deleteDoc(doc(firestore(), 'pendingAssets', String(id)))
