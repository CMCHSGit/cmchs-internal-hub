/* The knowledge base's data: Firestore collections kbArticles, kbParts, kbDevices and kbJobs (rules/firestore.rules,
   apps/knowledge/src/model.js says what each holds). Each kind is one live listener, started when its screen first needs it;
   the device copy (shared/firestore.js) means an open after the first only downloads what changed, so a long device list
   costs little to open again. With no database (`npm run dev` without a .env) a small made-up set runs in memory.

   Every change logs one line to the activity log, in words and counts, never the content. */
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { auth, db } from '../../schedule/src/firebase.js'
import { logActivity } from '../../../shared/activity.js'
import { buildRecord, KINDS, recordId } from './model.js'
import { sampleRecords } from './sample.js'

const CHUNK = 400 // a batch holds 500 writes
const ONE = { article: 'an article', part: 'a part', device: 'a device', job: 'a past job' }
const MANY = { article: 'articles', part: 'parts', device: 'devices', job: 'past jobs' }

const local = { article: null, part: null, device: null, job: null }
const listeners = { article: new Set(), part: new Set(), device: new Set(), job: new Set() }
const seed = (kind) => (local[kind] ||= sampleRecords(kind))
const tell = (kind) => listeners[kind].forEach((cb) => cb([...local[kind]]))
const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 20) : String(Date.now()) + Math.random().toString(36).slice(2, 8))

/** Live records of a kind: cb gets the whole list now (from the device copy if there is one) and on every change. Returns the stop function. */
export function watch(kind, cb, onError) {
  if (!db) {
    listeners[kind].add(cb)
    seed(kind)
    queueMicrotask(() => cb([...local[kind]]))
    return () => listeners[kind].delete(cb)
  }
  return onSnapshot(collection(db, KINDS[kind].col), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), onError)
}

const stamp = (by) => ({ updatedBy: auth?.currentUser?.uid || 'local', updatedByName: String(by || '').slice(0, 120), updatedAt: serverTimestamp() })

/** Adds or changes one record (id given: that one). Returns its id. */
export async function saveRecord(kind, id, input, by) {
  const rec = buildRecord(kind, input)
  const key = id || recordId(kind, rec) || newId()
  if (!db) {
    const at = Date.now()
    local[kind] = [...seed(kind).filter((r) => r.id !== key), { id: key, ...rec, updatedByName: by, updatedAt: { toMillis: () => at } }]
    tell(kind)
  } else {
    await setDoc(doc(db, KINDS[kind].col, key), { ...rec, ...stamp(by) })
  }
  logActivity(null, `${id ? 'Changed' : 'Added'} ${ONE[kind]} in the knowledge base`, { app: 'knowledge' })
  return key
}

export async function removeRecord(kind, id) {
  if (!db) { local[kind] = seed(kind).filter((r) => r.id !== id); tell(kind) } else await deleteDoc(doc(db, KINDS[kind].col, id))
  logActivity(null, `Removed ${ONE[kind]} from the knowledge base`, { app: 'knowledge' })
}

/** Writes a whole imported list (records from rowsToRecords). The same part, job or device again replaces itself. Returns how many were written. */
export async function importRecords(kind, records, by) {
  if (!records.length) return 0
  if (!db) {
    for (const r of records) await saveRecord(kind, recordId(kind, r), r, by)
    return records.length
  }
  const s = stamp(by)
  for (let i = 0; i < records.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const r of records.slice(i, i + CHUNK)) batch.set(doc(db, KINDS[kind].col, recordId(kind, r) || newId()), { ...r, ...s })
    await batch.commit()
  }
  logActivity(null, `Imported ${records.length} ${records.length === 1 ? ONE[kind].replace(/^an? /, '') : MANY[kind]} into the knowledge base`, { app: 'knowledge' })
  return records.length
}
