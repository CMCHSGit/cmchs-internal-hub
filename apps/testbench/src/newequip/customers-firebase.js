/* The Firestore side of the new-equipment page's customers: the project tracker's customer folders, in projectSettings/main
   (rules: everyone signed in reads; the people who can edit the tracker write, which is the same test as here). A change is made
   from the folders as they are right now, in a transaction, so two people adding customers at once keep each other's. */
import { doc, onSnapshot, runTransaction } from 'firebase/firestore'
import { firestore } from '../../../../shared/firestore.js'
import { customersOf, tidyCustomer } from './customers.js'

const ref = () => doc(firestore(), 'projectSettings', 'main')

/** Calls `onData({ customers, defaults })` now and whenever they change; `onError` if the rules say no. Returns a function that stops it. */
export function watchCustomers(onData, onError) {
  return onSnapshot(ref(), (s) => {
    const d = s.exists() ? s.data() : {}
    onData({ customers: customersOf(d), defaults: Array.isArray(d.customerDefaults) && d.customerDefaults.length ? d.customerDefaults : undefined })
  }, (e) => onError && onError(e))
}

/** Adds the customer, or replaces the one with its id, leaving every other folder as it is. Returns what was stored. */
export async function saveCustomer(draft) {
  const c = tidyCustomer(draft)
  await runTransaction(firestore(), async (t) => {
    const r = ref(), s = await t.get(r)
    const cur = s.exists() && Array.isArray(s.data().customers) ? s.data().customers : []
    const next = [...cur.filter((x) => x.id !== c.id), c]
    t.set(r, JSON.parse(JSON.stringify({ customers: next })), { merge: true })
  })
  return c
}
