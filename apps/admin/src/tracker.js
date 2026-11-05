/* The demo tracker's team, read and changed from Settings and from the tracker's Manage, Team.

   The team is the hub's own people records (step 5A): a person is on it when their
   users/{uid} record has a `trackerRole` ('am' = account manager, 'service' =
   Service & Projects), and their demo reminders switch is
   users/{uid}.notifications.demoReminders (the same one they set for themselves in
   Settings, Your notifications). The tracker's old list (accountManagers in the
   chs-equipment Realtime Database) is no longer read or written. Only an admin may
   set trackerRole (rules/firestore.rules). */
// The pass and the database address are the rebuilt tracker's (one pass for
// the whole app): apps/equipment/src/db.js.
import { loadCutover, read } from '../../equipment/src/db.js'
import { deleteField, doc, updateDoc } from 'firebase/firestore'
import { db } from '../../schedule/src/firebase'

export const TRACKER_ROLES = [
  { id: 'am', label: 'Account manager' },
  { id: 'service', label: 'Service & Projects' },
]
export const trackerRoleLabel = id => TRACKER_ROLES.find(r => r.id === id)?.label || 'Account manager'

/**
 * Reads one path of the tracker's data (e.g. 'upcomingLoans'). Read-only: the
 * project tracker's demo feed uses it. Wherever the data is: the old database,
 * or Firestore after step 5's cutover (db.js decides).
 */
export async function readTracker(path) {
  await loadCutover()
  return (await read(path)).data
}

/*
 * Changing the team, the same way from Settings (People and access) and the
 * tracker's Manage (Team), so the two never disagree. A person is { uid, name,
 * email }: they need a hub record (uid); someone who hasn't signed in yet is added
 * in Settings, People and access, and gets a role after their first sign-in.
 */

/** Their tracker role, on their hub record: this is what puts them on the team. */
export async function setMemberRole(person, role) {
  if (!person.uid || !db) throw new Error('They need a hub sign-in before they can be on the team.')
  await updateDoc(doc(db, 'users', person.uid), { trackerRole: role })
}

/** Off the team: their tracker role cleared. Their loans keep their name as the account manager. */
export async function removeMember(person) {
  if (!person.uid || !db) throw new Error('They aren’t on the team.')
  await updateDoc(doc(db, 'users', person.uid), { trackerRole: deleteField() })
}
