/* Checklists — the data, in Firestore (rules/firestore.rules, `checklists`).

   A list is one document: checklists/{listId} { name, total, steps, people, teams, createdAt, createdBy,
   createdByName, importedAt, importedByName }. `steps` are what has to be ticked on every device
   ([{ id, label }]; a list without any has one, "Done"). `people` (uids) and `teams` are who it is shared
   with, as an ask's are: the person who made it always sees it, and nobody else unless it is shared.

   Its devices are checklists/{listId}/items/{deviceId}: what the spreadsheet said about the device (type,
   serial, status, department, location, version ...) and, kept apart so a re-import never touches it, what
   people did on site: checks ({ [stepId]: { by, byName, at } }), result ('' | 'notfound', or 'done' on a
   list from before steps), doneBy, doneByName, doneAt and note.

   A document a device, so five people ticking at once never write the same document, and each screen
   sees the others' ticks as they happen. Firestore here keeps a copy on the device (shared/firestore.js), so
   a tick made in a dead spot is kept and sent when the signal is back. */
import {
  arrayUnion, collection, deleteField, doc, onSnapshot, query, setDoc, updateDoc, deleteDoc, where, writeBatch, serverTimestamp,
} from 'firebase/firestore'
import { auth, db } from '../../schedule/src/firebase.js'
import { PROXY_URL } from '../../../shared/proxy.js'

export const COL = 'checklists'
const CHUNK = 400 // a batch holds 500 writes

const WHO = (by) => ({ by: by.uid, byName: by.name })
const LOST = (by) => ({ result: 'notfound', doneBy: by.uid, doneByName: by.name })
const UNDONE = { result: '', doneBy: '', doneByName: '', doneAt: null }
const BLANK_PROGRESS = { ...UNDONE, checks: {}, note: '', noteByName: '' }

const strip = ({ id: _id, ...fields }) => fields

/** Several live queries as one list: cb fires once all have answered, then on every change. */
function watchMerged(queries, cb, onError) {
  const parts = queries.map(() => null)
  const unsubs = queries.map((q, i) => onSnapshot(q, (snap) => {
    parts[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    if (parts.every(Boolean)) cb([...new Map(parts.flat().map((x) => [x.id, x])).values()])
  }, onError))
  return () => unsubs.forEach((u) => u())
}
const newestFirst = (lists) => {
  const at = (l) => l.createdAt?.toMillis?.() ?? Date.now()
  return [...lists].sort((a, b) => at(b) - at(a))
}

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
  /** cb(lists) for the lists this person made, was named on, or whose team they are on: the only ones the rules let them read. */
  watchLists(me, cb, onError) {
    const col = collection(db, COL)
    const qs = [
      query(col, where('createdBy', '==', me.uid)),
      query(col, where('people', 'array-contains', me.uid)),
      ...(me.team ? [query(col, where('teams', 'array-contains', me.team))] : []),
    ]
    return watchMerged(qs, (lists) => cb(newestFirst(lists)), onError)
  },

  /** Just the lists this person made: what an ask can attach. */
  watchOwnLists(uid, cb, onError) {
    return watchMerged([query(collection(db, COL), where('createdBy', '==', uid))], (lists) => cb(newestFirst(lists)), onError)
  },

  /** Everyone signed in at least once, for choosing who to share with. */
  watchPeople(cb, onError) {
    return onSnapshot(collection(db, 'users'), (snap) => cb(snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((u) => !u.pending)
      .map((u) => ({ uid: u.uid, name: u.displayName || u.email || 'Someone', team: u.team || '' }))
      .sort((a, b) => a.name.localeCompare(b.name))), onError)
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

  async createList({ name, devices, by, steps }) {
    const ref = doc(collection(db, COL))
    await setDoc(ref, {
      name, total: devices.length, steps, people: [by.uid], teams: [],
      createdAt: serverTimestamp(), createdBy: by.uid, createdByName: by.name, importedAt: serverTimestamp(), importedByName: by.name,
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

  /** Ticks (on) or unticks (off) one step on a device. Ticking a device that was marked "couldn't find" says it was found. */
  setStep(listId, item, stepId, on, by) {
    const upd = { [`checks.${stepId}`]: on ? { ...WHO(by), at: serverTimestamp() } : deleteField() }
    if (on && item.result === 'notfound') Object.assign(upd, UNDONE)
    // A tick from before steps lives in `result`; unticking its step clears it.
    if (!on && stepId === 'done' && item.result === 'done') Object.assign(upd, UNDONE)
    return updateDoc(doc(db, COL, listId, 'items', item.id), upd)
  },

  markLost(listId, itemId, by) {
    return updateDoc(doc(db, COL, listId, 'items', itemId), { ...LOST(by), doneAt: serverTimestamp() })
  },

  /** Back to to do: every step unticked and not marked lost. */
  resetItem(listId, itemId) {
    return updateDoc(doc(db, COL, listId, 'items', itemId), { ...UNDONE, checks: {} })
  },

  setNote(listId, itemId, note, by) {
    return updateDoc(doc(db, COL, listId, 'items', itemId), { note, noteByName: note ? by.name : '' })
  },

  removeItem(listId, itemId) {
    return deleteDoc(doc(db, COL, listId, 'items', itemId))
  },

  /** A device found on site and not on the list. Anyone who can see the list may add one (rules); it is theirs to remove. */
  addDevice(listId, device, { note, stepIds = [] }, by) {
    const checks = Object.fromEntries(stepIds.map((id) => [id, { ...WHO(by), at: serverTimestamp() }]))
    return setDoc(doc(db, COL, listId, 'items', device.id), {
      ...strip(device), ...BLANK_PROGRESS, checks, note, noteByName: note ? by.name : '',
      addedOnSite: true, addedBy: by.uid, addedByName: by.name, addedAt: serverTimestamp(),
    })
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

  saveSteps(listId, steps) {
    return updateDoc(doc(db, COL, listId), { steps })
  },

  /** Who the list is shared with, replaced. */
  saveSharing(listId, { people, teams }) {
    return updateDoc(doc(db, COL, listId), { people, teams })
  },

  /**
   * Asks the proxy to push "<you> shared a checklist with you" to whoever can now see the list and hasn't been told. It
   * sends only the list's id; the proxy checks you made it. Returns { success, people, pushed, unreached } or null. Never throws.
   */
  async notifyShared(listId) {
    try {
      const idToken = await auth.currentUser?.getIdToken()
      if (!idToken) return null
      // text/plain keeps it a simple request (no CORS preflight, which Apps Script can't answer).
      const res = await fetch(PROXY_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'notifyChecklistShared', idToken, id: listId }) })
      return await res.json()
    } catch (e) {
      console.warn('Could not tell the people the checklist was shared with:', e)
      return null
    }
  },

  /** Adds people and teams to who a list is shared with (an ask that attaches it does this for its recipients). */
  shareWith(listId, { people = [], teams = [] }) {
    const upd = {}
    if (people.length) upd.people = arrayUnion(...people)
    if (teams.length) upd.teams = arrayUnion(...teams)
    return Object.keys(upd).length ? updateDoc(doc(db, COL, listId), upd) : Promise.resolve()
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
  const people = [
    { uid: 'dev', name: 'Dev User', team: 'Management' }, { uid: 'u1', name: 'Ann Taylor', team: 'Engineers' },
    { uid: 'u2', name: 'Ben Rivers', team: 'Engineers' }, { uid: 'u3', name: 'Cara Lee', team: 'Sales' },
  ]

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
  lists.set('sample', {
    id: 'sample', name: 'Sample N1 list (not saved)', total: seed.size, createdAt: now(), createdBy: 'dev', createdByName: 'Dev User', importedByName: 'Dev User',
    people: ['dev'], teams: [], steps: [{ id: 'sw', label: 'Software upgraded' }, { id: 'cfg', label: 'Changed config' }],
  })
  items.set('sample', seed)

  const item = (listId, id) => items.get(listId).get(id)
  return {
    watchLists: (me, cb) => watch(() => newestFirst([...lists.values()].filter((l) => l.createdBy === me.uid || (l.people || []).includes(me.uid) || (me.team && (l.teams || []).includes(me.team)))), cb),
    watchOwnLists: (uid, cb) => watch(() => newestFirst([...lists.values()].filter((l) => l.createdBy === uid)), cb),
    watchPeople: (cb) => watch(() => people, cb),
    watchItems: (listId, cb) => watch(() => [...(items.get(listId)?.values() || [])].map((x) => ({ ...x, checks: { ...x.checks } })), (arr) => cb(arr, { pending: 0, fromCache: false })),
    async createList({ name, devices, by, steps }) {
      const id = 'dev' + Date.now()
      lists.set(id, { id, name, total: devices.length, steps, people: [by.uid], teams: [], createdAt: now(), createdBy: by.uid, createdByName: by.name, importedByName: by.name })
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
    async setStep(listId, it, stepId, on, by) {
      const x = item(listId, it.id)
      if (on) { x.checks = { ...x.checks, [stepId]: { ...WHO(by), at: now() } }; if (x.result === 'notfound') Object.assign(x, UNDONE) }
      else { const { [stepId]: _gone, ...rest } = x.checks || {}; x.checks = rest; if (stepId === 'done' && x.result === 'done') Object.assign(x, UNDONE) }
      tell()
    },
    async markLost(listId, itemId, by) { Object.assign(item(listId, itemId), LOST(by), { doneAt: now() }); tell() },
    async resetItem(listId, itemId) { Object.assign(item(listId, itemId), UNDONE, { checks: {} }); tell() },
    async setNote(listId, itemId, note, by) { Object.assign(item(listId, itemId), { note, noteByName: note ? by.name : '' }); tell() },
    async removeItem(listId, itemId) { items.get(listId).delete(itemId); tell() },
    async addDevice(listId, device, { note, stepIds = [] }, by) {
      items.get(listId).set(device.id, {
        ...device, ...BLANK_PROGRESS, checks: Object.fromEntries(stepIds.map((s) => [s, { ...WHO(by), at: now() }])), note, noteByName: note ? by.name : '',
        addedOnSite: true, addedBy: by.uid, addedByName: by.name,
      }); tell()
    },
    async removeList(listId) { lists.delete(listId); items.delete(listId); tell() },
    async renameList(listId, name) { lists.get(listId).name = name; tell() },
    async saveSteps(listId, steps) { lists.get(listId).steps = steps; tell() },
    async saveSharing(listId, sharing) { Object.assign(lists.get(listId), sharing); tell() },
    async notifyShared() { return { success: true, people: 2, pushed: 1, unreached: 1 } }, // made-up counts, so the message can be seen
    async shareWith(listId, { people: p = [], teams: t = [] }) {
      const l = lists.get(listId); l.people = [...new Set([...(l.people || []), ...p])]; l.teams = [...new Set([...(l.teams || []), ...t])]; tell()
    },
  }
}

const impl = import.meta.env.DEV && !db ? devStore() : real

export const watchLists = (...a) => impl.watchLists(...a)
export const watchOwnLists = (...a) => impl.watchOwnLists(...a)
export const watchPeople = (...a) => impl.watchPeople(...a)
export const watchItems = (...a) => impl.watchItems(...a)
export const createList = (...a) => impl.createList(...a)
export const importInto = (...a) => impl.importInto(...a)
export const setStep = (...a) => impl.setStep(...a)
export const markLost = (...a) => impl.markLost(...a)
export const resetItem = (...a) => impl.resetItem(...a)
export const setNote = (...a) => impl.setNote(...a)
export const removeItem = (...a) => impl.removeItem(...a)
export const addDevice = (...a) => impl.addDevice(...a)
export const removeList = (...a) => impl.removeList(...a)
export const renameList = (...a) => impl.renameList(...a)
export const saveSteps = (...a) => impl.saveSteps(...a)
export const saveSharing = (...a) => impl.saveSharing(...a)
export const shareWith = (...a) => impl.shareWith(...a)
export const notifyShared = (...a) => impl.notifyShared(...a)
