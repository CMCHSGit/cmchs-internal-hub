/* A new loan (old: the Scan / Loan tab's batch loan form, submitBatchLoan).
   Who, where, when, the account manager, job and demo type, shipping
   island, notes, shipping details, and the devices. Making it opens its
   loan form to finish (LoanForm.jsx): that saves the form, emails it and
   makes the Simpro job, as closing the old form did.

   Filled in from the address:
     ?copy=kind:key        Copy: the same devices as that loan, for someone new
     ?move=kind:key&nos=…  Transfer's "move to a new loan": those devices,
                           taken off the loan they're on once this one's made
     ?ref=…&loanTo=…&location=…&start=…&end=…&notes=…
                           the project tracker's "Create loan form" (it opens the
                           tracker in a pop-up): filled in from the job, and once
                           made, the loan is posted back to the page that opened
                           it ({ type: 'chs-demo-loan-created', ref, batchId, … },
                           this site only), as the old notifyProjectTrackerOfLoan */
import { useMemo, useState } from 'react'
import { Alert, Button, useConfirm } from '../../../shared/ui/index.jsx'
import AssetPicker from './AssetPicker.jsx'
import LoanForm from './LoanForm.jsx'
import { ISLANDS, JOB_TYPES, assetStatus, demoTypeOptions, loanSections, newLoanProblem } from './model.js'

const blank = (today) => ({ loanTo: '', location: '', startDate: today, endDate: '', longTerm: false, am: '', email: '', contact: '', jobType: 'Demo', demoType: '', island: '', notes: '', shipping: '' })

export default function NewLoan({ s, params, go, onDone }) {
  // The loan devices are copied or moved from, if any.
  const source = useMemo(() => {
    const ref = params.copy || params.move
    if (!ref) return null
    const all = Object.values(loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode })).flat()
    return all.find((g) => g.kind + ':' + g.key === ref) || null
  }, [params.copy, params.move]) // eslint-disable-line react-hooks/exhaustive-deps
  const [f, setF] = useState(() => ({ ...blank(s.today), ...(params.loanTo ? { loanTo: params.loanTo } : {}), ...(params.location ? { location: params.location } : {}),
    ...(params.start ? { startDate: params.start } : {}), ...(params.end ? { endDate: params.end } : {}), ...(params.notes ? { notes: params.notes } : {}) }))
  const [picked, setPicked] = useState(() => {
    // ?add=: the devices ticked on the Equipment tab ("New loan with these"; old: the basket).
    if (!source) return [...new Set(String(params.add || '').split(',').filter(Boolean))]
    const nos = params.move ? String(params.nos || '').split(',').filter(Boolean) : source.items.map((e) => e.CHSAssetNo)
    return [...new Set(nos)]
  })
  const [otherType, setOtherType] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState(null)
  const [confirmDialog, confirm] = useConfirm()
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const managers = [...(s.managers || [])].sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  const types = demoTypeOptions(s.demoTypes, f.demoType)
  const when = { startDate: f.startDate, endDate: f.longTerm ? '' : f.endDate, loanTo: f.loanTo, today: s.today }

  async function submit(e) {
    e.preventDefault()
    const problem = newLoanProblem(f) || (!picked.length ? 'Add at least one device.' : '')
    if (problem) return setError(problem)
    // A device on a long-term loan would wait on a loan with no return date (old: the long-term blockers confirm).
    const stuck = picked.map((no) => assetStatus(s.equipment, s.upcoming, no, { ...when, loanMeta: s.loanMeta, loanDocs: s.loanDocs })).filter((st) => st.found && st.will === 'follow' && st.longTerm)
    if (stuck.length && !(await confirm({
      title: `${stuck.length} ${stuck.length === 1 ? 'device is' : 'devices are'} on a long-term loan`,
      message: `${stuck.map((st) => `${st.item.CHSAssetNo} is with ${st.item.OnLoanTo}`).join('; ')}. They’ll wait on this loan, but a long-term loan has no return date: they may never come back on their own. Make the loan anyway?`,
      confirmLabel: 'Make the loan',
    }))) return
    setBusy(true); setError('')
    try {
      const r = await s.createLoan({ ...f, endDate: f.longTerm ? '' : f.endDate }, picked, params.move && source ? { from: { key: source.batchId || source.key, loanTo: source.loanTo, items: source.items } } : {})
      setMade(r)
      if (params.ref) {
        const msg = { type: 'chs-demo-loan-created', ref: params.ref, batchId: r.batchId, loanTo: f.loanTo, location: f.location, startDate: f.startDate, endDate: f.longTerm ? '' : f.endDate,
          items: r.loaned.map((e) => ({ CHSAssetNo: e.CHSAssetNo, Model: e.Model || '' })) }
        for (const w of [window.parent !== window ? window.parent : null, window.opener]) { try { w?.postMessage(msg, location.origin) } catch { /* closed */ } }
      }
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }

  if (made) {
    const extra = [made.booked.length && `${made.booked.length} still out elsewhere, booked to follow`, made.skipped.length && `${made.skipped.length} left out (dates clash)`, made.reclaimed.length && `taken from bookings for ${[...new Set(made.reclaimed)].join(', ')}: make sure they’re back in time`].filter(Boolean)
    return (
      <>
        <Alert tone="success" title={`Loan to ${f.loanTo} made`}>{made.loaned.length} {made.loaned.length === 1 ? 'device' : 'devices'}{extra.length ? `: ${extra.join('; ')}` : ''}. Check its loan form and press Finish.</Alert>
        <LoanForm s={s} docKey={made.batchId} doc={made.doc} items={made.loaned}
          info={{ loanTo: f.loanTo, location: f.location, startDate: f.startDate, endDate: f.longTerm ? '' : f.endDate, accountManager: f.am, contactNumber: f.contact, jobType: f.jobType, demoType: f.demoType, island: f.island, longTerm: f.longTerm, email: f.email }}
          finishing={{ email: f.email, name: f.am, away: onDone }} onClose={() => {}}
          onDone={(msg) => { onDone(msg); go('loans', { open: (made.booked.length === made.loaned.length ? 'booking:' : f.startDate > s.today ? 'scheduled:' : 'loan:') + made.batchId }) }} />
      </>
    )
  }

  return (
    <form className="eq-newloan" onSubmit={submit}>
      {params.ref && <Alert tone="info" title="A loan for the project tracker">Filled in from the job. Pick the devices, then make the loan: the project tracker hears about it.</Alert>}
      {source && (
        <Alert tone="info" title={params.move ? `Moving ${picked.length} from ${source.loanTo} to a new loan` : `Copying ${source.loanTo}’s devices`}>
          {params.move ? 'Once this loan is made, they come off that loan’s form and Simpro job.' : 'A separate loan for someone new: the original isn’t touched. Fill in who it’s for.'}
        </Alert>
      )}
      <section className="card eq-newloan-part">
        <h2 className="eq-section-title">Who, where and when</h2>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">On loan to *</span><input className="input" value={f.loanTo} onChange={set('loanTo')} placeholder="Customer or event" /></label>
          <label className="field"><span className="field-label">Location *</span><input className="input" value={f.location} onChange={set('location')} placeholder="Ward, theatre or address" /></label>
        </div>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Start *</span><input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></label>
          <label className="field"><span className="field-label">End {f.longTerm ? '' : '*'}</span><input className="input" type="date" value={f.longTerm ? '' : f.endDate} min={f.startDate} onChange={set('endDate')} disabled={f.longTerm} /></label>
          <label className="eq-check"><input type="checkbox" checked={f.longTerm} onChange={set('longTerm')} /> Long term (no end date, no Simpro job)</label>
        </div>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Account manager *</span>
            <select value={f.am} onChange={(e) => { const m = managers.find((x) => x.name === e.target.value); setF((x) => ({ ...x, am: e.target.value, email: m?.email || x.email })) }}>
              <option value="">Select account manager…</option>
              {managers.map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
            </select>
          </label>
          <label className="field"><span className="field-label">Their email *</span><input className="input" type="email" value={f.email} onChange={set('email')} /></label>
          <label className="field"><span className="field-label">Contact number</span><input className="input" value={f.contact} onChange={set('contact')} /></label>
        </div>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Job type</span>
            <select value={f.jobType} onChange={set('jobType')}>{JOB_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          </label>
          {f.jobType === 'Demo' && !f.longTerm && (
            <label className="field"><span className="field-label">Demo type *</span>
              {otherType
                ? <input className="input" value={f.demoType} onChange={set('demoType')} placeholder="Type the demo type" autoFocus />
                : <select value={f.demoType} onChange={(e) => (e.target.value === '__other__' ? (setOtherType(true), setF((x) => ({ ...x, demoType: '' }))) : set('demoType')(e))}>
                  <option value="">Select demo type…</option>
                  {types.map((t) => <option key={t}>{t}</option>)}
                  <option value="__other__">Other…</option>
                </select>}
            </label>
          )}
          {!f.longTerm && (
            <label className="field"><span className="field-label">Shipping island *</span>
              <select value={f.island} onChange={set('island')}><option value="">Select island…</option>{ISLANDS.map((t) => <option key={t}>{t}</option>)}</select>
            </label>
          )}
        </div>
        <label className="field"><span className="field-label">Notes</span><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></label>
        <label className="field"><span className="field-label">Shipping details</span><textarea className="input" rows={2} value={f.shipping} onChange={set('shipping')} /></label>
      </section>
      <section className="card eq-newloan-part">
        <h2 className="eq-section-title">Devices</h2>
        <AssetPicker s={s} picked={picked} onChange={setPicked} when={when} />
      </section>
      {error && <Alert tone="critical" title="Not made yet">{error}</Alert>}
      <div className="eq-actions-row">
        <Button type="submit" disabled={busy}>{busy ? 'Making the loan…' : `Make the loan${picked.length ? ` (${picked.length} ${picked.length === 1 ? 'device' : 'devices'})` : ''}`}</Button>
        <Button variant="ghost" onClick={() => go('loans')}>Cancel</Button>
      </div>
      {confirmDialog}
    </form>
  )
}
