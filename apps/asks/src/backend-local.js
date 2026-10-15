/* `npm run dev` only: the same calls as backend-firebase.js, kept in
   localStorage and shared between tabs with a BroadcastChannel. Never part of
   a real build (backend.js picks Firestore whenever the config is present).
   The people are made up. ?as=mike (or jess, sam, lee) in the address makes
   this tab that person; without it you're Aroha, an admin. */

import { clean } from './backend.js'
import { statsOf } from './model.js'
import { SAMPLE_USERS, sampleAsks } from './sample.js'

const KEY = 'asks_dev_db'
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('asks_dev') : null

function seed() {
  const { asks, comments } = sampleAsks()
  return {
    asks: Object.fromEntries(asks.map((a) => [a.id, a])),
    comments: Object.fromEntries(comments.map((c) => [c.id, c])),
    photos: {},
  }
}
function load() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* fall through to a fresh copy */ }
  const fresh = seed()
  localStorage.setItem(KEY, JSON.stringify(fresh))
  return fresh
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

const as = new URLSearchParams(location.search).get('as') || 'aroha'
const ME = SAMPLE_USERS.find((u) => u.name.toLowerCase().startsWith(as.toLowerCase())) || SAMPLE_USERS[0]
const later = (fn) => Promise.resolve().then(fn)
const sub = (fire) => { listeners.add(fire); later(fire); return () => listeners.delete(fire) }
const canSee = (a) => ME.role === 'admin' || a.people.includes(ME.uid) || (ME.team && a.teams.includes(ME.team))

export default {
  kind: 'local',
  watchAuth(cb) { later(() => cb({ uid: ME.uid, name: ME.name, email: 'dev.user@example.com' })); return () => {} },
  signIn: async () => {},
  profile: async () => ({ displayName: ME.name, role: ME.role, team: ME.team }),

  watchUsers(cb) { return sub(() => cb(SAMPLE_USERS.map((u) => ({ ...u })))) },
  watchAsks(_me, cb) { return sub(() => cb(Object.entries(db.asks).map(([id, a]) => ({ ...a, id })).filter(canSee))) },
  watchStats(cb) { return sub(() => cb(Object.entries(db.asks).map(([id, a]) => ({ id, ...statsOf(a) })))) },
  watchThread(id, cb) {
    return sub(() => cb({
      comments: Object.values(db.comments).filter((c) => c.askId === id),
      photos: Object.values(db.photos).filter((p) => p.askId === id),
    }))
  },

  newId: () => Math.random().toString(36).slice(2, 12),
  async create(id, ask, photos = []) {
    db.asks[id] = clean(ask)
    for (const p of photos) db.photos[p.id] = { ...clean(p.data), id: p.id, askId: id }
    save()
  },
  async mutate(id, fn) {
    await new Promise((r) => setTimeout(r, 150))
    const cur = db.asks[id]
    if (!cur) throw new Error('That ask has been deleted.')
    const res = fn({ ...cur, id })
    if (!res) return null
    db.asks[id] = { ...cur, ...clean(res.patch) }
    for (const w of res.writes || []) {
      const [, , sub, wid] = w.path
      db[sub][wid] = { ...clean(w.data), id: wid, askId: id }
    }
    save()
    return db.asks[id]
  },
  async remove(id) {
    delete db.asks[id]
    for (const k of ['comments', 'photos']) for (const [x, v] of Object.entries(db[k])) if (v.askId === id) delete db[k][x]
    save()
  },
  async removeComment(_askId, comment) {
    delete db.comments[comment.id]
    for (const pid of comment.photoIds || []) delete db.photos[pid]
    save()
  },
  async notify(id) {
    const e = db.asks[id]?.event
    if (e) console.info(`[dev] would notify: ${e.type} on ${id}`)
  },

  push: {
    supported: () => true,
    needsInstall: () => false,
    enabledHere: () => localStorage.getItem('asks_dev_push') === '1',
    async enable() { localStorage.setItem('asks_dev_push', '1') },
  },

  /** Dev only: start again from the sample data. */
  reset() { localStorage.removeItem(KEY); db = load(); save() },
}
