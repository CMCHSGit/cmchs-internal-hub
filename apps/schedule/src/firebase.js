// The tools' Firebase handles: sign-in from the site's one start-up
// (shared/firebase.js), plus Firestore and push for the tools that need them.
import { getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'
import { app, auth, microsoftProvider } from '../../../shared/firebase.js'

export { auth, microsoftProvider }
// Null only in `npm run dev` without a .env (no app to read from), so that
// importing this doesn't throw: screens that don't need Firestore straight
// away (Settings' Appearance) still work there; ones that read it as they
// open (the schedule's weeks) show the shell's "didn't load" message.
export const db = app ? getFirestore(app) : null

// Not every browser supports FCM (e.g. Safari outside a standalone PWA on
// older iOS) — resolves to null there instead of throwing.
export const messagingPromise = isSupported().then(ok => ok && app ? getMessaging(app) : null)
