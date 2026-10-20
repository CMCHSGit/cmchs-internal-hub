// Firestore rules tests — runs the REAL rules engine (the emulator), not a mock.
// Needs Java. From an empty folder:
//   npm i firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10
//   (it reads ../firestore.rules; see rules/README.md), then:
//   npx firebase emulators:exec --only firestore --project rules-test "node firestore-rules.test.mjs"
// (firebase.json: {"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}})

// Runs the real Firestore rules engine (emulator) against every write the
// apps legitimately make, and every attack the new rules must stop.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc, updateDoc, deleteDoc, arrayUnion, serverTimestamp, writeBatch } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

// Seed with rules off: an admin, two settled users, and a placeholder.
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
  await setDoc(doc(db, 'users/bob'), { displayName: 'Bob Sales', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/zed'), { displayName: 'Zed Target', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/notyet'), { displayName: 'Nat New', role: 'user', team: null })
  await setDoc(doc(db, 'users/pending-carl'), { displayName: 'Carl Pending', email: 'carl@cass.co.nz', role: 'user', team: 'Engineers', pending: true })
  await setDoc(doc(db, 'users/pending-gus'), { displayName: 'Gus Pending', role: 'user', team: 'Sales', pending: true })
  await setDoc(doc(db, 'users/pending-fay'), { displayName: 'Fay Pending', email: 'fay@cass.co.nz', role: 'user', team: 'Management', pending: true })
  await setDoc(doc(db, 'users/pending-dee'), { displayName: 'Dee Pending', role: 'user', team: 'Sales', pending: true })
})

// Signed in with a company account, as everyone really is (rules: isCompanyEmail).
const as = (uid, email = uid + '@cass.co.nz') => env.authenticatedContext(uid, { email }).firestore()
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

console.log('\nLegitimate writes the apps make — must keep working')
await check('new user creates own profile (AuthContext)', true, () =>
  setDoc(doc(as('newbie'), 'users/newbie'), { displayName: 'New Bee', email: 'n@cass.co.nz', team: null, role: 'user', createdAt: serverTimestamp() }))
// Claiming an HR-made placeholder (AuthContext claimPendingProfile): one write
// that removes it and creates the profile, with its team only on an exact email match.
const claim = (uid, email, fields, del = true, from = 'pending-carl') => () => {
  const db = as(uid, email)
  const b = writeBatch(db)
  if (del) b.delete(doc(db, 'users/' + from))
  b.set(doc(db, 'users/' + uid), { displayName: 'Carl P', email, role: 'user', excelName: 'Carl', createdAt: serverTimestamp(), ...fields })
  return b.commit()
}
await check('new user claims their placeholder by exact email (team carried over)', true,
  claim('carl', 'carl@cass.co.nz', { team: 'Engineers', claimedFrom: 'pending-carl' }))
await check('new user claims a placeholder by name only: no team comes with it', true,
  claim('gustav', 'gustav@cass.co.nz', { team: null, claimedFrom: 'pending-gus' }, true, 'pending-gus'))
await check('user can\'t pick their own team, even while it\'s empty (admins and HR set it)', false, () =>
  updateDoc(doc(as('notyet'), 'users/notyet'), { team: 'Engineers' }))
await check('@chsnz.co.nz is a company account too', true, () =>
  getDoc(doc(as('chs', 'someone@chsnz.co.nz'), 'users/bob')))
await check('user registers a phone for push (push.js)', true, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { fcmTokens: arrayUnion('tok-123') }))
await check('user turns their own schedule reminder off (Settings → Your notifications)', true, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { 'notifications.scheduleReminder': false }))
await check('user turns their own Asks summary back on', true, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { 'notifications.asksSummary': true }))
await check('user can\'t put anything else in their notifications', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { 'notifications.everything': true }))
await check('user can\'t set a reminder to something that isn\'t on or off', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { 'notifications.asksSummary': 'yes' }))
await check('user can\'t change someone else\'s notifications', false, () =>
  updateDoc(doc(as('bob'), 'users/zed'), { 'notifications.scheduleReminder': false }))
await check('first-time sign-in deletes the placeholder it claims', true, () =>
  deleteDoc(doc(as('brandnew'), 'users/pending-dee')))
await check('admin changes someone\'s role (Admin page)', true, () =>
  updateDoc(doc(as('admin1'), 'users/zed'), { role: 'admin' }))
await check('admin changes someone\'s team', true, () =>
  updateDoc(doc(as('admin1'), 'users/zed'), { team: 'Engineers' }))
await check('admin creates a placeholder', true, () =>
  setDoc(doc(as('admin1'), 'users/pending-eve'), { displayName: 'Eve', team: 'Sales', role: 'user', pending: true, createdAt: serverTimestamp() }))
await check('anyone signed in reads the roster', true, () => getDoc(doc(as('bob'), 'users/admin1')))

console.log('\nThe hole — must now be refused')
await check('a new user can\'t take a placeholder\'s team when its email isn\'t theirs', false,
  claim('carlos', 'carlos@cass.co.nz', { team: 'Management', claimedFrom: 'pending-fay' }, true, 'pending-fay'))
await check('...or give themselves a team with no placeholder at all', false, () =>
  setDoc(doc(as('newbie2'), 'users/newbie2'), { displayName: 'New', email: 'newbie2@cass.co.nz', team: 'Management', role: 'user', createdAt: serverTimestamp() }))
await check('...or take a placeholder\'s team and leave the placeholder there', false,
  claim('fay', 'fay@cass.co.nz', { team: 'Management', claimedFrom: 'pending-fay' }, false, 'pending-fay'))
await check('an account that isn\'t a company one reads nothing', false, () =>
  getDoc(doc(as('guest', 'guest@gmail.com'), 'users/bob')))
await check('...nor a lookalike domain', false, () =>
  getDoc(doc(as('guest2', 'x@cass.co.nz.evil.com'), 'users/bob')))
await check('user makes themselves admin', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { role: 'admin' }))
await check('user grants themselves simproAccess', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { simproAccess: true }))
await check('user changes a team already set (Sales -> Engineers)', false, () =>
  updateDoc(doc(as('bob'), 'users/bob'), { team: 'Engineers' }))
await check('new user creates own profile as admin', false, () =>
  setDoc(doc(as('sneak'), 'users/sneak'), { displayName: 'S', role: 'admin', createdAt: serverTimestamp() }))
await check('new user creates own profile with simproAccess', false, () =>
  setDoc(doc(as('sneak2'), 'users/sneak2'), { displayName: 'S', role: 'user', simproAccess: true }))
await check('user overwrites own profile whole (setDoc) to admin', false, () =>
  setDoc(doc(as('bob'), 'users/bob'), { displayName: 'Bob', role: 'admin', team: 'Sales' }))
await check('settled user deletes someone else\'s placeholder', false, () =>
  deleteDoc(doc(as('bob'), 'users/pending-carl')))
await check('user edits someone else\'s record', false, () =>
  updateDoc(doc(as('bob'), 'users/notyet'), { team: 'Sales' }))
await check('signed-out read of the roster', false, () => getDoc(doc(anon, 'users/bob')))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
