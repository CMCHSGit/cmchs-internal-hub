// Reactions, comments and phone notifications for company news (news.js).
//
//   announcements/{id}                 reactions: { <uid>: 'like' | 'love' | … },
//                                      commentCount
//   announcements/{id}/comments/{cid}  uid, name, text, atMs, editedAtMs
//
// Anyone signed in reacts (one reaction each, theirs only) and comments; a
// comment's author edits it; it, the post's author, an admin or HR deletes it.
// firestore.rules enforces that (tests: rules/tests/news-rules.test.mjs).
//
// Notifications go through the proxy (action notifyNews), which reads the
// post or comment back itself before sending anything: a new post ticked
// "Notify everyone" goes to every phone, a pasted email as one push; a
// comment goes to the post's author and everyone else who has commented.
import { PROXY_URL } from '../../../shared/proxy.js'
import { fs } from './news.js'
import { log } from './log.js'

export const REACTIONS = [
  { id: 'like', emoji: '👍', label: 'Like' },
  { id: 'love', emoji: '❤️', label: 'Love' },
  { id: 'celebrate', emoji: '🎉', label: 'Celebrate' },
  { id: 'clap', emoji: '👏', label: 'Well done' },
  { id: 'laugh', emoji: '😂', label: 'Haha' },
  { id: 'wow', emoji: '😮', label: 'Wow' },
]
export const reactionOf = id => REACTIONS.find(r => r.id === id) || null

/** { uid: id } -> { total, mine, top: [{ id, emoji, label, count }] }, most used first. */
export function reactionSummary(reactions = {}, myUid = '') {
  const counts = new Map()
  for (const id of Object.values(reactions || {})) if (reactionOf(id)) counts.set(id, (counts.get(id) || 0) + 1)
  const top = REACTIONS.filter(r => counts.has(r.id)).map(r => ({ ...r, count: counts.get(r.id) }))
    .sort((a, b) => b.count - a.count)
  return { total: top.reduce((n, r) => n + r.count, 0), mine: reactionOf(reactions?.[myUid])?.id || null, top }
}

/** "Just now", "5m", "3h", "2d", then the date. */
export function timeAgo(ms, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000)
  if (s < 60) return 'Just now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`
  return new Date(ms).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })
}

export const initialsOf = name => String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?'

const devMode = import.meta.env?.DEV && !import.meta.env?.VITE_FIREBASE_API_KEY
const local = { comments: new Map(), reactions: new Map(), listeners: new Map() }
if (devMode) {
  local.reactions.set('dev-sample', { a: 'love', b: 'love', c: 'clap', d: 'like', e: 'celebrate' })
  local.comments.set('dev-sample', [
    { id: 'c1', uid: 'a', name: 'Theresa Ngata', text: 'Legs are sore but we keep going 💪', atMs: Date.now() - 3 * 3600e3 },
    { id: 'c2', uid: 'b', name: 'Jack Smith', text: 'Catching up, watch out!', atMs: Date.now() - 20 * 60e3, editedAtMs: Date.now() - 10 * 60e3 },
  ])
}
const ping = id => (local.listeners.get(id) || []).forEach(f => f())

/** The signed-in person as comments need them: { uid, name, admin } (admin or HR may delete any comment). */
export async function loadMe(user) {
  const me = { uid: user.uid, name: user.displayName || user.email || '', admin: false }
  if (devMode) return { ...me, name: me.name || 'You', admin: true }
  try {
    const { f, db } = await fs()
    const s = await f.getDoc(f.doc(db, 'users', user.uid))
    const d = s.exists() ? s.data() : {}
    return { ...me, name: d.displayName || me.name, admin: d.role === 'admin' || d.hr === true }
  } catch { return me }
}

/** Sets (or, with null, takes back) this person's reaction. */
export async function setReaction(postId, uid, id) {
  if (devMode) { const r = { ...(local.reactions.get(postId) || {}) }; if (id) r[uid] = id; else delete r[uid]; local.reactions.set(postId, r); ping(postId); return }
  const { f, db } = await fs()
  await f.updateDoc(f.doc(db, 'announcements', postId), { [`reactions.${uid}`]: id || f.deleteField() })
}

/** The post, live (reactions and comment count change while it's open). cb(null) if it's gone. */
export async function watchPost(postId, cb) {
  if (devMode) {
    const send = () => cb({ reactions: local.reactions.get(postId) || {}, commentCount: (local.comments.get(postId) || []).length })
    local.listeners.set(postId, [...(local.listeners.get(postId) || []), send]); send()
    return () => local.listeners.set(postId, (local.listeners.get(postId) || []).filter(x => x !== send))
  }
  const { f, db } = await fs()
  return f.onSnapshot(f.doc(db, 'announcements', postId), s => cb(s.exists() ? { id: s.id, ...s.data() } : null), () => cb(undefined))
}

/** The comments, oldest first, live. */
export async function watchComments(postId, cb) {
  if (devMode) {
    const send = () => cb([...(local.comments.get(postId) || [])])
    local.listeners.set(postId, [...(local.listeners.get(postId) || []), send]); send()
    return () => local.listeners.set(postId, (local.listeners.get(postId) || []).filter(x => x !== send))
  }
  const { f, db } = await fs()
  const q = f.query(f.collection(db, 'announcements', postId, 'comments'), f.orderBy('atMs'))
  return f.onSnapshot(q, s => cb(s.docs.map(d => ({ id: d.id, ...d.data() }))), () => cb([]))
}

export async function addComment(postId, me, text) {
  const body = String(text || '').trim().slice(0, 2000)
  if (!body) return
  const c = { uid: me.uid, name: me.name || '', text: body, atMs: Date.now() }
  if (devMode) { local.comments.set(postId, [...(local.comments.get(postId) || []), { id: String(c.atMs), ...c }]); ping(postId); return }
  const { f, db } = await fs()
  const ref = f.doc(f.collection(db, 'announcements', postId, 'comments'))
  const b = f.writeBatch(db)
  b.set(ref, c)
  b.update(f.doc(db, 'announcements', postId), { commentCount: f.increment(1) })
  await b.commit()
  log('Commented on a news post')
  notifyNews({ id: postId, cid: ref.id })
}

export async function editComment(postId, cid, text) {
  const body = String(text || '').trim().slice(0, 2000)
  if (!body) return
  if (devMode) { local.comments.set(postId, (local.comments.get(postId) || []).map(c => (c.id === cid ? { ...c, text: body, editedAtMs: Date.now() } : c))); ping(postId); return }
  const { f, db } = await fs()
  await f.updateDoc(f.doc(db, 'announcements', postId, 'comments', cid), { text: body, editedAtMs: Date.now() })
}

export async function deleteComment(postId, cid) {
  if (devMode) { local.comments.set(postId, (local.comments.get(postId) || []).filter(c => c.id !== cid)); ping(postId); return }
  const { f, db } = await fs()
  const b = f.writeBatch(db)
  b.delete(f.doc(db, 'announcements', postId, 'comments', cid))
  b.update(f.doc(db, 'announcements', postId), { commentCount: f.increment(-1) })
  await b.commit()
  log('Deleted a comment on a news post')
}

/**
 * Asks the proxy to tell people: { id } for a new post, { id, cid } for a
 * comment. It checks the post or comment is the caller's and new, so it
 * never sends anything the caller didn't just do. Never throws.
 */
export async function notifyNews(payload) {
  if (devMode) return
  try {
    const { getAuth } = await import('firebase/auth')
    const idToken = await getAuth().currentUser?.getIdToken()
    if (!idToken) return
    await fetch(PROXY_URL, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'notifyNews', idToken, ...payload }) })
  } catch (e) { console.warn('[news] notify failed', e) }
}
