/* Simpro Jobs: finding, changing and closing a job that already exists. No React and no Firebase, so the tests run it as it is.
   `call(method, path, body)` is makeCall()'s result (apps/testbench/src/simpro-api.js).

   Finding: the search is Simpro Deep Search's own (apps/simprosearch/src/search.js, reused as it is): each word is looked for in the job
   name, site, customer, description and notes, and a job needs every word. Here the results are shown in three sections: job number and
   title first, then jobs found only by their description, then only by their notes.

   Changing: the same plan, review and run as making a job (plan.js), and the relay holds each write to what this does (Code.js):
   - text is only ever ADDED to the end of a job's description or notes (never replaced: a job's description can be rich text, tables and
     all, which a phone's plain text box would flatten), and the relay refuses a description change that isn't an addition to the end;
   - Job Type, Charge category and Priority can be changed (the custom fields the new-job form sets);
   - Close is what SimproSync does: Stage Complete, then Status "Job : Completed".
   A job that is Invoiced or Archived can't be changed here. */
import { SendError, ok, simproErr } from '../../testbench/src/simpro-api.js'
import { customerName, searchJobs, statusName, whereFound } from '../../simprosearch/src/search.js'
import { htmlToText } from '../../simprosearch/src/html.js'
import { cleanText, toHtml } from './draft.js'

export const RECENT_PAGE = 30
/** Stages a job can still be changed in here, and the ones it can be closed from. */
export const EDITABLE_STAGES = ['Pending', 'Progress', 'Complete']
export const CLOSABLE_STAGES = ['Pending', 'Progress']
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

/** Jobs with every typed word in them (any place), in the three sections. Throws SendError when Simpro answered none of the questions. */
export async function findJobs(call, companyId, text, { stage = '' } = {}) {
  return groupResults(await searchJobs(call, companyId, text, { groups: ['text', 'names'], stage }))
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
export const canClose = (job) => CLOSABLE_STAGES.includes(job?.stage)

/** Simpro's "Job : Completed" status, the one closing a job sets (the same lookup SimproSync makes), or null. */
export async function loadCompletedStatus(call, companyId) {
  const r = await call('GET', `/companies/${companyId}/setup/statusCodes/projects/`)
  if (!ok(r) || !Array.isArray(r.data)) throw new SendError(`Status codes: ${simproErr(r)}`, r.status >= 500 || r.status === 429)
  const hit = r.data.find((c) => norm(c.Name) === 'job : completed')
  return hit ? { id: hit.ID, name: String(hit.Name).trim() } : null
}

// ── Changing ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const FIELD_KEYS = ['jobType', 'chargeCategory', 'priority']

/**
 * The plan for adding to a job's description or notes and/or changing its Job Type, Charge category or Priority. `job` is normaliseJob()'s;
 * `changes` is { addDescription, addNotes, jobType, chargeCategory, priority } (the last three are options { name } or nothing); a custom
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

/** The plan for closing a job: Stage Complete, then Status "Job : Completed", as SimproSync does. Throws Error in words. */
export function buildClosePlan({ job, statusCode, companyId }) {
  if (!canClose(job)) throw new Error(`Job ${job?.id} is ${job?.stage || 'not open'}, so there is nothing to close.`)
  if (!statusCode?.id) throw new Error('Simpro has no “Job : Completed” status, so a job can’t be closed from here.')
  const path = `/companies/${companyId}/jobs/${job.id}`
  return [
    { id: 'stage', title: 'Set the stage to Complete', facts: [['Stage', `${job.stage} → Complete`]], request: () => ({ method: 'PATCH', path, body: { Stage: 'Complete' } }) },
    // A bare number: Simpro refuses { Status: { ID } } (SimproSync and the Test Bench do the same).
    { id: 'status', title: `Set the status to “${statusCode.name}”`, facts: [['Status', `${job.status || 'not set'} → ${statusCode.name}`]], request: () => ({ method: 'PATCH', path, body: { Status: statusCode.id } }) },
  ]
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
