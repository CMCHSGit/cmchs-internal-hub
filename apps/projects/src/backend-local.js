/* `npm run dev` only: the same calls as backend-firebase.js, kept in
   localStorage and shared between tabs with a BroadcastChannel. Never part of
   a real build (backend.js picks Firestore whenever the config is present). */

import { SAMPLE_JOBS, SAMPLE_ASSIGNMENTS, SAMPLE_COMMENTS, SAMPLE_STAFF, SAMPLE_POOL, SAMPLE_FEED } from './sample.js'
import { trimRaw } from './feed.js'
import { DEFAULT_SETTINGS } from './model.js'
import { clean } from './backend.js'

const KEY = 'projects_dev_db'
const COLS = ['jobs', 'assignments', 'comments', 'history', 'presence']
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('projects_dev') : null

function seed() {
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, { ...x }]))
  return {
    jobs: byId(SAMPLE_JOBS.map((j) => ({ ...j, sample: true, updatedAtMs: Date.now() }))),
    assignments: byId(SAMPLE_ASSIGNMENTS),
    comments: byId(SAMPLE_COMMENTS),
    history: {},
    presence: {},
    settings: {
      staff: SAMPLE_STAFF,
      pool: DEFAULT_SETTINGS.pool.map((p) => ({ ...p, total: SAMPLE_POOL[p.model] ?? null })),
    },
  }
}

function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* fall through to a fresh copy */ }
  const db = seed()
  localStorage.setItem(KEY, JSON.stringify(db))
  return db
}

let db = load()
const listeners = new Set()

function save() {
  localStorage.setItem(KEY, JSON.stringify(db))
  channel?.postMessage('changed')
  emit()
}
function emit() { for (const l of listeners) l() }
channel?.addEventListener('message', () => { db = load(); emit() })
window.addEventListener('storage', (e) => { if (e.key === KEY) { db = load(); emit() } })

// Each tab is somebody different, so two windows show two people online.
const PEOPLE = ['Aroha Henare', 'Mike Tan', 'Jess Reid']
let who = sessionStorage.getItem('projects_dev_user')
if (!who) {
  who = PEOPLE[Math.floor(Math.random() * PEOPLE.length)]
  sessionStorage.setItem('projects_dev_user', who)
}
const USER = { uid: 'dev-' + who.toLowerCase().replace(/\W+/g, '-'), name: who, email: 'dev.user@cass.co.nz' }

const later = (fn) => Promise.resolve().then(fn)

export default {
  kind: 'local',
  watchAuth(cb) { later(() => cb(USER)); return () => {} },
  signIn: async () => {},
  profile: async () => ({ displayName: USER.name, role: 'admin', team: 'Management' }),

  watch(col, cb) {
    const fire = () => cb(Object.entries(db[col] || {}).map(([id, d]) => ({ ...d, id })))
    listeners.add(fire)
    later(fire)
    return () => listeners.delete(fire)
  },
  watchSettings(cb) {
    const fire = () => cb(db.settings || null)
    listeners.add(fire)
    later(fire)
    return () => listeners.delete(fire)
  },

  newId: () => Math.random().toString(36).slice(2, 12),
  async set(col, id, data) { db[col][id] = clean(data); save() },
  async update(col, id, patch) {
    if (!db[col][id]) throw new Error('That record no longer exists.')
    db[col][id] = { ...db[col][id], ...clean(patch) }
    save()
  },
  async remove(col, id) { delete db[col][id]; save() },
  async mutate(col, id, fn) {
    const cur = db[col][id]
    if (!cur) throw new Error('That job no longer exists.')
    const patch = fn({ ...cur, id })
    if (patch) { db[col][id] = { ...cur, ...clean(patch) }; save() }
    return patch
  },
  async batch(ops) {
    for (const o of ops) {
      if (o.op === 'delete') delete db[o.col][o.id]
      else if (o.op === 'update') db[o.col][o.id] = { ...db[o.col][o.id], ...clean(o.data) }
      else db[o.col][o.id] = clean(o.data)
    }
    save()
  },
  async saveSettings(patch) { db.settings = { ...(db.settings || {}), ...clean(patch) }; save() },

  /** The sample demo tracker. Set localStorage projects_dev_feed_fail to 1 to see the feed down. */
  async demoFeed() {
    await new Promise((r) => setTimeout(r, 400))
    if (localStorage.getItem('projects_dev_feed_fail') === '1') throw new Error('Could not read the demo tracker (dev: feed switched off)')
    return trimRaw(SAMPLE_FEED.equipment, SAMPLE_FEED.upcoming)
  },

  /** Dev only: start again from the sample data. */
  reset() { localStorage.removeItem(KEY); db = load(); save() },
}

export { COLS }
