/* Simpro Jobs: finding, changing and closing a job that already exists. No React and no Firebase, so the tests run it as it is.
   `call(method, path, body)` is makeCall()'s result (apps/testbench/src/simpro-api.js).

   Finding: the search is Simpro Deep Search's own (apps/simprosearch/src/search.js, reused as it is): each word is looked for in the job
   name, site, customer, description and notes, and a job needs every word. Here the results are shown in three sections: job number and
   title first, then jobs found only by their description, then only by their notes.

   Changing: the same plan, review and run as making a job (plan.js), and the relay holds each write to what this does (Code.js):
   - text is only ever ADDED to the end of a job's description or notes (never replaced: a job's description can be rich text, tables and
     all, which a phone's plain text box would flatten), and the relay refuses a description change that isn't an addition to the end;
   - the title can be changed, and Job Type, Charge category and Priority (the custom fields the new-job form sets);
   - Close starts on what SimproSync does, Stage Complete then Status "Job : Completed", and the person can pick another stage or status and add a
     note to the end of the job's notes (all three optional: whatever is left as it is isn't touched).
   A job that is Invoiced or Archived can't be changed here. */
import { SendError, ok, simproErr } from '../../testbench/src/simpro-api.js'
import { customerName, searchJobs, statusName, whereFound } from '../../simprosearch/src/search.js'
import { htmlToText } from '../../simprosearch/src/html.js'
import { cleanText, cleanTitle, titleProblem, toHtml } from './draft.js'

export const RECENT_PAGE = 30
/** Stages a job can still be changed in here (edited, closed, or moved to another stage). */
export const EDITABLE_STAGES = ['Pending', 'Progress', 'Complete']
/** The stages a job can be set to: Simpro's four, which is all its job update accepts (Invoiced is Simpro's own doing). */
export const STAGE_CHOICES = ['Pending', 'Progress', 'Complete', 'Archived']
/** The stage chips on the Find screen ('' is "any"). */
export const STAGE_CHIPS = ['Pending', 'Progress', 'Complete']
/** A typed addition to a job's description or notes: an update, not a rewrite. */
export const MAX_ADD = 5000

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

// ── Finding ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const jobTitle = (j) => String(j?.Name || '').trim() || String(htmlToText(j?.Description || '')).split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 90) || `Job ${j?.ID}`

/** A row for the results list: the plain facts, for either a search hit or a recent job. */
export const jobRow = (j) => ({ id: j.ID, title: jobTitle(j), customer: customerName(j), site: j.Site?.Name || '', stage: j.Stage || '', status: statusName(j) })

export function recentJobsPath(companyId, { stage = '', page = 1, ordered = true } = {}) {
  const parts = ['columns=ID,Name,Description,Customer,Site,Stage,Status', `pageSize=${RECENT_PAGE}`]
  if (ordered) parts.push('orderby=-ID')
  if (stage) parts.push('Stage=' + stage)
  if (page > 1) parts.push('page=' + page)
  return `/companies/${companyId}/jobs/?${parts.join('&')}`
}

/** The newest jobs (optionally in one stage): what the Find screen shows before anything is typed. A refused ordering is dropped. */
export async function loadRecentJobs(call, companyId, { stage = '', page = 1 } = {}) {
  let r = await call('GET', recentJobsPath(companyId, { stage, page }))
  if (!ok(r) && r.status >= 400 && r.status < 500) r = await call('GET', recentJobsPath(companyId, { stage, page, ordered: false }))
  if (!ok(r) || !Array.isArray(r.data)) throw new SendError(`Jobs: ${simproErr(r)}`, r.status >= 500 || r.status === 429)
  return { rows: r.data.filter((j) => j && j.ID).map(jobRow), more: r.data.length >= RECENT_PAGE }
}

const NAME_PLACES = ['Job number', 'Job name', 'Site', 'Customer']

/**
 * Search results in the three sections: a job goes in the first it belongs to. "names": its number, title, site or customer matched;
 * "description": otherwise its description did; "notes": only its notes did. Each item: { row, places: where it matched, snippets }.
 */
export function groupResults({ jobs = [], fields = [], terms = [] } = {}) {
  const groups = { names: [], description: [], notes: [] }
  for (const { job, found } of jobs) {
    const where = found.some((l) => NAME_PLACES.includes(l)) ? 'names' : found.includes('Description') ? 'description' : 'notes'
    const label = where === 'description' ? 'Description' : 'Notes'
    const snippets = where === 'names' ? [] : whereFound(job, terms).filter((p) => p.label === label)
    groups[where].push({ row: jobRow(job), places: found, snippets })
  }
  for (const g of Object.values(groups)) g.sort((a, b) => Number(b.row.id) - Number(a.row.id))
  const notSearched = fields.filter((f) => f.status !== 'ok').map((f) => f.label)
  return { groups, terms, notSearched, total: jobs.length }
}

// ── Filtering by the technician a job is assigned to ──────────────────────────────────────────────────────────────────────────

export const TECH_PAGE = 100       // jobs shown for a technician with nothing typed
const ID_PAGE = 250
const ID_PAGES = 4                 // with a search: the technician's newest 1,000 jobs are checked against the results
const SCAN_PAGES = 3               // if Simpro can't filter: the newest 750 jobs are read and filtered here
const TECH_COLUMNS = 'ID,Name,Description,Customer,Site,Stage,Status,Technicians'

/** The staff ids a job row lists as its technicians (Simpro gives objects { ID, Name, … }; a bare number is read too). */
export function technicianIds(j) {
  const t = j?.Technicians
  const list = Array.isArray(t) ? t : t ? [t] : []
  return list.map((x) => (x && typeof x === 'object' ? x.ID : x)).filter((x) => x != null).map(Number)
}
const hasTechnicians = (j) => !!j && Object.prototype.hasOwnProperty.call(j, 'Technicians')

function positiveId(v) {
  const id = Number(v)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Choose a technician.')
  return id
}

function jobsQuery(companyId, { columns, filter = '', stage = '', page = 1, pageSize, ordered = true }) {
  const parts = [`columns=${columns}`]
  if (filter) parts.push(filter)
  parts.push(`pageSize=${pageSize}`)
  if (ordered) parts.push('orderby=-ID')
  if (stage) parts.push('Stage=' + stage)
  if (page > 1) parts.push('page=' + page)
  return `/companies/${companyId}/jobs/?${parts.join('&')}`
}

/**
 * The jobs a technician is assigned to, newest first. Simpro is asked to filter (Technicians.ID); the answer is trusted only if EVERY row
 * says that technician is on it, because a filter Simpro ignores would hand back unrelated jobs. If it refuses the filter, or ignores it,
 * the newest jobs are read with their technicians and filtered here, and `via: 'scan'` says so. If this Simpro doesn't list technicians
 * in the job list at all, nothing can be filtered and it says that. Returns { jobs (raw rows), via, capped, scanned }.
 */
async function readTechnicianJobs(call, companyId, id, { stage, pageSize, pages }) {
  const mine = []
  let trusted = true
  let capped = false
  for (let page = 1; page <= pages && trusted; page++) {
    const r = await call('GET', jobsQuery(companyId, { columns: TECH_COLUMNS, filter: `Technicians.ID=${id}`, stage, page, pageSize }))
    if (!ok(r) || !Array.isArray(r.data)) { trusted = false; break }
    const rows = r.data.filter((j) => j && j.ID)
    if (rows.length && !rows.every((j) => hasTechnicians(j) && technicianIds(j).includes(id))) { trusted = false; break }
    mine.push(...rows)
    if (r.data.length < pageSize) return { jobs: mine, via: 'simpro', capped: false, scanned: 0 }
    capped = page === pages
  }
  if (trusted) return { jobs: mine, via: 'simpro', capped, scanned: 0 }

  const jobs = []
  let scanned = 0
  let more = false
  for (let page = 1; page <= SCAN_PAGES; page++) {
    const s = await call('GET', jobsQuery(companyId, { columns: TECH_COLUMNS, stage, page, pageSize: ID_PAGE }))
    if (!ok(s) || !Array.isArray(s.data)) {
      if (page === 1) throw new SendError(`Jobs: ${simproErr(s)}`, s.status >= 500 || s.status === 429)
      break
    }
    if (s.data.length && !s.data.some(hasTechnicians)) throw new SendError('This Simpro doesn’t list a job’s technicians in the job list, so jobs can’t be filtered by technician here.', false)
    scanned += s.data.length
    for (const j of s.data) if (j && j.ID && technicianIds(j).includes(id)) jobs.push(j)
    more = s.data.length >= ID_PAGE
    if (!more) break
  }
  return { jobs, via: 'scan', capped: more, scanned }
}

/** The jobs a technician is assigned to (nothing typed): rows for the list, and how it was found. */
export async function loadJobsByTechnician(call, companyId, technicianId, { stage = '' } = {}) {
  const r = await readTechnicianJobs(call, companyId, positiveId(technicianId), { stage, pageSize: TECH_PAGE, pages: 1 })
  return { rows: r.jobs.map(jobRow), more: r.capped, via: r.via, scanned: r.scanned }
}

/**
 * Jobs with every typed word in them (any place), in the three sections; with `technician` ({ id }) only those that technician is assigned
 * to (the search's results checked against that technician's jobs). Throws SendError when Simpro answered none of the questions.
 * `technician` on the answer says how the filter was done and whether it covered everything: { via, capped, scanned }.
 */
export async function findJobs(call, companyId, text, { stage = '', technician = null } = {}) {
  const found = groupResults(await searchJobs(call, companyId, text, { groups: ['text', 'names'], stage }))
  if (!technician) return found
  const t = await readTechnicianJobs(call, companyId, positiveId(technician.id), { stage, pageSize: ID_PAGE, pages: ID_PAGES })
  const ids = new Set(t.jobs.map((j) => String(j.ID)))
  const keep = (list) => list.filter((g) => ids.has(String(g.row.id)))
  const groups = { names: keep(found.groups.names), description: keep(found.groups.description), notes: keep(found.groups.notes) }
  return { ...found, groups, total: groups.names.length + groups.description.length + groups.notes.length, technician: { via: t.via, capped: t.capped, scanned: t.scanned } }
}

// ── Reading one job ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function normaliseJob(j) {
  return {
    id: j.ID, title: jobTitle(j), name: String(j.Name || ''), description: String(j.Description || ''), notes: String(j.Notes || ''),
    customer: customerName(j), customerId: j.Customer?.ID, site: j.Site?.Name || '', siteId: j.Site?.ID,
    stage: j.Stage || '', status: statusName(j), statusId: j.Status && typeof j.Status === 'object' ? j.Status.ID : null,
    issued: j.DateIssued || '', due: j.DueDate || '', modified: j.DateModified || '', fields: Array.isArray(j.CustomFields) ? j.CustomFields : [],
  }
}

/** One job, ready to show. Throws SendError (404 says the job isn't there). */
export async function loadJobDetail(call, companyId, id) {
  const r = await call('GET', `/companies/${companyId}/jobs/${id}`)
  if (r.status === 404) throw new SendError(`Job ${id} was not found in Simpro.`, false)
  if (!ok(r) || !r.data || typeof r.data !== 'object') throw new SendError(`Job ${id}: ${simproErr(r)}`, r.status >= 500 || r.status === 429)
  return normaliseJob(r.data)
}

/** What a job's custom field holds (by the field's id), as text, or ''. */
export function fieldValue(job, fieldId) {
  const f = (job?.fields || []).find((x) => x?.CustomField?.ID === fieldId)
  return f && f.Value != null ? String(f.Value).trim() : ''
}

export const canEdit = (job) => EDITABLE_STAGES.includes(job?.stage)
/** Whether the Close screen (note, stage, status) is open to the job: the same jobs as editing. */
export const canClose = (job) => canEdit(job)

/**
 * The job statuses Simpro has, [{ id, name }] in its order. The list also holds lead and quote statuses, so the ones named "Job …" are
 * kept when there are any (every status otherwise). Throws SendError.
 */
export async function loadStatusCodes(call, companyId) {
  const r = await call('GET', `/companies/${companyId}/setup/statusCodes/projects/`)
  if (!ok(r) || !Array.isArray(r.data)) throw new SendError(`Status codes: ${simproErr(r)}`, r.status >= 500 || r.status === 429)
  const all = r.data.filter((c) => c && c.ID != null && c.Name).map((c) => ({ id: c.ID, name: String(c.Name).trim() }))
  const jobs = all.filter((c) => /^job\b/i.test(c.name))
  return jobs.length ? jobs : all
}

/** Simpro's "Job : Completed" status, the one closing a job starts on (the same lookup SimproSync makes), or null. */
export const completedStatus = (codes) => (codes || []).find((c) => norm(c.name) === 'job : completed') || null

export async function loadCompletedStatus(call, companyId) {
  return completedStatus(await loadStatusCodes(call, companyId))
}

// ── Changing ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const FIELD_KEYS = ['jobType', 'chargeCategory', 'priority']

/**
 * The plan for adding to a job's description or notes, changing its title, and/or changing its Job Type, Charge category or Priority. `job` is
 * normaliseJob()'s; `changes` is { title, addDescription, addNotes, jobType, chargeCategory, priority } (the three fields are options { name } or nothing); a custom
 * field left as it is, or put back to what it holds, is not a step. Throws Error in words when there is nothing to change or it can't be.
 * The text step reads the job just before it writes (prepare), so what is added goes after whatever is there then.
 */
export function buildEditPlan({ job, changes = {}, setup, companyId }) {
  if (!canEdit(job)) throw new Error(`Job ${job?.id} is ${job?.stage || 'not open'}, so it can’t be changed here.`)
  const base = `/companies/${companyId}/jobs/${job.id}`
  const addDescription = cleanText(changes.addDescription)
  const addNotes = cleanText(changes.addNotes)
  if (addDescription.length > MAX_ADD || addNotes.length > MAX_ADD) throw new Error(`An addition can be up to ${MAX_ADD} characters.`)
  const plan = []
  // The title (Simpro's job "Name") is replaced, not added to: it is one short plain line, and the review shows it from → to.
  if (changes.title !== undefined && cleanTitle(changes.title) !== cleanTitle(job.name)) {
    const bad = titleProblem(changes.title)
    if (bad) throw new Error(bad)
    const title = cleanTitle(changes.title)
    if (!title) throw new Error('A title can’t be empty.')
    plan.push({
      id: 'title', title: 'Change the title', facts: [['Title', `${cleanTitle(job.name) || 'none'} → ${title}`]],
      request: () => ({ method: 'PATCH', path: base, body: { Name: title } }),
    })
  }
  if (addDescription || addNotes) {
    plan.push({
      id: 'text', title: 'Add to the job’s text',
      facts: [
        ...(addDescription ? [['Added to the end of the description', addDescription]] : []),
        ...(addNotes ? [['Added to the end of the notes', addNotes]] : []),
      ],
      prepare: async (call, ctx) => {
        const r = await call('GET', `${base}`)
        if (!ok(r) || !r.data) throw new SendError(`Could not read the job first, so nothing was changed: ${simproErr(r)}`, false)
        if (!EDITABLE_STAGES.includes(r.data.Stage)) throw new Error(`The job is ${r.data.Stage} now, so it can’t be changed here.`)
        ctx.fresh = r.data
      },
      request: (_s, ctx) => {
        const body = {}
        if (addDescription) body.Description = String(ctx.fresh?.Description || '') + toHtml(addDescription)
        if (addNotes) body.Notes = String(ctx.fresh?.Notes || '') + toHtml(addNotes)
        return { method: 'PATCH', path: base, body }
      },
    })
  }
  for (const key of FIELD_KEYS) {
    const wanted = changes[key]
    if (!wanted?.name) continue
    const field = setup?.[key]?.field
    if (!field?.id) throw new Error(`Simpro’s ${key === 'jobType' ? 'Job type' : key === 'chargeCategory' ? 'Charge category' : 'Priority'} field was not found, so it can’t be changed.`)
    const now = fieldValue(job, field.id)
    if (norm(now) === norm(wanted.name)) continue
    plan.push({
      id: key, title: `Change “${field.name}”`, facts: [[field.name, `${now || 'not set'} → ${wanted.name}`]],
      request: () => ({ method: 'PATCH', path: `${base}/customFields/${field.id}`, body: { Value: wanted.name } }),
    })
  }
  if (!plan.length) throw new Error('Nothing to change yet.')
  return plan
}

/**
 * The plan for closing a job, or moving it to another stage or status: an optional note added to the end of its notes, then the stage, then
 * the status, each its own step and each only if it differs from what the job has now. It starts on what SimproSync does (stage Complete,
 * status "Job : Completed") when the page passes those. Throws Error in words (including "Nothing to change yet").
 */
export function buildClosePlan({ job, stage = 'Complete', statusCode = null, addNotes = '', companyId }) {
  if (!canClose(job)) throw new Error(`Job ${job?.id} is ${job?.stage || 'not open'}, so it can’t be changed here.`)
  if (!STAGE_CHOICES.includes(stage)) throw new Error('Choose one of Simpro’s stages.')
  const note = cleanText(addNotes)
  if (note.length > MAX_ADD) throw new Error(`A note can be up to ${MAX_ADD} characters.`)
  const path = `/companies/${companyId}/jobs/${job.id}`
  const plan = []
  // The note goes first, while the job is still open; it is read fresh just before it is written, so a note added in Simpro meanwhile is kept.
  if (note) {
    plan.push({
      id: 'notes', title: 'Add a note', facts: [['Added to the end of the notes', note]],
      prepare: async (call, ctx) => {
        const r = await call('GET', path)
        if (!ok(r) || !r.data) throw new SendError(`Could not read the job first, so nothing was changed: ${simproErr(r)}`, false)
        if (!EDITABLE_STAGES.includes(r.data.Stage)) throw new Error(`The job is ${r.data.Stage} now, so it can’t be changed here.`)
        ctx.fresh = r.data
      },
      request: (_s, ctx) => ({ method: 'PATCH', path, body: { Notes: String(ctx.fresh?.Notes || '') + toHtml(note) } }),
    })
  }
  if (stage !== job.stage) {
    plan.push({ id: 'stage', title: `Set the stage to ${stage}`, facts: [['Stage', `${job.stage || 'none'} → ${stage}`]], request: () => ({ method: 'PATCH', path, body: { Stage: stage } }) })
  }
  if (statusCode?.id && statusCode.id !== job.statusId) {
    // A bare number: Simpro refuses { Status: { ID } } (SimproSync and the Test Bench do the same).
    plan.push({ id: 'status', title: `Set the status to “${statusCode.name}”`, facts: [['Status', `${job.status || 'not set'} → ${statusCode.name}`]], request: () => ({ method: 'PATCH', path, body: { Status: statusCode.id } }) })
  }
  if (!plan.length) throw new Error('Nothing to change yet.')
  return plan
}

/** The plain-words state of a change run (see plan.js runPlan): done, refused (nothing changed), unsure (no answer), or partial. */
export function describeChange(plan, run) {
  const left = plan.filter((s) => !run.done.includes(s.id))
  if (!run.failed && !left.length) return { state: 'done', text: 'The change was made in Simpro.' }
  const why = run.failed?.message || 'it was not sent.'
  if (!run.done.length) {
    return run.failed?.unknown
      ? { state: 'unsure', text: 'Simpro didn’t confirm. The change may or may not have been made: look at the job again before trying again.' }
      : { state: 'refused', text: 'Nothing was changed: ' + why }
  }
  const failed = plan.find((s) => s.id === run.failed?.step)
  return { state: 'partial', text: `Part of the change was made, but “${failed?.title || 'a step'}” did not finish: ${why}` }
}
