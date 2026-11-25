/* The Firestore side of the MAC reader's inbox (see macInbox.js). Rules: rules/firestore.rules, `macInbox`: one document per person, its id
   their user id; only they read, replace or remove it, and only while on one of the Bench's teams. */
import { deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { auth } from '../../../shared/firebase.js'
import { firestore } from '../../../shared/firestore.js'
import { cleanReading } from './macInbox.js'

const slot = (uid) => doc(firestore(), 'macInbox', String(uid))

/** Calls `onReading` with the person's reading ({ deviceId, lanMac, wlanMac, at } or null when there is none) now and whenever it changes. Returns a function that stops it. */
export function watchInbox(uid, onReading, onError) {
  return onSnapshot(slot(uid), (snap) => {
    if (!snap.exists()) return onReading(null)
    const x = snap.data()
    onReading({ deviceId: x.deviceId || '', lanMac: x.lanMac || '', wlanMac: x.wlanMac || '', at: x.at?.toMillis?.() || Date.now() })
  }, (e) => onError && onError(e))
}

/**
 * Sends the page's three values to the signed-in person's inbox, replacing what was there (refused with a plain message if one isn't an address).
 * Written to this device's copy at once and sent when there is a connection (a phone on site may have none): resolves { queued } true when
 * the server hadn't confirmed it within `waitMs`.
 */
export async function sendToPc(values, waitMs = 5000) {
  const { reading, errors } = cleanReading(values)
  if (errors.length) throw new Error(errors[0])
  const user = auth?.currentUser
  if (!user) throw new Error('Sign in to the hub to send to your PC.')
  const write = setDoc(slot(user.uid), { ...reading, by: (user.email || '').toLowerCase(), at: serverTimestamp() })
  write.catch(() => {}) // a refusal after the wait has nobody left to tell
  const refused = (e) => { throw new Error(e?.code === 'permission-denied' ? 'This account can’t send to the PC (it needs to be on one of the Test Bench’s teams), or the database rules for the MAC reader aren’t published yet.' : (e?.message || 'It couldn’t be sent.')) }
  const queued = await Promise.race([write.then(() => false, refused), new Promise((r) => setTimeout(() => r(true), waitMs))])
  return { queued, reading }
}

/** Removes the person's reading. */
export const clearInbox = (uid) => deleteDoc(slot(uid))
