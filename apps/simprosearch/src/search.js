/* Simpro Deep Search: what to ask Simpro, and what to make of the answers. Read only: every call here is a GET through the
   hub's Simpro relay (apps/simprosync's allowlist), so nothing can be written to Simpro from this file.
   No React and no Firebase, so the tests run it as it is. `call(method, path)` is makeCall()'s result (testbench/simpro-api.js). */
import { ok, simproErr, SendError } from '../../testbench/src/simpro-api.js'
import { htmlToText, snippetAround } from './html.js'

export const STAGES = ['Pending', 'Progress', 'Complete', 'Archived']
export const PAGE_SIZE = 100
export const MAX_PAGES = 3   // so at most PAGE_SIZE * MAX_PAGES rows per word and place
export const MAX_TERMS = 5

/**
 * What was typed, as the words to look for. "A9 Waitemata" is two words; "North Shore" in quotes stays one phrase.
 * A job needs ALL of them (each may be in a different place: A9 in the description, Waitemata in the site name). Repeats are
 * dropped, case is ignored, and a one-letter word is ignored unless it is all there is.
 */
export function parseTerms(text) {
  const found = []
  String(text ?? '').replace(/["“”]([^"“”]*)["“”]|([^\s"“”]+)/g, (_, phrase, word) => { found.push(String(phrase ?? word).trim().replace(/\s+/g, ' ')); return '' })
  const seen = new Set()
  const terms = found.filter((t) => { const k = t.toLowerCase(); if (!t || seen.has(k)) return false; seen.add(k); return true })
  const long = terms.filter((t) => t.length > 1)
  return (long.length ? long : terms).slice(0, MAX_TERMS)
}

/** The job fields Simpro is asked to look in. `key` is Simpro's filter name; `group` is the "Look in" choice that switches it on. */
export const JOB_FIELDS = [
  { key: 'Description', label: 'Description', group: 'text' },
  { key: 'Notes', label: 'Notes', group: 'text' },
  { key: 'Name', label: 'Job name', group: 'names' },
  { key: 'Site.Name', label: 'Site', group: 'names' },
  { key: 'Customer.CompanyName', label: 'Customer', group: 'names' },
]
export const GROUPS = [
  { id: 'text', label: 'Descriptions and notes' },
  { id: 'names', label: 'Job, site and customer names' },
  { id: 'assets', label: 'Asset and serial numbers' },
]

// Filters that might find a customer asset by its serial number. Simpro decides which of these it understands, and the
// page says which did (checkSearch below), so this is a list to try, not a promise.
export const ASSET_FILTERS = ['Serial', 'SerialNumber', 'CustomFields.Value']
const ASSET_COLUMNS = 'ID,Site,AssetType,Archived,CustomFields'
export const JOB_COLUMNS = 'ID,Name,Description,Notes,Customer,Site,Stage,Status'
export const SAFE_COLUMNS = 'ID,Name,Description,Customer,Site,Stage,Status' // what Ansur and the Test Bench already ask for

/** The text in Simpro's wildcard form (% on both ends, so it can be anywhere), safe to put in the address. */
export function likeTerm(text) {
  const enc = encodeURIComponent(String(text).trim()).replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return '%25' + enc + '%25'
}

export function jobsPath(companyId, field, text, { stage = '', columns = JOB_COLUMNS, pageSize = PAGE_SIZE, page = 1 } = {}) {
  const parts = [`${field}=${likeTerm(text)}`]
  if (stage) {
    if (!STAGES.includes(stage)) throw new Error('Not one of Simpro’s four stages: ' + stage)
    parts.push('Stage=' + stage)
  }
  parts.push('columns=' + columns, 'pageSize=' + pageSize)
  if (page > 1) parts.push('page=' + page)
  return `/companies/${companyId}/jobs/?${parts.join('&')}`
}

export function assetsPath(companyId, field, text, pageSize = PAGE_SIZE) {
  return `/companies/${companyId}/customerAssets/?${field}=${likeTerm(text)}&columns=${ASSET_COLUMNS}&pageSize=${pageSize}`
}

/** Every page of one question (up to MAX_PAGES). `capped`: there may be more than were fetched. A refused or lost page ends it. */
async function fetchPages(call, pathFor) {
  let rows = []
  let last
  for (let page = 1; page <= MAX_PAGES; page++) {
    last = await settle(call, 'GET', pathFor(page))
    if (!(ok(last) && Array.isArray(last.data))) return page === 1 ? { ok: false, rows: [], capped: false, res: last } : { ok: true, rows, capped: true, res: last }
    rows = rows.concat(last.data)
    if (last.data.length < PAGE_SIZE) return { ok: true, rows, capped: false, res: last }
  }
  return { ok: true, rows, capped: true, res: last }
}

const settle = (call, method, path) => call(method, path).catch((e) => ({ status: 0, data: String(e?.message || e), failed: true }))

export const customerName = (j) => j?.Customer?.CompanyName || [j?.Customer?.GivenName, j?.Customer?.FamilyName].filter(Boolean).join(' ') || ''
export const statusName = (j) => (j?.Status && typeof j.Status === 'object' ? j.Status.Name : j?.Status) || ''

/** What a job row says about where the text is: the labelled places it was seen, each with a short piece around it. */
export function whereFound(job, terms) {
  const list = Array.isArray(terms) ? terms : [terms]
  const places = []
  for (const [label, raw] of [['Description', job?.Description], ['Notes', job?.Notes]]) {
    if (raw === undefined || raw === null) continue
    const text = htmlToText(raw)
    // The piece around the first of the words that is in this text.
    for (const t of list) {
      const snip = snippetAround(text, t)
      if (snip) { places.push({ label, snip }); break }
    }
  }
  return places
}

/**
 * Jobs with `text` in the chosen places. Each field is asked on its own, since a field Simpro won't filter on fails the whole
 * request and one refusal shouldn't take the others down. Returns:
 *   jobs   [{ job, found: ['Notes', …] }]  newest job number first
 *   fields [{ key, label, status: 'ok' | 'refused' | 'unreachable', count, more }]  what Simpro said to each question
 */
export async function searchJobs(call, companyId, text, { groups = ['text', 'names'], stage = '' } = {}) {
  const terms = parseTerms(text)
  if (!terms.length) return { jobs: [], fields: [], terms: [] }
  const wanted = JOB_FIELDS.filter((f) => groups.includes(f.group))

  // One entry per word: the jobs that have that word somewhere (a Map of id to { job, found }).
  const perTerm = []
  const noteIn = (map, job, label) => {
    const key = String(job.ID)
    const have = map.get(key) || { job, found: [] }
    if (!have.found.includes(label)) have.found.push(label)
    // Keep the row that carries the most columns.
    if (Object.keys(job).length > Object.keys(have.job).length) have.job = job
    map.set(key, have)
  }

  // A lone number is tried as the job number.
  let byNumber = null
  if (terms.length === 1 && /^\d+$/.test(terms[0]) && groups.includes('names')) {
    const r = await settle(call, 'GET', `/companies/${companyId}/jobs/${terms[0]}`)
    if (ok(r) && r.data && r.data.ID) { byNumber = new Map(); noteIn(byNumber, r.data, 'Job number') }
    else if (r.status !== 404 && r.status !== 0) throw new SendError(`Job ${terms[0]}: ${simproErr(r)}`, r.status >= 500)
  }

  // What Simpro said to each place, over all the words: refused or unreachable if it ever was, "more" if any answer was cut short.
  const summary = wanted.map((f) => ({ key: f.key, label: f.label, status: 'ok', count: 0, more: false, code: undefined }))
  const runTerm = async (term, columns) => {
    const answers = await Promise.all(wanted.map((f) => fetchPages(call, (page) => jobsPath(companyId, f.key, term, { stage, columns, page }))))
    return answers
  }
  const absorb = (term, answers) => {
    const map = new Map()
    answers.forEach((a, i) => {
      const s = summary[i]
      if (a.ok) {
        for (const j of a.rows) if (j && j.ID != null) noteIn(map, j, wanted[i].label)
        s.count += a.rows.length
        if (a.capped) s.more = true
      } else if (s.status === 'ok') {
        const r = a.res || {}
        s.status = r.failed || r.status === 0 || r.status >= 500 ? 'unreachable' : 'refused'
        s.code = r.status
      }
    })
    perTerm.push(map)
  }

  let columns = JOB_COLUMNS
  if (wanted.length) {
    let first = await runTerm(terms[0], columns)
    // Simpro may not hand over Notes in a list row. If every question was refused, try again with the columns the other tools use.
    if (first.every((a) => !a.ok && a.res.status >= 400 && a.res.status < 500)) { columns = SAFE_COLUMNS; first = await runTerm(terms[0], columns) }
    absorb(terms[0], first)
    for (const term of terms.slice(1)) absorb(term, await runTerm(term, columns))
  }
  if (wanted.length && summary.every((f) => f.status !== 'ok') && !(byNumber && byNumber.size)) {
    throw new SendError(`Simpro didn’t answer the search (${summary.map((f) => f.code || 'no answer').join(', ')}). Try the exact job number.`, summary.some((f) => f.status === 'unreachable'))
  }
  // The job with that number is one more way the lone word can match, not another word to satisfy.
  if (byNumber) {
    if (perTerm.length) for (const { job, found } of byNumber.values()) for (const l of found) noteIn(perTerm[0], job, l)
    else perTerm.push(byNumber)
  }

  // A job must have every word (each in any place): the jobs found for all of them.
  const [head, ...rest] = perTerm.length ? perTerm : [new Map()]
  const jobs = []
  for (const [id, entry] of head) {
    if (!rest.every((m) => m.has(id))) continue
    const found = [...entry.found]
    let job = entry.job
    for (const m of rest) {
      const other = m.get(id)
      for (const label of other.found) if (!found.includes(label)) found.push(label)
      if (Object.keys(other.job).length > Object.keys(job).length) job = other.job
    }
    jobs.push({ job, found })
  }
  jobs.sort((a, b) => Number(b.job.ID) - Number(a.job.ID))
  return { jobs, fields: summary, terms }
}

/** A customer asset's serial number and model, from its custom fields (the same reading SimproSync uses). */
export function assetFacts(a) {
  const val = (name) => {
    const c = (a?.CustomFields || []).find((f) => String(f?.CustomField?.Name || '').trim().toLowerCase() === name)
    return c && c.Value ? String(c.Value) : ''
  }
  return {
    id: a?.ID,
    serial: val('serial number'),
    model: val('device model') || val('model'),
    type: a?.AssetType?.Name || '',
    site: a?.Site?.Name || '',
    siteId: a?.Site?.ID,
    archived: !!a?.Archived,
  }
}

/**
 * Customer assets whose serial number is `text`. Tries each filter in ASSET_FILTERS; the ones Simpro refuses are reported, and
 * rows are kept only if their own serial really does contain the text (so a filter Simpro ignored can't flood the page).
 */
export async function searchAssets(call, companyId, text) {
  const terms = parseTerms(text)
  if (!terms.length) return { assets: [], filters: [] }
  const filters = ASSET_FILTERS.map((f) => ({ key: f, status: 'ok', count: 0 }))
  const seen = new Map()
  for (const term of terms) {
    const answers = await Promise.all(ASSET_FILTERS.map((f) => settle(call, 'GET', assetsPath(companyId, f, term))))
    answers.forEach((r, i) => {
      if (!(ok(r) && Array.isArray(r.data))) {
        if (filters[i].status === 'ok') filters[i].status = r.failed || r.status === 0 || r.status >= 500 ? 'unreachable' : 'refused'
        return
      }
      filters[i].count += r.data.length
      for (const a of r.data) {
        const facts = assetFacts(a)
        // Only rows whose own serial really contains this word: a filter Simpro ignored can't flood the page.
        if (facts.serial.toLowerCase().includes(term.toLowerCase())) seen.set(String(facts.id), facts)
      }
    })
  }
  // With several words, the other words may be the asset's site or model ("DF-12345 Waitemata"): all of them must be in what is known of it.
  const assets = [...seen.values()].filter((a) => {
    const hay = [a.serial, a.model, a.type, a.site].join(' ').toLowerCase()
    return terms.every((t) => hay.includes(t.toLowerCase()))
  })
  return { assets, filters }
}

/**
 * The read-only check behind the page's "What can Simpro search?" button. For every place Simpro might be asked, two questions: a
 * letter that is in almost everything and a made-up word that is in nothing. A place that answers the first with rows and the second
 * with none really searches; one that answers both with rows ignores the filter; one that errors won't filter on it. Counts only:
 * nothing from a job is kept or shown.
 */
export async function checkSearch(call, companyId) {
  const NONSENSE = 'zqxjkv7zqxjkv7'
  const asks = [
    // "e" is in nearly every job description; "1" is in nearly every serial number.
    ...JOB_FIELDS.map((f) => ({ kind: 'job', key: f.key, label: f.label, common: 'e', path: (t) => jobsPath(companyId, f.key, t, { columns: 'ID', pageSize: 1 }) })),
    ...ASSET_FILTERS.map((f) => ({ kind: 'asset', key: f, label: 'Asset ' + f, common: '1', path: (t) => assetsPath(companyId, f, t, 1) })),
  ]
  const results = await Promise.all(asks.map(async (a) => {
    const [yes, no] = await Promise.all([settle(call, 'GET', a.path(a.common)), settle(call, 'GET', a.path(NONSENSE))])
    let verdict
    if (yes.failed || no.failed || yes.status >= 500 || no.status >= 500) verdict = 'unreachable'
    else if (!ok(yes) || !ok(no)) verdict = 'refused'
    else if (Array.isArray(no.data) && no.data.length > 0) verdict = 'ignored'
    else if (Array.isArray(yes.data) && yes.data.length > 0) verdict = 'works'
    else verdict = 'empty'
    return { kind: a.kind, key: a.key, label: a.label, verdict, status: [yes.status, no.status] }
  }))
  // Is the Notes text carried in a job list row, so results can show where it matched?
  const probe = await settle(call, 'GET', `/companies/${companyId}/jobs/?columns=ID,Notes&pageSize=1`)
  const notesColumn = ok(probe) && Array.isArray(probe.data) && probe.data.length > 0 ? 'Notes' in probe.data[0] : null
  return { results, notesColumn }
}

/** The check's verdicts in words, for the page. */
export const VERDICT_TEXT = {
  works: 'Simpro searches this.',
  ignored: 'Simpro accepts this filter but ignores it, so it finds nothing useful.',
  refused: 'Simpro refuses to search this.',
  empty: 'Simpro accepts this but found nothing to test it on.',
  unreachable: 'Simpro didn’t answer.',
}

/**
 * A job opened to read: the job itself, its cost centres, and the customer assets attached to it (serial and model where known).
 * Read only. Pieces that Simpro won't give are left out rather than failing the page.
 */
export async function loadJob(call, companyId, id) {
  const r = await call('GET', `/companies/${companyId}/jobs/${id}`)
  if (r.status === 404) throw new SendError(`Job ${id} was not found in this Simpro company.`, false)
  if (!ok(r) || !r.data || typeof r.data !== 'object') throw new SendError(`Job ${id}: ${simproErr(r)}`, r.status >= 500)
  const job = r.data
  const centres = []
  const secs = await settle(call, 'GET', `/companies/${companyId}/jobs/${id}/sections/`)
  const sections = ok(secs) && Array.isArray(secs.data) ? secs.data.slice(0, 10) : []
  await Promise.all(sections.map(async (s) => {
    const ccs = await settle(call, 'GET', `/companies/${companyId}/jobs/${id}/sections/${s.ID}/costCenters/`)
    const list = ok(ccs) && Array.isArray(ccs.data) ? ccs.data.slice(0, 20) : []
    await Promise.all(list.map(async (cc) => {
      const ar = await settle(call, 'GET', `/companies/${companyId}/jobs/${id}/sections/${s.ID}/costCenters/${cc.ID}/assets/`)
      const assets = ok(ar) && Array.isArray(ar.data) ? ar.data.slice(0, 40) : []
      centres.push({ section: s.Name || s.ID, name: cc.Name || cc.CostCenter?.Name || String(cc.ID), assets })
    }))
  }))
  centres.sort((a, b) => String(a.section).localeCompare(String(b.section)) || String(a.name).localeCompare(String(b.name)))
  // Serial and model for each attached asset: from its site's asset record.
  const siteId = job.Site?.ID
  const attached = []
  for (const c of centres) for (const a of c.assets) attached.push(a)
  const facts = new Map()
  if (siteId) {
    await Promise.all(attached.map(async (a) => {
      const aid = a.Asset?.ID ?? a.ID
      if (aid == null || facts.has(aid)) return
      const f = await settle(call, 'GET', `/companies/${companyId}/sites/${siteId}/assets/${aid}/customFields/`)
      if (ok(f) && Array.isArray(f.data)) facts.set(aid, assetFacts({ ID: aid, CustomFields: f.data }))
    }))
  }
  const assets = [...new Map(attached.map((a) => { const aid = a.Asset?.ID ?? a.ID; return [aid, { id: aid, name: a.Asset?.Name || a.Name || '', ...(facts.get(aid) || {}) }] })).values()]
  return { job, centres, assets }
}

/**
 * Jobs with their whole description and notes, for exporting. A job row from a search already has them when Simpro puts Notes in
 * a list row; any that don't are read one by one (a few at a time, so Simpro isn't flooded). Read only.
 *   onProgress(done, total), isCancelled(): called as it goes.   Returns { jobs, failed } (failed: how many could not be read).
 */
export async function completeJobs(call, companyId, jobs, { concurrency = 4, onProgress = () => {}, isCancelled = () => false } = {}) {
  const out = jobs.map((j) => j)
  const need = out.map((j, i) => [j, i]).filter(([j]) => j.Description === undefined || j.Notes === undefined)
  let next = 0, done = 0, failed = 0
  onProgress(0, need.length)
  const worker = async () => {
    while (next < need.length && !isCancelled()) {
      const [job, i] = need[next++]
      const r = await settle(call, 'GET', `/companies/${companyId}/jobs/${job.ID}`)
      if (ok(r) && r.data && typeof r.data === 'object') out[i] = { ...job, ...r.data }
      else failed++
      onProgress(++done, need.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, need.length) }, worker))
  return { jobs: out, failed, cancelled: isCancelled() }
}
