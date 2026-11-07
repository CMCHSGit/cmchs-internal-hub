/* Simpro Deep Search: what to ask Simpro, and what to make of the answers. Read only: every call here is a GET through the
   hub's Simpro relay (apps/simprosync's allowlist), so nothing can be written to Simpro from this file.
   No React and no Firebase, so the tests run it as it is. `call(method, path)` is makeCall()'s result (testbench/simpro-api.js). */
import { ok, simproErr, SendError } from '../../testbench/src/simpro-api.js'
import { htmlToText, snippetAround } from './html.js'

export const STAGES = ['Pending', 'Progress', 'Complete', 'Archived']
export const PAGE_SIZE = 30

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
const JOB_COLUMNS = 'ID,Name,Description,Notes,Customer,Site,Stage,Status'
const SAFE_COLUMNS = 'ID,Name,Description,Customer,Site,Stage,Status' // what Ansur and the Test Bench already ask for

/** The text in Simpro's wildcard form (% on both ends, so it can be anywhere), safe to put in the address. */
export function likeTerm(text) {
  const enc = encodeURIComponent(String(text).trim()).replace(/[!'()*~]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return '%25' + enc + '%25'
}

export function jobsPath(companyId, field, text, { stage = '', columns = JOB_COLUMNS, pageSize = PAGE_SIZE } = {}) {
  const parts = [`${field}=${likeTerm(text)}`]
  if (stage) {
    if (!STAGES.includes(stage)) throw new Error('Not one of Simpro’s four stages: ' + stage)
    parts.push('Stage=' + stage)
  }
  parts.push('columns=' + columns, 'pageSize=' + pageSize)
  return `/companies/${companyId}/jobs/?${parts.join('&')}`
}

export function assetsPath(companyId, field, text, pageSize = PAGE_SIZE) {
  return `/companies/${companyId}/customerAssets/?${field}=${likeTerm(text)}&columns=${ASSET_COLUMNS}&pageSize=${pageSize}`
}

const settle = (call, method, path) => call(method, path).catch((e) => ({ status: 0, data: String(e?.message || e), failed: true }))

export const customerName = (j) => j?.Customer?.CompanyName || [j?.Customer?.GivenName, j?.Customer?.FamilyName].filter(Boolean).join(' ') || ''
export const statusName = (j) => (j?.Status && typeof j.Status === 'object' ? j.Status.Name : j?.Status) || ''

/** What a job row says about where the text is: the labelled places it was seen, each with a short piece around it. */
export function whereFound(job, text) {
  const places = []
  for (const [label, raw] of [['Description', job?.Description], ['Notes', job?.Notes]]) {
    if (raw === undefined || raw === null) continue
    const snip = snippetAround(htmlToText(raw), text)
    if (snip) places.push({ label, snip })
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
  const q = String(text || '').trim()
  if (!q) return { jobs: [], fields: [] }
  const byId = new Map()
  const note = (job, label) => {
    const key = String(job.ID)
    const have = byId.get(key) || { job, found: [] }
    if (!have.found.includes(label)) have.found.push(label)
    // Keep the row that carries the most columns.
    if (Object.keys(job).length > Object.keys(have.job).length) have.job = job
    byId.set(key, have)
  }

  if (/^\d+$/.test(q) && groups.includes('names')) {
    const r = await settle(call, 'GET', `/companies/${companyId}/jobs/${q}`)
    if (ok(r) && r.data && r.data.ID) note(r.data, 'Job number')
    else if (r.status !== 404 && r.status !== 0) throw new SendError(`Job ${q}: ${simproErr(r)}`, r.status >= 500)
  }

  const wanted = JOB_FIELDS.filter((f) => groups.includes(f.group))
  const ask = (columns) => Promise.all(wanted.map((f) => settle(call, 'GET', jobsPath(companyId, f.key, q, { stage, columns }))))
  let answers = await ask(JOB_COLUMNS)
  // Simpro may not hand over Notes in a list row. If every question was refused, try again with the columns the other tools use.
  if (answers.length && answers.every((r) => !ok(r) && r.status >= 400 && r.status < 500)) answers = await ask(SAFE_COLUMNS)
  const fields = wanted.map((f, i) => {
    const r = answers[i]
    if (ok(r) && Array.isArray(r.data)) {
      for (const j of r.data) if (j && j.ID != null) note(j, f.label)
      return { key: f.key, label: f.label, status: 'ok', count: r.data.length, more: r.data.length >= PAGE_SIZE }
    }
    return { key: f.key, label: f.label, status: r.failed || r.status === 0 || r.status >= 500 ? 'unreachable' : 'refused', count: 0, more: false, code: r.status }
  })
  if (wanted.length && fields.every((f) => f.status !== 'ok') && !byId.size) {
    throw new SendError(`Simpro didn’t answer the search (${fields.map((f) => f.code || 'no answer').join(', ')}). Try the exact job number.`, fields.some((f) => f.status === 'unreachable'))
  }
  const jobs = [...byId.values()].sort((a, b) => Number(b.job.ID) - Number(a.job.ID))
  return { jobs, fields }
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
  const q = String(text || '').trim()
  if (!q) return { assets: [], filters: [] }
  const answers = await Promise.all(ASSET_FILTERS.map((f) => settle(call, 'GET', assetsPath(companyId, f, q))))
  const seen = new Map()
  const filters = ASSET_FILTERS.map((f, i) => {
    const r = answers[i]
    if (!(ok(r) && Array.isArray(r.data))) return { key: f, status: r.failed || r.status === 0 || r.status >= 500 ? 'unreachable' : 'refused', count: 0 }
    for (const a of r.data) {
      const facts = assetFacts(a)
      if (facts.serial.toLowerCase().includes(q.toLowerCase())) seen.set(String(facts.id), facts)
    }
    return { key: f, status: 'ok', count: r.data.length }
  })
  return { assets: [...seen.values()], filters }
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
