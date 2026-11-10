/* Where a finished test has got to, shared between laptops: which Simpro jobs its report is on (`sentJobs`) and when it was downloaded
   (`downloadedAt`). One small Firestore document per test, `benchTestStatus/{testId}` (rules: rules/firestore.rules). Before this, "Sent to" and
   "Downloaded" were known only to the laptop that did it, so a test Peter attached showed "Not sent" on everyone else's laptop.

   A laptop's own files are matched to the shared test by its start time (`started`, which the files carry as `meta.testedAt`).
   Plain functions, run by the tests; the Firestore calls are in bench-status-firebase.js. */

export const MAX_JOBS = 20
const YEAR = 365 * 864e5

const jobs = (list) => [...new Set((list || []).map((j) => String(j ?? '').trim().slice(0, 40)).filter(Boolean))]

/** { testId: { sentJobs: ['12345'], downloadedAt: ms } } from the documents read. */
export function statusMap(docs) {
  const out = {}
  for (const d of docs || []) if (d && d.id) out[d.id] = { sentJobs: jobs(d.sentJobs), downloadedAt: +d.downloadedAt || 0 }
  return out
}

/** The shared test's id for each start time (ms): how this laptop's files are matched to a shared test. */
export function idByStart(shared) {
  const m = new Map()
  for (const t of shared || []) { const ms = Date.parse(t && t.started); if (t && t.id && ms) m.set(ms, t.id) }
  return m
}

/** Groups (this laptop's, and other engineers' tests) with what any laptop recorded: the jobs the report is on, and the download. */
export function withStatus(groups, shared, map) {
  const byStart = idByStart(shared)
  return groups.map((g) => {
    const st = map && map[g.sharedId || byStart.get(g.testedAt)]
    if (!st) return g
    const sentTo = jobs([...(g.sentTo || []), ...st.sentJobs])
    return { ...g, sentTo, unsent: sentTo.length ? false : g.unsent, downloadedAt: Math.max(g.downloadedAt || 0, st.downloadedAt) }
  })
}

/** What this laptop knows that the shared status does not yet say: [{ id, jobs, downloadedAt }], for the groups matched to a shared test. */
export function statusToWrite(groups, shared, map) {
  const byStart = idByStart(shared), out = []
  for (const g of groups) {
    if (g.shared || g.uploaded || !g.testedAt) continue
    const id = byStart.get(g.testedAt); if (!id) continue
    const st = (map && map[id]) || { sentJobs: [], downloadedAt: 0 }
    const have = new Set(st.sentJobs), mine = jobs(g.sentTo), fresh = mine.filter((j) => !have.has(j))
    const dl = g.downloadedAt && !st.downloadedAt ? g.downloadedAt : 0
    if (fresh.length || dl) out.push({ id, jobs: jobs([...st.sentJobs, ...fresh]).slice(0, MAX_JOBS), downloadedAt: dl || st.downloadedAt })
  }
  return out
}

/** A test is done with when its report is on a Simpro job and it has been downloaded. */
export const isDone = (st) => !!(st && st.sentJobs.length && st.downloadedAt)

/**
 * The tests of the engineer `me` whose stored record can be cleared (clearTestData): done, according to the shared status or to this laptop's own files
 * (`groups`: downloaded and on a job, so it still works before the status rules are published), and not cleared already (size 0).
 */
export function clearableIds(shared, map, me, groups = []) {
  const byStart = idByStart(shared), local = new Set()
  for (const g of groups) if (!g.shared && !g.uploaded && g.testedAt && g.downloadedAt && g.sentTo && g.sentTo.length && !g.unsent && byStart.has(g.testedAt)) local.add(byStart.get(g.testedAt))
  return (shared || []).filter((t) => t && t.id && me && t.by === me && t.size !== 0 && (isDone(map && map[t.id]) || local.has(t.id))).map((t) => t.id)
}

/** The numbers for the storage panel: what is stored, what has been cleared, and what of this engineer's could be cleared, is waiting, or is old. */
export function storageSummary(shared, map, me, now = Date.now()) {
  const list = (shared || []).filter((t) => t && t.id), stored = list.filter((t) => t.size !== 0)
  const mine = stored.filter((t) => me && t.by === me)
  const ready = clearableIds(list, map, me).length
  return {
    stored: stored.length, cleared: list.length - stored.length, bytes: stored.reduce((n, t) => n + (+t.size || 0), 0),
    mine: mine.length, others: stored.length - mine.length, ready, waiting: mine.length - ready,
    old: mine.filter((t) => !isDone(map && map[t.id]) && now - (Date.parse(t.finished || t.started) || now) > YEAR).length,
  }
}
