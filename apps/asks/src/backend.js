/* Where the data lives.

   A real build: Firestore, in the staff schedule's Firebase project, which is
   also where the sign-in comes from (backend-firebase.js).

   `npm run dev` without a .env: a stand-in kept in this browser's localStorage
   and shared between tabs (backend-local.js), with sample people and asks.
   Add ?as=<name> to the address to be someone else (?as=mike), so two tabs
   can act as two people.

   Both expose the same calls; everything else in the app only talks to these. */

const configured = Boolean((import.meta.env.VITE_FIREBASE_API_KEY || '').trim())

let pending = null
export function getBackend() {
  if (!pending) {
    pending = configured || !import.meta.env.DEV
      ? import('./backend-firebase.js').then((m) => m.default)
      : import('./backend-local.js').then((m) => m.default)
  }
  return pending
}

/** Firestore refuses `undefined` anywhere in a document; drop those keys. */
export function clean(v) {
  if (Array.isArray(v)) return v.map(clean)
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) {
    const out = {}
    for (const [k, x] of Object.entries(v)) if (x !== undefined) out[k] = clean(x)
    return out
  }
  return v
}
