// One Microsoft sign-in for every app on internal.chsnz.co.nz.
//
// All apps live on the same origin and use the same Firebase project (the
// staff schedule's), so Firebase's saved session (IndexedDB, keyed by the API
// key) is shared: sign in once at the hub and /service, /demo, /schedule all
// see you as signed in. The session survives browser restarts until you sign
// out. No React here, so plain pages (the /service tools' gate) can use it too.
import { initializeApp } from 'firebase/app'
import { getAuth, OAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'

const config = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
}

export const configured = Boolean(config.apiKey)

// `npm run dev` without a .env: pretend someone is signed in so the UI can be
// worked on. Never happens in a real build (scripts/build.mjs refuses to build
// for CI without the config).
const devMock = !configured && import.meta.env.DEV
const DEV_USER = { uid: 'dev', displayName: 'Dev User', email: 'dev.user@cass.co.nz' }

let auth = null
let provider = null
if (configured) {
  auth = getAuth(initializeApp(config))
  provider = new OAuthProvider('microsoft.com')
  provider.setCustomParameters({
    // Only Cass Medical accounts (same setting as the schedule app)
    tenant: import.meta.env.VITE_AZURE_TENANT_ID,
    prompt: 'select_account',
  })
}

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
