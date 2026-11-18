/* Finding the jobs a customer asset is attached to. Simpro can't be asked "which jobs have asset 24105?", so this goes the other
   way: the jobs at the asset's site, then each job's sections, cost centres and attached assets (the Customer Assets tab on a job),
   looking for the asset. Read only: every call is a GET through the hub's Simpro relay, and the relay's job, section, cost-centre and
   asset reads are all it needs. Calls go 25 to a trip (bulk.js). No React and no DOM, so the tests run it. */
import { SendError, ok } from '../../testbench/src/simpro-api.js'
import { BATCH } from './bulk.js'
import { JOB_COLUMNS, SAFE_COLUMNS, STAGES, assetFacts, assetMatchesTerm, jobsPath } from './search.js'

export const SITE_PAGE = 250
export const SITE_PAGES = 4        // at most this many pages of a site's jobs are listed
export const SITE_JOBS = 400       // and at most this many (the newest) are looked into
export const SCAN_PAGES = 80       // customer asset pages (250 each) a full scan reads, at most
const TRIPS_AT_ONCE = 3

/** One page of the jobs at a site, by the site's number. */
export function siteJobsPath(companyId, siteId, { stage = '', columns = JOB_COLUMNS, page = 1 } = {}) {
  const parts = [`Site.ID=${Number(siteId)}`]
  if (stage) {
    if (!STAGES.includes(stage)) throw new Error('Not one of Simpro’s four stages: ' + stage)
    parts.push('Stage=' + stage)
  }
  parts.push('columns=' + columns, 'pageSize=' + SITE_PAGE)
  if (page > 1) parts.push('page=' + page)
  return `/companies/${companyId}/jobs/?${parts.join('&')}`
}

/** Many GETs, 25 to a trip and a few trips at once: results in the order asked ({ status, data }; status 0 where a trip was lost). */
export async function batchMany(batchGet, paths, { isCancelled = () => false, onTrip = () => {} } = {}) {
  const results = new Array(paths.length).fill(null)
  const groups = []
  for (let i = 0; i < paths.length; i += BATCH) groups.push(i)
  let next = 0, done = 0
  const worker = async () => {
    while (next < groups.length && !isCancelled()) {
      const start = groups[next++]
      const part = paths.slice(start, start + BATCH)
      let res = null
      for (let attempt = 0; attempt < 3 && !res; attempt++) {
        try { res = await batchGet(part) } catch (e) {
          if (!e?.retry || attempt === 2) break
          await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)))
        }
      }
      part.forEach((_, k) => { results[start + k] = res?.[k] || { status: 0, data: null } })
      done += part.length
      onTrip(done, paths.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(TRIPS_AT_ONCE, groups.length) }, worker))
  return results
}

const listOf = (r) => (r && ok(r) && Array.isArray(r.data) ? r.data : [])

/** The jobs at one site, newest first, up to SITE_JOBS: { jobs, capped }. Tries the site's number, then its name if Simpro won't filter on that. */
async function jobsAtSite(call, companyId, site, { stage, isCancelled }) {
  const tryList = async (pathFor) => {
    let rows = []
    for (let page = 1; page <= SITE_PAGES && !isCancelled(); page++) {
      let r = await call('GET', pathFor(page, JOB_COLUMNS)).catch((e) => ({ status: 0, data: String(e?.message || e) }))
      if (page === 1 && !ok(r) && r.status >= 400 && r.status < 500) r = await call('GET', pathFor(page, SAFE_COLUMNS)).catch(() => r)
      if (!ok(r) || !Array.isArray(r.data)) return page === 1 ? null : { rows, capped: true }
      rows = rows.concat(r.data)
      if (r.data.length < SITE_PAGE) return { rows, capped: false }
    }
    return { rows, capped: true }
  }
  let got = await tryList((page, columns) => siteJobsPath(companyId, site.id, { stage, columns, page }))
  if (!got && site.name) got = await tryList((page, columns) => jobsPath(companyId, 'Site.Name', site.name, { stage, columns, pageSize: SITE_PAGE, page }))
  if (!got) return { jobs: [], capped: false, refused: true }
  const jobs = got.rows.filter((j) => j && j.ID != null).sort((a, b) => Number(b.ID) - Number(a.ID))
  return { jobs: jobs.slice(0, SITE_JOBS), capped: got.capped || jobs.length > SITE_JOBS }
}

/**
 * Which jobs have these assets attached.
 *   assets: [{ id, siteId, site }] (searchAssets' result).   stage: only look at jobs in that stage.
 *   onProgress({ done, total, what }), isCancelled().
 * Returns { byAsset: Map(assetId -> [job rows]), scanned, capped, refused, cancelled }:
 *   scanned: jobs looked into.  capped: some site had more jobs than are looked into (the oldest weren't).  refused: a site's jobs couldn't be listed.
 */
export async function findAttachedJobs({ call, batchGet, companyId, assets, stage = '', onProgress = () => {}, isCancelled = () => false }) {
  const want = new Set(assets.map((a) => String(a.id)))
  const sites = new Map()
  for (const a of assets) if (a.siteId != null && !sites.has(a.siteId)) sites.set(a.siteId, { id: a.siteId, name: a.site || '' })
  const byAsset = new Map()
  let capped = false, refused = false

  // 1. The jobs at each site.
  const rows = new Map()
  let n = 0
  for (const site of sites.values()) {
    if (isCancelled()) break
    onProgress({ done: n++, total: sites.size, what: 'sites' })
    const r = await jobsAtSite(call, companyId, site, { stage, isCancelled })
    if (r.refused) refused = true
    if (r.capped) capped = true
    for (const j of r.jobs) rows.set(String(j.ID), j)
  }
  const jobIds = [...rows.keys()]

  // 2. Each job's sections, then their cost centres, then the assets on those.
  const sections = await batchMany(batchGet, jobIds.map((id) => `/companies/${companyId}/jobs/${id}/sections/?pageSize=250`), {
    isCancelled, onTrip: (done, total) => onProgress({ done, total, what: 'jobs' }),
  })
  const centreAsks = []
  sections.forEach((r, i) => { for (const s of listOf(r)) centreAsks.push({ job: jobIds[i], path: `/companies/${companyId}/jobs/${jobIds[i]}/sections/${s.ID}/costCenters/` }) })
  const centres = await batchMany(batchGet, centreAsks.map((c) => c.path + '?pageSize=250'), {
    isCancelled, onTrip: (done, total) => onProgress({ done, total, what: 'cost centres' }),
  })
  const assetAsks = []
  centres.forEach((r, i) => { for (const c of listOf(r)) assetAsks.push({ job: centreAsks[i].job, path: `${centreAsks[i].path}${c.ID}/assets/` }) })
  const attached = await batchMany(batchGet, assetAsks.map((a) => a.path + '?pageSize=250'), {
    isCancelled, onTrip: (done, total) => onProgress({ done, total, what: 'assets' }),
  })
  attached.forEach((r, i) => {
    for (const x of listOf(r)) {
      const id = String(x?.Asset?.ID ?? x?.ID ?? '')
      if (!want.has(id)) continue
      const list = byAsset.get(id) || []
      const row = rows.get(String(assetAsks[i].job))
      if (row && !list.includes(row)) list.push(row)
      byAsset.set(id, list)
    }
  })
  return { byAsset, scanned: jobIds.length, capped, refused, cancelled: isCancelled() }
}

/** "AG4-34001182 · A9" — how an asset reads next to a job it is attached to. */
export const assetLabel = (a) => [a.serial || a.assetNumber || `asset ${a.id}`, a.model].filter(Boolean).join(' · ')

/**
 * The jobs found through assets, as findAttachedJobs' answer turned into what searchJobs takes as `extra`: one Map per word, holding the
 * jobs attached to an asset that has that word in its serial, numbers, model, type or site.
 */
export function assetJobsByTerm(terms, assets, byAsset) {
  return terms.map((term) => {
    const map = new Map()
    for (const a of assets) {
      if (!assetMatchesTerm(a, term)) continue
      for (const job of byAsset.get(String(a.id)) || []) {
        const have = map.get(String(job.ID)) || { job, found: ['Attached asset'], assets: [] }
        const label = assetLabel(a)
        if (!have.assets.includes(label)) have.assets.push(label)
        map.set(String(job.ID), have)
      }
    }
    return map
  })
}

/**
 * Last resort when Simpro won't search assets by serial: read every customer asset (250 a page, 4 pages a trip) and look through them
 * here. Slower, and only run when asked. Returns { assets, pages, capped }.
 */
export async function scanAssets({ batchGet, companyId, terms, onProgress = () => {}, isCancelled = () => false, pageSize = 250, columns = 'ID,Site,AssetType,Archived,CustomFields' }) {
  const found = new Map()
  let pages = 0, capped = false, finished = false
  for (let page = 1; page <= SCAN_PAGES && !finished && !isCancelled(); page += 4) {
    const paths = [0, 1, 2, 3].map((k) => `/companies/${companyId}/customerAssets/?columns=${columns}&pageSize=${pageSize}&page=${page + k}`)
    let res
    try { res = await batchGet(paths) } catch (e) { throw new SendError(e?.message || 'Simpro stopped answering while the assets were being read.', !!e?.retry) }
    for (let k = 0; k < res.length; k++) {
      const r = res[k]
      if (!ok(r) || !Array.isArray(r.data)) { if (pages === 0) throw new SendError(`Simpro wouldn’t list the customer assets (${r?.status}).`, (r?.status || 0) >= 500); finished = true; break }
      pages++
      for (const a of r.data) {
        const f = assetFacts(a)
        if (terms.every((t) => assetMatchesTerm(f, t))) found.set(String(f.id), f)
      }
      if (r.data.length < pageSize) { finished = true; break }
    }
    onProgress({ pages, found: found.size })
  }
  if (!finished && !isCancelled()) capped = true
  return { assets: [...found.values()], pages, capped }
}
