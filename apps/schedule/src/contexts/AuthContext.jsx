import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../firebase'
import { logSignedIn, logSignedOut } from '../../../../shared/activity.js'
// A first sign-in's record is made there, shared with the hub's shell and the demo tracker
import { ensureProfile } from '../profile'

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
        keep(firebaseUser.uid, await ensureProfile(firebaseUser))
      }
      setProfileReady(true)
    })
  }, [])

  async function signInWithMicrosoft() {
    await signInWithPopup(auth, microsoftProvider)
    logSignedIn() // the hub's activity log (shared/activity.js)
  }

  async function signOutUser() {
    await logSignedOut()
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
