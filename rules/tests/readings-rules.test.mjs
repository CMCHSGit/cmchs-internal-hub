// Firestore rules tests for the phone readings of a device's Device ID and MACs (deviceReadings). Runs the REAL rules engine (the emulator),
// like pending-rules.test.mjs; see rules/README.md for how to run these. Invented addresses only.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, setLogLevel } from 'firebase/firestore'

setLogLevel('error')
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const reading = (by, over = {}) => ({ customerId: 'cust1', serial: 'EX3-000519', deviceId: '00-0F-14-04-CC-54-95-D4', lanMac: '00:0F:14:54:95:D4', wlanMac: '08:9B:27:69:71:BA', by, at: serverTimestamp(), ...over })

async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/eve'), { displayName: 'Eve', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/sally'), { displayName: 'Sally', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'users/nina'), { displayName: 'Nina', role: 'user', team: '' })
    await setDoc(doc(db, 'deviceReadings/r1'), { ...reading('eve@cass.co.nz'), at: new Date() })
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
const save = (db, by, over, id = 'r2') => setDoc(doc(db, 'deviceReadings', id), reading(by, over))
const only = (db, fields, id = 'r2') => setDoc(doc(db, 'deviceReadings', id), { customerId: 'cust1', serial: 'S1', ...fields, by: 'bob@cass.co.nz', at: serverTimestamp() })

console.log('\nPhone readings')
await check('an engineer reads them', true, () => getDoc(doc(as('bob'), 'deviceReadings/r1')))
await check('an admin reads them', true, () => getDoc(doc(as('admin1'), 'deviceReadings/r1')))
await check('not sales', false, () => getDoc(doc(as('sally'), 'deviceReadings/r1')))
await check('not someone with no team', false, () => getDoc(doc(as('nina'), 'deviceReadings/r1')))
await check('not someone signed out', false, () => getDoc(doc(anon, 'deviceReadings/r1')))

await check('an engineer saves a reading under their own email', true, () => save(as('bob'), 'bob@cass.co.nz'))
await check('with only a Device ID', true, () => only(as('bob'), { deviceId: '00-0F-14-04-CC-54-95-D4' }))
await check('with only a LAN MAC', true, () => only(as('bob'), { lanMac: '00:0F:14:54:95:D4' }))
await check('not under someone else’s email', false, () => save(as('bob'), 'eve@cass.co.nz'))
await check('not by someone with no team', false, () => save(as('nina'), 'nina@cass.co.nz'))
await check('not by sales', false, () => save(as('sally'), 'sally@cass.co.nz'))
await check('not signed out', false, () => save(anon, 'x@cass.co.nz'))
await check('not with no address at all', false, () => only(as('bob'), {}))
await check('not with no serial number', false, () => save(as('bob'), 'bob@cass.co.nz', { serial: '' }))
await check('not with no customer', false, () => save(as('bob'), 'bob@cass.co.nz', { customerId: '' }))
await check('not with a Device ID that is not in the asset lists’ shape', false, () => save(as('bob'), 'bob@cass.co.nz', { deviceId: '00:0F:14:04:CC:54:95:D4' }))
await check('not with a MAC that is not in the asset lists’ shape', false, () => save(as('bob'), 'bob@cass.co.nz', { lanMac: '00-0F-14-54-95-D4' }))
await check('not with lower-case letters', false, () => save(as('bob'), 'bob@cass.co.nz', { wlanMac: '08:9b:27:69:71:ba' }))
await check('not with something other than an address in a MAC', false, () => save(as('bob'), 'bob@cass.co.nz', { wlanMac: 'see photo' }))
await check('not with an address that is not text', false, () => save(as('bob'), 'bob@cass.co.nz', { lanMac: 5 }))
await check('not with extra fields', false, () => save(as('bob'), 'bob@cass.co.nz', { notes: 'x' }))
await check('not with a made-up time', false, () => save(as('bob'), 'bob@cass.co.nz', { at: new Date('2020-01-01') }))

await check('reading a unit again replaces it (any engineer, their own email)', true, () => save(as('bob'), 'bob@cass.co.nz', { lanMac: '00:0F:14:54:95:D5' }, 'r1'))
await check('a replace can’t move it to another customer', false, () => save(as('bob'), 'bob@cass.co.nz', { customerId: 'cust2' }, 'r1'))
await check('a replace can’t move it to another serial', false, () => save(as('bob'), 'bob@cass.co.nz', { serial: 'OTHER' }, 'r1'))
await check('a replace can’t be under someone else’s email', false, () => save(as('bob'), 'eve@cass.co.nz', {}, 'r1'))

await check('any engineer removes one', true, () => deleteDoc(doc(as('bob'), 'deviceReadings/r1')))
await check('an admin removes one', true, () => deleteDoc(doc(as('admin1'), 'deviceReadings/r1')))
await check('not sales', false, () => deleteDoc(doc(as('sally'), 'deviceReadings/r1')))
await check('not signed out', false, () => deleteDoc(doc(anon, 'deviceReadings/r1')))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
