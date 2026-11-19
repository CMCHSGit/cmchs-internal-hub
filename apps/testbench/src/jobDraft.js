/* "No job for these tests yet?" in the Test Bench's bar: opens Simpro Jobs' new-job form with a title and description made from the ticked tests,
   and, once the job is created there, brings the person back here to attach the reports to it. NOTHING is created from here: the form is only
   filled in (its customer and site are still chosen by the person), and the job is made by Simpro Jobs' own review screen and its Create button.
   The form's draft lives in sessionStorage (apps/simprojobs/src/App.jsx, DRAFT_KEY), the same place for both pages. Plain functions over a
   storage object, so the tests run them with a made-up one. */
import { NO_CUSTOMER, reportsLink } from './reports.js'
import { splitSerials } from './bench-tests.js'

export const DRAFT_KEY = 'simprojobs.draft'   // must match apps/simprojobs/src/App.jsx
export const RETURN_KEY = 'simprojobs.return'
export const RETURN_MAX_AGE_MS = 6 * 60 * 60 * 1000
const MAX_TITLE = 100   // Simpro Jobs' own limit for a job's title
const MAX_LINES = 40

const plain = (s) => String(s ?? '').replace(/[<>\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()

/** The title and description for a job covering these tests (Previous tests groups): plain text, no markup. Customer and site are left to the person. */
export function buildJobDraft(groups) {
  const customers = [...new Set(groups.map((g) => plain(g.customer)).filter((c) => c && c !== NO_CUSTOMER))]
  const title = ('Testing of new equipment' + (customers.length === 1 ? ' - ' + customers[0] : '')).slice(0, MAX_TITLE).trim()
  const lines = groups.slice(0, MAX_LINES).map((g) => `${plain(g.serial)}${plain(g.model) ? ' - ' + plain(g.model) : ''}`)
  const more = groups.length - lines.length
  const description = ['Electrical safety and function testing of new equipment, with the test reports attached.', '', `Devices (${groups.length}):`, ...lines, ...(more > 0 ? [`and ${more} more`] : [])].join('\n')
  return { title, description }
}

/**
 * The draft Simpro Jobs should open with: what is already typed is kept (only an empty title or description is filled in), a job already made
 * in this session starts a fresh form, and a run that has not finished is never touched. { draft, wrote }.
 */
export function mergeDraft(existing, built) {
  const ex = existing && typeof existing === 'object' ? existing : {}
  const run = ex.run
  const finished = !!(run && run.jobId && !run.failed && !run.inflight)
  if (run && !finished) return { draft: ex, wrote: false }
  const form = finished ? {} : { ...(ex.form || {}) }
  const has = (v) => String(v || '').trim() !== ''
  return { draft: { form: { ...form, title: has(form.title) ? form.title : built.title, description: has(form.description) ? form.description : built.description }, run: null }, wrote: true }
}

/** The ticked tests' serial numbers, each once, a set's devices separately. */
export const serialsOf = (groups) => [...new Set(groups.flatMap((g) => splitSerials(g.serial)))]

/** Fills in Simpro Jobs' form for these tests and remembers how to come back. Returns { wrote }; false (nothing touched) when storage is unavailable or a run is unfinished. */
export function startJobFor(groups, storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    let existing = null
    try { existing = JSON.parse(storage.getItem(DRAFT_KEY)) } catch { existing = null }
    const { draft, wrote } = mergeDraft(existing, buildJobDraft(groups))
    if (wrote) storage.setItem(DRAFT_KEY, JSON.stringify(draft))
    storage.setItem(RETURN_KEY, JSON.stringify({ serials: serialsOf(groups).slice(0, 200), at: now }))
    return { wrote }
  } catch { return { wrote: false } }
}

/** The tests to come back to once the job is made: { serials } or null (none, or older than six hours). */
export function readReturn(storage = globalThis.sessionStorage, now = Date.now()) {
  try {
    const r = JSON.parse(storage.getItem(RETURN_KEY))
    return r && Array.isArray(r.serials) && now - r.at < RETURN_MAX_AGE_MS ? { serials: r.serials.map(String) } : null
  } catch { return null }
}
export const clearReturn = (storage = globalThis.sessionStorage) => { try { storage.removeItem(RETURN_KEY) } catch { /* nothing kept */ } }

/** The Test Bench address that shows those tests, ticked, with this job chosen to attach them to. */
export const returnHref = (ret, jobId) => reportsLink(ret.serials, jobId)
