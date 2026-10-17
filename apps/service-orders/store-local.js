/* Service orders for `npm run dev` without a .env: made-up orders kept in
   this browser (localStorage), so the screens can be worked on without
   credentials. store.js uses this only when there is no Firestore; a real
   build never does. */
const KEY = 'dev:serviceOrders'
const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10)
const SAMPLE = [
  { so: '5001234', title: 'A9 FiCO2 too high alarm', sn: 'FX7-53001202', pn: '115-012345-00', partName: 'CO2 module', needReturn: 'YES', site: 'Waikato Hospital', notes: 'Loan unit in place', jobs: '18842', appliedBy: 'Sam Lee', dateRaised: day(-41), receivedDate: '', oldSo: '', extraNotes: '', stage: 'In progress' },
  { so: '5001240', title: 'BeneVision N15 touch fault', sn: 'BV-2209881', pn: '115-044110-00', partName: 'Touch panel', needReturn: 'YES', site: 'Middlemore', notes: '', jobs: '', appliedBy: 'Tama Brown', dateRaised: day(-12), receivedDate: '', oldSo: '', extraNotes: '', stage: 'In progress' },
  { so: '5001188', title: 'SpO2 cable intermittent', sn: 'SP-778120', pn: '0010-20-42594', partName: 'SpO2 extension cable', needReturn: 'NO', site: 'Waitakere', notes: '', jobs: '18790', appliedBy: 'Sam Lee', dateRaised: day(-30), receivedDate: day(-6), oldSo: '', extraNotes: '', stage: 'Received' },
  { so: '5001150', title: 'D30 battery swelling', sn: 'D30-110045', pn: '022-000123-00', partName: 'Battery pack', needReturn: 'YES', site: 'Whanganui', notes: 'Ship with dangerous goods label', jobs: '18701', appliedBy: 'Kiri Moana', dateRaised: day(-55), receivedDate: day(-20), oldSo: '', extraNotes: '', stage: 'Ready for shipping' },
  { so: '5001003', title: 'Pump door latch', sn: 'SK-450021', pn: '051-000880-00', partName: 'Door latch kit', needReturn: 'NO', site: 'North Shore', notes: '', jobs: '18512', appliedBy: 'Tama Brown', dateRaised: day(-90), receivedDate: day(-70), oldSo: '', extraNotes: '', stage: 'Completed or sent back' },
  { so: '5001260', title: 'Spare ECG leads for stock', sn: '', pn: '0010-30-42720', partName: '5-lead ECG cable', needReturn: '', site: 'CHS stock', notes: '', jobs: '', appliedBy: 'Kiri Moana', dateRaised: day(-3), receivedDate: '', oldSo: '', extraNotes: '', stage: 'CHS spare parts order' },
]

// Read on first use, not on import, so a real build (which never calls this
// file) can leave it out altogether.
let rows = null
const listeners = new Set()
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (Array.isArray(s)) return s } catch { /* fresh */ }
  return SAMPLE.map((o, i) => ({ id: 'dev-' + i, ...o }))
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(rows)) } catch { /* private mode */ }
  listeners.forEach((l) => l(rows.map((r) => ({ ...r }))))
}
const id = () => 'dev-' + Math.random().toString(36).slice(2, 10)

export function watchOrders(onChange) {
  rows ??= load()
  listeners.add(onChange)
  setTimeout(() => onChange(rows.map((r) => ({ ...r }))), 150)
  return () => listeners.delete(onChange)
}
export async function createOrder(order) { rows ??= load(); rows = [...rows, { id: id(), ...order }]; save() }
export async function saveOrder(oid, order) { rows ??= load(); rows = rows.map((r) => (r.id === oid ? { ...r, ...order } : r)); save() }
export async function removeOrder(oid) { rows ??= load(); rows = rows.filter((r) => r.id !== oid); save() }
export async function createMany(list, _who, onProgress) {
  rows ??= load()
  rows = [...rows, ...list.map((o) => ({ id: id(), ...o }))]; save(); onProgress?.(list.length, list.length); return list.length
}
