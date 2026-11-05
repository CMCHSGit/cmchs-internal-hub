/* The Firestore side of the customer registry (see registry.js). Rules: rules/firestore.rules, `customerRegistry`: the Bench's
   teams read; only admins add, change or remove. Each entry says who last changed it and when. */
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth } from '../../../shared/firebase.js'
import { firestore } from '../../../shared/firestore.js'
import { sortCustomers } from './registry.js'

/** Calls `onList` with every customer (by name) now and whenever they change; `onError` if the rules say no. Returns a function that stops it. */
export function watchRegistry(onList, onError) {
  return onSnapshot(collection(firestore(), 'customerRegistry'),
    (snap) => onList(sortCustomers(snap.docs.map((d) => ({ id: d.id, ...d.data() })))),
    (e) => onError && onError(e))
}

/** Adds a customer (no `id`) or changes one. `entry` is registry.js's cleanEntry(...).entry. Returns the id. */
export async function saveCustomer(entry, id) {
  const email = (auth?.currentUser?.email || '').toLowerCase()
  const ref = id ? doc(firestore(), 'customerRegistry', id) : doc(collection(firestore(), 'customerRegistry'))
  await setDoc(ref, { ...entry, updatedBy: email, updatedAt: serverTimestamp() })
  return ref.id
}

export const removeCustomer = (id) => deleteDoc(doc(firestore(), 'customerRegistry', String(id)))
