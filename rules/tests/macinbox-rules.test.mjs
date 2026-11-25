// Firestore rules tests for the Test Bench MAC reader's inbox (macInbox): the Device ID and MACs a person read on their phone, waiting for
// them in the MAC reader tab on their PC. One document per person, its id their user id. Runs the REAL rules engine (the emulator), like
// pending-rules.test.mjs; see rules/README.md for how to run these. Invented addresses only.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, setLogLevel } from 'firebase/firestore'

setLogLevel('error')
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const reading = (by, over = {}) => ({ deviceId: '00-0F-14-04-CC-54-95-D4', lanMac: '00:0F:14:54:95:D4', wlanMac: '08:9B:27:69:71:BA', by, at: serverTimestamp(), ...over })

async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/eve'), { displayName: 'Eve', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/sally'), { displayName: 'Sally', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'users/nina'), { displayName: 'Nina', role: 'user', team: '' })
    await setDoc(doc(db, 'macInbox/eve'), { ...reading('eve@cass.co.nz'), at: new Date() })
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
const send = (uid, over, as_ = uid, id = uid) => setDoc(doc(as(as_), 'macInbox', id), reading(uid + '@cass.co.nz', over))
const only = (uid, fields) => setDoc(doc(as(uid), 'macInbox', uid), { ...fields, by: uid + '@cass.co.nz', at: serverTimestamp() })

console.log('\nMAC reader inbox')
await check('a person reads their own', true, () => getDoc(doc(as('eve'), 'macInbox/eve')))
await check('an admin reads their own', true, () => getDoc(doc(as('admin1'), 'macInbox/admin1')))
await check('not someone else’s (an engineer)', false, () => getDoc(doc(as('bob'), 'macInbox/eve')))
await check('not someone else’s (an admin)', false, () => getDoc(doc(as('admin1'), 'macInbox/eve')))
await check('not sales', false, () => getDoc(doc(as('sally'), 'macInbox/sally')))
await check('not someone with no team', false, () => getDoc(doc(as('nina'), 'macInbox/nina')))
await check('not someone signed out', false, () => getDoc(doc(anon, 'macInbox/eve')))

await check('an engineer sends to their own inbox', true, () => send('bob'))
await check('with only a Device ID', true, () => only('bob', { deviceId: '00-0F-14-04-CC-54-95-D4' }))
await check('with only a WLAN MAC', true, () => only('bob', { wlanMac: '08:9B:27:69:71:BA' }))
await check('a new scan replaces the last one', true, () => send('eve', { lanMac: '00:0F:14:54:95:D5' }))
await check('not into someone else’s inbox', false, () => send('bob', {}, 'bob', 'eve'))
await check('not under someone else’s email', false, () => setDoc(doc(as('bob'), 'macInbox/bob'), reading('eve@cass.co.nz')))
await check('not by sales', false, () => send('sally'))
await check('not by someone with no team', false, () => send('nina'))
await check('not signed out', false, () => setDoc(doc(anon, 'macInbox/bob'), reading('bob@cass.co.nz')))
await check('not with no address at all', false, () => only('bob', {}))
await check('not with a Device ID that is not in the asset lists’ shape', false, () => send('bob', { deviceId: '00:0F:14:04:CC:54:95:D4' }))
await check('not with a MAC that is not in the asset lists’ shape', false, () => send('bob', { lanMac: '00-0F-14-54-95-D4' }))
await check('not with lower-case letters', false, () => send('bob', { wlanMac: '08:9b:27:69:71:ba' }))
await check('not with something other than an address in a MAC', false, () => send('bob', { wlanMac: 'see photo' }))
await check('not with an address that is not text', false, () => send('bob', { lanMac: 5 }))
await check('not with extra fields', false, () => send('bob', { notes: 'x' }))
await check('not with a made-up time', false, () => send('bob', { at: new Date('2020-01-01') }))

await check('a person removes their own', true, () => deleteDoc(doc(as('eve'), 'macInbox/eve')))
await check('not someone else’s', false, () => deleteDoc(doc(as('bob'), 'macInbox/eve')))
await check('not someone else’s (an admin)', false, () => deleteDoc(doc(as('admin1'), 'macInbox/eve')))
await check('not signed out', false, () => deleteDoc(doc(anon, 'macInbox/eve')))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
