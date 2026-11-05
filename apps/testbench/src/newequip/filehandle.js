/* The asset list file a person chose for a customer, remembered on this PC so the next time is one click (Chrome and Edge: the File System
   Access API; other browsers just ask for the file each time). What is kept is a handle to the file, not a copy: reloading reads the file as
   it is now, so a OneDrive-synced copy is always the latest the sync has. READ ONLY: the handle is only ever asked for read access. Plain
   functions over a small store, so the tests run them with an in-memory one and made-up handles. */

export function memoryHandles() {
  const m = new Map()
  return { async get(k) { return m.get(k) || null }, async put(k, v) { m.set(k, v) }, async remove(k) { m.delete(k) } }
}

export function idbHandles(dbName = 'chs-newequip-files') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('handles')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const run = async (mode, fn) => {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('handles', mode)
        const r = fn(tx.objectStore('handles'))
        tx.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined)
        tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }
  return {
    get: async (k) => (await run('readonly', (s) => s.get(String(k)))) || null,
    put: (k, v) => run('readwrite', (s) => s.put(v, String(k))),
    remove: (k) => run('readwrite', (s) => s.delete(String(k))),
  }
}

/** Whether this browser can remember a chosen file. */
export const canRemember = () => typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function'

/** Asks for the file with the browser's picker: the handle, or null if the person cancelled. */
export async function pickFile() {
  try {
    const [h] = await window.showOpenFilePicker({ multiple: false, types: [{ description: 'Excel workbook', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'] } }] })
    return h || null
  } catch (e) {
    if (e?.name === 'AbortError') return null
    throw e
  }
}

/** Read access to a remembered file: true when there is (asking the person, from a click, when there isn't yet). */
export async function ensureRead(handle) {
  if (!handle || typeof handle.queryPermission !== 'function') return Boolean(handle)
  if ((await handle.queryPermission({ mode: 'read' })) === 'granted') return true
  return (await handle.requestPermission({ mode: 'read' })) === 'granted'
}

/** The file now, from a remembered handle: { file } or { error } in words (moved or deleted, or access not given). */
export async function readRemembered(handle) {
  try {
    if (!(await ensureRead(handle))) return { error: 'The browser didn’t give access to that file. Choose it again.' }
    return { file: await handle.getFile() }
  } catch (e) {
    if (e?.name === 'NotFoundError') return { error: 'That file has been moved or deleted. Choose it again.', gone: true }
    return { error: 'Couldn’t open that file: ' + (e?.message || e) + '. Choose it again.' }
  }
}
