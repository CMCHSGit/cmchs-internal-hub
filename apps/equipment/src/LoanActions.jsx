/* What can be done to a loan, under its devices on an open loan card: so
   far testing and dispatch (old: buildReadinessButtons) and Extend (old:
   openExtendLoan). The rest of the old card's buttons (long term, edit,
   transfer, copy, add items, return, delete) come next; until then they're
   in the old tracker. */
import { useState } from 'react'
import { Alert, Button, Dialog, useConfirm } from '../../../shared/ui/index.jsx'
import { canExtend, extendProblem, fmtDate, fmtWhen, nzNow, readinessButtons } from './model.js'

const LABEL = { tested: 'tested', dispatched: 'dispatched', noTestRequired: 'no test required' }

export default function LoanActions({ g, s, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(null) // 'tested' | 'dispatched' | 'extend'
  const [confirmDialog, confirm] = useConfirm()
  const rb = readinessButtons(g, { loanMeta: s.loanMeta, today: s.today })

  // One change at a time; data-working holds off the app's update reload meanwhile.
  async function run(fn, done) {
    setBusy(true); setError('')
    try { await fn(); setAsking(null); onDone?.(done) } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  const undo = async (field, at) => {
    if (!(await confirm({ title: `Clear “${LABEL[field]}”?`, message: `${g.loanTo}: marked ${LABEL[field]}${at ? ' ' + fmtWhen(at) : ''}. Clear it?`, confirmLabel: 'Clear it' }))) return
    run(() => s.setReadiness(g, field, false), `${g.loanTo}: no longer marked ${LABEL[field]}.`)
  }

  return (
    <div className="eq-actions" data-working={busy ? '' : undefined}>
      {(rb.noTestRequired || rb.skip || rb.tested || rb.dispatched) && (
        <div className="eq-actions-row" role="group" aria-label="Testing and dispatch">
          {rb.noTestRequired && <Button size="sm" variant="secondary" disabled={busy} onClick={() => undo('noTestRequired')}>— No test required</Button>}
          {rb.skip && <Button size="sm" variant="ghost" disabled={busy} onClick={() => run(() => s.setReadiness(g, 'noTestRequired', true), `${g.loanTo}: no test required.`)}>— Skip testing</Button>}
          {rb.tested && (rb.tested.on
            ? <Button size="sm" variant="secondary" className="eq-done" disabled={busy} onClick={() => undo('tested', rb.tested.at)}>✔ Tested{rb.tested.at && <span className="eq-when">{fmtWhen(rb.tested.at)}</span>}</Button>
            : <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking('tested')}>○ Mark tested</Button>)}
          {rb.dispatched && (rb.dispatched.on
            ? <Button size="sm" variant="secondary" className="eq-done" disabled={busy} onClick={() => undo('dispatched', rb.dispatched.at)}>Dispatched{rb.dispatched.at && <span className="eq-when">{fmtWhen(rb.dispatched.at)}</span>}</Button>
            : <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking('dispatched')}>Mark dispatched</Button>)}
        </div>
      )}
      {canExtend(g) && (
        <div className="eq-actions-row">
          <Button size="sm" disabled={busy} onClick={() => setAsking('extend')}>Extend</Button>
          <span className="eq-note">Other changes: <a href="/demo/">the current tracker</a>.</span>
        </div>
      )}
      {error && <Alert tone="critical" title="Not saved">{error}</Alert>}

      {(asking === 'tested' || asking === 'dispatched') && (
        <WhenDialog g={g} field={asking} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={(at) => run(() => s.setReadiness(g, asking, true, at), `${g.loanTo}: marked ${LABEL[asking]}.`)} />
      )}
      {asking === 'extend' && (
        <ExtendDialog g={g} today={s.today} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={(d) => run(() => s.extendLoan(g, d), `${g.loanTo}: extended to ${fmtDate(d)}.`)} />
      )}
      {confirmDialog}
    </div>
  )
}

/** When it was tested or dispatched, now by default (old: the readiness date modal). */
function WhenDialog({ g, field, busy, error, onClose, onSave }) {
  const now = nzNow()
  const [date, setDate] = useState(now.slice(0, 10))
  const [time, setTime] = useState(now.slice(11, 16))
  const submit = (e) => { e.preventDefault(); onSave(date ? `${date}T${time || '00:00'}:00+12:00` : nzNow()) }
  return (
    <Dialog title={field === 'tested' ? 'Mark as tested' : 'Mark as dispatched'} description={g.loanTo} onClose={onClose} width={420}>
      <form onSubmit={submit} className="eq-form">
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Date</span><input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required /></label>
          <label className="field"><span className="field-label">Time</span><input className="input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        </div>
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function ExtendDialog({ g, today, busy, error, onClose, onSave }) {
  const [date, setDate] = useState(g.endDate || today)
  const problem = date === g.endDate ? '' : extendProblem(g, date)
  const n = g.kind === 'booking' ? g.pending.length : g.items.length
  const submit = (e) => { e.preventDefault(); if (!extendProblem(g, date)) onSave(date) }
  return (
    <Dialog title={`Extend: ${g.loanTo}`} description={`${n} ${n === 1 ? 'device' : 'devices'} · due back ${g.endDate ? fmtDate(g.endDate) : 'no date yet'}`} onClose={onClose} width={420}>
      <form onSubmit={submit} className="eq-form">
        <label className="field"><span className="field-label">New end date</span>
          <input className="input" type="date" value={date} min={g.endDate || undefined} onChange={(e) => setDate(e.target.value)} required />
        </label>
        {problem && <p className="eq-note eq-problem">{problem}</p>}
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !!extendProblem(g, date)}>{busy ? 'Saving…' : 'Extend'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
