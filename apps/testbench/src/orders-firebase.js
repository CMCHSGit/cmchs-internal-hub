/* The Firestore side of the Test Bench's orders (see orders.js). Rules: rules/firestore.rules, `benchOrders`: the Bench's teams read, add and
   change them (any engineer can edit or close an order, that is the point); the person who made one, or an admin, deletes it. */
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore'
import { firestore } from '../../../shared/firestore.js'
import { cleanOrder } from './orders.js'

/** Calls `onList` with every order now and whenever one changes; `onError` if the rules say no (or aren't published yet). Returns a function that stops it. */
export function watchOrders(onList, onError) {
  const q = query(collection(firestore(), 'benchOrders'), orderBy('createdAt', 'desc'))
  return onSnapshot(q, (snap) => onList(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), (e) => onError && onError(e))
}

/** Adds an order (no id) or saves changes to one. Returns its id. */
export async function saveOrder(order, who) {
  const data = cleanOrder(order, who)
  if (order.id) { await setDoc(doc(firestore(), 'benchOrders', order.id), data); return order.id }
  return (await addDoc(collection(firestore(), 'benchOrders'), data)).id
}

export const removeOrder = (id) => deleteDoc(doc(firestore(), 'benchOrders', String(id)))
