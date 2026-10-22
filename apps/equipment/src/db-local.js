/* A made-up demo tracker database for `npm run dev` without a .env, kept in
   this browser (localStorage), so the screens can be worked on without
   credentials. Same calls as db.js, the same shapes as the real database,
   and the same clash guard: a write with an out-of-date ETag is refused. A
   real build never uses it. */
const KEY = 'dev:equipment-db'
const day = (n) => new Date(Date.now() + n * 86400000).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
const ts = (n) => day(n) + 'T09:30:00+12:00'

// Also the test copy's demo equipment (scripts/emulator-seed.mjs).
export function sample() {
  const eq = (i, o) => ({ id: 'id_dev_' + i, Returned: 'No', OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', BatchID: '', Notes: '', ShelfLocation: 'Shelf ' + (1 + (i % 4)), ...o })
  const equipment = [
    eq(1, { CHSAssetNo: '100166', Model: 'TEX20', Description: 'TEX20 Ultrasound Crate', SerialNo: 'TX-20-0041' }),
    eq(2, { CHSAssetNo: '100201', Model: 'A9', Description: 'A9 Anaesthesia machine', SerialNo: 'FX7-53001202', OnLoanTo: 'Whanganui Hospital', Location: 'Theatre 2', LoanStartDate: day(-10), LoanEndDate: day(12), BatchID: 'batch_dev_1' }),
    eq(3, { CHSAssetNo: '100202', Model: 'A9', Description: 'A9 Anaesthesia machine', SerialNo: 'FX7-53001203', OnLoanTo: 'Whanganui Hospital', Location: 'Theatre 2', LoanStartDate: day(-10), LoanEndDate: day(12), BatchID: 'batch_dev_1' }),
    eq(4, { CHSAssetNo: '100310', Model: 'N15', Description: 'BeneVision N15 monitor', SerialNo: 'BV-2209881', OnLoanTo: 'Waikato Hospital', Location: 'ICU', LoanStartDate: day(-30), LoanEndDate: day(-3), BatchID: 'batch_dev_2' }),
    eq(5, { CHSAssetNo: '100311', Model: 'N15', Description: 'BeneVision N15 monitor', SerialNo: 'BV-2209882', Counted: 'Counted 01/10/2026' }),
    eq(6, { CHSAssetNo: '100420', Model: 'D30', Description: 'BeneHeart D30 defibrillator', SerialNo: 'D30-110045', OnLoanTo: 'Tauranga Hospital', Location: 'ED', LoanStartDate: day(4), LoanEndDate: day(18), BatchID: 'batch_dev_3' }),
    eq(7, { CHSAssetNo: '100421', Model: 'D30', Description: 'BeneHeart D30 defibrillator', SerialNo: 'D30-110046' }),
    eq(8, { CHSAssetNo: '100530', Model: 'VS9', Description: 'VS9 vital signs monitor', SerialNo: 'VS9-77120', OnLoanTo: 'Middlemore', Location: 'Ward 10', LoanStartDate: day(-200), LoanEndDate: day(-100), BatchID: 'batch_dev_4' }),
    eq(9, { CHSAssetNo: '100640', Model: 'SK-600', Description: 'SK-600 infusion pump', SerialNo: 'SK-450021' }),
    eq(10, { CHSAssetNo: '100641', Model: 'SK-600', Description: 'SK-600 infusion pump', SerialNo: 'SK-450022', OnLoanTo: 'Test hospital', LoanStartDate: day(-2), LoanEndDate: day(5), BatchID: 'testbatch_dev_5' }),
  ]
  const history = [
    { id: 'h_dev_1', ts: ts(-10), chsAssetNo: '100201', model: 'A9', action: 'Loan', loanTo: 'Whanganui Hospital', location: 'Theatre 2', loanStart: day(-10), loanEnd: day(12), batchId: 'batch_dev_1', operator: 'Sam Lee' },
    { id: 'h_dev_2', ts: ts(-10), chsAssetNo: '100202', model: 'A9', action: 'Loan', loanTo: 'Whanganui Hospital', location: 'Theatre 2', loanStart: day(-10), loanEnd: day(12), batchId: 'batch_dev_1', operator: 'Sam Lee' },
    { id: 'h_dev_3', ts: ts(-30), chsAssetNo: '100310', model: 'N15', action: 'Loan', loanTo: 'Waikato Hospital', location: 'ICU', loanStart: day(-30), loanEnd: day(-3), batchId: 'batch_dev_2', operator: 'Tama Brown' },
    { id: 'h_dev_4', ts: ts(-40), chsAssetNo: '100166', model: 'TEX20', action: 'Return', loanTo: 'North Shore', operator: 'Kiri Moana' },
    { id: 'h_dev_5', ts: ts(-16), chsAssetNo: '100311', model: 'N15', action: 'Count', notes: 'Counted on the shelf', operator: 'Kiri Moana' },
  ]
  return {
    data: { equipment, history, _v: String(Date.now()), loanMeta: {
      batch_dev_1: { accountManager: 'Sam Lee', noTestRequired: true, dispatched: true, dispatchedAt: ts(-10) },
      batch_dev_2: { accountManager: 'Tama Brown', tested: true, testedAt: ts(-31), dispatched: true, dispatchedAt: ts(-30) },
      batch_dev_4: { accountManager: 'Sam Lee', longTerm: true },
    } },
    upcomingLoans: {
      batch_dev_6: { id: 'batch_dev_6', loanTo: 'Napier Hospital', location: 'CCU', startDate: day(20), endDate: day(34), accountManager: 'Tama Brown', items: [{ id: 'id_dev_7', CHSAssetNo: '100421', Model: 'D30', SerialNo: 'D30-110046' }] },
      // Started yesterday, still waiting on a monitor that's out (overdue) at Waikato: a transfer due.
      batch_dev_7: { id: 'batch_dev_7', loanTo: 'Hutt Hospital', location: 'Ward 4', startDate: day(-1), endDate: day(13), accountManager: 'Sam Lee', items: [{ id: 'id_dev_4', CHSAssetNo: '100310', Model: 'N15', SerialNo: 'BV-2209881' }] },
    },
    loanDocs: {
      batch_dev_1: { simproJobId: 209677, demoType: 'Clinical Trial', notes: 'Ship with the full set of accessories.' },
      batch_dev_2: { simproJobId: 209306, demoType: 'Conference/Presentation' },
      batch_dev_3: { demoType: 'Evaluation', island: 'North' },
      batch_dev_4: { simproJobId: 209067, simproClosedAt: ts(-100), longTerm: true },
    },
    // Sam Lee has the dev sign-in's email (shared/session.js), so Overview shows "Yours" in dev.
    accountManagers: [{ name: 'Sam Lee', email: 'dev.user@cass.co.nz', role: 'am' }, { name: 'Tama Brown', email: 'tama.brown@example.com', role: 'am' }, { name: 'Kiri Moana', email: 'kiri.moana@example.com', role: 'service' }],
    kitGroups: { kit_dev_1: { label: 'TEX20 ultrasound kit', triggers: ['100166'], accessories: [{ assetNo: '100640', model: 'SK-600' }, { assetNo: '100999', model: 'Probe (not in the list)' }] } },
    retired: [],
    customDemoTypes: ['Evaluation'],
  }
}

// Read on first use, not on import, so a real build (which never calls this
// file) can leave it out altogether.
let db = null
let version = 1
const watchers = new Set()
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && s.data) return s } catch { /* fresh */ }
  return sample()
}
function persist() {
  version++
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* private mode */ }
  watchers.forEach((w) => w())
}

// Each part of the address decoded, as the real database does.
const parts = (path) => path.split('/').filter(Boolean).map(decodeURIComponent)
function get(path) { db ??= load(); return parts(path).reduce((o, k) => (o == null ? undefined : o[k]), db) ?? null }
function set(path, value) {
  db ??= load()
  const ks = parts(path), last = ks.pop()
  let o = db
  for (const k of ks) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k] }
  if (value === null || value === undefined) delete o[last]
  else o[last] = value
}
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)))

export async function read(path, { etag = false } = {}) {
  await new Promise((r) => setTimeout(r, 120)) // feels like a network
  return { data: clone(get(path)), etag: etag ? String(version) : null }
}

export async function write(path, value, { method = 'PUT', etag = null } = {}) {
  await new Promise((r) => setTimeout(r, 120))
  if (etag && etag !== String(version)) return { ok: false, conflict: true }
  if (method === 'DELETE') set(path, null)
  else if (method === 'PATCH') set(path, { ...(get(path) || {}), ...clone(value) })
  else set(path, clone(value))
  persist()
  return { ok: true }
}

export function watch(path, onChange) {
  let last
  const tell = () => { const v = clone(get(path)); const s = JSON.stringify(v); if (s !== last) { last = s; onChange(v) } }
  const w = () => tell()
  watchers.add(w)
  setTimeout(tell, 100)
  // Another tab of the dev server is another person: see their changes too.
  const onStorage = (e) => { if (e.key === KEY) { db = load(); version++; tell() } }
  window.addEventListener('storage', onStorage)
  return () => { watchers.delete(w); window.removeEventListener('storage', onStorage) }
}

/** Starts the made-up database again. */
export function reset() { db = sample(); persist() }
