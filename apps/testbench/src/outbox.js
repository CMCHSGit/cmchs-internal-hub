/* The Test Bench's outbox: files waiting to go to a Simpro job. Everything that is sent goes in here first and is
   taken out only once Simpro has it, so a dropped connection, a closed tab or a laptop shut in the van loses
   nothing: the files stay on this laptop (IndexedDB) and go the next time the hub is open with a connection.
   Plain functions over a small store, so the tests run them with an in-memory one. */

/** An item: { id, companyId, jobId, jobLabel, name, mime, buffer, by, queuedAt, status: 'waiting' | 'failed', error } */

export function memoryStore() {
  const items = new Map()
  return {
    async put(item) { items.set(item.id, { ...item }) },
    async all() { return [...items.values()].map((x) => ({ ...x })) },
    async remove(id) { items.delete(id) },
    async update(id, patch) { const x = items.get(id); if (x) Object.assign(x, patch) },
  }
}

/** The same, kept on this laptop. */
export function idbStore(dbName = 'chs-bench-outbox') {
  const open = () => new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1)
    req.onupgradeneeded = () => req.result.createObjectStore('items', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  const run = async (mode, fn) => {
    const db = await open()
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('items', mode)
        let out
        Promise.resolve(fn(tx.objectStore('items'))).then((v) => { out = v }, reject)
        tx.oncomplete = () => resolve(out)
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    } finally { db.close() }
  }
  const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
  return {
    put: (item) => run('readwrite', (s) => req(s.put(item))),
    all: () => run('readonly', (s) => req(s.getAll())),
    remove: (id) => run('readwrite', (s) => req(s.delete(id))),
    update: (id, patch) => run('readwrite', async (s) => { const x = await req(s.get(id)); if (x) await req(s.put({ ...x, ...patch })) }),
  }
}

let counter = 0
const newId = () => `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`

/** Puts files in the outbox for one job. Nothing is sent yet. Returns the items. */
export async function enqueue(store, { companyId, jobId, jobLabel, by, files }, now = Date.now()) {
  const items = files.map((f, i) => ({
    id: newId(), companyId, jobId: String(jobId), jobLabel: jobLabel || `#${jobId}`, name: f.name, mime: f.mime || '', buffer: f.buffer,
    by: by || '', queuedAt: now + i, status: 'waiting', error: '',
  }))
  for (const it of items) await store.put(it)
  return items
}

/**
 * Sends what is waiting, oldest first, one at a time (the proxy takes one attachment per request). `send(item)` resolves
 * 'sent' or 'duplicate' (either way Simpro has it: the item goes) or throws an error with `.retry`:
 *  - retry true (no connection, Simpro down): the item stays waiting and sending stops, to try again when it can;
 *  - otherwise: the item is marked failed with the reason and the rest carry on. A failed one is tried again only by
 *    `retryFailed`, because it won't have changed by itself.
 * Returns { sent, duplicate, failed, stopped }; `stopped` is the reason sending stopped early, or ''.
 */
export async function drain(store, send, onChange = () => {}) {
  const out = { sent: 0, duplicate: 0, failed: 0, stopped: '' }
  const waiting = (await store.all()).filter((x) => x.status === 'waiting').sort((a, b) => a.queuedAt - b.queuedAt)
  for (const item of waiting) {
    try {
      const r = await send(item)
      await store.remove(item.id)
      out[r === 'duplicate' ? 'duplicate' : 'sent']++
    } catch (e) {
      if (e?.retry) {
        await store.update(item.id, { error: e.message })
        out.stopped = e.message
        onChange()
        return out
      }
      await store.update(item.id, { status: 'failed', error: e?.message || String(e) })
      out.failed++
    }
    onChange()
  }
  return out
}

/** Puts failed items back to waiting (after whatever was wrong has been put right). */
export async function retryFailed(store) {
  for (const x of (await store.all()).filter((i) => i.status === 'failed')) await store.update(x.id, { status: 'waiting', error: '' })
}

/** The same file sent again: one item per name and job, the latest copy kept, so saving a report twice doesn't send two. */
export async function enqueueReplacing(store, args, now) {
  const have = await store.all()
  for (const f of args.files) {
    for (const x of have) if (x.status !== 'failed' && x.jobId === String(args.jobId) && x.companyId === args.companyId && x.name === f.name) await store.remove(x.id)
  }
  return enqueue(store, args, now)
}
