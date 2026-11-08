/* Reading every job in Simpro, for building the knowledge base. Read only: every call is a GET through the hub's Simpro relay.
   The jobs are listed page by page (250 at a time). If Simpro doesn't put the notes in a list row, each job is then read in full,
   25 to a trip (the relay's batch size), so a few thousand jobs take minutes, not hours. No React and no DOM, so the tests run it. */
import { SendError, ok } from '../../testbench/src/simpro-api.js'
import { JOB_COLUMNS, SAFE_COLUMNS, STAGES } from './search.js'

export const LIST_PAGE = 250   // Simpro's largest page
export const MAX_LIST_PAGES = 400
export const BATCH = 25        // what the relay accepts in one call

/** The address of one page of the job list, optionally narrowed to a stage and to jobs issued on or after a date. */
export function listPath(companyId, { stage = '', issuedFrom = '', columns = JOB_COLUMNS, pageSize = LIST_PAGE, page = 1 } = {}) {
  const parts = []
  if (stage) {
    if (!STAGES.includes(stage)) throw new Error('Not one of Simpro’s four stages: ' + stage)
    parts.push('Stage=' + stage)
  }
  if (issuedFrom) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(issuedFrom)) throw new Error('A date looks like 2025-01-31')
    parts.push(`DateIssued=ge(${issuedFrom})`)
  }
  parts.push('columns=' + columns, 'pageSize=' + pageSize)
  if (page > 1) parts.push('page=' + page)
  return `/companies/${companyId}/jobs/?${parts.join('&')}`
}

/** Like makeCall (testbench/simpro-api.js) but for many GETs in one trip: returns [{ status, data }] in the order asked. */
export function makeBatchGet({ getToken, proxyUrl, fetchFn = fetch }) {
  return async function batchGet(paths) {
    let res
    try {
      const idToken = await getToken()
      res = await fetchFn(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ action: 'simproSync', idToken, requests: paths.map((path) => ({ method: 'GET', path })) }),
      })
    } catch (e) {
      throw new SendError('No connection to the hub’s Simpro service (' + (e?.message || e) + ')', true)
    }
    const json = await res.json().catch(() => null)
    if (!json) throw new SendError(`The hub’s Simpro service gave no answer (${res.status})`, true)
    if (!json.success) throw new SendError(json.error || 'The hub’s Simpro service refused the request', false)
    if (!Array.isArray(json.results) || json.results.length !== paths.length) throw new SendError('The hub’s Simpro service answered only part of the request', true)
    return json.results
  }
}

const hasText = (j) => j.Description !== undefined && j.Notes !== undefined
const isEmpty = (j) => !String(j.Description ?? '').replace(/<[^>]*>|&nbsp;|\s/g, '') && !String(j.Notes ?? '').replace(/<[^>]*>|&nbsp;|\s/g, '')

/**
 * Every job (narrowed by `stage` and `issuedFrom` if given) with its description and notes.
 *   call(method, path): makeCall's result.   batchGet(paths): makeBatchGet's result.
 *   onProgress({ phase: 'list' | 'read', done, total }), isCancelled().
 * Returns { jobs, failed, cancelled, listed }: `jobs` is the jobs whose text was read (when stopped early, only those); `failed`: jobs Simpro
 * would not give; `listed`: how many jobs the list had. With `skipEmpty`, jobs with nothing written in either place are left out of `jobs`.
 */
export async function exportAllJobs({ call, batchGet, companyId, stage = '', issuedFrom = '', skipEmpty = true, pageSize = LIST_PAGE, onProgress = () => {}, isCancelled = () => false }) {
  // 1. The list.
  const byId = new Map()
  let columns = JOB_COLUMNS
  let page = 1, lastFirst = null
  while (page <= MAX_LIST_PAGES && !isCancelled()) {
    let r = await call('GET', listPath(companyId, { stage, issuedFrom, columns, pageSize, page }))
    // Simpro may not list Notes in a row: if the very first question is refused, ask again with the columns the other tools use.
    if (page === 1 && columns === JOB_COLUMNS && !ok(r) && r.status >= 400 && r.status < 500) {
      columns = SAFE_COLUMNS
      r = await call('GET', listPath(companyId, { stage, issuedFrom, columns, pageSize, page }))
    }
    if (!ok(r) || !Array.isArray(r.data)) {
      if (page === 1) throw new SendError(`Simpro wouldn’t list the jobs (${r.status}${issuedFrom && r.status >= 400 && r.status < 500 ? ': it may not accept that date filter' : ''}).`, r.status >= 500)
      throw new SendError(`Simpro stopped answering after ${byId.size} jobs (page ${page}: ${r.status}). Try again, or narrow it by stage or date.`, r.status >= 500)
    }
    const first = r.data[0]?.ID ?? null
    if (page > 1 && first !== null && first === lastFirst) break // Simpro ignored the page number and sent the same page again: stop rather than loop
    lastFirst = first
    for (const j of r.data) if (j && j.ID != null) byId.set(String(j.ID), j)
    onProgress({ phase: 'list', done: byId.size, total: 0 })
    if (r.data.length < pageSize) break
    page++
  }
  const listed = byId.size

  // 2. The full text of any job whose row didn't carry it.
  const rows = [...byId.values()]
  const need = rows.filter((j) => !hasText(j))
  let failed = 0, done = 0
  const full = new Map(rows.filter(hasText).map((j) => [String(j.ID), j]))
  for (let i = 0; i < need.length && !isCancelled(); i += BATCH) {
    const group = need.slice(i, i + BATCH)
    let results = null
    for (let attempt = 0; attempt < 3 && !results; attempt++) {
      try { results = await batchGet(group.map((j) => `/companies/${companyId}/jobs/${j.ID}`)) } catch (e) {
        if (!e?.retry || attempt === 2) break
        await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)))
      }
    }
    group.forEach((j, k) => {
      const r = results?.[k]
      if (r && ok(r) && r.data && typeof r.data === 'object') full.set(String(j.ID), { ...j, ...r.data })
      else failed++
    })
    done += group.length
    onProgress({ phase: 'read', done, total: need.length })
  }

  const cancelled = isCancelled()
  let jobs = rows.filter((j) => full.has(String(j.ID))).map((j) => full.get(String(j.ID)))
  if (skipEmpty) jobs = jobs.filter((j) => !isEmpty(j))
  jobs.sort((a, b) => Number(a.ID) - Number(b.ID))
  return { jobs, failed, cancelled, listed }
}
