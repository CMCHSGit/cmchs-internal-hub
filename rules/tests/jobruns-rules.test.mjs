// Firestore rules tests for the background-jobs page (Settings → Background
// jobs): only admins read jobRuns, and nobody signed in writes it. Runs the REAL
// rules engine (the emulator), like news-rules.test.mjs; see rules/README.md for
// how to run these.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, setLogLevel } from 'firebase/firestore'

setLogLevel('error')
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'jobRuns/deploy'), { id: 'deploy', lastRunMs: 1, lastOk: true, lastMessage: 'Worked', failuresInARow: 0 })
  })
}

const as = (uid) => env.authenticatedContext(uid, { email: uid + '@cass.co.nz' }).firestore()
const anon = env.unauthenticatedContext().firestore()
let pass = 0, fail = 0
async function check(label, expectAllowed, fn) {
  await seed()
  try {
    await (expectAllowed ? assertSucceeds(fn()) : assertFails(fn()))
    pass++; console.log(`  ok    ${expectAllowed ? 'allow' : 'deny '}  ${label}`)
  } catch (e) {
    fail++; console.log(`  FAIL  expected ${expectAllowed ? 'allow' : 'deny'}: ${label}\n        ${String(e.message).split('\n')[0]}`)
  }
}

console.log('\nBackground jobs')
await check('an admin reads a job', true, () => getDoc(doc(as('admin1'), 'jobRuns/deploy')))
await check('not someone who is not an admin', false, () => getDoc(doc(as('bob'), 'jobRuns/deploy')))
await check('not someone signed out', false, () => getDoc(doc(anon, 'jobRuns/deploy')))
await check('not even an admin writes one', false, () => setDoc(doc(as('admin1'), 'jobRuns/deploy'), { id: 'deploy', lastOk: false }))
await check('nobody changes one', false, () => updateDoc(doc(as('bob'), 'jobRuns/deploy'), { lastOk: false }))
await check('nobody deletes one', false, () => deleteDoc(doc(as('admin1'), 'jobRuns/deploy')))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
