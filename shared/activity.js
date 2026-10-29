// The hub's one activity log: who did what, and when, in every tool.
//
// One line per action in Firestore's `activity` collection (rules: anyone
// signed in can add a line about themselves; only admins read; nobody edits or
// deletes, not even admins). Read on Settings → Staff schedule → Activity log,
// and copied nightly to Google Drive by backend/apps-script/backup (activityBackup_).
//
// Fire-and-forget: a logging failure (offline, rules not yet published) never
// blocks or fails the action it records, it only means that one line is lost.
// Call it AFTER the action has worked, not before, so the log says what happened.
//
// Lines say what changed, in words ("Moved Waikato 2 weeks later"). Never put
// passwords, tokens or private details (pay, health, emergency contacts) in one:
// the log is readable by every admin and is copied to Drive.
import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
import { auth } from './firebase.js'
import { firestore } from './firestore.js'
import { buildEntry } from './activity-core.js'

export { APP_LABELS, appLabel, appOfPath, buildEntry, MAX_SUMMARY } from './activity-core.js'

/** Signing in and out, for the tools' own sign-in buttons. Sign-out waits a moment for the line to go (it can't be sent afterwards), never long. */
export const logSignedIn = () => logActivity(null, 'Signed in')
export const logSignedOut = () => Promise.race([logActivity(null, 'Signed out'), new Promise((r) => setTimeout(r, 1500))])

/**
 * Records one action by whoever is signed in.
 * `who` is optional (the person's name for the line; the signed-in user is the
 * author either way, which is what the rules check). `opts.app` overrides the
 * tool, which is otherwise read from the page's address.
 */
export async function logActivity(who, summary, opts = {}) {
  try {
    const user = auth?.currentUser
    const entry = buildEntry(user, who, summary, opts, typeof location !== 'undefined' ? location.pathname : '')
    if (!entry) return
    await addDoc(collection(firestore(), 'activity'), { ...entry, at: serverTimestamp() })
  } catch (e) {
    console.warn('[activity] not logged', e?.code || e)
  }
}
