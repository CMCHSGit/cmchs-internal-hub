// Tool requests and feedback, sent from Manage to the engineering team.
//
//   hubRequests/{id}  kind: 'tool' | 'feedback'
//     tool:     title, details, who (who'd use it), urgency, votes: [uid]
//     feedback: tool (a tools.json id, or 'hub'), rating 1-5, good, change
//     both:     uid, name, createdAt, status, response, respondedBy
//
// Tool requests are visible to everyone, who can +1 them; feedback only to
// its author and the engineering team (Engineers, plus admins). The team
// sets the status and replies. A new one sends the team a push through the
// Simpro proxy (action notifyHubRequest), which checks the request is real
// before sending anything. firestore.rules enforces who sees and changes what.

export const STATUSES = [
  { id: 'new', label: 'New', tone: 'purple' },
  { id: 'reviewing', label: 'Under review', tone: 'orange' },
  { id: 'planned', label: 'Planned', tone: 'green' },
  { id: 'built', label: 'Built', tone: 'green-solid' },
  { id: 'declined', label: 'Not now', tone: 'grey' },
]
export const URGENCY = ['Nice to have', 'Would save real time', 'Blocking my work']
export const statusOf = id => STATUSES.find(s => s.id === id) || STATUSES[0]

export const isEngineering = me => !!me && (me.role === 'admin' || me.team === 'Engineers')

import { PROXY_URL } from '../../../shared/proxy.js'
import { log } from './log.js'

/** Average rating and count per tool, best-rated last so problems come first. */
export function feedbackSummary(items) {
  const by = new Map()
  for (const f of items) {
    if (f.kind !== 'feedback' || !(f.rating >= 1)) continue
    const s = by.get(f.tool) || { tool: f.tool, count: 0, total: 0 }
    s.count++
    s.total += f.rating
    by.set(f.tool, s)
  }
  return [...by.values()].map(s => ({ ...s, average: Math.round((s.total / s.count) * 10) / 10 }))
    .sort((a, b) => a.average - b.average || b.count - a.count)
}

/** Most +1s first, then newest; finished ones (built, not now) last. */
export function sortRequests(list) {
  const done = r => (['built', 'declined'].includes(r.status) ? 1 : 0)
  return [...list].sort((a, b) => done(a) - done(b) || (b.votes?.length || 0) - (a.votes?.length || 0) || (b.createdMs || 0) - (a.createdMs || 0))
}

// ── Backend ───────────────────────────────────────────────────────────────

const devMode = import.meta.env?.DEV && !import.meta.env?.VITE_FIREBASE_API_KEY
const local = new Map()
let fsPromise = null
async function fs() {
  if (!fsPromise) {
    fsPromise = Promise.all([import('firebase/app'), import('firebase/firestore'), import('../../../shared/firestore.js')]).then(([{ getApp }, f, s]) => ({ f, db: s.firestore(getApp()) }))
  }
  return fsPromise
}
const withMs = d => ({ id: d.id, ...d.data(), createdMs: d.data().createdAt?.toMillis?.() || Date.now() })

/**
 * What this person may see: every tool request, plus feedback (their own, or
 * everyone's for the engineering team). Two queries for non-engineers,
 * because Firestore only allows a query its rules can prove is all readable.
 */
export async function loadRequests(me) {
  if (devMode) return sortRequests([...local.values()])
  const { f, db } = await fs()
  const col = f.collection(db, 'hubRequests')
  if (isEngineering(me)) return sortRequests((await f.getDocs(col)).docs.map(withMs))
  const [tools, mine] = await Promise.all([
    f.getDocs(f.query(col, f.where('kind', '==', 'tool'))),
    f.getDocs(f.query(col, f.where('uid', '==', me.uid))),
  ])
  const all = new Map([...tools.docs, ...mine.docs].map(d => [d.id, withMs(d)]))
  return sortRequests([...all.values()])
}

const clean = (v, max) => String(v ?? '').trim().slice(0, max)

export async function sendRequest(user, input) {
  const base = { uid: user.uid, name: user.displayName || user.email || '', status: 'new', response: '' }
  let data
  if (input.kind === 'tool') {
    data = { ...base, kind: 'tool', title: clean(input.title, 120), details: clean(input.details, 3000), who: clean(input.who, 300),
      urgency: URGENCY.includes(input.urgency) ? input.urgency : URGENCY[0], votes: [user.uid] }
    if (!data.title) throw new Error('Give the tool a name or a one-line summary.')
    if (!data.details) throw new Error('Say what it should do.')
  } else {
    const rating = Number(input.rating)
    data = { ...base, kind: 'feedback', tool: clean(input.tool, 60) || 'hub', rating: rating >= 1 && rating <= 5 ? rating : 0,
      good: clean(input.good, 2000), change: clean(input.change, 2000) }
    if (!data.rating) throw new Error('Pick a rating out of five.')
  }
  if (devMode) { const id = Math.random().toString(36).slice(2); local.set(id, { id, ...data, createdMs: Date.now() }); return id }
  const { f, db } = await fs()
  const ref = await f.addDoc(f.collection(db, 'hubRequests'), { ...data, createdAt: f.serverTimestamp() })
  notify(ref.id) // fire and forget: the request is saved either way
  log(data.kind === 'tool' ? `Asked for a new tool: ${data.title}` : `Sent feedback on ${data.tool}`)
  return ref.id
}

/** Asks the proxy to push the engineering team about a new request. It re-reads the request itself. */
async function notify(id) {
  try {
    const { getAuth } = await import('firebase/auth')
    const idToken = await getAuth().currentUser?.getIdToken()
    if (!idToken) return
    await fetch(PROXY_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'notifyHubRequest', idToken, id }) })
  } catch (e) {
    console.warn('Could not notify the engineering team:', e)
  }
}

export async function toggleVote(user, r) {
  const on = !(r.votes || []).includes(user.uid)
  if (devMode) { const x = local.get(r.id); x.votes = on ? [...(x.votes || []), user.uid] : x.votes.filter(v => v !== user.uid); return x.votes }
  const { f, db } = await fs()
  await f.updateDoc(f.doc(db, 'hubRequests', r.id), { votes: on ? f.arrayUnion(user.uid) : f.arrayRemove(user.uid) })
  return on ? [...(r.votes || []), user.uid] : (r.votes || []).filter(v => v !== user.uid)
}

/** Engineering team: status and reply. */
export async function respond(user, r, { status, response }) {
  const data = { status: statusOf(status).id, response: clean(response, 2000), respondedBy: user.displayName || user.email || '' }
  if (devMode) { Object.assign(local.get(r.id), data); return data }
  const { f, db } = await fs()
  await f.updateDoc(f.doc(db, 'hubRequests', r.id), { ...data, updatedAt: f.serverTimestamp() })
  log(`Replied to a ${r.kind === 'tool' ? 'tool request' : 'feedback'} and set it to "${statusOf(status).label}"`)
  return data
}

export async function deleteRequest(r) {
  if (devMode) { local.delete(r.id); return }
  const { f, db } = await fs()
  await f.deleteDoc(f.doc(db, 'hubRequests', r.id))
  log(`Deleted a ${r.kind === 'tool' ? 'tool request' : 'feedback entry'}`)
}
