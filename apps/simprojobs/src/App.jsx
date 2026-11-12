/* Simpro Jobs, steps 1 and 2: the new-job form. Choose a customer, then one of its sites, set the cost centre, job type, charge category
   and priority (step 1), and write the description and notes (step 2). Read only: every call is a GET through the hub's Simpro relay
   (the Simpro key never reaches the page), and nothing can be created in Simpro from here yet. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { auth } from '../../schedule/src/firebase.js'
import { Alert, Badge, Button, Loading, useConfirm } from '../../../shared/ui/index.jsx'
import { PROXY_URL } from '../../../shared/proxy.js'
import { COMPANY_KEY, DEFAULT_COMPANY, SendError, listCompanies, makeCall } from '../../testbench/src/simpro-api.js'
import { DEFAULTS, friendly, loadSetup, pickDefault, runChecks } from './lookups.js'
import { MAX_TEXT, hasWork, missing, preview } from './draft.js'
import { CustomerSheet, OptionSheet, SiteSheet } from './Sheets.jsx'

const savedCompany = () => { try { return +(localStorage.getItem(COMPANY_KEY) || DEFAULT_COMPANY) } catch { return DEFAULT_COMPANY } }
const sheetFromHash = () => (/^#\/pick\/([A-Za-z]+)/.exec(location.hash) || [])[1] || ''

// What the form holds while the page is open, so a phone that switches apps (and reloads this page) doesn't lose the choices.
const DRAFT_KEY = 'simprojobs.draft'
const readDraft = () => { try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY)) || {} } catch { return {} } }
const writeDraft = (d) => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* private mode: the form simply starts afresh next time */ } }

// Cost centres, priorities and the custom fields' options hardly ever change: keep them for half an hour so a reopened page is instant.
const SETUP_TTL = 30 * 60 * 1000
const setupKey = (companyId) => 'simprojobs.setup.' + companyId
const readSetup = (companyId) => {
  try {
    const s = JSON.parse(sessionStorage.getItem(setupKey(companyId)))
    return s && Date.now() - s.at < SETUP_TTL ? s.data : null
  } catch { return null }
}
const writeSetup = (companyId, data) => { try { sessionStorage.setItem(setupKey(companyId), JSON.stringify({ at: Date.now(), data })) } catch { /* no cache then */ } }

/** The four option pickers, in form order: the form's key, its label, where it sits in the setup answer, and what it starts on. */
const OPTION_FIELDS = [
  { key: 'costCentre', label: 'Cost centre', title: 'Cost centre', defaultName: DEFAULTS.costCentre },
  { key: 'jobType', label: 'Job type', title: 'Job type', defaultName: DEFAULTS.jobType },
  { key: 'chargeCategory', label: 'Charge category', title: 'Charge category', defaultName: null },
  { key: 'priority', label: 'Priority', title: 'Priority', defaultName: DEFAULTS.priority },
]

/** The form with every untouched option picker on its usual choice (only where Simpro really has an option of that name), flagged `usual`. */
function withDefaults(base, setup) {
  const next = { ...base }
  for (const { key, defaultName } of OPTION_FIELDS) {
    if (next[key] || !defaultName || !setup) continue
    const found = pickDefault(setup[key]?.options, defaultName)
    if (found) next[key] = { ...found, usual: true }
  }
  return next
}

function PickRow({ label, value, placeholder, disabled, note, error, onClick }) {
  return (
    <div className="sj-field">
      <button type="button" className={`sj-pick${value ? '' : ' sj-pick-empty'}`} disabled={disabled} onClick={onClick}>
        <span className="sj-pick-text">
          <span className="sj-pick-label">{label}</span>
          <span className="sj-pick-value">{value || placeholder}</span>
        </span>
        {note}
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 6 6 6-6 6" /></svg>
      </button>
      {error && <p className="sj-pick-error" role="alert">{error}</p>}
    </div>
  )
}

export default function SimproJobs() {
  const call = useMemo(() => makeCall({
    proxyUrl: PROXY_URL,
    getToken: async () => {
      if (!auth?.currentUser) throw new SendError('Sign in to the hub to use Simpro.', false)
      return auth.currentUser.getIdToken()
    },
  }), [])

  // Who may use Simpro is decided by the relay; the first call (the company list) is also that check.
  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(savedCompany)
  const [access, setAccess] = useState('')
  const [booting, setBooting] = useState(true)
  useEffect(() => {
    let live = true
    listCompanies(call)
      .then((list) => { if (!live) return; setCompanies(list); if (list.length && !list.some((c) => c.ID === companyId)) setCompanyId(list[0].ID) })
      .catch((e) => { if (live) setAccess(friendly(e)) })
      .finally(() => { if (live) setBooting(false) })
    return () => { live = false }
  }, [call]) // eslint-disable-line react-hooks/exhaustive-deps

  // The form. A choice is { id, name } (a customer is { ID, kind, name, individual }; a site is { id, name }).
  const [form, setForm] = useState(() => readDraft().form || {})
  useEffect(() => writeDraft({ form }), [form])
  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }))
  const chooseCustomer = (c) => {
    if (form.customer?.ID !== c.ID) setForm((f) => ({ ...f, customer: c, site: null })) // another customer's site is no longer the site
    close()
  }

  // The setup lists, from the cache if it is fresh, and always refreshed behind it.
  const [setup, setSetup] = useState(() => readSetup(savedCompany()))
  const [setupBusy, setSetupBusy] = useState(false)
  useEffect(() => {
    if (booting || access) return
    let live = true
    const cached = readSetup(companyId)
    if (cached) setSetup(cached)
    if (!cached) {
      setSetupBusy(true)
      loadSetup(call, companyId).then((s) => { if (!live) return; setSetup(s); writeSetup(companyId, s) }).finally(() => { if (live) setSetupBusy(false) })
    }
    return () => { live = false }
  }, [call, companyId, booting, access])

  // Starting choices, once the lists are here: only a field nobody has chosen yet.
  const started = useRef(false)
  useEffect(() => {
    if (!setup || started.current) return
    started.current = true
    setForm((f) => withDefaults(f, setup))
  }, [setup])
  const [confirmDialog, confirm] = useConfirm()
  const startAgain = async () => {
    if (hasWork(form) && !(await confirm({ title: 'Start again?', message: 'This clears the customer, site, description and notes you have entered on this page. Nothing has been sent to Simpro.', confirmLabel: 'Clear the form', danger: true }))) return
    setForm(withDefaults({}, setup))
  }

  // Which picker is open lives in the address (#/pick/customer), so the phone's Back closes it.
  const [sheet, setSheet] = useState(sheetFromHash)
  const pushed = useRef(false)
  useEffect(() => {
    const on = () => setSheet(sheetFromHash())
    window.addEventListener('hashchange', on)
    window.addEventListener('popstate', on)
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on) }
  }, [])
  const open = (name) => { pushed.current = true; location.hash = '#/pick/' + name }
  const close = useCallback(() => {
    if (pushed.current) { pushed.current = false; history.back(); return }
    history.replaceState(null, '', location.pathname + location.search)
    setSheet('')
  }, [])
  const pick = (key) => (o) => { set(key, o); close() }
  const pickSite = (s) => { set('site', s); close() }

  const [checks, setChecks] = useState(null)
  const [checking, setChecking] = useState(false)
  const check = async () => {
    setChecking(true); setChecks(null)
    try { setChecks(await runChecks(call, companyId)) } catch (e) { setChecks([{ label: 'Check', state: 'fail', detail: friendly(e) }]) } finally { setChecking(false) }
  }

  if (booting) return <div className="sj-page"><Loading /></div>
  if (access) {
    return <div className="sj-page"><Alert tone="critical" title="Can’t reach Simpro">{access}</Alert></div>
  }

  const todo = missing(form)
  const optionError = (key) => (setup && setup[key]?.error) || ''
  const badge = (key) => (form[key]?.usual ? <Badge tone="neutral">Usual</Badge> : null)
  const openOption = sheet && OPTION_FIELDS.find((f) => f.key === sheet)

  return (
    <div className="sj-page">
      <div className="sj-head">
        <div>
          <h1 className="sj-title">New Simpro job</h1>
          <p className="sj-sub">Step 2 of 3: choose who the job is for, how it is set up, and what it is about. Nothing is created in Simpro yet.</p>
        </div>
        {companies.length > 1 && (
          <label className="field sj-company">
            <span className="field-label">Simpro company</span>
            <select value={companyId} onChange={(e) => { const id = +e.target.value; setCompanyId(id); try { localStorage.setItem(COMPANY_KEY, String(id)) } catch { /* not remembered */ } setForm({}); started.current = false; setSetup(readSetup(id)) }}>
              {companies.map((c) => <option key={c.ID} value={c.ID}>{c.Name || `Company ${c.ID}`}</option>)}
            </select>
          </label>
        )}
      </div>

      <div className="sj-col">
      <div className="sj-card sj-form">
        <PickRow label="Customer" value={form.customer?.name} placeholder="Choose a customer" onClick={() => open('customer')} />
        <PickRow label="Site" value={form.site?.name} placeholder={form.customer ? 'Choose a site' : 'Choose a customer first'} disabled={!form.customer} onClick={() => open('site')} />
        {OPTION_FIELDS.map(({ key, label }) => {
          const part = setup?.[key]
          const err = optionError(key)
          return (
            <PickRow
              key={key} label={label} value={form[key]?.name}
              placeholder={!setup ? 'Loading from Simpro…' : err ? 'Not available' : `Choose ${label.toLowerCase()}`}
              disabled={!part || !!err} note={badge(key)} error={err}
              onClick={() => open(key)}
            />
          )
        })}
        {setupBusy && <p className="sj-hint"><span className="sj-dot" aria-hidden="true" /> Refreshing the lists from Simpro…</p>}
      </div>

      <div className="sj-card sj-form">
        <label className="field">
          <span className="field-label">Description <span className="sj-req">(needed)</span></span>
          <textarea
            className="input sj-text" rows={5} maxLength={MAX_TEXT} value={form.description || ''} onChange={(e) => set('description', e.target.value)}
            placeholder="What is the fault or the request? e.g. the monitor will not power on" aria-describedby="sj-desc-hint"
          />
          <span id="sj-desc-hint" className="sj-hint">Shown on the job as the fault or request. A blank line starts a new paragraph.</span>
        </label>
        <label className="field">
          <span className="field-label">Notes <span className="sj-opt">(optional)</span></span>
          <textarea
            className="input sj-text" rows={4} maxLength={MAX_TEXT} value={form.notes || ''} onChange={(e) => set('notes', e.target.value)}
            placeholder="Anything else the technician should know: contact on site, access, serial number…"
          />
        </label>
      </div>
      </div>

      <div className="sj-card">
        <h2 className="sj-h2">This job would be made with</h2>
        <dl className="sj-summary">
          <div><dt>Customer</dt><dd>{form.customer?.name || '—'}</dd></div>
          <div><dt>Site</dt><dd>{form.site?.name || '—'}</dd></div>
          {OPTION_FIELDS.map(({ key, label }) => <div key={key}><dt>{label}</dt><dd>{form[key]?.name || '—'}</dd></div>)}
          <div><dt>Description</dt><dd>{preview(form.description) || '—'}</dd></div>
          <div><dt>Notes</dt><dd>{preview(form.notes) || 'None'}</dd></div>
        </dl>
        <div className="sj-actions">
          <Button variant="primary" disabled title="Creating jobs comes in step 3">Create job</Button>
          <Button variant="ghost" onClick={startAgain}>Start again</Button>
        </div>
        <p className="sj-hint">{todo.length ? `Still to fill in: ${todo.join(', ')}.` : 'Everything a job needs is filled in.'} Next: a preview of exactly what will be created, and your yes, before anything goes to Simpro.</p>
      </div>

      <details className="sj-card sj-check">
        <summary>Check Simpro</summary>
        <p className="sj-hint">Asks Simpro for each list on this page once and says what came back (counts and list names only). Use it if a picker is empty or says it can’t load.</p>
        <div className="sj-actions"><Button variant="secondary" size="sm" disabled={checking} onClick={check}>{checking ? 'Checking…' : 'Check now'}</Button></div>
        {checks && (
          <ul className="sj-verdicts">
            {checks.map((c, i) => (
              <li key={i} className={`sj-verdict sj-${c.state}`}><strong>{c.state === 'ok' ? '✓' : c.state === 'warn' ? '!' : '✗'} {c.label}</strong> {c.detail}</li>
            ))}
          </ul>
        )}
      </details>

      {confirmDialog}
      {sheet === 'customer' && <CustomerSheet call={call} companyId={companyId} selected={form.customer} onPick={chooseCustomer} onClose={close} />}
      {sheet === 'site' && form.customer && <SiteSheet call={call} companyId={companyId} customer={form.customer} selected={form.site} onPick={pickSite} onClose={close} />}
      {openOption && setup?.[openOption.key] && !setup[openOption.key].error && (
        <OptionSheet title={openOption.title} options={setup[openOption.key].options} selected={form[openOption.key]} defaultName={openOption.defaultName} onPick={pick(openOption.key)} onClose={close} />
      )}
    </div>
  )
}
