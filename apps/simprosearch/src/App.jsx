/* Simpro Deep Search, phase 1: find jobs by what is written in them (descriptions, notes, asset and serial numbers), and open a
   job to read it. Read only. Calls go through the hub's Simpro relay (the Simpro key never reaches the page). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { auth } from '../../schedule/src/firebase.js'
import { Alert, Badge, Button, Loading, Tag } from '../../../shared/ui/index.jsx'
import { PROXY_URL } from '../../../shared/proxy.js'
import { COMPANY_KEY, DEFAULT_COMPANY, SendError, listCompanies, makeCall } from '../../testbench/src/simpro-api.js'
import { GROUPS, MAX_PAGES, PAGE_SIZE, STAGES, VERDICT_TEXT, checkSearch, customerName, loadJob, parseTerms, searchAssets, searchJobs, statusName, whereFound } from './search.js'
import { htmlToText, splitByTerms } from './html.js'
import SafeHtml from './SafeHtml.jsx'

const savedCompany = () => { try { return +(localStorage.getItem(COMPANY_KEY) || DEFAULT_COMPANY) } catch { return DEFAULT_COMPANY } }
const jobFromHash = () => (/^#\/job\/(\d+)/.exec(location.hash) || [])[1] || ''
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function stageTone(stage) {
  return stage === 'Complete' ? 'green' : stage === 'Progress' ? 'orange' : stage === 'Archived' ? 'neutral' : 'purple'
}

export default function SimproSearch() {
  const call = useMemo(() => makeCall({
    proxyUrl: PROXY_URL,
    getToken: async () => {
      if (!auth?.currentUser) throw new SendError('Sign in to the hub to use Simpro.', false)
      return auth.currentUser.getIdToken()
    },
  }), [])

  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(savedCompany)
  const [access, setAccess] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let live = true
    listCompanies(call)
      .then((list) => { if (!live) return; setCompanies(list); if (list.length && !list.some((c) => c.ID === companyId)) setCompanyId(list[0].ID) })
      .catch((e) => { if (live) setAccess(e.message || String(e)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [call]) // eslint-disable-line react-hooks/exhaustive-deps

  // Which job is open lives in the address (#/job/123), so the back button and a copied link both work.
  const [jobId, setJobId] = useState(jobFromHash)
  useEffect(() => {
    const on = () => setJobId(jobFromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])

  // The search and its answer stay put while a job is open.
  const [q, setQ] = useState('')
  const [groups, setGroups] = useState(['text', 'names', 'assets'])
  const [stage, setStage] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [result, setResult] = useState(null) // { text, jobs, fields, assets, assetFilters }
  const [checking, setChecking] = useState(false)
  const [check, setCheck] = useState(null)
  const searchId = useRef(0)

  const changeCompany = (id) => {
    setCompanyId(id); setResult(null); setCheck(null); setNote('')
    try { localStorage.setItem(COMPANY_KEY, String(id)) } catch { /* private mode */ }
  }
  const toggleGroup = (id) => setGroups((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]))

  async function find(e) {
    e?.preventDefault()
    const text = q.trim()
    if (!text) return setNote('Type a job number, a serial number or some words to look for.')
    if (!groups.length) return setNote('Choose somewhere to look.')
    const mine = ++searchId.current
    setBusy(true); setNote(''); setResult(null)
    try {
      const [jobsAnswer, assetsAnswer] = await Promise.all([
        groups.some((g) => g !== 'assets') ? searchJobs(call, companyId, text, { groups: groups.filter((g) => g !== 'assets'), stage }) : { jobs: [], fields: [] },
        groups.includes('assets') ? searchAssets(call, companyId, text).catch(() => ({ assets: [], filters: [], failed: true })) : { assets: [], filters: [] },
      ])
      if (mine !== searchId.current) return
      setResult({ text, terms: parseTerms(text), jobs: jobsAnswer.jobs, fields: jobsAnswer.fields, assets: assetsAnswer.assets, assetFilters: assetsAnswer.filters })
    } catch (err) {
      if (mine === searchId.current) setNote(err.message || String(err))
    } finally {
      if (mine === searchId.current) setBusy(false)
    }
  }

  async function runCheck() {
    setChecking(true)
    try { setCheck(await checkSearch(call, companyId)) } catch (err) { setNote(err.message || String(err)) } finally { setChecking(false) }
  }

  const open = useCallback((id) => { location.hash = '#/job/' + id }, [])
  const back = useCallback(() => { if (history.length > 1 && jobFromHash()) history.back(); else location.hash = '' }, [])

  if (loading) return <div className="ds-page"><Loading /></div>
  if (access) {
    return <div className="ds-page"><Alert tone="warning" title="Simpro couldn’t be reached">{access}</Alert></div>
  }

  return (
    <div className="ds-page">
      <div className="ds-head">
        <div>
          <h1 className="ds-title">Simpro Deep Search</h1>
          <p className="ds-sub">Finds jobs by what is written inside them: descriptions, notes, asset numbers and serial numbers.</p>
        </div>
        <Badge tone="purple">Read only: nothing here changes Simpro</Badge>
      </div>

      {jobId
        ? <JobView call={call} companyId={companyId} id={jobId} term={result?.terms || []} onBack={back} />
        : (
          <>
            <form className="ds-card ds-form" onSubmit={find}>
              <div className="ds-row">
                <label className="field ds-grow">
                  <span className="field-label">Search for</span>
                  <input className="input ds-mono" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. A9 Waitemata, or a serial number and a site" autoFocus />
                  <span className="ds-muted">Every word must be found somewhere in the job, in any place. Put a phrase in quotes: “North Shore”.</span>
                </label>
                {companies.length > 1 && (
                  <label className="field">
                    <span className="field-label">Simpro company</span>
                    <select value={companyId} onChange={(e) => changeCompany(+e.target.value)}>
                      {companies.map((c) => <option key={c.ID} value={c.ID}>{c.Name}</option>)}
                    </select>
                  </label>
                )}
                <label className="field">
                  <span className="field-label">Stage</span>
                  <select value={stage} onChange={(e) => setStage(e.target.value)}>
                    <option value="">Any stage</option>
                    {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <Button type="submit" size="lg" disabled={busy}>{busy ? 'Searching…' : 'Search'}</Button>
              </div>
              <div className="ds-row ds-tags" role="group" aria-label="Look in">
                <span className="field-label">Look in</span>
                {GROUPS.map((g) => <Tag key={g.id} selected={groups.includes(g.id)} onClick={() => toggleGroup(g.id)}>{g.label}</Tag>)}
              </div>
            </form>

            {note && <p className="ds-note" role="status">{note}</p>}
            {busy && <Loading />}
            {result && <Results result={result} stage={stage} onOpen={open} />}

            <details className="ds-card ds-check">
              <summary>What can Simpro search?</summary>
              <p className="ds-muted">Simpro decides which fields it will search, and it doesn’t say. This asks it about each one with a harmless test word and tells you which really work. It only reads, and shows counts, never job details.</p>
              <Button variant="secondary" onClick={runCheck} disabled={checking}>{checking ? 'Checking…' : 'Check now'}</Button>
              {check && <CheckResults check={check} />}
            </details>
          </>
        )}
    </div>
  )
}

function Results({ result, stage, onOpen }) {
  const { text, terms, jobs, fields, assets, assetFilters } = result
  const refused = fields.filter((f) => f.status !== 'ok')
  const more = fields.filter((f) => f.more)
  return (
    <section className="ds-results" aria-label="Results">
      <p className="ds-count">
        <strong>{plural(jobs.length, 'job', 'jobs')}</strong> mention {terms.map((t, i) => <span key={t}>{i > 0 && (i === terms.length - 1 ? ' and ' : ', ')}“{t}”</span>)}{terms.length > 1 ? ' (all of them)' : ''}{stage ? ` (stage ${stage})` : ''}
        {assets.length > 0 && <> and <strong>{plural(assets.length, 'customer asset', 'customer assets')}</strong> have that serial number</>}.
      </p>
      {refused.length > 0 && (
        <Alert tone="warning" title="Simpro wouldn’t search everywhere">
          Not searched: {refused.map((f) => f.label).join(', ')}. “What can Simpro search?” below says why.
        </Alert>
      )}
      {more.length > 0 && <p className="ds-muted">Only the first {PAGE_SIZE * MAX_PAGES} for each word and place are read. {more.map((f) => f.label).join(', ')} may have more: add more words to narrow it.</p>}
      {assetFilters.length > 0 && assets.length === 0 && assetFilters.every((f) => f.status !== 'ok') && (
        <p className="ds-muted">Simpro wouldn’t search customer assets by serial number. Serial numbers written in job descriptions and notes are still searched.</p>
      )}

      {assets.length > 0 && (
        <div className="ds-assets">
          <h2 className="ds-h2">Customer assets</h2>
          {assets.map((a) => (
            <div key={a.id} className="ds-card ds-asset">
              <span className="ds-mono"><HighlightText text={a.serial} terms={terms} /></span>
              <span>{[a.model, a.type].filter(Boolean).join(' · ')}</span>
              <span className="ds-muted">{a.site || 'No site'} · asset {a.id}{a.archived ? ' · archived' : ''}</span>
            </div>
          ))}
        </div>
      )}

      <ul className="ds-hits">
        {jobs.map(({ job, found }) => <Hit key={job.ID} job={job} found={found} terms={terms} onOpen={onOpen} />)}
      </ul>
      {jobs.length === 0 && assets.length === 0 && <p className="ds-muted">Nothing matched {terms.length > 1 ? 'all of those words together' : `“${text}”`}. Try fewer words, or one distinctive piece such as a serial number.</p>}
    </section>
  )
}

function HighlightText({ text, terms }) {
  return splitByTerms(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))
}

function Hit({ job, found, terms, onOpen }) {
  const places = whereFound(job, terms)
  return (
    <li className="ds-card ds-hit">
      <div className="ds-hit-head">
        <button type="button" className="ds-hit-title" onClick={() => onOpen(job.ID)}>Job {job.ID}{job.Name ? ` · ${job.Name}` : ''}</button>
        {job.Stage && <Badge tone={stageTone(job.Stage)}>{job.Stage}</Badge>}
        {statusName(job) && <Badge tone="neutral">{statusName(job)}</Badge>}
      </div>
      <div className="ds-muted">{[customerName(job), job.Site?.Name].filter(Boolean).join(' · ')}</div>
      {places.length > 0
        ? places.map((p) => (
          <div key={p.label} className="ds-snip"><strong>In {p.label.toLowerCase()}</strong> {p.snip.cutStart && '…'}<HighlightText text={p.snip.before + p.snip.hit + p.snip.after} terms={terms} />{p.snip.cutEnd && '…'}</div>
        ))
        : <div className="ds-snip"><strong>Matched in</strong> {found.join(', ').toLowerCase()}</div>}
      {places.length > 0 && found.some((f) => !places.some((p) => p.label === f)) && (
        <div className="ds-muted">Also matched in {found.filter((f) => !places.some((p) => p.label === f)).join(', ').toLowerCase()}</div>
      )}
    </li>
  )
}

function CheckResults({ check }) {
  const kinds = [['job', 'Jobs'], ['asset', 'Customer assets (by serial number)']]
  return (
    <div className="ds-check-out">
      {kinds.map(([kind, title]) => (
        <div key={kind}>
          <h3 className="ds-h3">{title}</h3>
          <ul className="ds-verdicts">
            {check.results.filter((r) => r.kind === kind).map((r) => (
              <li key={r.key} className={'ds-verdict ds-' + r.verdict}><strong>{r.label}</strong> {VERDICT_TEXT[r.verdict]}</li>
            ))}
          </ul>
        </div>
      ))}
      <p className="ds-muted">
        {check.notesColumn === true && 'Simpro puts the notes in each result row, so results can show where the words were found.'}
        {check.notesColumn === false && 'Simpro doesn’t put the notes in a result row, so results say “in notes” without showing the words; open the job to read them.'}
        {check.notesColumn === null && 'Whether Simpro puts the notes in a result row could not be told.'}
      </p>
    </div>
  )
}

function JobView({ call, companyId, id, term: terms, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    setData(null); setError('')
    loadJob(call, companyId, id).then((d) => { if (live) setData(d) }).catch((e) => { if (live) setError(e.message || String(e)) })
    return () => { live = false }
  }, [call, companyId, id])

  const job = data?.job
  return (
    <div className="ds-job">
      <div><Button variant="ghost" onClick={onBack}>‹ Back to results</Button></div>
      {error && <Alert tone="warning" title={`Job ${id} didn’t load`}>{error}</Alert>}
      {!data && !error && <Loading />}
      {job && (
        <>
          <div className="ds-job-head">
            <div className="ds-mono ds-muted">JOB {job.ID}</div>
            <h2 className="ds-job-title">{job.Name || htmlToText(job.Description).split('\n')[0] || `Job ${job.ID}`}</h2>
            <div className="ds-badges">
              {job.Stage && <Badge tone={stageTone(job.Stage)}>Stage: {job.Stage}</Badge>}
              {statusName(job) && <Badge tone="neutral">Status: {statusName(job)}</Badge>}
              {data.centres.map((c) => <Badge key={c.section + c.name} tone="neutral">{c.name}</Badge>)}
            </div>
          </div>

          <div className="ds-job-grid">
            <div className="ds-job-main">
              <section className="ds-card"><h3 className="ds-h3">Description</h3><SafeHtml html={job.Description} mark={terms} empty="No description." /></section>
              <section className="ds-card"><h3 className="ds-h3">Notes <Badge tone="purple">Private to staff</Badge></h3><SafeHtml html={job.Notes} mark={terms} empty="No notes." /></section>
              <section className="ds-card">
                <h3 className="ds-h3">Customer assets on this job</h3>
                {data.assets.length === 0 && <p className="ds-empty">None attached.</p>}
                {data.assets.map((a) => (
                  <div key={a.id} className="ds-asset-line">
                    <span>{[a.model, a.type, a.name].filter(Boolean).join(' · ') || `Asset ${a.id}`}</span>
                    <span className="ds-mono">{a.serial || '—'}</span>
                  </div>
                ))}
              </section>
            </div>
            <aside className="ds-job-side">
              <section className="ds-card ds-facts">
                <div className="overline">Customer</div><div>{customerName(job) || '—'}</div>
                <div className="overline">Site</div><div>{job.Site?.Name || '—'}</div>
                {job.DateIssued && <><div className="overline">Issued</div><div>{String(job.DateIssued).slice(0, 10)}</div></>}
                {job.DueDate && <><div className="overline">Due</div><div>{String(job.DueDate).slice(0, 10)}</div></>}
              </section>
              <p className="ds-muted">Attachments and the job’s change log aren’t shown yet. They need a small addition to the Simpro relay, which waits for your say-so.</p>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
