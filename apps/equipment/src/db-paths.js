/* The Realtime Database's paths, answered from Firestore (step 5B's cutover).

   store.jsx and tracker.js read and write the tracker's data by the old
   database's paths (data, loanMeta/<key>, loanDocs/<key>/simproJobId,
   upcomingLoans/<id>/items, retired, kitGroups…). Once the tracker is on
   Firestore (settings/equipmentCutover.source, db.js), the same calls come
   here: a read is the same value out of the Firestore state (db-firestore.js
   fromDocs), a write is a commit() that sets that value in the state, which
   db-firestore.js turns into writes of only the documents it touches, in one
   transaction. So the tracker's rules and screens don't change at the cutover.

   Paths with no place in Firestore: data/_v (the old live-update marker:
   Firestore's own listeners do that), config (the admin password: roles
   instead, shared/can.js), returnDueSoonReminders (the proxy's own record).
   Their writes do nothing and their reads give null. The audit log and test
   reports have their own calls in db-firestore.js. */
import { addAudit, commit, current, deleteReport, listReports, loadAudit, reportFile, uploadReport } from './db-firestore.js'

/** The Firestore state laid out as the old database was. */
export function asTree(s) {
  return {
    // _v: a marker that's never empty, so store.jsx's "has it changed?" check works (watch() gives a new one each change).
    data: { equipment: s.equipment, history: s.history, loanMeta: s.loanMeta, _v: 'fs' },
    loanMeta: s.loanMeta, loanDocs: s.loanDocs,
    upcomingLoans: Object.fromEntries((s.upcoming || []).map((u) => [u.id, u])),
    retired: s.retired, kitGroups: s.kits, customDemoTypes: s.demoTypes, simproConfig: s.simproConfig,
  }
}
/** And back: the state's parts, from a tree changed at `top`. */
function fromTree(t, top) {
  const parts = {
    data: { equipment: t.data?.equipment || [], history: t.data?.history || [] },
    loanMeta: { loanMeta: t.loanMeta || {} }, loanDocs: { loanDocs: t.loanDocs || {} },
    upcomingLoans: { upcoming: Object.values(t.upcomingLoans || {}).filter((u) => u && typeof u === 'object' && (u.items || []).length) },
    retired: { retired: (t.retired || []).filter(Boolean) }, kitGroups: { kits: t.kitGroups || {} },
    customDemoTypes: { demoTypes: (t.customDemoTypes || []).filter(Boolean) }, simproConfig: { simproConfig: t.simproConfig || {} },
  }
  return parts[top] || {}
}

const IGNORED = new Set(['config', 'returnDueSoonReminders', 'accountManagers'])
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)))
const split = (path) => String(path).split('/').filter(Boolean).map(decodeURIComponent)
function get(tree, parts) { return parts.reduce((o, k) => (o == null ? undefined : o[k]), tree) ?? null }
function set(tree, parts, value) {
  const last = parts[parts.length - 1]
  let o = tree
  for (const k of parts.slice(0, -1)) { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k] }
  if (value === null || value === undefined) { if (Array.isArray(o)) o.splice(Number(last), 1); else delete o[last] } else o[last] = value
}

/** A path's value, as db.js read() gives it ({ data, etag: null }). */
export async function read(path) {
  const parts = split(path)
  if (!parts.length) return { data: clone(asTree(await current())), etag: null }
  if (IGNORED.has(parts[0]) || (parts[0] === 'data' && parts[1] === '_v')) return { data: null, etag: null }
  if (parts[0] === 'auditLog') return { data: Object.fromEntries((await loadAudit()).map((e) => [e.id, e])), etag: null }
  if (parts[0] === 'testReports' && parts.length === 2) return { data: Object.fromEntries((await listReports(parts[1])).map(({ id, ...m }) => [id, m])), etag: null }
  if (parts[0] === 'testReportFiles' && parts.length === 3) return { data: await reportFile(parts[1], parts[2]), etag: null }
  return { data: clone(get(asTree(await current()), parts)), etag: null }
}

// Test report metadata waiting for its file (store.jsx writes the two separately, as the old database kept them).
const pendingReports = new Map()

/**
 * A path written (PUT replaces, PATCH merges, DELETE removes), as one
 * commit(). Resolves { ok: true }; never a conflict (commit() takes someone
 * else's change and runs the write again on it).
 */
export async function write(path, value, { method = 'PUT' } = {}) {
  const parts = split(path)
  if (!parts.length) throw new Error('The whole tracker can’t be written in one go.')
  const top = parts[0]
  if (IGNORED.has(top) || (top === 'data' && parts[1] === '_v')) return { ok: true }
  if (top === 'auditLog') { if (value) await addAudit(value); return { ok: true } }
  if (top === 'testReports' && parts.length === 3) {
    if (method === 'DELETE') await deleteReport(parts[1], parts[2]); else pendingReports.set(parts[1] + '/' + parts[2], value)
    return { ok: true }
  }
  if (top === 'testReportFiles' && parts.length === 3) {
    if (method === 'DELETE') return { ok: true } // deleteReport took the chunks with it
    const meta = pendingReports.get(parts[1] + '/' + parts[2]) || {}
    pendingReports.delete(parts[1] + '/' + parts[2])
    await uploadReport(parts[1], parts[2], meta, value)
    return { ok: true }
  }
  await commit((s) => {
    const tree = asTree(s)
    const next = method === 'DELETE' ? null : method === 'PATCH' ? { ...(get(tree, parts) || {}), ...clone(value) } : clone(value)
    if (parts.length === 1) tree[top] = next ?? (top === 'retired' || top === 'customDemoTypes' ? [] : {})
    else set(tree, parts, next)
    return fromTree(tree, top)
  })
  return { ok: true }
}

/** A path's value out of a state already in hand (for watch()). */
export function pick(s, path) { return clone(get(asTree(s), split(path))) }
