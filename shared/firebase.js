// The one Firebase start-up for internal.chsnz.co.nz (the staff schedule's
// project: Microsoft sign-in, Firestore, push). Everything signs in through
// this: the hub's shared/session.js and the tools' apps/schedule/src/firebase.js
// both start from here, so in the one app (INTEGRATION-PLAN.md step 2) there is
// exactly one Firebase app, not two fighting over the name "[DEFAULT]".
//
// Sign-in only. Firestore and messaging are added by apps/schedule/src/firebase.js
// for the tools that need them, so the hub's first load stays small.
import { getApp, getApps, initializeApp } from 'firebase/app'
import { connectAuthEmulator, getAuth, OAuthProvider } from 'firebase/auth'

// Trimmed: a value pasted into GitHub Secrets with a trailing newline (it
// happened with the tenant ID) makes Microsoft answer "Bad Request".
const env = name => (import.meta.env[name] || '').trim() || undefined

export const firebaseConfig = {
  apiKey:            env('VITE_FIREBASE_API_KEY'),
  authDomain:        env('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId:         env('VITE_FIREBASE_PROJECT_ID'),
  storageBucket:     env('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: env('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId:             env('VITE_FIREBASE_APP_ID'),
}

/** False in `npm run dev` without a .env; scripts/build.mjs refuses a CI build without it. */
export const configured = Boolean(firebaseConfig.apiKey)

/**
 * The test copy (`npm run dev:emulators`, README "Test copy"): sign-in and
 * Firestore are the Firebase emulators on this computer, under a made-up
 * "demo-" project, so nothing can reach the live data. Only on the dev server:
 * a real build can't turn it on.
 */
export const emulators = Boolean(import.meta.env.DEV) && import.meta.env.VITE_EMULATORS === 'true'

export const app = configured ? (getApps().length ? getApp() : initializeApp(firebaseConfig)) : null
export const auth = app ? getAuth(app) : null
if (emulators && auth && !auth.emulatorConfig) connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true })

// Microsoft (Entra ID). Only Cass Medical accounts, and always the account
// picker, so nobody gets stuck signed in as the wrong person.
export const microsoftProvider = new OAuthProvider('microsoft.com')
microsoftProvider.setCustomParameters({
  tenant: env('VITE_AZURE_TENANT_ID'),
  prompt: 'select_account',
})
