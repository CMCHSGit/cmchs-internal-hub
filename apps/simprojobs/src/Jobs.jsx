/* The Find tab: search the jobs that already exist, open one, add to it, change its Job type, Charge category or Priority, or close it.
   Looking is read only. A change is previewed on a review screen first (the exact text, and each field from what it is to what it will be)
   and goes to Simpro only when the person taps its button; it sends exactly that plan (manage.js, plan.js), and the relay holds every
   write to the same rules again (Code.js). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Loading, Spinner } from '../../../shared/ui/index.jsx'
import SafeHtml from '../../simprosearch/src/SafeHtml.jsx'
import { friendly, loadSetup } from './lookups.js'
import { MAX_TITLE, titleProblem } from './draft.js'
import {
  MAX_ADD, STAGE_CHIPS, buildClosePlan, buildEditPlan, canClose, canEdit, describeChange, fieldValue, findJobs, loadCompletedStatus, loadJobDetail, loadRecentJobs,
} from './manage.js'
import { runPlan } from './plan.js'
import { Sheet } from './Sheets.jsx'
import { readSetup, writeSetup } from './setupCache.js'

const routeFromHash = () => {
  const m = /^#\/job\/(\d+)(?:\/(edit|close))?/.exec(location.hash)
  return m ? { job: m[1], sheet: m[2] || '' } : { job: '', sheet: '' }
}
const stageTone = (stage) => (stage === 'Complete' ? 'green' : stage === 'Progress' ? 'orange' : stage === 'Archived' || stage === 'Invoiced' ? 'neutral' : 'purple')

// ── The list ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function Snippet({ s }) {
  return (
    <span className="sj-snip">
      <strong>{s.label}</strong> {s.snip.cutStart && '…'}{s.snip.before}<mark>{s.snip.hit}</mark>{s.snip.after}{s.snip.cutEnd && '…'}
    </span>
  )
}

function ResultRow({ row, snippets = [] }) {
  return (
    <li>
      <a className="sj-result" href={`#/job/${row.id}`}>
        <span className="sj-result-head">
          <span className="sj-result-no">#{row.id}</span>
          <span className="sj-result-title">{row.title}</span>
          {row.stage && <Badge tone={stageTone(row.stage)}>{row.stage}</Badge>}
        </span>
        {(row.customer || row.site) && <span className="sj-result-sub">{[row.customer, row.site].filter(Boolean).join(' · ')}</span>}
        {snippets.map((s, i) => <Snippet key={i} s={s} />)}
      </a>
    </li>
  )
}

const SECTIONS = [
  ['names', 'Job number and title', 'Jobs whose number, title, customer or site has what you typed.'],
  ['description', 'In the description', 'Jobs found only by what is written in their description.'],
  ['notes', 'In the notes', 'Jobs found only by what is written in their notes.'],
]

function FindList({ call, companyId }) {
  const [q, setQ] = useState(() => { try { return sessionStorage.getItem('simprojobs.find.q') || '' } catch { return '' } })
  const [stage, setStage] = useState(() => { try { return sessionStorage.getItem('simprojobs.find.stage') || '' } catch { return '' } })
  const [state, setState] = useState({ busy: true, error: '', recent: null, found: null })
  const ask = useRef(0)
  useEffect(() => { try { sessionStorage.setItem('simprojobs.find.q', q); sessionStorage.setItem('simprojobs.find.stage', stage) } catch { /* not kept */ } }, [q, stage])

  const run = useCallback(async (text, chosenStage) => {
    const mine = ++ask.current
    setState((s) => ({ ...s, busy: true, error: '' }))
    try {
      if (text.trim()) {
        const found = await findJobs(call, companyId, text, { stage: chosenStage })
        if (mine === ask.current) setState({ busy: false, error: '', recent: null, found })
      } else {
        const recent = await loadRecentJobs(call, companyId, { stage: chosenStage })
        if (mine === ask.current) setState({ busy: false, error: '', recent, found: null })
      }
    } catch (e) {
      if (mine === ask.current) setState((s) => ({ ...s, busy: false, error: friendly(e) }))
    }
  }, [call, companyId])

  // The first answer at once; then a short pause after the last key press, so typing doesn't ask Simpro for every letter.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; run(q, stage); return }
    const t = setTimeout(() => run(q, stage), q.trim() ? 450 : 0)
    return () => clearTimeout(t)
  }, [q, stage, run])

  const { busy, error, recent, found } = state
  return (
    <div className="sj-find">
      <div className="sj-card sj-find-box">
        <label className="field">
          <span className="field-label">Search jobs</span>
          <input
            className="input sj-find-input" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck="false"
            value={q} onChange={(e) => setQ(e.target.value)} placeholder="Job number, title, customer, site, or words in the description or notes"
          />
        </label>
        <div className="sj-chips" role="group" aria-label="Stage">
          {['', ...STAGE_CHIPS].map((s) => (
            <button key={s || 'any'} type="button" className={`tag${stage === s ? ' tag-selected' : ''}`} aria-pressed={stage === s} onClick={() => setStage(s)}>{s || 'Any stage'}</button>
          ))}
        </div>
        <p className="sj-hint">Every word you type must be in the job somewhere. Results list the job number and title first, then jobs found only by their description, then only by their notes.</p>
      </div>

      {error && <Alert tone="critical" title="Couldn’t load jobs" action={<Button size="sm" variant="secondary" onClick={() => run(q, stage)}>Try again</Button>}>{error}</Alert>}
      {busy && <div className="sj-busy" role="status"><Spinner size={20} /> {q.trim() ? 'Searching Simpro…' : 'Loading the newest jobs…'}</div>}

      {!error && recent && (
        <section className="sj-card">
          <h2 className="sj-h2">Newest jobs{stage ? ` · ${stage}` : ''}</h2>
          {recent.rows.length ? <ul className="sj-results">{recent.rows.map((r) => <ResultRow key={r.id} row={r} />)}</ul> : <p className="sj-empty">No jobs to show.</p>}
          {recent.more && <p className="sj-hint">Showing the newest {recent.rows.length}. Type something to search them all.</p>}
        </section>
      )}

      {!error && found && (
        <>
          {found.notSearched.length > 0 && <Alert tone="warning" title="Simpro wouldn’t search everywhere">It did not search: {found.notSearched.join(', ')}. Results may be missing jobs that only match there.</Alert>}
          {!found.total && !busy && <p className="sj-empty">No job has {found.terms.length > 1 ? 'all of those words' : 'that'} in it{stage ? ` in stage ${stage}` : ''}.</p>}
          {SECTIONS.map(([key, title, hint]) => found.groups[key].length > 0 && (
            <section className="sj-card" key={key}>
              <h2 className="sj-h2">{title} <span className="sj-count">{found.groups[key].length}</span></h2>
              <p className="sj-hint">{hint}</p>
              <ul className="sj-results">{found.groups[key].map((g) => <ResultRow key={g.row.id} row={g.row} snippets={g.snippets} />)}</ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}

// ── Reviewing and making a change ───────────────────────────────────────────────────────────────────────────────────────────

const Mark = ({ state }) => {
  if (state === 'running') return <span className="sj-mark"><Spinner size={16} /></span>
  return <span className={`sj-mark sj-mark-${state}`} aria-label={{ done: 'Done', failed: 'Did not finish', pending: 'Not done yet' }[state]}>{{ done: '✓', failed: '✗', pending: '○' }[state]}</span>
}

/**
 * The review screen for a change: each step with what it will do (a text addition word for word, a field from what it is to what it will be),
 * then, after the button, the steps as they happen. `confirmLabel` is the button's words; it is the only thing here that sends anything.
 */
function ChangeSheet({ title, intro, plan, change, confirmLabel, onClose, onDone }) {
  const { run, running, start } = change
  const state = (id) => (run?.done?.includes(id) ? 'done' : running && run?.inflight === id ? 'running' : run?.failed?.step === id ? 'failed' : 'pending')
  const outcome = run && !running ? describeChange(plan, run) : null
  return (
    <Sheet title={title} onClose={onClose}>
      {!run && <Alert tone="info" title="Nothing has been sent to Simpro yet">{intro}</Alert>}
      {outcome?.state === 'done' && <Alert tone="success" title={outcome.text} />}
      {outcome && outcome.state !== 'done' && (
        <Alert tone={outcome.state === 'refused' ? 'critical' : 'warning'} title={outcome.state === 'refused' ? 'Not changed' : outcome.state === 'unsure' ? 'Not sure it was changed' : 'The change is only part made'}>{outcome.text}</Alert>
      )}
      <ol className="sj-steps">
        {plan.map((step) => (
          <li key={step.id} className={`sj-step sj-step-${state(step.id)}`}>
            <div className="sj-step-head"><Mark state={state(step.id)} /><span className="sj-step-title">{step.title}</span></div>
            {step.facts.length > 0 && <dl className="sj-facts">{step.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
          </li>
        ))}
      </ol>
      <div className="sj-review-actions">
        {!run && (<><Button variant="primary" size="lg" block onClick={start}>{confirmLabel}</Button><Button variant="ghost" block onClick={onClose}>Back</Button></>)}
        {running && <Button variant="primary" size="lg" block disabled>Working… keep this page open</Button>}
        {outcome?.state === 'done' && <Button variant="primary" size="lg" block onClick={onDone}>Back to the job</Button>}
        {outcome?.state === 'refused' && <Button variant="primary" size="lg" block onClick={start}>Try again</Button>}
        {outcome?.state === 'partial' && <Button variant="primary" size="lg" block onClick={start}>Try the remaining steps</Button>}
        {outcome?.state === 'unsure' && <p className="sj-hint">Look at the job again to see what Simpro holds before trying anything further.</p>}
        {outcome && outcome.state !== 'done' && <Button variant="ghost" block onClick={onDone}>Back to the job (reload it from Simpro)</Button>}
      </div>
    </Sheet>
  )
}

/** One change at a time, and never two at once: a double tap can't start it twice. */
function useChange(call, plan) {
  const [run, setRun] = useState(null)
  const [running, setRunning] = useState(false)
  const busy = useRef(false)
  const start = async () => {
    if (busy.current || !plan) return
    busy.current = true; setRunning(true)
    try {
      const base = { jobId: null, sectionId: null, done: run?.done || [], failed: null }
      const ctx = {}
      setRun({ ...base })
      const final = await runPlan(call, plan, base, (s) => setRun((prev) => ({ ...prev, ...s })), ctx)
      setRun(final)
    } finally { busy.current = false; setRunning(false) }
  }
  return { run, running, start }
}

function EditSheet({ call, companyId, job, setup, onClose, onDone }) {
  const [add, setAdd] = useState({ addDescription: '', addNotes: '' })
  const [title, setTitle] = useState(job.name || '')
  const [picked, setPicked] = useState({ jobType: '', chargeCategory: '', priority: '' })
  const [review, setReview] = useState(false)
  const FIELDS = [['jobType', 'Job type'], ['chargeCategory', 'Charge category'], ['priority', 'Priority']]
  const changes = useMemo(() => {
    const c = { ...add, title }
    for (const [key] of FIELDS) { if (picked[key]) c[key] = { name: picked[key] } }
    return c
  }, [add, picked, title]) // eslint-disable-line react-hooks/exhaustive-deps
  const built = useMemo(() => { try { return { plan: buildEditPlan({ job, changes, setup, companyId }) } } catch (e) { return { error: e.message } } }, [job, changes, setup, companyId])
  const change = useChange(call, built.plan)

  if (review && built.plan) {
    return <ChangeSheet title={`Review the change to job ${job.id}`} intro="This is exactly what will be changed. Text is only ever added to the end of what is there now; nothing is replaced." plan={built.plan} change={change} confirmLabel="Make this change in Simpro" onClose={() => setReview(false)} onDone={onDone} />
  }
  return (
    <Sheet title={`Change job ${job.id}`} onClose={onClose}>
      <p className="sj-hint">Change the title, add to the description or notes (what is there now stays as it is), or change a field. Then review it: nothing goes to Simpro until you confirm.</p>
      <label className="field">
        <span className="field-label">Title</span>
        <input className="input sj-title-input" type="text" maxLength={MAX_TITLE + 20} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="No title yet" autoComplete="off" aria-invalid={!!titleProblem(title) || undefined} />
        {titleProblem(title) && <span className="sj-pick-error" role="alert">{titleProblem(title)}</span>}
      </label>
      <label className="field">
        <span className="field-label">Add to the description</span>
        <textarea className="input sj-text" rows={4} maxLength={MAX_ADD} value={add.addDescription} onChange={(e) => setAdd((a) => ({ ...a, addDescription: e.target.value }))} placeholder="Goes after the existing description" />
      </label>
      <label className="field">
        <span className="field-label">Add to the notes</span>
        <textarea className="input sj-text" rows={4} maxLength={MAX_ADD} value={add.addNotes} onChange={(e) => setAdd((a) => ({ ...a, addNotes: e.target.value }))} placeholder="Goes after the existing notes" />
      </label>
      {FIELDS.map(([key, label]) => {
        const part = setup?.[key]
        const now = part?.field ? fieldValue(job, part.field.id) : ''
        return (
          <label className="field" key={key}>
            <span className="field-label">{label}</span>
            <select className="sj-select" value={picked[key]} disabled={!part || !!part.error || !part.options?.length} onChange={(e) => setPicked((p) => ({ ...p, [key]: e.target.value }))}>
              <option value="">{now ? `Leave as it is: ${now}` : 'Leave as it is (not set)'}</option>
              {(part?.options || []).filter((o) => o.name !== now).map((o) => <option key={o.id} value={o.name}>{o.name}</option>)}
            </select>
            {part?.error && <span className="sj-pick-error">{part.error}</span>}
          </label>
        )
      })}
      <div className="sj-review-actions">
        <Button variant="primary" size="lg" block disabled={!built.plan} onClick={() => setReview(true)}>Review the change</Button>
        {built.error && built.error !== 'Nothing to change yet.' && <p className="sj-pick-error" role="alert">{built.error}</p>}
        {built.error === 'Nothing to change yet.' && <p className="sj-hint">Add some text or choose a different value to continue.</p>}
      </div>
    </Sheet>
  )
}

function CloseSheet({ call, companyId, job, onClose, onDone }) {
  const [status, setStatus] = useState({ busy: true, value: null, error: '' })
  useEffect(() => {
    let live = true
    loadCompletedStatus(call, companyId)
      .then((value) => { if (live) setStatus({ busy: false, value, error: '' }) })
      .catch((e) => { if (live) setStatus({ busy: false, value: null, error: friendly(e) }) })
    return () => { live = false }
  }, [call, companyId])
  const built = useMemo(() => { if (status.busy || status.error) return {}; try { return { plan: buildClosePlan({ job, statusCode: status.value, companyId }) } } catch (e) { return { error: e.message } } }, [status, job, companyId])
  const change = useChange(call, built.plan)
  return (
    <>
      {status.busy && <Sheet title={`Close job ${job.id}`} onClose={onClose}><div className="sj-busy" role="status"><Spinner size={20} /> Checking Simpro’s status list…</div></Sheet>}
      {!status.busy && (status.error || built.error) && <Sheet title={`Close job ${job.id}`} onClose={onClose}><Alert tone="critical" title="This job can’t be closed from here">{status.error || built.error}</Alert></Sheet>}
      {built.plan && <ChangeSheet title={`Close job ${job.id}`} intro="This marks the job complete: its stage becomes Complete and its status “Job : Completed”. It is not invoiced or archived." plan={built.plan} change={change} confirmLabel="Close job in Simpro" onClose={onClose} onDone={onDone} />}
    </>
  )
}

// ── One job ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────

function JobView({ call, companyId, jobId, sheet, openSheet, closeSheet }) {
  const [state, setState] = useState({ busy: true, job: null, error: '' })
  const [setup, setSetup] = useState(() => readSetup(companyId))
  const load = useCallback(() => {
    let live = true
    setState((s) => ({ ...s, busy: true, error: '' }))
    loadJobDetail(call, companyId, jobId)
      .then((job) => { if (live) setState({ busy: false, job, error: '' }) })
      .catch((e) => { if (live) setState({ busy: false, job: null, error: friendly(e) }) })
    return () => { live = false }
  }, [call, companyId, jobId])
  useEffect(() => load(), [load])
  useEffect(() => {
    if (setup) return undefined
    let live = true
    loadSetup(call, companyId).then((s) => { if (live) { setSetup(s); writeSetup(companyId, s) } })
    return () => { live = false }
  }, [call, companyId, setup])

  const { busy, job, error } = state
  const done = () => { closeSheet(); load() }
  return (
    <div className="sj-detail">
      <p className="sj-back-link"><a href="#/find">← All jobs</a></p>
      {busy && !job && <Loading />}
      {error && <Alert tone="critical" title="Couldn’t load the job" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{error}</Alert>}
      {job && (
        <>
          <div className="sj-card">
            <div className="sj-badges"><Badge tone={stageTone(job.stage)}>{job.stage || 'No stage'}</Badge>{job.status && <Badge tone="neutral">{job.status}</Badge>}{busy && <Spinner size={16} />}</div>
            <h2 className="sj-job-title">#{job.id} {job.title}</h2>
            <p className="sj-result-sub">{[job.customer, job.site].filter(Boolean).join(' · ')}</p>
            <div className="sj-actions">
              <Button variant="primary" disabled={!canEdit(job)} onClick={() => openSheet('edit')}>Add to it or change it</Button>
              <Button variant="secondary" disabled={!canClose(job)} onClick={() => openSheet('close')}>Close job</Button>
              <a className="btn btn-ghost btn-md" href={`/simprosearch/#/job/${job.id}`}>More detail</a>
            </div>
            {!canEdit(job) && <p className="sj-hint">A job that is {job.stage || 'not open'} can’t be changed here.</p>}
            {canEdit(job) && !canClose(job) && <p className="sj-hint">This job is already complete.</p>}
          </div>
          <div className="sj-card">
            <h3 className="sj-h3">Fields</h3>
            <dl className="sj-summary">
              {[['jobType', 'Job type'], ['chargeCategory', 'Charge category'], ['priority', 'Priority']].map(([key, label]) => (
                <div key={key}><dt>{label}</dt><dd>{setup?.[key]?.field ? fieldValue(job, setup[key].field.id) || 'Not set' : setup ? 'Not available' : '…'}</dd></div>
              ))}
              {job.issued && <div><dt>Issued</dt><dd>{job.issued}</dd></div>}
              {job.due && <div><dt>Due</dt><dd>{job.due}</dd></div>}
            </dl>
          </div>
          <div className="sj-card sj-rich-wrap"><h3 className="sj-h3">Description</h3><SafeHtml html={job.description} empty="No description." /></div>
          <div className="sj-card sj-rich-wrap"><h3 className="sj-h3">Notes</h3><SafeHtml html={job.notes} empty="No notes." /></div>
        </>
      )}
      {sheet === 'edit' && job && <EditSheet call={call} companyId={companyId} job={job} setup={setup} onClose={closeSheet} onDone={done} />}
      {sheet === 'close' && job && <CloseSheet call={call} companyId={companyId} job={job} onClose={closeSheet} onDone={done} />}
    </div>
  )
}

/** The Find tab: the list, or one job (and its edit and close screens), by the address (#/find, #/job/123, #/job/123/edit). */
export default function FindJobs({ call, companyId }) {
  const [route, setRoute] = useState(routeFromHash)
  const pushed = useRef(false)
  useEffect(() => {
    const on = () => { const r = routeFromHash(); if (!r.sheet) pushed.current = false; setRoute(r) }
    window.addEventListener('hashchange', on)
    window.addEventListener('popstate', on)
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on) }
  }, [])
  const openSheet = (name) => { pushed.current = true; location.hash = `#/job/${route.job}/${name}` }
  const closeSheet = useCallback(() => {
    if (!routeFromHash().sheet) return // nothing is open: never step back out of the page
    if (pushed.current) { pushed.current = false; history.back(); return }
    history.replaceState(null, '', `${location.pathname}${location.search}#/job/${routeFromHash().job}`)
    setRoute(routeFromHash())
  }, [])
  return route.job
    ? <JobView key={route.job} call={call} companyId={companyId} jobId={route.job} sheet={route.sheet} openSheet={openSheet} closeSheet={closeSheet} />
    : <FindList call={call} companyId={companyId} />
}
