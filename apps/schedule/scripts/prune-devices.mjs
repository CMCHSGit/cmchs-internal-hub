/**
 * apps/schedule/scripts/prune-devices.mjs — run weekly by
 * .github/workflows/prune-devices.yml.
 *
 * Every browser or installed app that turns notifications on adds a device to
 * users/{uid}.fcmTokens, and nothing takes it off when the app is deleted or a
 * browser's data is cleared. The senders only prune a dead device when a real
 * send to it fails, and the demo tracker's sender (the Simpro proxy) can't
 * prune at all — it only reads this list. So Admin's device counts drift up.
 *
 * This asks FCM about every device without delivering anything (a dry-run
 * send) and removes only the ones FCM says no longer exist. A device it isn't
 * sure about is kept.
 *
 * Env (GitHub Actions secrets, the same as remind.mjs): FIREBASE_PROJECT_ID,
 * FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY. DRY_RUN=true checks and prints
 * the counts but removes nothing. The repo is public and so are its Action
 * logs — only ever log counts.
 */

import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore, FieldValue }      from 'firebase-admin/firestore'
import { getMessaging }                  from 'firebase-admin/messaging'

// Only these mean "gone for good"; anything else (a timeout, a quota error)
// leaves the device alone.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
])
const BATCH = 500 // FCM's limit per sendEach call

function initFirebase() {
  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
      }),
    })
  }
}

async function main() {
  initFirebase()
  const db = getFirestore()
  const dryRun = process.env.DRY_RUN === 'true'

  const snap = await db.collection('users').get()
  const checks = [] // { uid, token }
  for (const d of snap.docs) {
    for (const token of d.data().fcmTokens || []) checks.push({ uid: d.id, token })
  }

  const dead = new Map() // uid -> [token]
  let unsure = 0
  for (let i = 0; i < checks.length; i += BATCH) {
    const slice = checks.slice(i, i + BATCH)
    const res = await getMessaging().sendEach(
      slice.map(c => ({ token: c.token, data: { check: '1' } })),
      true, // dry run: validated by FCM, delivered to nobody
    )
    res.responses.forEach((r, j) => {
      if (r.success) return
      if (DEAD_TOKEN_CODES.has(r.error?.code)) {
        const { uid, token } = slice[j]
        dead.set(uid, [...(dead.get(uid) || []), token])
      } else {
        unsure++
      }
    })
  }

  const deadCount = [...dead.values()].reduce((n, t) => n + t.length, 0)
  if (!dryRun) {
    for (const [uid, tokens] of dead) {
      await db.collection('users').doc(uid).update({ fcmTokens: FieldValue.arrayRemove(...tokens) })
    }
  }

  console.log(`${dryRun ? 'Dry run: ' : ''}${checks.length} devices checked across ${snap.size} people; ` +
    `${deadCount} no longer exist (${dead.size} people)${dryRun ? ' — nothing removed' : ' — removed'}; ` +
    `${unsure} couldn't be checked and were kept.`)
}

main().catch(err => {
  console.error('Device clean-up failed:', err.message)
  process.exit(1)
})
