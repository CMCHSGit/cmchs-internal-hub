// Fills the test copy's emulators with made-up data (README, "Test copy"):
// the test staff of shared/test-accounts.js (sign-in and users), this week's
// schedule, news, asks, the project tracker's sample jobs and the demo
// tracker's sample equipment. Wipes the emulators first, so running it again
// starts afresh. scripts/emulators.mjs runs it once the emulators are up.
//
// Refuses to run against anything but the local emulators: it never sees a
// key, and the project is the made-up "demo-cmchs".
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../shared/test-accounts.js'
import { sampleAsks } from '../apps/asks/src/sample.js'
import { statsOf } from '../apps/asks/src/model.js'
import { SAMPLE_JOBS, SAMPLE_ASSIGNMENTS, SAMPLE_COMMENTS, SAMPLE_STAFF, SAMPLE_POOL } from '../apps/projects/src/sample.js'
import { sample as trackerSample } from '../apps/equipment/src/db-local.js'
import { COLLECTIONS, SETTINGS_DOC, toDocs } from '../apps/equipment/src/fs-shape.js'

export const PROJECT = 'demo-cmchs'
export const HOSTS = { firestore: '127.0.0.1:8080', auth: '127.0.0.1:9099' }

const local = (h) => /^(127\.0\.0\.1|localhost):\d+$/.test(h || '')

export async function seed() {
  process.env.FIRESTORE_EMULATOR_HOST ||= HOSTS.firestore
  process.env.FIREBASE_AUTH_EMULATOR_HOST ||= HOSTS.auth
  if (!local(process.env.FIRESTORE_EMULATOR_HOST) || !local(process.env.FIREBASE_AUTH_EMULATOR_HOST)) {
    throw new Error('Refusing to seed: the emulator hosts are not local.')
  }

  // Start afresh: the emulators' own wipe endpoints.
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' })
  await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' })

  const app = initializeApp({ projectId: PROJECT }, 'seed-' + Date.now())
  const auth = getAuth(app)
  const db = getFirestore(app)
  const now = Date.now()
  const iso = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
  const day = (n) => iso(new Date(now + n * 86400000))
  const monday = (() => { const d = new Date(now); const w = d.getDay(); d.setDate(d.getDate() + (w === 0 ? 1 : w === 6 ? 2 : 1 - w)); return iso(d) })()

  // ── people ──
  for (const a of TEST_ACCOUNTS) {
    await auth.createUser({ uid: a.uid, email: a.email, password: TEST_PASSWORD, displayName: a.name, emailVerified: true })
    const rec = { displayName: a.name, email: a.email, team: a.team || null, role: a.role, createdAt: new Date(now - 90 * 86400000) }
    if (a.hr) rec.hr = true
    if (a.trackerRole) rec.trackerRole = a.trackerRole
    await db.doc(`users/${a.uid}`).set(rec)
  }

  // ── this week's schedule ──
  const WEEK = {
    'test-admin': ['Cass Office', 'Cass Office', 'Remote Support', 'Cass Office', 'Work from Home'],
    'test-hr': ['Cass Office', 'Cass Office', 'Cass Office', 'Annual Leave', 'Annual Leave'],
    'test-eng': ['Middlemore', 'Middlemore', 'Cass Office', 'Waikato Hospital', 'Cass Office'],
    'test-eng2': ['Cass Office', 'Tauranga Hospital', 'Tauranga Hospital', 'Cass Office', 'Remote Support'],
    'test-sales': ['Cass Office', 'Whanganui Hospital', 'Cass Office', 'Cass Office', 'Work from Home'],
    'test-apps': ['Auckland City Hospital', 'Cass Office', 'Cass Office', 'North Shore Hospital', 'Cass Office'],
  }
  for (const [uid, places] of Object.entries(WEEK)) {
    await db.doc(`schedules/${monday}_${uid}`).set({ uid, weekStart: monday, days: places.map((location) => ({ location, onCall: false })), comments: '', updatedAt: new Date(now) })
  }

  // ── news ──
  const news = [
    { title: 'Labour Day: the office is closed on Monday', body: 'Check the staff schedule for on-call cover.', category: 'Announcements', pinned: true, by: 'test-admin' },
    { title: 'A9 installed at Middlemore theatre 3', body: 'Commissioning done, training booked for next week.', category: 'Team news', section: 'been', regions: ['Auckland'], by: 'test-eng' },
    { title: 'Whanganui ICU demo of the N15 monitors', body: 'Two days, with the applications team.', category: 'Team news', section: 'next', by: 'test-sales' },
  ]
  for (const [i, n] of news.entries()) {
    const who = TEST_ACCOUNTS.find((a) => a.uid === n.by)
    await db.collection('announcements').add({
      title: n.title, body: n.body, category: n.category, section: n.section || '', regions: n.regions || [], people: [],
      pinned: !!n.pinned, date: day(-i), weekOf: monday, order: i, batchId: '', author: who.name, authorUid: who.uid,
      photoCount: 0, commentCount: 0, createdAt: new Date(now - i * 3600000),
    })
  }

  // ── asks: the Asks sample, with its made-up people swapped for the test staff ──
  const SWAP = { 'u-aroha': 'test-admin', 'u-mike': 'test-eng', 'u-sam': 'test-eng2', 'u-jess': 'test-sales', 'u-lee': 'test-apps' }
  const nameOf = (uid) => TEST_ACCOUNTS.find((a) => a.uid === uid)?.name || ''
  const swap = (v) => JSON.parse(JSON.stringify(v).replace(/u-(aroha|mike|sam|jess|lee)/g, (m) => SWAP[m]))
  const { asks, comments } = sampleAsks(now)
  for (const raw of asks) {
    const { id, ...a } = swap(raw)
    a.createdByName = nameOf(a.createdBy)
    a.ownerName = a.owner ? nameOf(a.owner) : ''
    if (a.doneBy) a.doneBy = nameOf(a.owner)
    a.cc = a.cc || []
    await db.doc(`asks/${id}`).set(a)
    await db.doc(`askStats/${id}`).set(statsOf(a))
  }
  for (const raw of comments) {
    const { id, askId, ...c } = swap(raw)
    c.name = nameOf(c.uid)
    c.text = c.text.replace(/@Jess Reid/g, '@' + nameOf('test-sales'))
    await db.doc(`asks/${askId}/comments/${id}`).set(c)
  }

  // ── the project tracker's sample ──
  for (const j of SAMPLE_JOBS) await db.doc(`projectJobs/${j.id}`).set({ ...j, sample: true, updatedAtMs: now })
  for (const x of SAMPLE_ASSIGNMENTS) await db.doc(`projectAssignments/${x.id}`).set(x)
  for (const x of SAMPLE_COMMENTS) await db.doc(`projectComments/${x.id}`).set(x)
  await db.doc('projectSettings/main').set({ staff: SAMPLE_STAFF, pool: Object.entries(SAMPLE_POOL).map(([model, total]) => ({ model, total })) })

  // ── the demo tracker, in Firestore (its cutover set to Firestore) ──
  const tree = JSON.parse(JSON.stringify(trackerSample())
    .replace(/Sam Lee/g, nameOf('test-sales')).replace(/Tama Brown/g, nameOf('test-apps')).replace(/Kiri Moana/g, nameOf('test-eng')))
  const d = tree.data || {}
  const state = {
    equipment: d.equipment || [], history: d.history || [], retired: tree.retired || [],
    loanMeta: d.loanMeta || {}, loanDocs: tree.loanDocs || {},
    upcoming: Object.entries(tree.upcomingLoans || {}).map(([k, u]) => (u.id ? u : { ...u, id: k })),
    kits: tree.kitGroups || {}, demoTypes: tree.customDemoTypes || [], simproConfig: tree.simproConfig || {},
  }
  const docs = toDocs(state, { today: day(0) })
  for (const [key, col] of Object.entries(COLLECTIONS)) {
    for (const [id, v] of docs[key]) await db.doc(`${col}/${id}`).set(v)
  }
  await db.doc(SETTINGS_DOC.join('/')).set(docs.settings)
  await db.doc('settings/equipmentCutover').set({ source: 'firestore', readOnly: false, by: 'test copy', at: new Date(now).toISOString() })

  const count = async (c) => (await db.collection(c).count().get()).data().count
  console.log(`Seeded the test copy: ${TEST_ACCOUNTS.length} test staff, ${await count('asks')} asks, ${await count('announcements')} news posts, ` +
    `${await count('projectJobs')} project jobs, ${await count('equipment')} demo items, ${await count('loans')} loans.`)
}

if (process.argv[1] && /emulator-seed\.mjs$/.test(process.argv[1])) {
  seed().then(() => process.exit(0)).catch((e) => { console.error('Seeding failed:', e.message); process.exit(1) })
}
