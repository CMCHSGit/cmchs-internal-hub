/* Handing an asset list from the new-equipment page to Simpro Asset Sync: the page leaves the file here (this PC's IndexedDB, nowhere
   else), opens Asset Sync, and Asset Sync takes it once as if it had been chosen there. The file is only a file: Asset Sync still reads
   Simpro, shows the preview and waits for someone to press Apply. Kept 10 minutes at most and taken once, so an old list can never turn
   up later. Plain functions over a small store, so the tests run them with an in-memory one. */

export const HANDOFF_PARAM = 'from'
export const HANDOFF_FROM = 'new-equipment'
export const MAX_AGE_MS = 10 * 60 * 1000

export function memoryHandoff() {
  let item = null
  return { async put(x) { item = x }, async get() { return item }, async clear() { item = null } }
}

export function idbHandoff(dbName = 'chs-newequip-handoff') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('file')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const run = async (mode, fn) => {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('file', mode)
        const r = fn(tx.objectStore('file'))
        tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined)
        tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }
  return {
    put: (x) => run('readwrite', (s) => s.put(x, 'current')),
    get: () => run('readonly', (s) => s.get('current')),
    clear: () => run('readwrite', (s) => s.delete('current')),
  }
}

/** Leaves a file for Asset Sync: { name, mime, buffer }. */
export async function putHandoff(store, { name, mime, buffer }, now = Date.now()) {
  await store.put({ name: String(name), mime: String(mime || ''), buffer, at: now })
}

/** The file left for Asset Sync, or null (none, or too old). Taken: it is gone afterwards either way. */
export async function takeHandoff(store, now = Date.now()) {
  const x = await store.get()
  await store.clear()
  if (!x || !x.buffer || now - x.at > MAX_AGE_MS) return null
  return { name: x.name, mime: x.mime, buffer: x.buffer }
}

/** Asset Sync's address for a handed-over file. */
export const handoffUrl = () => `/simprosync/?${HANDOFF_PARAM}=${HANDOFF_FROM}`

/** Whether an address asks Asset Sync to take a handed-over file. */
export const wantsHandoff = (search) => new URLSearchParams(search || '').get(HANDOFF_PARAM) === HANDOFF_FROM
