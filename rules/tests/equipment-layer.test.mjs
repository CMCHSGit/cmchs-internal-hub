// The demo tracker's Firestore data layer (apps/equipment/src/db-firestore.js,
// step 5B) against the REAL rules on the emulator: the layer itself, bundled
// with its Firebase handle swapped for an emulator user. Needs Java, and the
// hub's own npm install (for esbuild). Copy it into the same empty folder as
// the other rules tests (rules/README.md), so `firebase` resolves there, and
// say where the hub's checkout is:
//   HUB_REPO=C:/Users/<you>/cmchs-internal-hub npx firebase emulators:exec --only firestore --project rules-test "node equipment-layer.test.mjs"
//
// Checks a new loan, a retire by someone who isn't an admin, a clash with
// someone else's change (the change is run again on theirs, nothing of theirs
// lost), what's refused, test reports in chunks, and the audit log.
import { readFileSync, writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const repo = process.env.HUB_REPO ? pathToFileURL(process.env.HUB_REPO.replace(/\/?$/, '/')) : new URL('../../', import.meta.url)
const src = new URL('apps/equipment/src/', repo)
const { build } = await import(new URL('node_modules/esbuild/lib/main.js', repo))
// The bundle goes beside the folder's node_modules, so it shares its firebase.
// __stale makes this browser's copy of a document out of date, for the clash.
writeFileSync('layer-stub.mjs', 'export const db = globalThis.__testDb')
await build({
  stdin: { contents: `export * from './db-firestore.js'; export * as M from './model.js'`, resolveDir: src.pathname.replace(/^\/([A-Za-z]:)/, '$1') },
  bundle: true, format: 'esm', outfile: 'layer.bundle.mjs', external: ['firebase/firestore'], logLevel: 'error',
  define: { 'import.meta.env': '{"DEV":false}' },
  footer: { js: 'export function __stale(name, id, data) { docs = { ...docs, [name]: new Map(docs[name]).set(id, data) } }' },
  plugins: [{ name: 'stub', setup(b) {
    b.onResolve({ filter: /(schedule\/src\/firebase|db-local)\.js$/ }, () => ({ path: process.cwd() + '/layer-stub.mjs' }))
  } }],
})

const env = await initializeTestEnvironment({ projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('rules/firestore.rules', repo), 'utf8'), host: '127.0.0.1', port: 8085 } })
const T = '2026-10-19T10:00:00+12:00'
const item = (id, o = {}) => ({ id, CHSAssetNo: 'A' + id, Model: 'N15', Returned: 'Yes', OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', BatchID: '', ...o })
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore()
  await setDoc(doc(db, 'users/sam'), { displayName: 'Sam', role: 'user', team: 'Sales' })
  await setDoc(doc(db, 'users/kiri'), { displayName: 'Kiri', role: 'user', team: 'Engineers' })
  for (let i = 1; i <= 4; i++) await setDoc(doc(db, 'equipment/i' + i), { ...item('i' + i), _pos: i })
  await setDoc(doc(db, 'equipmentHistory/h1'), { id: 'h1', ts: T, action: 'Count', chsAssetNo: 'Ai1', _pos: 0 })
  await setDoc(doc(db, 'settings/equipment'), { simproConfig: { createJobs: false }, demoTypes: [] })
})
globalThis.__testDb = env.authenticatedContext('sam', { email: 'sam@cass.co.nz' }).firestore()
const L = await import(pathToFileURL(process.cwd() + '/layer.bundle.mjs').href)
const M = L.M
let pass = 0, fail = 0
const ok = (label, cond) => { cond ? pass++ : fail++; console.log(`  ${cond ? 'ok  ' : 'FAIL'}  ${label}`) }
const today = M.nzDate()
const f = { loanTo: 'Waikato', location: 'ICU', startDate: today, endDate: '2099-01-01', am: 'Sam', email: '' }

let s = await L.current()
ok('loads the items in order', s.equipment.map((e) => e.id).join() === 'i1,i2,i3,i4')

let plan
await L.commit((st) => { plan = M.planNewLoan(st, f, ['Ai1', 'Ai2'], { batchId: 'batch_1', today, operator: 'Sam' }); return { equipment: plan.equipment, history: plan.history, loanMeta: { ...st.loanMeta, batch_1: { accountManager: 'Sam' } } } })
s = await L.current()
ok('new loan: two items out on batch_1', s.equipment.filter((e) => e.BatchID === 'batch_1').length === 2)
const loan = (await getDoc(doc(globalThis.__testDb, 'loans/batch_1'))).data()
ok('new loan: its document is active, with both asset numbers', loan.status === 'active' && loan.assetNos.length === 2)
ok('new loan: history newest first', s.history[0].action === 'Loan' && s.history.at(-1).id === 'h1')

await L.commit((st) => { const r = M.retireEquipment(st.equipment, 'i4', { reason: 'Sold', today }); return { equipment: r.equipment, retired: [r.retired, ...st.retired] } })
s = await L.current()
ok('retire (as Sam, not an admin): off the list, onto the retired list', !s.equipment.some((e) => e.id === 'i4') && s.retired[0].id === 'i4')

// Someone else changes an item the next change also touches: the layer takes theirs and runs again.
const kiri = env.authenticatedContext('kiri', { email: 'kiri@cass.co.nz' }).firestore()
const cur = (await getDoc(doc(kiri, 'equipment/i1'))).data()
await setDoc(doc(kiri, 'equipment/i1'), { ...cur, Notes: 'Kiri was here' })
await new Promise((r) => setTimeout(r, 500))
L.__stale('equipment', 'i1', cur)  // Sam's copy hasn't caught up with Kiri's yet
let runs = 0
await L.commit((st) => { runs++;  const r = M.returnEquipment(st.equipment, st.history, ['i1', 'i2'], { today, operator: 'Sam' }); return { equipment: r.equipment, history: r.history } })
const i1 = (await getDoc(doc(kiri, 'equipment/i1'))).data()
ok('a clash: run again on the fresh copy (' + runs + ' runs)', runs === 2)
ok('a clash: the return saved and Kiri\'s note kept', i1.Returned === 'Yes' && i1.Notes === 'Kiri was here')
const closed = (await getDoc(doc(kiri, 'loans/batch_1'))).data()
ok('the loan, now empty, is kept as closed', closed.status === 'closed')

let refused = ''
try { await L.commit((st) => ({ history: [{ ...st.history[0], notes: 'edited' }, ...st.history.slice(1)] })) } catch (e) { refused = e.message }
ok('editing history is refused', /can’t be changed/.test(refused))
let denied = ''
try { await L.commit((st) => ({ equipment: st.equipment.filter((e) => e.id !== 'i3') })) } catch (e) { denied = e.code || e.message }
ok('deleting an item outright (not an admin) is refused by the rules', /permission/i.test(denied))
try { await L.commit((st) => ({ simproConfig: { createJobs: true } })); ok('turning job creation on as Sam is refused', false) } catch (e) { ok('turning job creation on as Sam is refused', /permission/i.test(e.code || e.message)) }

const big = 'data:application/pdf;base64,' + 'Q'.repeat(2500000)
await L.uploadReport('batch_1', 'rep1', { filename: 'safety.pdf', mimeType: 'application/pdf', size: 1800000, uploadedAt: T, uploadedBy: 'Sam' }, big)
ok('a 2.5 MB report: listed', (await L.listReports('batch_1')).length === 1)
ok('a 2.5 MB report: comes back whole', (await L.reportFile('batch_1', 'rep1')) === big)
await L.deleteReport('batch_1', 'rep1')
ok('a report deleted', (await L.listReports('batch_1')).length === 0)
await L.addAudit({ id: 'a1', ts: T, type: 'loan_created', summary: 'x', detail: {}, operator: 'Sam', source: 'hub' })
ok('the audit log', (await L.loadAudit()).length === 1)

console.log(`\n${pass} passed, ${fail} failed`)
await env.cleanup()
process.exit(fail ? 1 : 0)
