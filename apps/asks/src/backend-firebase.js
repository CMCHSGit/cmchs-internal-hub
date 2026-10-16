/* Firestore, in the staff schedule's project.

     asks/{id}                 one per ask (model.js lists the fields)
     asks/{id}/comments/{id}   the conversation on it
     asks/{id}/photos/{id}     photos, one compressed JPEG each (photos.js)
     askStats/{id}             the counting fields only, for the Company page

   Security rules for these live with the others in
   chs-equipment/cmchs-staff-schedule/firestore.rules (canSeeAsk). They let
   people see only the asks they're involved in, so this asks only for those:
   Firestore refuses a query its rules can't prove is all readable.

   Notifications: after a change that should tell someone, the browser hands
   the ask's id to the Simpro proxy (action notifyAsk), which reads the ask
   back, checks the change is the caller's and new, and sends the pushes (and
   emails, for people without push) itself. */

import { onAuthStateChanged, signInWithPopup } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, onSnapshot, query, where, runTransaction, writeBatch } from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../../schedule/src/firebase.js'
import { canUsePush, needsHomeScreenInstall, pushEnabledOnThisDevice, enablePush, onForegroundMessage } from '../../schedule/src/utils/push.js'
import { clean } from './backend.js'
import { statsOf } from './model.js'

const PROXY_URL = 'https://script.google.com/macros/s/AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw/exec'
const OUTSTANDING = ['open', 'picked', 'waiting']

const withId = (d) => ({ id: d.id, ...d.data() })

/** Several live queries as one list: cb fires once all have answered, then on every change. */
function watchMerged(queries, cb, onError) {
  const parts = queries.map(() => null)
  const unsubs = queries.map((q, i) => onSnapshot(q, (snap) => {
    parts[i] = snap.docs.map(withId)
    if (parts.every(Boolean)) cb([...new Map(parts.flat().map((x) => [x.id, x])).values()])
  }, onError))
  return () => unsubs.forEach((u) => u())
}

export default {
  kind: 'firebase',

  watchAuth(cb) {
    return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, name: u.displayName || u.email, email: u.email } : null))
  },
  signIn: () => signInWithPopup(auth, microsoftProvider),

  /** The person's record in the staff schedule: role and team decide what they see. */
  async profile(uid) {
    const s = await getDoc(doc(db, 'users', uid))
    return s.exists() ? s.data() : {}
  },

  /** Everyone who can be sent an ask: signed in at least once (placeholders can't see anything). */
  watchUsers(cb, onError) {
    return onSnapshot(collection(db, 'users'), (snap) => cb(snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => !u.pending)
      .map((u) => ({ uid: u.uid, name: u.displayName || u.email || 'Someone', team: u.team || '', role: u.role || 'user', hasPush: (u.fcmTokens || []).length > 0 }))), onError)
  },

  /** Admins see every ask; everyone else the ones naming them, plus their team's. */
  watchAsks(me, cb, onError) {
    const col = collection(db, 'asks')
    const qs = me.role === 'admin'
      ? [col]
      : [query(col, where('people', 'array-contains', me.uid)), ...(me.team ? [query(col, where('teams', 'array-contains', me.team))] : [])]
    return watchMerged(qs, cb, onError)
  },

  /** Every outstanding ask's counts, plus those finished in the last 8 days. */
  watchStats(cb, onError) {
    const col = collection(db, 'askStats')
    return watchMerged([
      query(col, where('status', 'in', OUTSTANDING)),
      query(col, where('doneAtMs', '>=', Date.now() - 8 * 86400000)),
    ], cb, onError)
  },

  /** One ask's comments and photos, live while it's open. */
  watchThread(id, cb, onError) {
    const got = { comments: null, photos: null }
    const fire = () => { if (got.comments && got.photos) cb({ ...got }) }
    const a = onSnapshot(collection(db, 'asks', id, 'comments'), (s) => { got.comments = s.docs.map(withId); fire() }, onError)
    const b = onSnapshot(collection(db, 'asks', id, 'photos'), (s) => { got.photos = s.docs.map(withId); fire() }, onError)
    return () => { a(); b() }
  },

  newId: (path = 'asks') => doc(collection(db, path)).id,

  /** A new ask, its counts and its photos, all or nothing. */
  async create(id, ask, photos = []) {
    const b = writeBatch(db)
    b.set(doc(db, 'asks', id), clean(ask))
    b.set(doc(db, 'askStats', id), statsOf(ask))
    for (const p of photos) b.set(doc(db, 'asks', id, 'photos', p.id), clean(p.data))
    await b.commit()
  },

  /**
   * Read the ask, change it and write it back as one transaction, so two
   * people pressing "I'll take it" at once can't both get it: the second
   * one's fn sees the first one's owner and refuses. fn returns
   * { patch, writes: [{ path: ['asks', id, 'comments', cid], data }] } or null.
   */
  mutate(id, fn) {
    return runTransaction(db, async (t) => {
      const ref = doc(db, 'asks', id)
      const s = await t.get(ref)
      if (!s.exists()) throw new Error('That ask has been deleted.')
      const res = fn({ id, ...s.data() })
      if (!res) return null
      const next = { ...s.data(), ...res.patch }
      t.update(ref, clean(res.patch))
      t.set(doc(db, 'askStats', id), statsOf(next))
      for (const w of res.writes || []) t.set(doc(db, ...w.path), clean(w.data))
      return next
    })
  },

  /** The ask, its comments, photos and counts. */
  async remove(id) {
    const [c, p] = await Promise.all([getDocs(collection(db, 'asks', id, 'comments')), getDocs(collection(db, 'asks', id, 'photos'))])
    const refs = [...c.docs, ...p.docs].map((d) => d.ref)
    for (let i = 0; i < refs.length; i += 400) {
      const b = writeBatch(db)
      refs.slice(i, i + 400).forEach((r) => b.delete(r))
      await b.commit()
    }
    const b = writeBatch(db)
    b.delete(doc(db, 'askStats', id))
    b.delete(doc(db, 'asks', id))
    await b.commit()
  },

  async removeComment(askId, comment) {
    const b = writeBatch(db)
    b.delete(doc(db, 'asks', askId, 'comments', comment.id))
    for (const pid of comment.photoIds || []) b.delete(doc(db, 'asks', askId, 'photos', pid))
    await b.commit()
  },

  /**
   * Ask the proxy to tell the people the ask's latest event concerns, and say
   * how it went: { success, people, pushed, emailed, unreached, error }. Never
   * throws — the change is saved either way.
   */
  async notify(id) {
    try {
      const idToken = await auth.currentUser?.getIdToken()
      if (!idToken) return { success: false, error: 'Not signed in' }
      // text/plain keeps it a simple request (no CORS preflight, which Apps
      // Script can't answer); its reply comes back readable after the redirect.
      const res = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'notifyAsk', idToken, id }) })
      return await res.json()
    } catch (e) {
      console.warn('Could not send the notification:', e)
      return { success: false, error: 'Could not reach the notification service' }
    }
  },

  push: {
    supported: canUsePush,
    needsInstall: needsHomeScreenInstall,
    enabledHere: pushEnabledOnThisDevice,
    enable: enablePush,
    // The browser shows no notification for a tab that has focus; this hears it instead.
    onForeground: onForegroundMessage,
  },
}
