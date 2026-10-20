// Firestore rules tests for company news (the hub's Manage → News and the
// post page): reactions and comments. Runs the REAL rules engine (the
// emulator), not a mock. Needs Java. From an empty folder:
//   npm i firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10
//   (it reads ../firestore.rules; see rules/README.md), then:
//   npx firebase emulators:exec --only firestore --project rules-test "node news-rules.test.mjs"
// (firebase.json: {"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}})
//
// Every write apps/hub/src/social.js and news.js make, and the ways someone
// might try to change what isn't theirs.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { deleteField, doc, increment, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const post = { title: 'Labour Day', body: 'Office closed', category: 'Announcements', authorUid: 'pat', author: 'Pat', date: '2026-10-19' }
async function seed() {
  await env.clearFirestore()
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore()
    await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
    await setDoc(doc(db, 'users/pat'), { displayName: 'Pat Poster', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'users/bob'), { displayName: 'Bob', role: 'user', team: 'Engineers' })
    await setDoc(doc(db, 'users/zed'), { displayName: 'Zed', role: 'user', team: 'Sales' })
    await setDoc(doc(db, 'announcements/p1'), { ...post, reactions: { zed: 'love' }, commentCount: 1 })
    await setDoc(doc(db, 'announcements/p1/comments/c1'), { uid: 'zed', name: 'Zed', text: 'Nice', atMs: 1 })
  })
}

// Signed in with a company account, as everyone really is (rules: isCompanyEmail).
const as = (uid) => env.authenticatedContext(uid, { email: uid + '@cass.co.nz' }).firestore()
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
const newComment = (db, uid, extra = {}) => {
  const b = writeBatch(db)
  b.set(doc(db, 'announcements/p1/comments/c2'), { uid, name: 'Bob', text: 'Great news', atMs: 2, ...extra })
  b.update(doc(db, 'announcements/p1'), { commentCount: increment(1) })
  return b.commit()
}

console.log('\nReactions')
await check('anyone reacts', true, () => updateDoc(doc(as('bob'), 'announcements/p1'), { 'reactions.bob': 'like' }))
await check('changes their reaction', true, () => updateDoc(doc(as('zed'), 'announcements/p1'), { 'reactions.zed': 'clap' }))
await check('takes it back', true, () => updateDoc(doc(as('zed'), 'announcements/p1'), { 'reactions.zed': deleteField() }))
await check('not someone else\'s', false, () => updateDoc(doc(as('bob'), 'announcements/p1'), { 'reactions.zed': deleteField() }))
await check('not a made-up reaction', false, () => updateDoc(doc(as('bob'), 'announcements/p1'), { 'reactions.bob': 'angry' }))
await check('not the title along with it', false, () => updateDoc(doc(as('bob'), 'announcements/p1'), { 'reactions.bob': 'like', title: 'Hacked' }))
await check('not signed out', false, () => updateDoc(doc(anon, 'announcements/p1'), { 'reactions.x': 'like' }))
await check('the author still edits the post', true, () => updateDoc(doc(as('pat'), 'announcements/p1'), { title: 'Labour Day, Monday' }))
await check('but not other people\'s reactions', false, () => updateDoc(doc(as('pat'), 'announcements/p1'), { title: 'x', reactions: {} }))
await check('anyone else can\'t edit the post', false, () => updateDoc(doc(as('bob'), 'announcements/p1'), { title: 'Hacked' }))

console.log('\nComments')
await check('anyone comments, with the count', true, () => newComment(as('bob'), 'bob'))
await check('not as someone else', false, () => newComment(as('bob'), 'zed'))
await check('not empty', false, () => newComment(as('bob'), 'bob', { text: '' }))
await check('not with extra fields', false, () => newComment(as('bob'), 'bob', { pinned: true }))
await check('not on a post that isn\'t there', false, () =>
  setDoc(doc(as('bob'), 'announcements/nope/comments/c9'), { uid: 'bob', name: 'Bob', text: 'Hi', atMs: 2 }))
await check('the count moves by one only', false, () => updateDoc(doc(as('bob'), 'announcements/p1'), { commentCount: 50 }))
await check('the author of a comment edits it', true, () =>
  updateDoc(doc(as('zed'), 'announcements/p1/comments/c1'), { text: 'Nice one', editedAtMs: 3 }))
await check('nobody else edits it', false, () =>
  updateDoc(doc(as('bob'), 'announcements/p1/comments/c1'), { text: 'Mine now', editedAtMs: 3 }))
await check('can\'t change who wrote it', false, () =>
  updateDoc(doc(as('zed'), 'announcements/p1/comments/c1'), { uid: 'bob' }))
const del = (uid) => () => {
  const db = as(uid)
  const b = writeBatch(db)
  b.delete(doc(db, 'announcements/p1/comments/c1'))
  b.update(doc(db, 'announcements/p1'), { commentCount: increment(-1) })
  return b.commit()
}
await check('its author deletes it', true, del('zed'))
await check('the post\'s author deletes it', true, del('pat'))
await check('an admin deletes it', true, del('admin1'))
await check('someone else can\'t', false, () => deleteDoc(doc(as('bob'), 'announcements/p1/comments/c1')))
await check('signed out can\'t read them', false, () => import('firebase/firestore').then(f => f.getDoc(doc(anon, 'announcements/p1/comments/c1'))))

console.log('\nPhotos')
await check('a real JPEG photo', true, () => setDoc(doc(as('pat'), 'announcementPhotos/p1'), { photo: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==' }))
await check('not one with HTML tucked in after the picture', false, () =>
  setDoc(doc(as('pat'), 'announcementPhotos/p1'), { photo: 'data:image/jpeg;base64,AAAA" onerror="alert(1)' }))
await check('not anything else', false, () => setDoc(doc(as('pat'), 'announcementPhotos/p1'), { photo: 'javascript:alert(1)' }))

await env.cleanup()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
