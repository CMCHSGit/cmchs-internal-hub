// Firestore rules tests for Checklists (apps/checklists) — runs the REAL rules engine (the emulator), not a
// mock. Needs Java; see rules/README.md for the setup, then:
//   npx firebase emulators:exec --only firestore --project rules-test "node checklists-rules.test.mjs"
// (firebase.json: {"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}})
//
// A checklist is seen like an ask: by whoever made it and the people and teams it is shared with, and by
// nobody else. They tick and add devices found on site; only whoever made it imports, changes the steps,
// shares or deletes it.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { collection, deleteField, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, deleteDoc, arrayUnion, where } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const STEPS = [{ id: 'sw', label: 'Software upgraded' }, { id: 'cfg', label: 'Changed config' }]
const device = (o = {}) => ({ deviceId: 'd1', serial: 'AA3-1', name: 'N1-1', status: 'Working', department: 'CCU', location: 'CCU 1', version: '02.41.00.01',
  result: '', doneBy: '', doneByName: '', doneAt: null, checks: {}, note: '', noteByName: '', ...o })

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
  await setDoc(doc(db, 'users/kiri'), { displayName: 'Kiri', role: 'user', team: 'Engineers' })
  await setDoc(doc(db, 'users/mgr'), { displayName: 'Max', role: 'user', team: 'Management' })
  await setDoc(doc(db, 'users/sam'), { displayName: 'Sam', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/pat'), { displayName: 'Pat', role: 'user', team: 'Application' })
  await setDoc(doc(db, 'users/zed'), { displayName: 'Zed', role: 'user', team: 'Engineers' })
  // Kiri's list, shared with Sam and with the whole Application team.
  await setDoc(doc(db, 'checklists/l1'), { name: 'N1 upgrade', total: 2, steps: STEPS, createdBy: 'kiri', people: ['kiri', 'sam'], teams: ['Application'] })
  await setDoc(doc(db, 'checklists/l1/items/d1'), device())
  await setDoc(doc(db, 'checklists/l1/items/d2'), device({ deviceId: 'd2', serial: 'AA3-2', name: 'N1-2' }))
  // A list from before sharing existed: only createdBy.
  await setDoc(doc(db, 'checklists/old'), { name: 'Older list', total: 1, createdBy: 'kiri' })
  await setDoc(doc(db, 'checklists/old/items/d1'), device({ result: 'done', doneBy: 'kiri', doneByName: 'Kiri' }))
  // Nobody else's.
  await setDoc(doc(db, 'checklists/priv'), { name: 'Private', total: 0, steps: STEPS, createdBy: 'zed', people: ['zed'], teams: [] })
  await setDoc(doc(db, 'checklists/priv/items/d1'), device())
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
const item = (db, id, list = 'l1') => doc(db, `checklists/${list}/items/${id}`)
const tick = (uid, step = 'sw') => ({ [`checks.${step}`]: { by: uid, byName: uid, at: serverTimestamp() } })

console.log('\nWho sees a checklist')
await check('Kiri (made it) finds it by createdBy', true, () => getDocs(query(collection(as('kiri'), 'checklists'), where('createdBy', '==', 'kiri'))))
await check('Sam (named on it) finds it by people', true, () => getDocs(query(collection(as('sam'), 'checklists'), where('people', 'array-contains', 'sam'))))
await check('Pat (on the Application team it is shared with) finds it by team', true, () => getDocs(query(collection(as('pat'), 'checklists'), where('teams', 'array-contains', 'Application'))))
await check('Sam reads it', true, () => getDoc(doc(as('sam'), 'checklists/l1')))
await check('Pat reads its devices', true, () => getDocs(collection(as('pat'), 'checklists/l1/items')))
await check('Kiri reads the older list with no sharing fields', true, () => getDoc(doc(as('kiri'), 'checklists/old')))
await check('Zed (Engineers, not named) reads it', false, () => getDoc(doc(as('zed'), 'checklists/l1')))
await check('Zed reads its devices', false, () => getDocs(collection(as('zed'), 'checklists/l1/items')))
await check('Max (Management) reads it', false, () => getDoc(doc(as('mgr'), 'checklists/l1')))
await check('an admin who is not on it reads it', false, () => getDoc(doc(as('admin1'), 'checklists/l1')))
await check('Sam lists every checklist', false, () => getDocs(collection(as('sam'), 'checklists')))
await check('Sam asks for the lists Kiri is on', false, () => getDocs(query(collection(as('sam'), 'checklists'), where('people', 'array-contains', 'zed'))))
await check('Sam reads the older list', false, () => getDoc(doc(as('sam'), 'checklists/old')))
await check('someone not signed in reads it', false, () => getDocs(collection(anon, 'checklists/l1/items')))
await check('a personal account reads it', false, () => getDoc(doc(outsider, 'checklists/l1')))

console.log('\nTicking steps — anyone it is shared with')
await check('Sam ticks a step', true, () => updateDoc(item(as('sam'), 'd1'), tick('sam')))
await check('Sam ticks the other step', true, () => updateDoc(item(as('sam'), 'd1'), tick('sam', 'cfg')))
await check('Pat (through the team) ticks a step', true, () => updateDoc(item(as('pat'), 'd2'), tick('pat')))
await check('Sam unticks a step', true, () => updateDoc(item(as('sam'), 'd1'), { 'checks.cfg': deleteField() }))
await check('Sam marks one couldn\'t find', true, () => updateDoc(item(as('sam'), 'd2'), { result: 'notfound', doneBy: 'sam', doneByName: 'Sam', doneAt: serverTimestamp() }))
await check('Sam puts one back to to do', true, () => updateDoc(item(as('sam'), 'd2'), { result: '', doneBy: '', doneByName: '', doneAt: null, checks: {} }))
await check('Sam leaves a note', true, () => updateDoc(item(as('sam'), 'd1'), { note: 'In the ED2 cupboard', noteByName: 'Sam' }))
await check('Kiri ticks a step on the older list', true, () => updateDoc(item(as('kiri'), 'd1', 'old'), tick('kiri', 'done')))
await check('Zed ticks a step on a list not shared with him', false, () => updateDoc(item(as('zed'), 'd1'), tick('zed')))
await check('Max ticks a step on a list not shared with him', false, () => updateDoc(item(as('mgr'), 'd1'), tick('mgr')))
await check('Sam says it was done by Kiri', false, () => updateDoc(item(as('sam'), 'd1'), { result: 'done', doneBy: 'kiri' }))
await check('Sam sets a made-up result', false, () => updateDoc(item(as('sam'), 'd1'), { result: 'maybe', doneBy: 'sam' }))
await check('Sam changes a device\'s serial number', false, () => updateDoc(item(as('sam'), 'd1'), { serial: 'AA3-999' }))
await check('Sam ticks and changes the department in one go', false, () => updateDoc(item(as('sam'), 'd1'), { ...tick('sam'), department: 'ICU' }))
await check('Sam writes a huge note', false, () => updateDoc(item(as('sam'), 'd1'), { note: 'x'.repeat(1001) }))
await check('a personal account ticks a step', false, () => updateDoc(item(outsider, 'd1'), tick('eve')))

console.log('\nDevices found on site')
await check('Sam adds one in his own name', true, () => setDoc(item(as('sam'), 'found-abc-0001'), device({ deviceId: '', addedOnSite: true, addedBy: 'sam', addedByName: 'Sam' })))
await check('Sam adds one with a step already ticked', true, () => setDoc(item(as('sam'), 'found-abc-0002'), device({ deviceId: '', addedOnSite: true, addedBy: 'sam', addedByName: 'Sam', checks: { sw: { by: 'sam', byName: 'Sam' } } })))
await check('Pat adds one through the team', true, () => setDoc(item(as('pat'), 'found-abc-0007'), device({ addedOnSite: true, addedBy: 'pat', addedByName: 'Pat' })))
await check('Sam removes the one he added', true, () => deleteDoc(item(as('sam'), 'found-abc-0001')))
await check('Kiri (made the list) removes the one Sam added', true, () => deleteDoc(item(as('kiri'), 'found-abc-0002')))
await check('Sam adds one in Kiri\'s name', false, () => setDoc(item(as('sam'), 'found-abc-0003'), device({ addedOnSite: true, addedBy: 'kiri' })))
await check('Sam adds one whose id is not found-…', false, () => setDoc(item(as('sam'), 'd7'), device({ addedOnSite: true, addedBy: 'sam' })))
await check('Sam adds one without saying it was found on site', false, () => setDoc(item(as('sam'), 'found-abc-0004'), device({ addedBy: 'sam' })))
await check('Sam adds one already marked couldn\'t find', false, () => setDoc(item(as('sam'), 'found-abc-0005'), device({ addedOnSite: true, addedBy: 'sam', result: 'notfound' })))
await check('Sam adds one ticked in Kiri\'s name', false, () => setDoc(item(as('sam'), 'found-abc-0006'), device({ addedOnSite: true, addedBy: 'sam', result: 'done', doneBy: 'kiri' })))
await check('Zed adds one to a list not shared with him', false, () => setDoc(item(as('zed'), 'found-abc-0008'), device({ addedOnSite: true, addedBy: 'zed' })))
await check('Sam adds a device the spreadsheet had', false, () => setDoc(item(as('sam'), 'd9'), device({ deviceId: 'd9' })))
await check('Sam removes a device the spreadsheet had', false, () => deleteDoc(item(as('sam'), 'd2')))

console.log('\nOnly whoever made it changes the list')
await check('Sam renames it', false, () => updateDoc(doc(as('sam'), 'checklists/l1'), { name: 'mine now' }))
await check('Sam shares it with himself more widely', false, () => updateDoc(doc(as('sam'), 'checklists/l1'), { people: ['kiri', 'sam', 'zed'] }))
await check('Sam changes the steps', false, () => updateDoc(doc(as('sam'), 'checklists/l1'), { steps: [{ id: 'x', label: 'X' }] }))
await check('Sam deletes it', false, () => deleteDoc(doc(as('sam'), 'checklists/l1')))
await check('Sam refreshes a device from a newer export', false, () => setDoc(item(as('sam'), 'd1'), { status: 'Offline' }, { merge: true }))
await check('an admin who did not make it renames it', false, () => updateDoc(doc(as('admin1'), 'checklists/l1'), { name: 'mine now' }))
await check('Kiri renames it', true, () => updateDoc(doc(as('kiri'), 'checklists/l1'), { name: 'Renamed' }))
await check('Kiri changes the steps', true, () => updateDoc(doc(as('kiri'), 'checklists/l1'), { steps: [...STEPS, { id: 'bat', label: 'Battery tested' }] }))
await check('Kiri shares it with Max and the Sales team', true, () => updateDoc(doc(as('kiri'), 'checklists/l1'), { people: ['kiri', 'sam', 'mgr'], teams: ['Application', 'Sales'] }))
await check('Kiri adds someone (an ask attaching it does this)', true, () => updateDoc(doc(as('kiri'), 'checklists/l1'), { people: arrayUnion('zed') }))
await check('Kiri shares it with a team that does not exist', false, () => updateDoc(doc(as('kiri'), 'checklists/l1'), { teams: ['Interns'] }))
await check('Kiri gives it thirteen steps', false, () => updateDoc(doc(as('kiri'), 'checklists/l1'), { steps: Array.from({ length: 13 }, (_, i) => ({ id: 's' + i, label: 'S' + i })) }))
await check('Kiri hands it to Sam', false, () => updateDoc(doc(as('kiri'), 'checklists/l1'), { createdBy: 'sam' }))
await check('Kiri refreshes a device from a newer export', true, () => setDoc(item(as('kiri'), 'd1'), { status: 'Offline', location: 'Transit 7' }, { merge: true }))
await check('Kiri imports a new device', true, () => setDoc(item(as('kiri'), 'd5'), device({ deviceId: 'd5' })))
await check('Kiri removes a device', true, () => deleteDoc(item(as('kiri'), 'd5')))
await check('Max (Management) makes a list', true, () => setDoc(doc(as('mgr'), 'checklists/l3'), { name: 'Max\'s', total: 0, steps: STEPS, createdBy: 'mgr', people: ['mgr'], teams: [] }))
await check('Max makes one in Kiri\'s name', false, () => setDoc(doc(as('mgr'), 'checklists/l4'), { name: 'Fake', total: 0, createdBy: 'kiri', people: ['kiri'], teams: [] }))
await check('Sam (Sales) makes a list', false, () => setDoc(doc(as('sam'), 'checklists/l5'), { name: 'Sam\'s list', total: 0, steps: STEPS, createdBy: 'sam', people: ['sam'], teams: [] }))
await check('Max deletes his list', true, () => deleteDoc(doc(as('mgr'), 'checklists/l3')))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
