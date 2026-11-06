// Firestore rules tests for the knowledge base (apps/knowledge): kbArticles, kbParts, kbDevices, kbJobs. Runs the REAL rules
// engine (the emulator); see rules/README.md. Everyone signed in reads; admins and anyone an admin gave kbEditor write; nobody
// can give themselves the switch; every write names the writer and carries only the known fields.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, updateDoc, writeBatch, Timestamp } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
  await setDoc(doc(db, 'users/ed'), { displayName: 'Edie Editor', role: 'user', team: 'Admin', kbEditor: true })
  await setDoc(doc(db, 'users/off'), { displayName: 'Olly', role: 'user', team: 'Admin', kbEditor: false })
  await setDoc(doc(db, 'users/eng'), { displayName: 'Kiri', role: 'user', team: 'Engineers' })
  await setDoc(doc(db, 'users/hr'), { displayName: 'Hana', role: 'user', team: 'Management', hr: true })
  await setDoc(doc(db, 'kbArticles/a1'), { title: 'N17 will not power on', body: 'x', category: 'Faults', tags: [], parts: [], search: 'n17', updatedBy: 'admin1', updatedByName: 'Ann', updatedAt: Timestamp.now() })
  await setDoc(doc(db, 'kbParts/p-ab123'), { partNo: 'AB-123', name: 'PSU', notes: '', diagram: '', aliases: [], fits: [], search: 'ab123', updatedBy: 'admin1', updatedByName: 'Ann', updatedAt: Timestamp.now() })
  await setDoc(doc(db, 'kbDevices/d1'), { site: 'Waikato', dept: 'CCU', model: 'N17', serial: 'A1', version: '', options: '', notes: '', extra: {}, search: 'waikato', updatedBy: 'admin1', updatedByName: 'Ann', updatedAt: Timestamp.now() })
  await setDoc(doc(db, 'kbJobs/j1'), { jobNo: '1234', title: 'Replaced PSU', notes: '', site: '', date: '2026-01-01', parts: [], model: [], search: 'psu', updatedBy: 'admin1', updatedByName: 'Ann', updatedAt: Timestamp.now() })
})

const as = (uid, provider = 'microsoft.com', email = uid + '@cass.co.nz') => env.authenticatedContext(uid, { email, firebase: { sign_in_provider: provider } }).firestore()
let pass = 0, fail = 0
async function check(label, expectAllowed, fn) {
  try {
    await (expectAllowed ? assertSucceeds(fn()) : assertFails(fn()))
    pass++; console.log(`  ok    ${expectAllowed ? 'allow' : 'deny '}  ${label}`)
  } catch (e) {
    fail++; console.log(`  FAIL  expected ${expectAllowed ? 'allow' : 'deny'}: ${label}\n        ${String(e.message).split('\n')[0]}`)
  }
}

const stamp = (uid) => ({ updatedBy: uid, updatedByName: uid, updatedAt: serverTimestamp() })
const article = (uid, o = {}) => ({ title: 'Screen flicker on 02.40', body: 'Update to 02.41.', category: 'Faults', tags: ['n17'], parts: ['AB-123'], reviewedAt: '', search: 'screen flicker', ...stamp(uid), ...o })
const part = (uid, o = {}) => ({ partNo: 'CD-9', name: 'Cable', notes: '', diagram: '', aliases: ['lead'], fits: ['N17'], search: 'cd9', ...stamp(uid), ...o })
const device = (uid, o = {}) => ({ site: 'Hutt', dept: 'ED', model: 'N12', serial: 'Z1', version: '', options: '', notes: '', extra: { WiFi: 'Yes' }, search: 'hutt', ...stamp(uid), ...o })
const job = (uid, o = {}) => ({ jobNo: '99', title: 'Fitted new cable', notes: 'ok', site: 'Hutt', date: '2026-02-02', parts: ['CD-9'], model: ['N12'], search: 'cable', ...stamp(uid), ...o })

const KINDS = [['kbArticles', article, 'a1'], ['kbParts', part, 'p-ab123'], ['kbDevices', device, 'd1'], ['kbJobs', job, 'j1']]

console.log('\nWho reads')
for (const [col, , id] of KINDS) {
  await check(`${col}: any signed-in person reads one`, true, () => getDoc(doc(as('eng'), `${col}/${id}`)))
  await check(`${col}: and lists them all`, true, () => getDocs(collection(as('eng'), col)))
  await check(`${col}: a Microsoft sign-in from another company's address cannot read`, false, () => getDoc(doc(as('eve', 'microsoft.com', 'eve@gmail.com'), `${col}/${id}`)))
  await check(`${col}: an email/password account with a company address cannot read`, false, () => getDoc(doc(as('mal', 'password'), `${col}/${id}`)))
  await check(`${col}: nobody signed out reads`, false, () => getDoc(doc(env.unauthenticatedContext().firestore(), `${col}/${id}`)))
}

console.log('\nWho writes')
for (const [col, make] of KINDS) {
  await check(`${col}: an admin adds one`, true, () => setDoc(doc(as('admin1'), `${col}/new1`), make('admin1')))
  await check(`${col}: an editor adds one`, true, () => setDoc(doc(as('ed'), `${col}/new2`), make('ed')))
  await check(`${col}: an editor changes one`, true, () => setDoc(doc(as('ed'), `${col}/new2`), make('ed', { search: 'changed' })))
  await check(`${col}: an editor deletes one`, true, () => deleteDoc(doc(as('ed'), `${col}/new2`)))
  await check(`${col}: someone with the switch off cannot add`, false, () => setDoc(doc(as('off'), `${col}/x`), make('off')))
  await check(`${col}: an engineer with no switch cannot add`, false, () => setDoc(doc(as('eng'), `${col}/x`), make('eng')))
  await check(`${col}: HR, with no switch, cannot add`, false, () => setDoc(doc(as('hr'), `${col}/x`), make('hr')))
  await check(`${col}: a plain user cannot delete`, false, () => deleteDoc(doc(as('eng'), `${col}/${col === 'kbArticles' ? 'a1' : col === 'kbParts' ? 'p-ab123' : col === 'kbDevices' ? 'd1' : 'j1'}`)))
  await check(`${col}: an editor from another company's address cannot add`, false, () => setDoc(doc(as('ed', 'microsoft.com', 'ed@gmail.com'), `${col}/x`), make('ed')))
  await check(`${col}: an editor cannot sign someone else's name`, false, () => setDoc(doc(as('ed'), `${col}/x`), make('ed', { updatedBy: 'admin1' })))
  await check(`${col}: an editor cannot choose the time`, false, () => setDoc(doc(as('ed'), `${col}/x`), make('ed', { updatedAt: Timestamp.fromDate(new Date('2020-01-01')) })))
  await check(`${col}: a field that is not part of it is refused`, false, () => setDoc(doc(as('ed'), `${col}/x`), make('ed', { secret: 'x' })))
}

console.log('\nWhat a document may hold')
await check('an article with no title', false, () => setDoc(doc(as('ed'), 'kbArticles/x'), article('ed', { title: '' })))
await check('an article body over 20,000 characters', false, () => setDoc(doc(as('ed'), 'kbArticles/x'), article('ed', { body: 'a'.repeat(20001) })))
await check('an article body of exactly 20,000', true, () => setDoc(doc(as('ed'), 'kbArticles/x'), article('ed', { body: 'a'.repeat(20000) })))
await check('an article whose tags are text, not a list', false, () => setDoc(doc(as('ed'), 'kbArticles/x'), article('ed', { tags: 'n17' })))
await check('more than 60 tags', false, () => setDoc(doc(as('ed'), 'kbArticles/x'), article('ed', { tags: Array.from({ length: 61 }, (_, i) => 't' + i) })))
await check('a part with no part number', false, () => setDoc(doc(as('ed'), 'kbParts/x'), part('ed', { partNo: '' })))
await check('a device with 25 extra columns', false, () => setDoc(doc(as('ed'), 'kbDevices/x'), device('ed', { extra: Object.fromEntries(Array.from({ length: 25 }, (_, i) => ['c' + i, 'v'])) })))
await check('a device with 24 extra columns', true, () => setDoc(doc(as('ed'), 'kbDevices/x'), device('ed', { extra: Object.fromEntries(Array.from({ length: 24 }, (_, i) => ['c' + i, 'v'])) })))
await check('a search string over 9,000 characters', false, () => setDoc(doc(as('ed'), 'kbParts/x'), part('ed', { search: 's'.repeat(9001) })))
await check('an import of 100 devices in one batch', true, async () => {
  const db = as('ed'), batch = writeBatch(db)
  for (let i = 0; i < 100; i++) batch.set(doc(db, `kbDevices/imp${i}`), device('ed', { serial: 'S' + i }))
  return batch.commit()
})

console.log('\nThe editor switch is the admin\'s alone')
await check('an admin gives someone the switch', true, () => updateDoc(doc(as('admin1'), 'users/eng'), { kbEditor: true }))
await check('someone gives themselves the switch', false, () => updateDoc(doc(as('off'), 'users/off'), { kbEditor: true }))
await check('someone with no record sets it on their own new profile', false, () => setDoc(doc(as('newbie'), 'users/newbie'), { displayName: 'N', email: 'newbie@cass.co.nz', team: '', role: 'user', kbEditor: true, createdAt: serverTimestamp() }))
await check('HR gives someone the switch', false, () => updateDoc(doc(as('hr'), 'users/off'), { kbEditor: true }))
await check('an editor gives someone else the switch', false, () => updateDoc(doc(as('ed'), 'users/off'), { kbEditor: true }))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
