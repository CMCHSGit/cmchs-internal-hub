/* The maintenance schedule for `npm run dev` without a .env: made-up entries
   kept in this browser (localStorage), so the screens can be worked on
   without credentials. store.js uses this only when there is no Firestore; a
   real build never does. */
const KEY = 'dev:maintenance'
const month = (n) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 7) + '-01' }
const SAMPLE = {
  pmTypes: ['First PM', 'Second PM', 'Third PM', 'Fourth PM', 'Other'],
  entries: [
    { site: 'Waikato Hospital', wards: 'ICU\nHDU', models: '16x N1\n4x N15', due: month(-2), monthOnly: true, pmType: 'Second PM', status: 'Not started', dateComplete: '', notes: 'Service Contract - pending!', extraNotes: '' },
    { site: 'Middlemore', wards: 'ED', models: '8x BeneVision N12', due: month(1), monthOnly: true, pmType: 'First PM', status: 'In progress', dateComplete: '', notes: '', extraNotes: '' },
    { site: 'Whanganui', wards: 'Theatre', models: '6x A9', due: month(2), monthOnly: true, pmType: 'Third PM', status: 'Not started', dateComplete: '', notes: 'not charged', extraNotes: '' },
    { site: 'North Shore', wards: 'Ward 10', models: '12x VS9', due: month(-5), monthOnly: true, pmType: 'First PM', status: 'Completed', dateComplete: month(-5).slice(0, 8) + '14', notes: '', extraNotes: '' },
    { site: 'Tauranga', wards: 'CCU', models: '10x N1', due: month(-1), monthOnly: true, pmType: 'Other', status: 'Completed by Biomeds', dateComplete: month(-1).slice(0, 8) + '20', notes: '', extraNotes: '' },
    { site: 'Waitakere', wards: 'Maternity', models: '4x D30', due: month(7), monthOnly: true, pmType: 'Fourth PM', status: 'On hold', dateComplete: '', notes: 'Waiting on access', extraNotes: '' },
  ],
}

let db = load()
const entryListeners = new Set(), settingsListeners = new Set()
function load() {
  try { const s = JSON.parse(localStorage.getItem(KEY)); if (s && Array.isArray(s.entries)) return s } catch { /* fresh */ }
  return { pmTypes: SAMPLE.pmTypes, entries: SAMPLE.entries.map((e, i) => ({ id: 'dev-' + i, ...e })) }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)) } catch { /* private mode */ }
  entryListeners.forEach((l) => l(db.entries.map((e) => ({ ...e }))))
  settingsListeners.forEach((l) => l({ pmTypes: [...db.pmTypes] }))
}
const id = () => 'dev-' + Math.random().toString(36).slice(2, 10)

export function watchEntries(onChange) {
  entryListeners.add(onChange); setTimeout(() => onChange(db.entries.map((e) => ({ ...e }))), 150)
  return () => entryListeners.delete(onChange)
}
export function watchSettings(onChange) {
  settingsListeners.add(onChange); setTimeout(() => onChange({ pmTypes: [...db.pmTypes] }), 100)
  return () => settingsListeners.delete(onChange)
}
export async function createEntry(entry) { db.entries = [...db.entries, { id: id(), ...entry }]; save() }
export async function saveEntry(eid, entry) { db.entries = db.entries.map((e) => (e.id === eid ? { ...e, ...entry } : e)); save() }
export async function removeEntry(eid) { db.entries = db.entries.filter((e) => e.id !== eid); save() }
export async function createMany(list, _who, onProgress) { db.entries = [...db.entries, ...list.map((e) => ({ id: id(), ...e }))]; save(); onProgress?.(list.length, list.length); return list.length }
export async function removeMany(ids, onProgress) { const s = new Set(ids); db.entries = db.entries.filter((e) => !s.has(e.id)); save(); onProgress?.(ids.length, ids.length); return ids.length }
export async function savePmTypes(pmTypes) { db.pmTypes = pmTypes; save() }
