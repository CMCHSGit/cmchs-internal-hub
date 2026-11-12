/* Simpro Jobs, step 3: making the job. A PLAN is the ordered list of requests a finished form turns into. The review screen is drawn from
   the same plan that is then run, so what is shown is what is sent. Nothing is sent until the person taps the button on that screen.
   No React and no Firebase, so the tests run it as it is. `call(method, path, body)` is makeCall()'s result (testbench/simpro-api.js).

   The sequence is the one the demo tracker's createJob has used against this Simpro: create the job, add a section, add the cost centre
   under it, then set the job's custom fields (Job Type, Charge Category and Priority are custom fields on jobs in CHS's Simpro). Each step is its own call, and the
   relay (backend/apps-script/proxy/Code.js, simproSyncJobWriteError_) checks each body again. */
import { SendError, ok, simproErr } from '../../testbench/src/simpro-api.js'
import { cleanText, missing, toHtml } from './draft.js'

/** Every job made here is a Service job (the relay refuses any other Type). */
export const JOB_TYPE = 'Service'

/**
 * The body of the first request: only what the form holds, and Stage Pending (a new job; the relay only lets this tool add to a Pending job).
 * No name, dates, status or people: Simpro's own defaults apply.
 */
export function jobBody(form) {
  const body = { Type: JOB_TYPE, Customer: form.customer.ID, Site: form.site.id, Description: toHtml(form.description), Stage: 'Pending' }
  const notes = toHtml(form.notes)
  if (notes) body.Notes = notes
  return body
}

/**
 * The plan for a finished form. `setup` is loadSetup()'s answer (it says which custom field is Job Type and which is Charge Category).
 * Throws Error (in words) when the form isn't finished or Simpro's lists aren't there, so a plan is never half-formed.
 * Each step: { id, title, facts: [[label, value]…] for the review screen, request(state) -> { method, path, body } }.
 */
export function buildPlan(form, setup, companyId) {
  const todo = missing(form)
  if (todo.length) throw new Error('Still to fill in: ' + todo.join(', ') + '.')
  const jobField = setup?.jobType?.field
  const chargeField = setup?.chargeCategory?.field
  const priorityField = setup?.priority?.field
  if (!jobField?.id) throw new Error('Simpro’s Job type field was not found, so the job type can’t be set.')
  if (!chargeField?.id) throw new Error('Simpro’s Charge category field was not found, so it can’t be set.')
  if (!priorityField?.id) throw new Error('Simpro’s Priority field was not found, so the priority can’t be set.')
  const base = `/companies/${companyId}/jobs/`
  const notes = cleanText(form.notes)
  return [
    {
      id: 'job', title: 'Create the job in Simpro',
      facts: [
        ['Type', JOB_TYPE], ['Stage', 'Pending'], ['Customer', form.customer.name], ['Site', form.site.name],
        ['Description', cleanText(form.description)], ['Notes', notes || 'None'],
      ],
      request: () => ({ method: 'POST', path: base, body: jobBody(form) }),
    },
    { id: 'section', title: 'Add a section to the job', facts: [], request: (s) => ({ method: 'POST', path: `${base}${s.jobId}/sections/`, body: {} }) },
    {
      id: 'costCentre', title: 'Add the cost centre', facts: [['Cost centre', form.costCentre.name]],
      request: (s) => ({ method: 'POST', path: `${base}${s.jobId}/sections/${s.sectionId}/costCenters/`, body: { CostCenter: form.costCentre.id } }),
    },
    {
      id: 'jobType', title: `Set “${jobField.name}”`, facts: [[jobField.name, form.jobType.name]],
      request: (s) => ({ method: 'PATCH', path: `${base}${s.jobId}/customFields/${jobField.id}`, body: { Value: form.jobType.name } }),
    },
    {
      id: 'chargeCategory', title: `Set “${chargeField.name}”`, facts: [[chargeField.name, form.chargeCategory.name]],
      request: (s) => ({ method: 'PATCH', path: `${base}${s.jobId}/customFields/${chargeField.id}`, body: { Value: form.chargeCategory.name } }),
    },
    {
      id: 'priority', title: `Set “${priorityField.name}”`, facts: [[priorityField.name, form.priority.name]],
      request: (s) => ({ method: 'PATCH', path: `${base}${s.jobId}/customFields/${priorityField.id}`, body: { Value: form.priority.name } }),
    },
  ]
}

/** A short fingerprint of what the plan would create, so an unfinished run is only ever resumed for the same form. */
export function planSignature(plan) {
  const text = JSON.stringify(plan.map((s) => s.request({ jobId: 0, sectionId: 0 })))
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return String(h >>> 0)
}

/**
 * Runs the plan from where `run` left off ({ jobId, sectionId, done: [step ids], sig }) and stops at the first step that fails, so a
 * step that is already done is never done twice (a second job is the one thing this must not do). Returns the new run:
 *   { jobId, sectionId, done, failed: null | { step, message, unknown } }
 * `unknown`: the answer never came (or Simpro said it had a fault), so the step may or may not have happened: the page says to look in
 * Simpro before trying again. `onChange(run)` is called after every step, so the page can show progress and keep it across a reload.
 */
export async function runPlan(call, plan, run = {}, onChange = () => {}, ctx = {}) {
  const state = { jobId: run.jobId || null, sectionId: run.sectionId || null, done: [...(run.done || [])], failed: null }
  const stop = (step, message, unknown) => { state.failed = { step: step.id, message, unknown } }
  for (const step of plan) {
    if (state.done.includes(step.id)) continue
    // A step may read what it is about to change first (editing adds to the end of the job's text as it is NOW, not as it was when the
    // page loaded). Nothing has been sent if that read fails, so a failure here is never "unknown".
    if (step.prepare) {
      try { await step.prepare(call, ctx) } catch (e) { stop(step, String(e?.message || e), false); break }
    }
    const req = step.request(state, ctx)
    let res
    // Saved before the request goes, so a page closed or a phone put to sleep mid-step is known afterwards: that step may have happened.
    onChange({ ...state, done: [...state.done], inflight: step.id })
    try {
      res = await call(req.method, req.path, req.body)
    } catch (e) {
      // SendError.retry === false is the relay refusing outright (nothing happened); anything else is a lost answer.
      stop(step, e instanceof SendError ? e.message : String(e?.message || e), e instanceof SendError ? e.retry !== false : true)
      break
    }
    if (!ok(res)) { stop(step, simproErr(res), res.status >= 500); break } // a 4xx is Simpro refusing it; a 5xx may have half-happened
    if (step.id === 'job') {
      if (!res.data?.ID) { stop(step, 'Simpro answered but did not give the new job’s number.', true); break }
      state.jobId = res.data.ID
    }
    if (step.id === 'section') {
      if (!res.data?.ID) { stop(step, 'Simpro answered but did not give the new section’s number.', true); break }
      state.sectionId = res.data.ID
    }
    state.done.push(step.id)
    onChange({ ...state, done: [...state.done], inflight: null })
  }
  onChange({ ...state, done: [...state.done], inflight: null })
  return state
}

/**
 * A run read back after a reload: a step that was in flight when the page went away is a step whose outcome is not known, so the run
 * stops there as "unknown" and nothing is sent again until the person has looked in Simpro and chosen to.
 */
export function settleRun(run) {
  if (!run || !run.inflight) return run
  const { inflight, ...rest } = run
  return { ...rest, failed: { step: inflight, message: 'The page was closed while this step was being sent, so it may or may not have happened.', unknown: true } }
}

/** The plain-words status of a finished or stopped run, for the page. */
export function describeRun(plan, run) {
  const left = plan.filter((s) => !run.done.includes(s.id))
  if (!run.failed && !left.length) return { state: 'done', text: `Job ${run.jobId} was created in Simpro.` }
  if (!run.jobId) {
    return run.failed?.unknown
      ? { state: 'unsure', text: 'Simpro didn’t confirm. The job may or may not have been created: look for it in Simpro before trying again.' }
      : { state: 'refused', text: 'Nothing was created: ' + (run.failed?.message || 'the request was not sent.') }
  }
  const failed = plan.find((s) => s.id === run.failed?.step)
  return { state: 'partial', text: `Job ${run.jobId} was created, but “${failed?.title || 'a step'}” did not finish: ${run.failed?.message || 'it was not sent.'}` }
}
