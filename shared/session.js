// One Microsoft sign-in for every app on internal.chsnz.co.nz.
//
// All apps live on the same origin and use the same Firebase project (the
// staff schedule's), so Firebase's saved session (IndexedDB, keyed by the API
// key) is shared: sign in once at the hub and /service, /demo, /schedule all
// see you as signed in. The session survives browser restarts until you sign
// out. No React here, so plain pages (the /service tools' gate) can use it too.
import { onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
// The site's one Firebase start-up (shared with every tool's apps/schedule/src/firebase.js)
import { auth, configured, microsoftProvider } from './firebase.js'

export { configured }

// `npm run dev` without a .env: pretend someone is signed in so the UI can be
// worked on. Never happens in a real build (scripts/build.mjs refuses to build
// for CI without the config).
const devMock = !configured && import.meta.env.DEV
const DEV_USER = { uid: 'dev', displayName: 'Dev User', email: 'dev.user@cass.co.nz' }

const provider = microsoftProvider

/** Calls back with the signed-in user, or null. Returns an unsubscribe function. */
export function watchUser(callback) {
  if (devMock) { callback(DEV_USER); return () => {} }
  if (!auth) { callback(null); return () => {} }
  return onAuthStateChanged(auth, callback)
}

export async function signIn() {
  if (!auth) throw new Error('Sign-in is not configured for this build.')
  await signInWithPopup(auth, provider)
}

export async function signOutUser() {
  if (auth) await signOut(auth)
}

/** "Peter Lin" -> "PL"; falls back to the email's first letters. */
export function initialsOf(user) {
  const name = (user?.displayName || '').trim()
  if (name) {
    const parts = name.split(/\s+/)
    return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
  }
  return (user?.email || '?').slice(0, 2).toUpperCase()
}

export function firstNameOf(user) {
  const name = (user?.displayName || '').trim()
  if (name) return name.split(/\s+/)[0]
  return (user?.email || '').split(/[.@]/)[0].replace(/^./, c => c.toUpperCase())
}

/** Sends a signed-out visitor to the hub's sign-in, then back to where they were. */
export function goToSignIn() {
  const here = location.pathname + location.search + location.hash
  location.replace('/?next=' + encodeURIComponent(here))
}

/** The ?next= target after sign-in, if it's a safe same-site path. */
export function nextPath() {
  const next = new URLSearchParams(location.search).get('next')
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}
