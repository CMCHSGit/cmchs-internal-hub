// Firestore rules tests for the customer registry (customerRegistry). Runs the REAL rules engine (the emulator), like
// bench-rules.test.mjs; see rules/README.md for how to run these. Invented names and links only.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, setLogLevel } from 'firebase/firestore'

setLogLevel('error')
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const LINK = 'https://example.sharepoint.com/:x:/s/example/EaAssetList'
const entry = (by, over = {}) => ({ name: 'Example Hospital', assetListUrl: LINK, reportsUrl: 'https://example.sharepoint.com/:f:/s/example/Reports', simproCustomerId: '1042', siteIds: ['2350', '2351'], updatedBy: by, updatedAt: serverTimestamp(), ...over })

async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/eve'), { displayName: 'Eve', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/sally'), { displayName: 'Sally', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'users/nina'), { displayName: 'Nina', role: 'user', team: '' })
    await setDoc(doc(db, 'customerRegistry/c1'), { ...entry('admin1@cass.co.nz'), updatedAt: new Date() })
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
const save = (db, over, id = 'c2', by = 'admin1@cass.co.nz') => setDoc(doc(db, 'customerRegistry', id), entry(by, over))

console.log('\nCustomer registry')
await check('an engineer reads a customer', true, () => getDoc(doc(as('eve'), 'customerRegistry/c1')))
await check('an admin reads a customer', true, () => getDoc(doc(as('admin1'), 'customerRegistry/c1')))
await check('not sales', false, () => getDoc(doc(as('sally'), 'customerRegistry/c1')))
await check('not someone with no team', false, () => getDoc(doc(as('nina'), 'customerRegistry/c1')))
await check('not someone signed out', false, () => getDoc(doc(anon, 'customerRegistry/c1')))

await check('an admin adds a customer', true, () => save(as('admin1')))
await check('an admin adds one with no links yet', true, () => save(as('admin1'), { assetListUrl: '', reportsUrl: '', siteIds: [] }))
await check('an admin changes one', true, () => save(as('admin1'), { name: 'Example Hospital North' }, 'c1'))
await check('an admin removes one', true, () => deleteDoc(doc(as('admin1'), 'customerRegistry/c1')))
await check('an engineer cannot add', false, () => save(as('eve'), {}, 'c2', 'eve@cass.co.nz'))
await check('an engineer cannot change', false, () => save(as('eve'), { name: 'Other' }, 'c1', 'eve@cass.co.nz'))
await check('an engineer cannot remove', false, () => deleteDoc(doc(as('eve'), 'customerRegistry/c1')))
await check('signed out cannot add', false, () => save(anon, {}))

await check('not a link that is not https', false, () => save(as('admin1'), { assetListUrl: 'http://example.sharepoint.com/x' }))
await check('not a javascript: link', false, () => save(as('admin1'), { reportsUrl: 'javascript:alert(1)' }))
await check('not a link with a space in it', false, () => save(as('admin1'), { assetListUrl: 'https://example.com/a b' }))
await check('not a link that is not text', false, () => save(as('admin1'), { assetListUrl: 5 }))
await check('not an empty name', false, () => save(as('admin1'), { name: '' }))
await check('not a name that is too long', false, () => save(as('admin1'), { name: 'x'.repeat(121) }))
await check('not extra fields', false, () => save(as('admin1'), { notes: 'x' }))
await check('not under someone else\'s email', false, () => save(as('admin1'), {}, 'c2', 'eve@cass.co.nz'))
await check('not with a made-up time', false, () => save(as('admin1'), { updatedAt: new Date('2020-01-01') }))
await check('not with site ids that are not a list', false, () => save(as('admin1'), { siteIds: '2350' }))
await check('not with more than 30 sites', false, () => save(as('admin1'), { siteIds: Array.from({ length: 31 }, (_, i) => String(i)) }))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
