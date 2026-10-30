// How a background job tells the hub how its run went (shared/jobs.js lists
// them; Settings → Background jobs shows them). Node only, with the firebase-admin
// Firestore. Never throws: a job that worked must not fail because the status
// could not be written.
//
// What is written is counts and plain words, never names, emails or addresses.

/** Keeps a message short and drops the user's folder name from any path in it. */
export function cleanMessage(text) {
  return String(text ?? '')
    .replace(/[A-Za-z]:\\Users\\[^\\'"]+/g, 'C:\\Users\\…')
    .replace(/\/home\/[^/\s'"]+/g, '/home/…')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

/** Records one run. `db` is a firebase-admin Firestore. Resolves to true if it was written. */
export async function reportJob(db, id, ok, message = '', now = Date.now()) {
  try {
    const ref = db.collection('jobRuns').doc(id)
    await db.runTransaction(async tx => {
      const before = (await tx.get(ref)).data() || {}
      const text = cleanMessage(message)
      tx.set(ref, {
        id,
        lastRunMs: now,
        lastOk: !!ok,
        lastMessage: text,
        ...(ok ? { lastSuccessMs: now } : { lastFailureMs: now, lastFailureMessage: text }),
        failuresInARow: ok ? 0 : (before.failuresInARow || 0) + 1,
      }, { merge: true })
    })
    return true
  } catch (e) {
    console.error('Could not report this run to the hub (' + (e.code || e.message) + ')')
    return false
  }
}
