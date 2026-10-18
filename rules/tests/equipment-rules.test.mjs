// Firestore rules tests for the demo tracker's data (step 5B, STEP-5-PLAN.md)
// — runs the REAL rules engine (the emulator), not a mock. Needs Java. From
// an empty folder:
//   npm i firebase-tools@13 @firebase/rules-unit-testing@3 firebase@10
//   (it reads ../firestore.rules; see rules/README.md), then:
//   npx firebase emulators:exec --only firestore --project rules-test "node equipment-rules.test.mjs"
// (firebase.json: {"emulators":{"firestore":{"host":"127.0.0.1","port":8085}}})
//
// The writes the Firestore data layer makes (each change one batch: the items,
// loans and history entries it touches), and what only an admin may do, which
// the old tracker kept behind its admin password.
import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore'

const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

const TS = '2026-10-19T10:00:00+12:00'
const item = (id, no, o = {}) => ({ id, CHSAssetNo: no, Model: 'N15', Description: 'BeneVision N15 monitor', SerialNo: 'BV-' + no,
  OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', Returned: 'Yes', BatchID: '', Notes: '', ...o })
const entry = (id, o = {}) => ({ id, ts: TS, chsAssetNo: '100310', model: 'N15', action: 'Loan', operator: 'Sam', ...o })
const loan = (o = {}) => ({ loanTo: 'Waikato Hospital', location: 'ICU', startDate: '2026-10-19', endDate: '2026-11-02', accountManager: 'Sam',
  longTerm: false, status: 'active', waitingFor: [], ...o })
const report = (o = {}) => ({ filename: 'N15 electrical safety.pdf', mimeType: 'application/pdf', size: 1200000, uploadedAt: TS, uploadedBy: 'Sam', chunks: 2, ...o })
const CHUNK = 'A'.repeat(900000)

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/admin1'), { displayName: 'Ann Admin', role: 'admin', team: 'Management' })
  await setDoc(doc(db, 'users/sam'), { displayName: 'Sam', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/kiri'), { displayName: 'Kiri', role: 'user', team: 'Engineers' })
  await setDoc(doc(db, 'users/hr1'), { displayName: 'Helen', role: 'user', team: 'Management', hr: true })
  await setDoc(doc(db, 'users/placeholder'), { displayName: 'Not yet', role: 'user', team: 'Sales', pending: true })
  await setDoc(doc(db, 'equipment/i1'), item('i1', '100310'))
  await setDoc(doc(db, 'equipment/i2'), item('i2', '100311'))
  await setDoc(doc(db, 'equipment/i3'), item('i3', '100312'))
  await setDoc(doc(db, 'equipment/i4'), item('i4', '100313'))
  await setDoc(doc(db, 'retiredEquipment/r1'), item('r1', '100100', { RetiredDate: '2026-09-01', RetiredReason: 'Sold', RetiredNotes: '' }))
  await setDoc(doc(db, 'retiredEquipment/r2'), item('r2', '100101', { RetiredDate: '2026-09-01', RetiredReason: 'Lost', RetiredNotes: '' }))
  await setDoc(doc(db, 'loans/batch_1'), loan())
  await setDoc(doc(db, 'loans/batch_1/reports/rep1'), report())
  await setDoc(doc(db, 'loans/batch_1/reports/rep1/chunks/0'), { data: CHUNK })
  await setDoc(doc(db, 'loans/batch_1/reports/rep1/chunks/1'), { data: 'AAAA' })
  await setDoc(doc(db, 'equipmentHistory/h1'), entry('h1'))
  await setDoc(doc(db, 'equipmentAudit/a1'), { id: 'a1', ts: TS, type: 'loan_created', summary: 'Loan created', detail: {}, operator: 'Sam', source: 'hub' })
  await setDoc(doc(db, 'equipmentKits/k1'), { label: 'TEX20 ultrasound kit', triggers: ['100166'], accessories: [] })
  await setDoc(doc(db, 'settings/equipment'), { simproConfig: { createJobs: false, windDownFrom: '2026-10-01' }, demoTypes: ['Evaluation'] })
})

const as = (uid) => env.authenticatedContext(uid).firestore()
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
const batch = (db, fill) => { const b = writeBatch(db); fill(b, db); return b.commit() }

console.log('\nWhat the tracker does — must work')
await check('Sam reads the equipment list', true, () => getDocs(collection(as('sam'), 'equipment')))
await check('Sam reads loans, history, the audit log, kits and settings', true, async () => {
  const db = as('sam')
  await getDocs(collection(db, 'loans')); await getDocs(collection(db, 'equipmentHistory')); await getDocs(collection(db, 'equipmentAudit'))
  await getDocs(collection(db, 'equipmentKits')); await getDoc(doc(db, 'settings/equipment')); await getDocs(collection(db, 'retiredEquipment'))
})
await check('Sam makes a new loan: the item, the loan and its history entry together', true, () => batch(as('sam'), (b, db) => {
  b.update(doc(db, 'equipment/i2'), { OnLoanTo: 'Hutt Hospital', Location: 'Ward 4', LoanStartDate: '2026-10-19', LoanEndDate: '2026-11-02', Returned: 'No', BatchID: 'batch_2' })
  b.set(doc(db, 'loans/batch_2'), loan({ loanTo: 'Hutt Hospital', location: 'Ward 4' }))
  b.set(doc(db, 'equipmentHistory/h2'), entry('h2', { chsAssetNo: '100311', loanTo: 'Hutt Hospital', batchId: 'batch_2' }))
  b.set(doc(db, 'equipmentAudit/a2'), { id: 'a2', ts: TS, type: 'loan_created', summary: 'Loan for Hutt Hospital', detail: {}, operator: 'Sam', source: 'hub' })
}))
await check('Sam books a device that is out elsewhere (a booked loan waiting for it)', true, () =>
  setDoc(doc(as('sam'), 'loans/batch_3'), loan({ loanTo: 'Napier Hospital', status: 'booked', waitingFor: [{ id: 'i2', CHSAssetNo: '100311', Model: 'N15', SerialNo: 'BV-100311' }] })))
await check('Kiri marks a loan tested', true, () => updateDoc(doc(as('kiri'), 'loans/batch_1'), { tested: true, testedAt: TS }))
await check('Kiri returns an item and closes its loan', true, () => batch(as('kiri'), (b, db) => {
  b.update(doc(db, 'equipment/i2'), { OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', Returned: 'Yes', BatchID: '' })
  b.update(doc(db, 'loans/batch_2'), { status: 'closed' })
  b.set(doc(db, 'equipmentHistory/h3'), entry('h3', { chsAssetNo: '100311', action: 'Return' }))
}))
await check('the system (no operator) logs an auto-transfer', true, () => setDoc(doc(as('sam'), 'equipmentHistory/h4'), entry('h4', { action: 'Transfer', operator: null })))
await check('Sam adds an item', true, () => setDoc(doc(as('sam'), 'equipment/i9'), item('i9', '100900')))
await check('Sam edits an item', true, () => updateDoc(doc(as('sam'), 'equipment/i1'), { ShelfLocation: 'Shelf 2', Notes: 'Battery replaced' }))
await check('Sam retires an item: off the list and onto the retired list together', true, () => batch(as('sam'), (b, db) => {
  b.delete(doc(db, 'equipment/i3'))
  b.set(doc(db, 'retiredEquipment/i3'), item('i3', '100312', { RetiredDate: '2026-10-19', RetiredReason: 'Sold', RetiredNotes: '' }))
}))
await check('Sam restores a retired item: back on the list together', true, () => batch(as('sam'), (b, db) => {
  b.delete(doc(db, 'retiredEquipment/r1'))
  b.set(doc(db, 'equipment/r1'), item('r1', '100100'))
}))
await check('Sam uploads a test report and its chunks', true, () => batch(as('sam'), (b, db) => {
  b.set(doc(db, 'loans/batch_1/reports/rep2'), report({ chunks: 2 }))
  b.set(doc(db, 'loans/batch_1/reports/rep2/chunks/0'), { data: CHUNK })
  b.set(doc(db, 'loans/batch_1/reports/rep2/chunks/1'), { data: 'AAAA' })
}))
// A write carries at most 10 MiB (the emulator: 4 MiB), so an 8 MB report
// (about 11 MB as base64) goes in several: the report, then its chunks four
// at a time, as the data layer writes it.
await check('Sam uploads an 8 MB report in several writes', true, async () => {
  const db = as('sam')
  await setDoc(doc(db, 'loans/batch_1/reports/rep4'), report({ size: 8 * 1024 * 1024, chunks: 12 }))
  for (let from = 0; from < 12; from += 4) {
    await batch(db, (b) => { for (let n = from; n < from + 4; n++) b.set(doc(db, `loans/batch_1/reports/rep4/chunks/${n}`), { data: CHUNK }) })
  }
})
await check('Kiri downloads a report (reads its chunks)', true, () => getDocs(collection(as('kiri'), 'loans/batch_1/reports/rep1/chunks')))
await check('Kiri deletes a report and its chunks', true, () => batch(as('kiri'), (b, db) => {
  b.delete(doc(db, 'loans/batch_1/reports/rep1/chunks/0')); b.delete(doc(db, 'loans/batch_1/reports/rep1/chunks/1')); b.delete(doc(db, 'loans/batch_1/reports/rep1'))
}))
await check('Sam adds and deletes a kit', true, async () => {
  const db = as('sam')
  await setDoc(doc(db, 'equipmentKits/k2'), { label: 'D30 kit', triggers: ['100420'], accessories: [] })
  await deleteDoc(doc(db, 'equipmentKits/k2'))
})
await check('Sam adds a demo type', true, () => updateDoc(doc(as('sam'), 'settings/equipment'), { demoTypes: ['Evaluation', 'Training'] }))
await check('Sam turns Simpro job creation off', true, () => updateDoc(doc(as('sam'), 'settings/equipment'), { simproConfig: { createJobs: false, windDownFrom: '2026-10-19', changedBy: 'Sam' } }))

console.log('\nAdmins only — must work for an admin')
await check('an admin deletes an item', true, () => deleteDoc(doc(as('admin1'), 'equipment/i4')))
await check('an admin deletes a loan', true, () => deleteDoc(doc(as('admin1'), 'loans/batch_3')))
await check('an admin deletes a retired item for good', true, () => deleteDoc(doc(as('admin1'), 'retiredEquipment/r2')))
await check('an admin turns Simpro job creation on', true, () => updateDoc(doc(as('admin1'), 'settings/equipment'), { simproConfig: { createJobs: true, changedBy: 'Ann Admin' } }))
await check('Sam changes a demo type while job creation is on (leaves it on)', true, () => updateDoc(doc(as('sam'), 'settings/equipment'), { demoTypes: ['Evaluation'] }))
await check('Sam turns it off again', true, () => updateDoc(doc(as('sam'), 'settings/equipment'), { 'simproConfig.createJobs': false }))
await check('an admin deletes a history entry', true, () => deleteDoc(doc(as('admin1'), 'equipmentHistory/h4')))

console.log('\nThe team on users (step 5A) — must work')
await check('an admin sets Kiri\'s tracker role', true, () => updateDoc(doc(as('admin1'), 'users/kiri'), { trackerRole: 'service' }))
await check('Sam turns his own demo reminders off', true, () => updateDoc(doc(as('sam'), 'users/sam'), { notifications: { scheduleReminder: true, demoReminders: false } }))

console.log('\nWhat must be refused')
await check('someone signed out reads the equipment list', false, () => getDocs(collection(anon, 'equipment')))
await check('someone signed in with no hub account reads it', false, () => getDocs(collection(as('stranger'), 'equipment')))
await check('someone signed in with no hub account adds an item', false, () => setDoc(doc(as('stranger'), 'equipment/x1'), item('x1', '100999')))
await check('Sam deletes an item outright', false, () => deleteDoc(doc(as('sam'), 'equipment/i1')))
await check('Sam deletes a loan', false, () => deleteDoc(doc(as('sam'), 'loans/batch_1')))
await check('Sam deletes a retired item for good', false, () => deleteDoc(doc(as('sam'), 'retiredEquipment/i3')))
await check('Sam turns Simpro job creation on', false, () => updateDoc(doc(as('sam'), 'settings/equipment'), { 'simproConfig.createJobs': true }))
await check('Sam edits a history entry', false, () => updateDoc(doc(as('sam'), 'equipmentHistory/h1'), { notes: 'never happened' }))
await check('Sam deletes a history entry', false, () => deleteDoc(doc(as('sam'), 'equipmentHistory/h1')))
await check('Sam edits the audit log', false, () => updateDoc(doc(as('sam'), 'equipmentAudit/a1'), { summary: 'something else' }))
await check('an admin deletes from the audit log', false, () => deleteDoc(doc(as('admin1'), 'equipmentAudit/a1')))
await check('an item with no asset number', false, () => setDoc(doc(as('sam'), 'equipment/x2'), item('x2', '')))
await check('an item whose id is not its document', false, () => setDoc(doc(as('sam'), 'equipment/x3'), item('other', '100998')))
await check('a loan with a made-up status', false, () => setDoc(doc(as('sam'), 'loans/batch_x'), loan({ status: 'lost' })))
await check('a retired item with no retired date', false, () => batch(as('sam'), (b, db) => {
  b.delete(doc(db, 'equipment/i1')); b.set(doc(db, 'retiredEquipment/i1'), item('i1', '100310'))
}))
await check('a report over 8 MB', false, () => setDoc(doc(as('sam'), 'loans/batch_1/reports/big'), report({ size: 9 * 1024 * 1024 })))
await check('a chunk too big for a document', false, () => batch(as('sam'), (b, db) => {
  b.set(doc(db, 'loans/batch_1/reports/rep3'), report({ chunks: 1 }))
  b.set(doc(db, 'loans/batch_1/reports/rep3/chunks/0'), { data: 'A'.repeat(960000) })
}))
await check('a chunk with no report', false, () => setDoc(doc(as('sam'), 'loans/batch_1/reports/none/chunks/0'), { data: 'AAAA' }))
await check('a placeholder account (not signed in yet) reads the list', false, () => getDocs(collection(as('placeholder'), 'equipment')))
await check('HR changes someone\'s tracker role', false, () => updateDoc(doc(as('hr1'), 'users/kiri'), { trackerRole: 'am' }))
await check('Sam turns his demo reminders on with something that isn\'t on or off', false, () => updateDoc(doc(as('sam'), 'users/sam'), { notifications: { demoReminders: 'yes' } }))
await check('Sam gives himself a tracker role', false, () => updateDoc(doc(as('sam'), 'users/sam'), { trackerRole: 'service' }))

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
