#!/usr/bin/env node
// The last step of a GitHub workflow: records how the job went.
//   node scripts/report-job.mjs <job id> <success|failure|cancelled> [message]
// Needs FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, as the other scripts do.
// Always exits 0: reporting must never turn a good run into a failed one.
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { reportJob } from '../shared/jobReport.mjs'

const [id, status = 'failure', ...rest] = process.argv.slice(2)
const { FIREBASE_PROJECT_ID: projectId, FIREBASE_CLIENT_EMAIL: clientEmail, FIREBASE_PRIVATE_KEY: key } = process.env
if (!id || !projectId || !clientEmail || !key) {
  console.error('Job status not reported: missing the job id or the Firebase secrets.')
  process.exit(0)
}
const db = getFirestore(initializeApp({ credential: cert({ projectId, clientEmail, privateKey: key.replace(/\\n/g, '\n') }) }))
const ok = status === 'success'
const message = rest.join(' ') || (ok ? 'Worked' : status === 'cancelled' ? 'Cancelled' : 'Failed: see the run in GitHub Actions')
await reportJob(db, id, ok, message)
process.exit(0)
