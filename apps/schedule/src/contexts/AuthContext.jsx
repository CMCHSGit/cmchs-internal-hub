import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../firebase'

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

const AuthContext = createContext(null)

const DEV_USER = { uid: 'dev', displayName: 'Dev User', email: 'dev.user@cass.co.nz' }
const DEV_PROFILE = { displayName: 'Dev User', email: DEV_USER.email, team: 'Management', role: 'admin' }

// The signed-in person's profile, kept for the page's life rather than the
// AuthProvider's. Each tool (schedule, Maintenance, Service orders, Settings)
// has its own AuthProvider, which the shell unmounts when someone switches
// tool; without this, every switch back re-read the profile behind a
// full-page spinner. A tool opened again shows at once with this copy and
// refreshes it quietly.
let known = null // { uid, profile }

export function AuthProvider({ children }) {
  const kept = known && auth?.currentUser?.uid === known.uid ? known : null
  const [user,         setUser]         = useState(kept ? auth.currentUser : undefined) // undefined = loading auth
  const [profile,      setProfile]      = useState(kept ? kept.profile : null)
  const [profileReady, setProfileReady] = useState(!!kept)   // false until Firestore profile loaded
  const loadedUidRef = useRef(null) // whose profile we've already fetched this session
  const keep = (uid, p) => { known = { uid, profile: p }; setProfile(p) }

  useEffect(() => {
    // `npm run dev` without a .env: the same pretend "Dev User" the hub's
    // shell signs in (shared/session.js), as an admin, so the screens can be
    // worked on. A real build always has auth (scripts/build.mjs insists).
    if (!auth) {
      setUser(import.meta.env.DEV ? DEV_USER : null)
      setProfile(import.meta.env.DEV ? DEV_PROFILE : null)
      setProfileReady(true)
      return
    }
    return onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        known = null
        loadedUidRef.current = null
        setUser(null)
        setProfile(null)
        setProfileReady(true)
        return
      }

      setUser(firebaseUser)

      // onAuthStateChanged also fires on background token refreshes and
      // multi-tab sync, not just real sign-ins — re-fetching the profile
      // (and re-showing the full-page spinner) every time made the app
      // feel randomly slow. Only refetch for an actual new sign-in.
      if (loadedUidRef.current === firebaseUser.uid) {
        setProfileReady(true)
        return
      }
      loadedUidRef.current = firebaseUser.uid
      const ref = doc(db, 'users', firebaseUser.uid)

      // Read already by another tool this visit: show with that, refresh behind it.
      if (known?.uid === firebaseUser.uid) {
        setProfile(known.profile)
        setProfileReady(true)
        getDoc(ref).then(s => { if (s.exists()) keep(firebaseUser.uid, s.data()) }).catch(() => {})
        return
      }
      setProfileReady(false)

      const snap = await getDoc(ref)
      if (snap.exists()) {
        keep(firebaseUser.uid, snap.data())
      } else {
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
        keep(firebaseUser.uid, newProfile)
      }
      setProfileReady(true)
    })
  }, [])

  async function signInWithMicrosoft() {
    await signInWithPopup(auth, microsoftProvider)
  }

  async function signOutUser() {
    await signOut(auth)
  }

  async function refreshProfile() {
    const uid = auth.currentUser?.uid
    if (!uid) return
    const snap = await getDoc(doc(db, 'users', uid))
    if (snap.exists()) keep(uid, snap.data())
  }

  function patchProfile(updates) {
    if (known) known = { ...known, profile: { ...known.profile, ...updates } }
    setProfile(prev => (prev ? { ...prev, ...updates } : prev))
  }

  return (
    <AuthContext.Provider value={{
      user, profile, profileReady,
      signInWithMicrosoft, signOutUser, refreshProfile, patchProfile,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
