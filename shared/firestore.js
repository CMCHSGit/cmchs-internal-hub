// The one Firestore for internal.chsnz.co.nz, with a copy kept on the device
// (since 22 Oct 2026). With the copy, a list that was open before shows at once
// from it when a tool is opened again, then updates from the server, instead
// of a spinner on every switch between tools. Signing out clears it
// (shared/session.js), so the next person on a shared phone doesn't get it.
//
// Everything must get Firestore from here, never getFirestore() directly: the
// copy can only be turned on by whichever call comes first, so one stray
// getFirestore() that happened to run first would quietly turn it off.
import { getApp } from 'firebase/app'
import {
  clearIndexedDbPersistence, getFirestore, initializeFirestore,
  persistentLocalCache, persistentMultipleTabManager, terminate,
} from 'firebase/firestore'

let db = null

/** Firestore for the site's one Firebase app, started with the device copy on the first call. */
export function firestore(app = getApp()) {
  if (db) return db
  try {
    // Multiple tabs: the hub open in two tabs (or the app and a browser tab) share the copy.
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })
  } catch {
    // Already started without the copy (should not happen; see above): use it as it is.
    db = getFirestore(app)
  }
  return db
}

/** Sign-out: delete this device's copy. Firestore can't be used again in this page afterwards, so reload. */
export async function clearFirestoreCache() {
  const d = firestore()
  await terminate(d)
  // Fails while another tab of the hub is still open; that tab's copy stays until it signs out too.
  await clearIndexedDbPersistence(d).catch((e) => console.warn('[firestore] device copy not cleared', e?.code || e))
}
