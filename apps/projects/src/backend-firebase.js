/* Firestore, in the staff schedule's project. Collections:

     projectJobs/{id}          one per job, including archived ones
     projectAssignments/{id}   one per person, job, week and activity
     projectComments/{id}      comments on a job
     projectHistory/{id}       who changed what on a job, and when
     projectPresence/{uid}     who has the tracker open right now
     projectSettings/main      staff, categories, statuses, colours, demo pool

   Security rules for these live with the others in
   rules/firestore.rules at the top of this repo. */

import { onAuthStateChanged, signInWithPopup } from 'firebase/auth'
import { logSignedIn } from '../../../shared/activity.js'
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, getDocs, query, where, runTransaction, writeBatch,
} from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../../schedule/src/firebase.js'
import { ensureProfile } from '../../schedule/src/profile.js'
import { clean } from './backend.js'
import { trimRaw } from './feed.js'
import { readTracker } from '../../admin/src/tracker.js'

const C = {
  jobs: 'projectJobs',
  assignments: 'projectAssignments',
  comments: 'projectComments',
  history: 'projectHistory',
  presence: 'projectPresence',
  settings: 'projectSettings',
}

export default {
  kind: 'firebase',

  watchAuth(cb) {
    return onAuthStateChanged(auth, (u) => cb(u ? { uid: u.uid, name: u.displayName || u.email, email: u.email } : null))
  },
  signIn: () => signInWithPopup(auth, microsoftProvider).then((r) => { logSignedIn(); return r }),

  /** The person's record in the staff schedule: role and team decide who may edit. */
  async profile(uid) {
    // A first sign-in that came straight here: its record (and any team HR set) first
    if (auth.currentUser?.uid === uid) await ensureProfile(auth.currentUser).catch(() => {})
    const s = await getDoc(doc(db, 'users', uid))
    return s.exists() ? s.data() : {}
  },

  /** The staff schedule's people, to match the staff list to (for leave). */
  async scheduleUsers() {
    const snap = await getDocs(collection(db, 'users'))
    return snap.docs.map((d) => { const u = d.data(); return { uid: d.id, displayName: u.displayName || '', email: u.email || '', excelName: u.excelName || '' } })
  },
  /** The staff schedule's weeks starting on these Mondays: who is where each day, so leave shows here. */
  async scheduleWeeks(weeks) {
    const out = []
    // Firestore's `in` takes up to 30 values
    for (let i = 0; i < weeks.length; i += 30) {
      const snap = await getDocs(query(collection(db, 'schedules'), where('weekStart', 'in', weeks.slice(i, i + 30))))
      for (const d of snap.docs) { const x = d.data(); out.push({ uid: x.uid, weekStart: x.weekStart, days: (x.days || []).map((y) => ({ location: y?.location || '' })) }) }
    }
    return out
  },

  watch(col, cb, onError) {
    return onSnapshot(collection(db, C[col]), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError)
  },
  watchSettings(cb, onError) {
    return onSnapshot(doc(db, C.settings, 'main'), (s) => cb(s.exists() ? s.data() : null), onError)
  },

  newId: (col) => doc(collection(db, C[col])).id,
  set: (col, id, data) => setDoc(doc(db, C[col], id), clean(data)),
  update: (col, id, patch) => updateDoc(doc(db, C[col], id), clean(patch)),
  remove: (col, id) => deleteDoc(doc(db, C[col], id)),

  /** Read, change and write one document as a transaction, so two people
      ticking action points at once never undo each other. */
  mutate(col, id, fn) {
    return runTransaction(db, async (t) => {
      const ref = doc(db, C[col], id)
      const s = await t.get(ref)
      if (!s.exists()) throw new Error('That job no longer exists.')
      const patch = fn({ id, ...s.data() })
      if (patch) t.update(ref, clean(patch))
      return patch
    })
  },

  /** ops: [{ op: 'set' | 'update' | 'delete', col, id, data }] — 400 per batch, under Firestore's 500. */
  async batch(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db)
      for (const o of ops.slice(i, i + 400)) {
        const ref = doc(db, C[o.col], o.id)
        if (o.op === 'delete') b.delete(ref)
        else if (o.op === 'update') b.update(ref, clean(o.data))
        else b.set(ref, clean(o.data))
      }
      await b.commit()
    }
  },

  saveSettings: (patch) => setDoc(doc(db, C.settings, 'main'), clean(patch), { merge: true }),

  /** The demo tracker's assets and booked-ahead loans, read-only, trimmed (feed.js). */
  async demoFeed() {
    const [equipment, upcoming] = await Promise.all([readTracker('data/equipment'), readTracker('upcomingLoans')])
    return trimRaw(equipment, upcoming)
  },
}
