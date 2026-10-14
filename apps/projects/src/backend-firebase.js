/* Firestore, in the staff schedule's project. Collections:

     projectJobs/{id}          one per job, including archived ones
     projectAssignments/{id}   one per person, job, week and activity
     projectComments/{id}      comments on a job
     projectHistory/{id}       who changed what on a job, and when
     projectPresence/{uid}     who has the tracker open right now
     projectSettings/main      staff, categories, statuses, colours, demo pool

   Security rules for these live with the others in
   chs-equipment/cmchs-staff-schedule/firestore.rules. */

import { onAuthStateChanged, signInWithPopup } from 'firebase/auth'
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, getDoc, runTransaction, writeBatch,
} from 'firebase/firestore'
import { auth, db, microsoftProvider } from '../../schedule/src/firebase.js'
import { clean } from './backend.js'

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
  signIn: () => signInWithPopup(auth, microsoftProvider),

  /** The person's record in the staff schedule: role and team decide who may edit. */
  async profile(uid) {
    const s = await getDoc(doc(db, 'users', uid))
    return s.exists() ? s.data() : {}
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
}
