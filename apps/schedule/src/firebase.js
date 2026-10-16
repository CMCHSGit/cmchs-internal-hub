// The tools' Firebase handles: sign-in from the site's one start-up
// (shared/firebase.js), plus Firestore and push for the tools that need them.
import { getFirestore } from 'firebase/firestore'
import { getMessaging, isSupported } from 'firebase/messaging'
import { app, auth, microsoftProvider } from '../../../shared/firebase.js'

export { auth, microsoftProvider }
export const db = getFirestore(app)

// Not every browser supports FCM (e.g. Safari outside a standalone PWA on
// older iOS) — resolves to null there instead of throwing.
export const messagingPromise = isSupported().then(ok => ok ? getMessaging(app) : null)
