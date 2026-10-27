/* Project checklists — the data, in Firestore (rules/firestore.rules, `checklists`).

   A list is one document: checklists/{listId} { name, total, createdAt, createdBy, createdByName,
   importedAt, importedByName }. Its devices are checklists/{listId}/items/{deviceId}: what the
   spreadsheet said about the device (type, serial, status, department, location, version ...) and,
   kept apart so a re-import never touches it, what people did on site: result ('' | 'done' |
   'notfound'), doneBy, doneByName, doneAt and note.

   A document a device, so five people ticking at once never write the same document, and each
   screen sees the others' ticks as they happen. Firestore here keeps a copy on the device
   (shared/firestore.js), so a tick made in a dead spot is kept and sent when the signal is back. */
import {
  collection, doc, onSnapshot, setDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../schedule/src/firebase.js'

export const COL = 'checklists'
const CHUNK = 400 // a batch holds 500 writes

const DONE_FIELDS = (by) => ({ doneBy: by.uid, doneByName: by.name })
const UNDONE = { result: '', doneBy: '', doneByName: '', doneAt: null }
const BLANK_PROGRESS = { ...UNDONE, note: '', noteByName: '' }

const strip = ({ id: _id, ...fields }) => fields

// ── Firestore ──────────────────────────────────────────────────────────────────────────────────────

async function writeDevices(listId, devices, existing) {
  for (let i = 0; i < devices.length; i += CHUNK) {
    const batch = writeBatch(db)
    for (const d of devices.slice(i, i + CHUNK)) {
      const ref = doc(db, COL, listId, 'items', d.id)
      // A device already on the list gets what the new file says about it and keeps its ticks and note.
      if (existing.has(d.id)) batch.set(ref, strip(d), { merge: true })
      else batch.set(ref, { ...strip(d), ...BLANK_PROGRESS, addedAt: serverTimestamp() })
    }
    await batch.commit()
  }
}

const real = {
  /** cb(lists) for every list, newest first; returns the unsubscribe. */
  watchLists(cb, onError) {
    return onSnapshot(collection(db, COL), (snap) => {
      const lists = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      const at = (l) => l.createdAt?.toMillis?.() ?? Date.now()
      cb(lists.sort((a, b) => at(b) - at(a)))
    }, onError)
  },

  /** cb(items, { pending, fromCache }): `pending` is how many ticks are waiting to reach the server. */
  watchItems(listId, cb, onError) {
    return onSnapshot(collection(db, COL, listId, 'items'), (snap) => {
      cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })), {
        pending: snap.docs.filter((d) => d.metadata.hasPendingWrites).length,
        fromCache: snap.metadata.fromCache,
      })
    }, onError)
  },

  async createList({ name, devices, by }) {
    const ref = doc(collection(db, COL))
    await setDoc(ref, {
      name, total: devices.length, createdAt: serverTimestamp(), createdBy: by.uid, createdByName: by.name,
      importedAt: serverTimestamp(), importedByName: by.name,
    })
    await writeDevices(ref.id, devices, new Set())
    return ref.id
  },

  /** Adds the devices that are new and refreshes the ones already there. Returns { added, updated }. */
  async importInto(listId, devices, existingIds, by) {
    const existing = new Set(existingIds)
    await writeDevices(listId, devices, existing)
    const added = devices.filter((d) => !existing.has(d.id)).length
    await updateDoc(doc(db, COL, listId), { total: existing.size + added, importedAt: serverTimestamp(), importedByName: by.name })
    return { added, updated: devices.length - added }
  },

  setResult(listId, itemId, result, by) {
    const ref = doc(db, COL, listId, 'items', itemId)
    return updateDoc(ref, result ? { result, ...DONE_FIELDS(by), doneAt: serverTimestamp() } : UNDONE)
  },

  setNote(listId, itemId, note, by) {
    return updateDoc(doc(db, COL, listId, 'items', itemId), { note, noteByName: note ? by.name : '' })
  },

  removeItem(listId, itemId) {
    return deleteDoc(doc(db, COL, listId, 'items', itemId))
  },

  async removeList(listId, itemIds) {
    for (let i = 0; i < itemIds.length; i += CHUNK) {
      const batch = writeBatch(db)
      for (const id of itemIds.slice(i, i + CHUNK)) batch.delete(doc(db, COL, listId, 'items', id))
      await batch.commit()
    }
    await deleteDoc(doc(db, COL, listId))
  },

  renameList(listId, name) {
    return updateDoc(doc(db, COL, listId), { name })
  },
}

// ── `npm run dev` without a .env: no Firestore, so a made-up list kept in this tab ───────────────────
// (A real build always has the database; this drops out of it.)

function devStore() {
  const lists = new Map()
  const items = new Map() // listId -> Map(id -> item)
  const subs = new Set()
  const tell = () => subs.forEach((f) => f())
  const watch = (read, cb) => { const f = () => cb(read()); subs.add(f); queueMicrotask(f); return () => subs.delete(f) }
  const now = () => ({ toMillis: () => Date.now(), toDate: () => new Date() })

  const sample = [
    ['TTHSU', 'Working'], ['TTHSU', 'Offline'], ['EDN', 'Standby'], ['EDN', 'Working'], ['NADU', 'Shutdown'],
    ['Theatre', 'Working'], ['PACU', 'Offline'], ['SCBU', 'Working'], ['CCU', 'Working'], ['', 'Offline'],
  ]
  const seed = new Map()
  sample.forEach(([department, status], i) => {
    const id = '00-0F-14-04-9B-00-00-' + String(i).padStart(2, '0')
    seed.set(id, {
      id, deviceId: id, category: 'Transport Monitor', model: 'BeneVision N1', serial: 'AA3-4108' + String(4000 + i), name: 'N1-WHA30' + (4500 + i),
      status, statusSince: status === 'Working' ? '' : '2026-10-27 11:43', location: department ? department + ' Bed ' + (i + 1) : 'Transit 7', facility: 'NSH',
      department: department || 'Transit', deptGuessed: !department, version: i % 4 ? '02.41.00.01' : '02.39.00.01', lastSeenAt: '2026-10-27 09:15', ip: '10.100.176.' + (140 + i),
      wirelessMac: '00:17:23:98:5A:0' + (i % 10), wiredMac: '00:0F:14:3A:79:7' + (i % 10), ...BLANK_PROGRESS,
    })
  })
  lists.set('sample', { id: 'sample', name: 'Sample N1 list (not saved)', total: seed.size, createdAt: now(), createdByName: 'Dev User', importedByName: 'Dev User' })
  items.set('sample', seed)

  return {
    watchLists: (cb) => watch(() => [...lists.values()], cb),
    watchItems: (listId, cb) => watch(() => [...(items.get(listId)?.values() || [])].map((x) => ({ ...x })), (arr) => cb(arr, { pending: 0, fromCache: false })),
    async createList({ name, devices, by }) {
      const id = 'dev' + Date.now()
      lists.set(id, { id, name, total: devices.length, createdAt: now(), createdByName: by.name, importedByName: by.name })
      items.set(id, new Map(devices.map((d) => [d.id, { ...d, ...BLANK_PROGRESS }])))
      tell(); return id
    },
    async importInto(listId, devices, existingIds, by) {
      const map = items.get(listId); let added = 0
      for (const d of devices) {
        if (map.has(d.id)) Object.assign(map.get(d.id), strip(d)); else { map.set(d.id, { ...d, ...BLANK_PROGRESS }); added++ }
      }
      Object.assign(lists.get(listId), { total: map.size, importedByName: by.name }); tell()
      return { added, updated: devices.length - added }
    },
    async setResult(listId, itemId, result, by) {
      Object.assign(items.get(listId).get(itemId), result ? { result, ...DONE_FIELDS(by), doneAt: now() } : UNDONE); tell()
    },
    async setNote(listId, itemId, note, by) { Object.assign(items.get(listId).get(itemId), { note, noteByName: note ? by.name : '' }); tell() },
    async removeItem(listId, itemId) { items.get(listId).delete(itemId); tell() },
    async removeList(listId) { lists.delete(listId); items.delete(listId); tell() },
    async renameList(listId, name) { lists.get(listId).name = name; tell() },
  }
}

const impl = import.meta.env.DEV && !db ? devStore() : real

export const watchLists = (...a) => impl.watchLists(...a)
export const watchItems = (...a) => impl.watchItems(...a)
export const createList = (...a) => impl.createList(...a)
export const importInto = (...a) => impl.importInto(...a)
export const setResult = (...a) => impl.setResult(...a)
export const setNote = (...a) => impl.setNote(...a)
export const removeItem = (...a) => impl.removeItem(...a)
export const removeList = (...a) => impl.removeList(...a)
export const renameList = (...a) => impl.renameList(...a)
