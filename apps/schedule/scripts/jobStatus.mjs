// Tells the hub how one run of a PC job went (Settings → Background jobs).
// Used by excel-import.mjs and excel-export.mjs, with the same Firebase key
// file they already read from their config. Never throws, never stops the job.
import fs from 'node:fs'
import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { reportJob } from '../../../shared/jobReport.mjs'

export async function reportRun(serviceAccountFile, id, ok, message) {
  try {
    if (!serviceAccountFile || !fs.existsSync(serviceAccountFile)) return false
    const app = getApps()[0] || initializeApp({ credential: cert(JSON.parse(fs.readFileSync(serviceAccountFile, 'utf8'))) })
    return await reportJob(getFirestore(app), id, ok, message)
  } catch {
    return false
  }
}
