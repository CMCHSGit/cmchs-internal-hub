// Everyone signed in has a record in users/{uid}: their name, team and role,
// which the rules, the People page and the Simpro proxy all go by (the demo
// tracker's database pass is refused without one: "Could not verify sign-in
// (404)"). It is made on a person's first sign-in, here.
//
// Until 22 Oct 2026 only the tools with their own AuthProvider (the schedule,
// Maintenance, Service orders, Settings, SimproSync) made it, so someone whose
// first stop was Home, People, Asks, Projects or Demo had none. Now the hub's
// shell calls ensureProfile as soon as anyone signs in (apps/hub/src/App.jsx),
// AuthProvider calls it, and the demo tracker waits for it before asking for
// its pass. However many ask at once, it runs once per sign-in.
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from './firebase'

/** first.last@ pattern guesses for a full "First Last" name — company uses both domains. */
function guessedEmails(fullName) {
  const parts = fullName.trim().toLowerCase().split(/\s+/)
  if (parts.length < 2) return []
  const key = `${parts[0]}.${parts[parts.length - 1]}`
  return [`${key}@cass.co.nz`, `${key}@chsnz.co.nz`]
}

/**
 * Copies any schedules saved under a pending placeholder's made-up id onto
 * the real uid claiming it, so admin-backfilled history doesn't become
 * orphaned the moment the placeholder is deleted. The old copies are left
 * in place rather than deleted (deleting them needs admin rights, which a
 * brand-new sign-in doesn't have) — harmless, since nothing ever looks
 * them up again once no user document references that placeholder id.
 */
async function transferSchedules(pendingId, realUid) {
  const snap = await getDocs(query(collection(db, 'schedules'), where('uid', '==', pendingId)))
  for (const scheduleDoc of snap.docs) {
    const newId = scheduleDoc.id.replace(pendingId, realUid)
    await setDoc(doc(db, 'schedules', newId), { ...scheduleDoc.data(), uid: realUid })
  }
}

/**
 * Settings → People and access (apps/admin) can bulk-create "pending" placeholder profiles (team,
 * excelName) for staff who haven't signed in yet, keyed by a made-up id
 * rather than their eventual real uid (which doesn't exist until they do).
 * On an actual first sign-in, adopt one of those placeholders — preferring
 * an email match (reliable even for two pending people sharing a first
 * name, e.g. two "Mark"s, as long as the pending record has a full name to
 * guess an email from) and falling back to first-name matching otherwise,
 * only when exactly one pending record shares that name. A genuinely
 * ambiguous case (shared first name, no full name to disambiguate with) is
 * left alone rather than guessed at — an admin sorts it out by hand, since
 * a wrong auto-merge silently hands someone the wrong team assignment.
 */
async function claimPendingProfile(firebaseUser) {
  const email = (firebaseUser.email || '').toLowerCase()
  const firstName = (firebaseUser.displayName || '').trim().split(/\s+/)[0]?.toLowerCase()

  const snap = await getDocs(query(collection(db, 'users'), where('pending', '==', true)))
  const pendingDocs = snap.docs

  let claimed = null
  // People added on the hub's People page carry the exact work email
  if (email) {
    const exact = pendingDocs.filter(d => (d.data().email || '').toLowerCase() === email)
    if (exact.length === 1) claimed = exact[0]
  }
  if (!claimed && email) {
    const emailMatches = pendingDocs.filter(d => guessedEmails(d.data().displayName || '').includes(email))
    if (emailMatches.length === 1) claimed = emailMatches[0]
  }
  if (!claimed && firstName) {
    const nameMatches = pendingDocs.filter(d => {
      const pendingFirst = (d.data().displayName || '').trim().split(/\s+/)[0]?.toLowerCase()
      return pendingFirst === firstName
    })
    if (nameMatches.length === 1) claimed = nameMatches[0]
  }
  if (!claimed) return null

  const data = claimed.data()
  await transferSchedules(claimed.id, firebaseUser.uid)
  // The placeholder is removed in the same write that creates the profile
  // (below). Its team comes too only on an exact email match: a team grants
  // rights, and firestore.rules lets a new profile take one only from a
  // placeholder carrying this sign-in's own email. Otherwise HR sets it.
  const exactEmail = !!email && (data.email || '').toLowerCase() === email
  return { ...data, id: claimed.id, team: exactEmail ? data.team || null : null }
}

/** Reads this person's users record, making it first if this is their first sign-in. */
async function readOrCreate(firebaseUser) {
  const ref = doc(db, 'users', firebaseUser.uid)
  const snap = await getDoc(ref)
  if (snap.exists()) return snap.data()

  const claimed = await claimPendingProfile(firebaseUser)
  const newProfile = {
    displayName: firebaseUser.displayName,
    email:       firebaseUser.email,
    team:        claimed?.team || null,
    role:        'user',
    ...(claimed?.excelName ? { excelName: claimed.excelName } : {}),
    ...(claimed?.workMobile ? { workMobile: claimed.workMobile } : {}),
    ...(claimed ? { claimedFrom: claimed.id } : {}),
    createdAt:   serverTimestamp(),
  }
  const batch = writeBatch(db)
  if (claimed) batch.delete(doc(db, 'users', claimed.id))
  batch.set(ref, newProfile)
  try {
    await batch.commit()
  } catch (e) {
    // Rules published before 21 Oct 2026 don't know claimedFrom. Until
    // the new ones are in the Firebase console, fall back to the old way:
    // remove the placeholder, then write the profile without it. Safe to
    // delete this fallback once rules/firestore.rules is published.
    if (!claimed || e?.code !== 'permission-denied') throw e
    const { claimedFrom: _unused, ...old } = newProfile
    await deleteDoc(doc(db, 'users', claimed.id)).catch(() => {})
    await setDoc(ref, old)
  }
  return newProfile
}

let running = null // { uid, promise }: one at a time, shared by every caller

/**
 * This person's users record, made on their first sign-in. Every caller for
 * the same sign-in shares one read (and at most one write); a failure is
 * forgotten, so the next call tries again.
 */
export function ensureProfile(firebaseUser) {
  if (!db || !firebaseUser) return Promise.resolve(null)
  if (running?.uid === firebaseUser.uid) return running.promise
  const mine = { uid: firebaseUser.uid }
  mine.promise = readOrCreate(firebaseUser).catch((e) => {
    if (running === mine) running = null
    throw e
  })
  running = mine
  return mine.promise
}
