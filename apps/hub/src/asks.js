// The home page's Asks panel: what's waiting for you in Asks (/asks/), and
// the latest activity on asks you're part of, live. Same queries and rules as
// Asks itself — only asks naming you, or sent to your team — and the same
// "seen" marks (localStorage asks:seen, shared because the whole site is one
// origin), so opening an ask in either place clears its dot in both.
//
// Firestore is imported on demand, like today.js. Resolves the unsubscribe
// function; calls back with null when Asks can't be read (signed-out dev
// builds, rules not published), and the panel hides.
import { activityOf, isMineToDo, isOverdue, sortAsks, todayISO } from '../../asks/src/model.js'

export const ASKS_URL = '/asks/'
export const askUrl = id => `/asks/#/mine?ask=${encodeURIComponent(id)}`

export function readSeen() {
  try { return JSON.parse(localStorage.getItem('asks:seen') || '{}') } catch { return {} }
}

/** What the panel shows, from the asks this person can see. Pure, for the tests. */
export function asksSummary(asks, me, names, seen = {}, now = Date.now()) {
  const today = todayISO(new Date(now))
  const nameOf = uid => names.get(uid) || ''
  const mine = sortAsks(asks.filter(a => isMineToDo(a, me)), today)
  const activity = asks
    .map(a => activityOf(a, me, nameOf, now))
    .filter(Boolean)
    .map(x => ({ ...x, unread: x.atMs > (seen[x.id] || 0) }))
    .sort((a, b) => b.atMs - a.atMs)
  return {
    mine,
    toPick: mine.filter(a => !a.owner).length,
    onIt: mine.filter(a => a.owner === me.uid).length,
    overdue: mine.filter(a => isOverdue(a, today)).length,
    activity,
    unread: activity.filter(x => x.unread).length,
    today,
  }
}

export async function watchMyAsks(user, cb) {
  if (import.meta.env.DEV && !import.meta.env.VITE_FIREBASE_API_KEY) {
    const { SAMPLE_USERS, sampleAsks } = await import('../../asks/src/sample.js')
    const me = { uid: 'u-jess', team: 'Sales', role: 'user' }
    cb({ asks: sampleAsks().asks.filter(a => a.people.includes(me.uid) || a.teams.includes(me.team)), me, names: new Map(SAMPLE_USERS.map(u => [u.uid, u.name])) })
    return () => {}
  }
  let fs, app
  try {
    const [{ getApp }, firestore] = await Promise.all([import('firebase/app'), import('firebase/firestore')])
    app = getApp()
    fs = firestore
  } catch {
    cb(null)
    return () => {}
  }
  const db = fs.getFirestore(app)
  const [profile, usersSnap] = await Promise.all([fs.getDoc(fs.doc(db, 'users', user.uid)), fs.getDocs(fs.collection(db, 'users'))])
  const p = profile.exists() ? profile.data() : {}
  const me = { uid: user.uid, team: p.team || '', role: p.role || 'user' }
  const names = new Map(usersSnap.docs.map(d => [d.id, d.data().displayName || '']))
  const col = fs.collection(db, 'asks')
  const queries = [fs.query(col, fs.where('people', 'array-contains', me.uid))]
  if (me.team) queries.push(fs.query(col, fs.where('teams', 'array-contains', me.team)))
  const parts = queries.map(() => null)
  const unsubs = queries.map((q, i) => fs.onSnapshot(q, snap => {
    parts[i] = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    if (parts.every(Boolean)) cb({ asks: [...new Map(parts.flat().map(a => [a.id, a])).values()], me, names })
  }, err => { console.warn('[hub] asks unavailable', err); cb(null) }))
  return () => unsubs.forEach(u => u())
}
