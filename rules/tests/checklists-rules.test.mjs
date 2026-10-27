// Firestore rules tests for the project checklists (apps/checklists) — runs the REAL rules engine
// (the emulator), not a mock. Needs Java; see rules/README.md for the setup, then:
//   npx firebase emulators:exec --only firestore --project rules-test "node checklists-rules.test.mjs"
// (firebase.json: {"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}})
//
// Everyone signed in reads and ticks; the Engineers and Management teams and admins make lists and
// import devices; nobody but them changes what the spreadsheet said, and a tick is always the person's own.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const device = (o = {}) => ({ deviceId: 'd1', serial: 'AA3-1', name: 'N1-1', status: 'Working', department: 'CCU', location: 'CCU 1', version: '02.41.00.01',
  result: '', doneBy: '', doneByName: '', doneAt: null, note: '', noteByName: '', ...o })

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
  await setDoc(doc(db, 'users/kiri'), { displayName: 'Kiri', role: 'user', team: 'Engineers' })
  await setDoc(doc(db, 'users/mgr'), { displayName: 'Max', role: 'user', team: 'Management' })
  await setDoc(doc(db, 'users/sam'), { displayName: 'Sam', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'checklists/l1'), { name: 'N1 upgrade', total: 2 })
  await setDoc(doc(db, 'checklists/l1/items/d1'), device())
  await setDoc(doc(db, 'checklists/l1/items/d2'), device({ deviceId: 'd2', serial: 'AA3-2', name: 'N1-2' }))
})

const as = (uid) => env.authenticatedContext(uid, { email: uid + '@cass.co.nz' }).firestore()
const outsider = env.authenticatedContext('eve', { email: 'eve@gmail.com' }).firestore()
const anon = env.unauthenticatedContext().firestore()
let pass = 0, fail = 0
async function check(label, expectAllowed, fn) {
  try {
    await (expectAllowed ? assertSucceeds(fn()) : assertFails(fn()))
    pass++; console.log(`  ok    ${expectAllowed ? 'allow' : 'deny '}  ${label}`)
  } catch (e) {
    fail++; console.log(`  FAIL  expected ${expectAllowed ? 'allow' : 'deny'}: ${label}\n        ${String(e.message).split('\n')[0]}`)
  }
}
const item = (db, id) => doc(db, 'checklists/l1/items/' + id)

console.log('\nReading and ticking — everyone signed in')
await check('Sam (Sales) reads the lists', true, () => getDocs(collection(as('sam'), 'checklists')))
await check('Sam reads a list\'s devices', true, () => getDocs(collection(as('sam'), 'checklists/l1/items')))
await check('Sam ticks a device done', true, () => updateDoc(item(as('sam'), 'd1'), { result: 'done', doneBy: 'sam', doneByName: 'Sam', doneAt: serverTimestamp() }))
await check('Sam marks another one couldn\'t find', true, () => updateDoc(item(as('sam'), 'd2'), { result: 'notfound', doneBy: 'sam', doneByName: 'Sam', doneAt: serverTimestamp() }))
await check('Sam unticks it again', true, () => updateDoc(item(as('sam'), 'd1'), { result: '', doneBy: '', doneByName: '', doneAt: null }))
await check('Sam leaves a note', true, () => updateDoc(item(as('sam'), 'd1'), { note: 'In the ED2 cupboard', noteByName: 'Sam' }))
await check('Kiri (Engineers) ticks one', true, () => updateDoc(item(as('kiri'), 'd2'), { result: 'done', doneBy: 'kiri', doneByName: 'Kiri', doneAt: serverTimestamp() }))

console.log('\nWhat only a tick may change')
await check('Sam ticks a device in someone else\'s name', false, () => updateDoc(item(as('sam'), 'd1'), { result: 'done', doneBy: 'kiri', doneByName: 'Kiri', doneAt: serverTimestamp() }))
await check('Sam sets a made-up result', false, () => updateDoc(item(as('sam'), 'd1'), { result: 'maybe', doneBy: 'sam', doneByName: 'Sam' }))
await check('Sam changes a device\'s serial number', false, () => updateDoc(item(as('sam'), 'd1'), { serial: 'AA3-999' }))
await check('Sam ticks and changes the department in one go', false, () => updateDoc(item(as('sam'), 'd1'), { result: 'done', doneBy: 'sam', department: 'ICU' }))
await check('Sam writes a huge note', false, () => updateDoc(item(as('sam'), 'd1'), { note: 'x'.repeat(1001) }))
await check('Sam adds a device', false, () => setDoc(item(as('sam'), 'd9'), device({ deviceId: 'd9' })))
await check('Sam removes a device', false, () => deleteDoc(item(as('sam'), 'd2')))
await check('Sam renames the list', false, () => updateDoc(doc(as('sam'), 'checklists/l1'), { name: 'mine now' }))
await check('Sam deletes the list', false, () => deleteDoc(doc(as('sam'), 'checklists/l1')))
await check('Sam makes a list', false, () => setDoc(doc(as('sam'), 'checklists/l2'), { name: 'Sam\'s list', total: 0 }))

console.log('\nMaking lists and importing — Engineers, Management, admins')
await check('Kiri (Engineers) makes a list and its devices together', true, async () => {
  const db = as('kiri'); const b = writeBatch(db)
  b.set(doc(db, 'checklists/l2'), { name: 'Second list', total: 1, createdAt: serverTimestamp(), createdBy: 'kiri' })
  b.set(doc(db, 'checklists/l2/items/a'), device({ deviceId: 'a' }))
  await b.commit()
})
await check('Max (Management) refreshes a device from a newer export', true, () => setDoc(item(as('mgr'), 'd1'), { status: 'Offline', location: 'Transit 7' }, { merge: true }))
await check('an admin renames a list', true, () => updateDoc(doc(as('admin1'), 'checklists/l1'), { name: 'Renamed' }))
await check('Kiri removes a device', true, () => deleteDoc(item(as('kiri'), 'd2')))
await check('an admin deletes a list', true, () => deleteDoc(doc(as('admin1'), 'checklists/l2')))

console.log('\nNot signed in, or not from the company')
await check('someone not signed in reads a list', false, () => getDocs(collection(anon, 'checklists/l1/items')))
await check('a personal account reads a list', false, () => getDocs(collection(outsider, 'checklists')))
await check('a personal account ticks a device', false, () => updateDoc(item(outsider, 'd1'), { result: 'done', doneBy: 'eve' }))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
