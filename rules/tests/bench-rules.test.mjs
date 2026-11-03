// Firestore rules tests for the Test Bench's shared previous tests (benchTests, benchTestData). Runs the REAL rules engine
// (the emulator), like news-rules.test.mjs; see rules/README.md for how to run these.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, writeBatch, setLogLevel } from 'firebase/firestore'

setLogLevel('error')
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const line = (by, over = {}) => ({ id: 't1', by, byName: 'Someone', template: 'D30', serial: 'SN1', model: 'D30', customer: 'WDHB', overall: 'pass', finished: '2026-11-03T01:00:00Z', started: '2026-11-03T00:30:00Z', steps: 20, size: 5000, savedAt: 1, ...over })
const data = (by, json = '{"id":"t1"}') => ({ by, json })

async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/eve'), { displayName: 'Eve', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/sally'), { displayName: 'Sally', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'users/nina'), { displayName: 'Nina', role: 'user', team: '' })
    await setDoc(doc(db, 'benchTests/t1'), line('eve@cass.co.nz'))
    await setDoc(doc(db, 'benchTestData/t1'), data('eve@cass.co.nz'))
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
const share = (db, by, id = 't2', over = {}) => { const b = writeBatch(db); b.set(doc(db, 'benchTests', id), line(by, { id, ...over })); b.set(doc(db, 'benchTestData', id), data(by)); return b.commit() }

console.log('\nTest Bench shared tests')
await check('an engineer reads the list', true, () => getDoc(doc(as('bob'), 'benchTests/t1')))
await check('an engineer opens a test', true, () => getDoc(doc(as('bob'), 'benchTestData/t1')))
await check('an admin reads', true, () => getDoc(doc(as('admin1'), 'benchTests/t1')))
await check('not sales', false, () => getDoc(doc(as('sally'), 'benchTests/t1')))
await check('not someone with no team', false, () => getDoc(doc(as('nina'), 'benchTestData/t1')))
await check('not someone signed out', false, () => getDoc(doc(anon, 'benchTests/t1')))

await check('an engineer shares a test under their own email', true, () => share(as('bob'), 'bob@cass.co.nz'))
await check('not under someone else\'s email', false, () => share(as('bob'), 'eve@cass.co.nz'))
await check('not with a result that isn\'t one', false, () => share(as('bob'), 'bob@cass.co.nz', 't2', { overall: 'banana' }))
await check('not with extra fields', false, () => share(as('bob'), 'bob@cass.co.nz', 't2', { notes: 'x' }))
await check('not by someone with no team', false, () => share(as('nina'), 'nina@cass.co.nz'))
await check('not a test too big for a document', false, () => setDoc(doc(as('bob'), 'benchTestData/big'), data('bob@cass.co.nz', 'x'.repeat(960000))))

await check('the engineer who shared it updates it', true, () => setDoc(doc(as('eve'), 'benchTests/t1'), line('eve@cass.co.nz', { overall: 'fail' })))
await check('an admin updates it', true, () => setDoc(doc(as('admin1'), 'benchTests/t1'), line('eve@cass.co.nz', { overall: 'fail' })))
await check('another engineer does not', false, () => setDoc(doc(as('bob'), 'benchTests/t1'), line('eve@cass.co.nz', { overall: 'fail' })))
await check('nor takes it over by changing who shared it', false, () => setDoc(doc(as('bob'), 'benchTests/t1'), line('bob@cass.co.nz')))
await check('nor changes its data', false, () => setDoc(doc(as('bob'), 'benchTestData/t1'), data('eve@cass.co.nz', '{"id":"t1","x":1}')))

await check('the engineer who shared it removes it (both parts, as the bench does)', true, () => { const db = as('eve'), b = writeBatch(db); b.delete(doc(db, 'benchTests/t1')); b.delete(doc(db, 'benchTestData/t1')); return b.commit() })
await check('an admin removes it', true, () => deleteDoc(doc(as('admin1'), 'benchTestData/t1')))
await check('another engineer does not', false, () => deleteDoc(doc(as('bob'), 'benchTests/t1')))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
