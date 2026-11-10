// Firestore rules tests for the new-equipment page's pending assets (pendingAssets). Runs the REAL rules engine (the emulator), like
// bench-rules.test.mjs; see rules/README.md for how to run these. Invented serials only.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp, setLogLevel } from 'firebase/firestore'

setLogLevel('error')
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const item = (by, over = {}, row = {}) => ({ customerId: 'cust1', row: { serial: 'EX3-000519', model: 'D30', site: '2350', ...row }, by, createdAt: serverTimestamp(), ...over })

async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/eve'), { displayName: 'Eve', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/sally'), { displayName: 'Sally', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'users/nina'), { displayName: 'Nina', role: 'user', team: '' })
    await setDoc(doc(db, 'pendingAssets/p1'), { ...item('eve@cass.co.nz'), createdAt: new Date() })
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
const add = (db, by, over, row, id = 'p2') => setDoc(doc(db, 'pendingAssets', id), item(by, over, row))

console.log('\nPending assets')
await check('an engineer reads the pending rows', true, () => getDoc(doc(as('bob'), 'pendingAssets/p1')))
await check('an admin reads them', true, () => getDoc(doc(as('admin1'), 'pendingAssets/p1')))
await check('not sales', false, () => getDoc(doc(as('sally'), 'pendingAssets/p1')))
await check('not someone with no team', false, () => getDoc(doc(as('nina'), 'pendingAssets/p1')))
await check('not someone signed out', false, () => getDoc(doc(anon, 'pendingAssets/p1')))

await check('an engineer records an asset under their own email', true, () => add(as('bob'), 'bob@cass.co.nz'))
await check('not under someone else\'s email', false, () => add(as('bob'), 'eve@cass.co.nz'))
await check('not by someone with no team', false, () => add(as('nina'), 'nina@cass.co.nz'))
await check('not signed out', false, () => add(anon, 'x@cass.co.nz'))
await check('not with no serial number', false, () => add(as('bob'), 'bob@cass.co.nz', {}, { serial: '' }))
await check('not with a serial number that is not text', false, () => add(as('bob'), 'bob@cass.co.nz', {}, { serial: 5 }))
await check('not with a field that is not a known one', false, () => add(as('bob'), 'bob@cass.co.nz', {}, { notes: 'x' }))
await check('not with extra fields on the document', false, () => add(as('bob'), 'bob@cass.co.nz', { extra: 1 }))
await check('not with no customer', false, () => add(as('bob'), 'bob@cass.co.nz', { customerId: '' }))
await check('not with a made-up time', false, () => add(as('bob'), 'bob@cass.co.nz', { createdAt: new Date('2020-01-01') }))
await check('not with a row that is not a map', false, () => add(as('bob'), 'bob@cass.co.nz', { row: 'x' }))

await check('any engineer clears a row once it is in the workbook', true, () => deleteDoc(doc(as('bob'), 'pendingAssets/p1')))
await check('an admin clears one', true, () => deleteDoc(doc(as('admin1'), 'pendingAssets/p1')))
await check('not sales', false, () => deleteDoc(doc(as('sally'), 'pendingAssets/p1')))
const edit = (db, by, over = {}, row = {}) => updateDoc(doc(db, 'pendingAssets/p1'), { row: { serial: 'EX3-000519', model: 'D30', site: '2350', ...row }, editedBy: by, editedAt: serverTimestamp(), ...over })
await check('any engineer corrects a row’s details, stamped with their own email', true, () => edit(as('bob'), 'bob@cass.co.nz', {}, { model: 'D3', serial: 'EX3-000591' }))
await check('an admin corrects one', true, () => edit(as('admin1'), 'admin1@cass.co.nz', {}, { ward: 'ICU' }))
await check('not sales', false, () => edit(as('sally'), 'sally@cass.co.nz'))
await check('not someone with no team', false, () => edit(as('nina'), 'nina@cass.co.nz'))
await check('not signed out', false, () => edit(anon, 'x@cass.co.nz'))
await check('not stamped with someone else’s email', false, () => edit(as('bob'), 'eve@cass.co.nz'))
await check('not without saying who edited it', false, () => updateDoc(doc(as('bob'), 'pendingAssets/p1'), { row: { serial: 'OTHER' } }))
await check('not with a made-up time', false, () => edit(as('bob'), 'bob@cass.co.nz', { editedAt: new Date('2020-01-01') }))
await check('not to a blank serial number', false, () => edit(as('bob'), 'bob@cass.co.nz', {}, { serial: '' }))
await check('not with a field that is not a known one', false, () => edit(as('bob'), 'bob@cass.co.nz', {}, { notes: 'x' }))
await check('not moving it to another customer', false, () => edit(as('bob'), 'bob@cass.co.nz', { customerId: 'cust2' }))
await check('not changing who recorded it', false, () => edit(as('bob'), 'bob@cass.co.nz', { by: 'bob@cass.co.nz' }))
await check('not changing when it was recorded', false, () => edit(as('bob'), 'bob@cass.co.nz', { createdAt: serverTimestamp() }))
await check('not adding other fields', false, () => edit(as('bob'), 'bob@cass.co.nz', { extra: 1 }))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
