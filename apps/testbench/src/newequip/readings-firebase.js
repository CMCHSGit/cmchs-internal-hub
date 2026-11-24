/* The Firestore side of the phone readings (see readings.js). Rules: rules/firestore.rules, `deviceReadings`: the Bench's teams read, add,
   replace and remove them; nobody saves one under another person's email. One query by customer (a single equality: no index needed). */
import { collection, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { auth } from '../../../../shared/firebase.js'
import { firestore } from '../../../../shared/firestore.js'
import { cleanReading, readingId } from './readings.js'

/** Calls `onList` with a customer's readings ({ id, serial, deviceId, lanMac, wlanMac, by, at }) now and whenever they change. Returns a function that stops it. */
export function watchReadings(customerId, onList, onError) {
  const q = query(collection(firestore(), 'deviceReadings'), where('customerId', '==', String(customerId)))
  return onSnapshot(q, (snap) => {
    onList(snap.docs.map((d) => { const x = d.data(); return { id: d.id, serial: x.serial || '', deviceId: x.deviceId || '', lanMac: x.lanMac || '', wlanMac: x.wlanMac || '', by: x.by || '', at: x.at?.toMillis?.() || Date.now() } }))
  }, (e) => onError && onError(e))
}

/**
 * Sends a unit's reading (the page's three values; refused with a plain message if one isn't an address). Written to this device's copy at once and
 * sent when there is a connection (a phone on site may have none): resolves { queued } true when the server hadn't confirmed it within `waitMs`.
 */
export async function saveReading(customerId, serial, values, waitMs = 5000) {
  const { reading, errors } = cleanReading(values)
  if (errors.length) throw new Error(errors[0])
  const by = (auth?.currentUser?.email || '').toLowerCase()
  const ref = doc(firestore(), 'deviceReadings', readingId(customerId, serial))
  const write = setDoc(ref, { customerId: String(customerId), serial: String(serial).trim(), ...reading, by, at: serverTimestamp() })
  write.catch(() => {}) // a refusal after the wait has nobody left to tell
  const refused = (e) => { throw new Error(e?.code === 'permission-denied' ? 'This account can’t save readings (it needs to be on one of the Test Bench’s teams), or the database rules for them aren’t published yet.' : (e?.message || 'It couldn’t be sent.')) }
  const queued = await Promise.race([write.then(() => false, refused), new Promise((r) => setTimeout(() => r(true), waitMs))])
  return { queued, reading }
}

export const removeReading = (id) => deleteDoc(doc(firestore(), 'deviceReadings', String(id)))
