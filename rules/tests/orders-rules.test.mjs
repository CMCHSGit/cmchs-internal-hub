// Firestore rules tests for the Test Bench's orders (benchOrders) and the `order` on a shared test (benchTests). Runs the REAL rules
// engine (the emulator); see rules/README.md for how to run these.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, setLogLevel } from 'firebase/firestore'

setLogLevel('error')
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const order = (by, over = {}) => ({ number: '209676', jobLabel: '#209676 Waikato', customer: 'Waikato', expected: { D30: 15, D60: 2 }, since: '2026-11-03', note: '', status: 'open', createdBy: by, createdByName: 'Someone', createdAt: 1, updatedAt: 2, ...over })
const line = (by, over = {}) => ({ id: 't2', by, byName: 'Someone', template: 'D30', serial: 'SN1', model: 'D30', customer: 'WDHB', overall: 'pass', finished: '2026-11-03T01:00:00Z', started: '2026-11-03T00:30:00Z', steps: 20, size: 5000, savedAt: 1, ...over })

async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/eve'), { displayName: 'Eve', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/sally'), { displayName: 'Sally', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'benchOrders/o1'), order('eve@cass.co.nz'))
  })
}
const as = (uid) => env.authenticatedContext(uid, { email: uid + '@cass.co.nz', firebase: { sign_in_provider: 'microsoft.com' } }).firestore()
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

console.log('\nTest Bench orders')
await check('an engineer reads an order', true, () => getDoc(doc(as('bob'), 'benchOrders/o1')))
await check('an admin reads', true, () => getDoc(doc(as('admin1'), 'benchOrders/o1')))
await check('not sales', false, () => getDoc(doc(as('sally'), 'benchOrders/o1')))
await check('not someone signed out', false, () => getDoc(doc(anon, 'benchOrders/o1')))

await check('an engineer makes an order under their own email', true, () => setDoc(doc(as('bob'), 'benchOrders/o2'), order('bob@cass.co.nz')))
await check('not under someone else\'s email', false, () => setDoc(doc(as('bob'), 'benchOrders/o2'), order('eve@cass.co.nz')))
await check('not by sales', false, () => setDoc(doc(as('sally'), 'benchOrders/o2'), order('sally@cass.co.nz')))
await check('not without a job number', false, () => setDoc(doc(as('bob'), 'benchOrders/o2'), order('bob@cass.co.nz', { number: '' })))
await check('not with a status that isn\'t one', false, () => setDoc(doc(as('bob'), 'benchOrders/o2'), order('bob@cass.co.nz', { status: 'banana' })))
await check('not with extra fields', false, () => setDoc(doc(as('bob'), 'benchOrders/o2'), order('bob@cass.co.nz', { secret: 'x' })))
await check('not with the quantities as text', false, () => setDoc(doc(as('bob'), 'benchOrders/o2'), order('bob@cass.co.nz', { expected: '15 D30' })))

await check('another engineer edits the order (that is the point)', true, () => setDoc(doc(as('bob'), 'benchOrders/o1'), order('eve@cass.co.nz', { expected: { D30: 16, D60: 2 }, updatedAt: 3 })))
await check('and closes it', true, () => setDoc(doc(as('bob'), 'benchOrders/o1'), order('eve@cass.co.nz', { status: 'closed', closedAt: 5, closedBy: 'bob@cass.co.nz' })))
await check('but cannot make it theirs by changing who created it', false, () => setDoc(doc(as('bob'), 'benchOrders/o1'), order('bob@cass.co.nz')))
await check('sales cannot edit', false, () => setDoc(doc(as('sally'), 'benchOrders/o1'), order('eve@cass.co.nz', { updatedAt: 3 })))

await check('whoever made the order deletes it', true, () => deleteDoc(doc(as('eve'), 'benchOrders/o1')))
await check('an admin deletes it', true, () => deleteDoc(doc(as('admin1'), 'benchOrders/o1')))
await check('another engineer does not', false, () => deleteDoc(doc(as('bob'), 'benchOrders/o1')))

console.log('\nA shared test started against an order')
await check('a shared test may carry the order (job number)', true, () => setDoc(doc(as('bob'), 'benchTests/t2'), line('bob@cass.co.nz', { order: '209676' })))
await check('and still may not carry it', true, () => setDoc(doc(as('bob'), 'benchTests/t2'), line('bob@cass.co.nz')))
await check('not an order that isn\'t text', false, () => setDoc(doc(as('bob'), 'benchTests/t2'), line('bob@cass.co.nz', { order: 7 })))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
