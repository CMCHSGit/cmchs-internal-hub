/* Firestore, in the staff schedule's project.

     asks/{id}                 one per ask (model.js lists the fields)
     asks/{id}/comments/{id}   the conversation on it
     asks/{id}/photos/{id}     photos, one compressed JPEG each (photos.js)
     asks/{id}/files/{id}      files (a PDF, a quote), their parts below (files.js)
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
import { ensureProfile } from '../../schedule/src/profile.js'
import { canUsePush, needsHomeScreenInstall, pushEnabledOnThisDevice, enablePush, onForegroundMessage } from '../../schedule/src/utils/push.js'
import { clean } from './backend.js'
import { statsOf } from './model.js'

import { PROXY_URL } from '../../../shared/proxy.js'
import { logSignedIn } from '../../../shared/activity.js'
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

/** Each file's parts, then the file: deleted in that order. */
const fileRefs = (askId, files) => [
  ...files.flatMap((f) => Array.from({ length: f.parts || 0 }, (_, i) => doc(db, 'asks', askId, 'files', f.id, 'parts', String(i)))),
  ...files.map((f) => doc(db, 'asks', askId, 'files', f.id)),
]

export default {
  kind: 'firebase',

  watchAuth(cb) {
    return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, name: u.displayName || u.email, email: u.email } : null))
  },
  signIn: () => signInWithPopup(auth, microsoftProvider).then((r) => { logSignedIn(); return r }),

  /** The person's record in the staff schedule: role and team decide what they see. */
  async profile(uid) {
    // A first sign-in that came straight here: its record (and any team HR set) first
    if (auth.currentUser?.uid === uid) await ensureProfile(auth.currentUser).catch(() => {})
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

  /** The asks naming this person, plus those sent to their whole team. Admins too: nobody sees every ask. */
  watchAsks(me, cb, onError) {
    const col = collection(db, 'asks')
    const qs = [query(col, where('people', 'array-contains', me.uid)), ...(me.team ? [query(col, where('teams', 'array-contains', me.team))] : [])]
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

  /** One ask's comments, photos and files (not their contents), live while it's open. */
  watchThread(id, cb, onError) {
    const got = { comments: null, photos: null, files: null }
    const fire = () => { if (got.comments && got.photos && got.files) cb({ ...got }) }
    const a = onSnapshot(collection(db, 'asks', id, 'comments'), (s) => { got.comments = s.docs.map(withId); fire() }, onError)
    const b = onSnapshot(collection(db, 'asks', id, 'photos'), (s) => { got.photos = s.docs.map(withId); fire() }, onError)
    const c = onSnapshot(collection(db, 'asks', id, 'files'), (s) => { got.files = s.docs.map(withId); fire() }, onError)
    return () => { a(); b(); c() }
  },

  /** A file and its parts, all or nothing. f: { id, meta, parts }. Up to 7 MB, inside a batch's 10 MB. */
  async addFile(askId, f) {
    const b = writeBatch(db)
    b.set(doc(db, 'asks', askId, 'files', f.id), clean(f.meta))
    f.parts.forEach((data, i) => b.set(doc(db, 'asks', askId, 'files', f.id, 'parts', String(i)), { data }))
    await b.commit()
  },

  /** A file's contents, as the base64 parts in order. */
  async fileParts(askId, file) {
    const s = await getDocs(collection(db, 'asks', askId, 'files', file.id, 'parts'))
    if (s.size < file.parts) throw new Error('This file hasn’t finished uploading yet.')
    return s.docs.sort((x, y) => Number(x.id) - Number(y.id)).map((d) => d.data().data)
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

  /** The ask, its comments, photos, files and counts. A file's parts go before it: their rule reads it. */
  async remove(id) {
    const [c, p, f] = await Promise.all(['comments', 'photos', 'files'].map((k) => getDocs(collection(db, 'asks', id, k))))
    const refs = [...fileRefs(id, f.docs.map(withId)), ...c.docs.map((d) => d.ref), ...p.docs.map((d) => d.ref)]
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

  /** A comment with its photos and files (files: those whose commentId is this comment's). */
  async removeComment(askId, comment, files = []) {
    const b = writeBatch(db)
    for (const r of fileRefs(askId, files)) b.delete(r)
    b.delete(doc(db, 'asks', askId, 'comments', comment.id))
    for (const pid of comment.photoIds || []) b.delete(doc(db, 'asks', askId, 'photos', pid))
    await b.commit()
  },

  /** Files whose comment didn't save. */
  async removeFiles(askId, files) {
    const b = writeBatch(db)
    for (const r of fileRefs(askId, files)) b.delete(r)
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
