/* What can be done to a loan, under its devices on an open loan card: so
   far testing and dispatch (old: buildReadinessButtons), Extend (old:
   openExtendLoan), Return items (old: openBatchReturn) and long term either
   way (old: openLongTermModal). The rest of the old card's buttons (edit,
   transfer, copy, add items, delete) come next; until then they're in the
   old tracker. */
import { useState } from 'react'
import { Alert, Button, Dialog, useConfirm } from '../../../shared/ui/index.jsx'
import { canExtend, demoTypeOptions, editProblem, extendProblem, fmtDate, fmtWhen, nzNow, readinessButtons, returnToActiveProblem, suggestedReturnDate } from './model.js'

const LABEL = { tested: 'tested', dispatched: 'dispatched', noTestRequired: 'no test required' }

export default function LoanActions({ g, s, onDone }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [asking, setAsking] = useState(null) // 'tested' | 'dispatched' | 'extend' | 'return' | 'longTerm' | 'active' | 'edit' | 'delete'
  const [confirmDialog, confirm] = useConfirm()
  const rb = readinessButtons(g, { loanMeta: s.loanMeta, today: s.today })

  // One change at a time; data-working holds off the app's update reload meanwhile.
  async function run(fn, done) {
    setBusy(true); setError('')
    try { const r = await fn(); setAsking(null); onDone?.(typeof done === 'function' ? done(r) : done) } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
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
      <div className="eq-actions-row">
        {canExtend(g) && <Button size="sm" disabled={busy} onClick={() => setAsking('extend')}>Extend</Button>}
        {g.kind === 'loan' && g.longTerm && <Button size="sm" disabled={busy} onClick={() => setAsking('active')}>Return to active</Button>}
        {g.kind === 'loan' && g.items.length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking('return')}>Return items</Button>}
        {g.kind === 'loan' && !g.longTerm && g.items.length > 0 && <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking('longTerm')}>Make long-term</Button>}
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => setAsking('edit')}>Edit</Button>
        <Button size="sm" variant="ghost" className="eq-danger" disabled={busy} onClick={() => setAsking('delete')}>{g.kind === 'booking' ? 'Cancel booking' : 'Delete'}</Button>
        <span className="eq-note">Other changes: <a href="/demo/">the current tracker</a>.</span>
      </div>
      {error && <Alert tone="critical" title="Not saved">{error}</Alert>}

      {(asking === 'tested' || asking === 'dispatched') && (
        <WhenDialog g={g} field={asking} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={(at) => run(() => s.setReadiness(g, asking, true, at), `${g.loanTo}: marked ${LABEL[asking]}.`)} />
      )}
      {asking === 'extend' && (
        <ExtendDialog g={g} today={s.today} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={(d) => run(() => s.extendLoan(g, d), `${g.loanTo}: extended to ${fmtDate(d)}.`)} />
      )}
      {asking === 'return' && (
        <ReturnDialog g={g} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={(ids) => run(() => s.returnItems(g, ids), (r) => returnedText(g, r))} />
      )}
      {asking === 'longTerm' && (
        <LongTermDialog g={g} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={() => run(() => s.makeLongTerm(g), `${g.loanTo} is now a long-term loan.`)} />
      )}
      {asking === 'active' && (
        <ActiveDialog g={g} today={s.today} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={(d) => run(() => s.returnToActive(g, d), `${g.loanTo} is back on active loans, due ${fmtDate(d)}.`)} />
      )}
      {asking === 'edit' && (
        <EditDialog g={g} s={s} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={(f) => run(() => s.editLoan(g, f), (r) => (r.started === 'all' ? 'Loan updated: it has started.' : r.started === 'some' ? 'Loan updated, but some devices are still out on another loan.' : 'Loan updated.'))} />
      )}
      {asking === 'delete' && (
        <DeleteDialog g={g} busy={busy} error={error} onClose={() => { setAsking(null); setError('') }}
          onSave={async (pw) => {
            setError('')
            try { if (!(await s.checkAdmin(pw))) return setError('That isn’t the admin password.') } catch (e) { return setError(e.message || String(e)) }
            run(() => s.deleteLoan(g), g.kind === 'booking' ? `Booking for ${g.loanTo} cancelled.` : `Loan for ${g.loanTo} deleted.`)
          }} />
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

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const returnedText = (g, r) =>
  `${plural(r.returned, 'item', 'items')} returned from ${g.loanTo}${r.started ? `; ${plural(r.started, 'booking', 'bookings')} waiting on them started` : ''}.`

/** Which devices are back (old: the batch return modal). All ticked to start with: a loan usually comes back whole. */
function ReturnDialog({ g, busy, error, onClose, onSave }) {
  const [picked, setPicked] = useState(() => new Set(g.items.map((e) => e.id)))
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const n = picked.size
  return (
    <Dialog title={`Return from ${g.loanTo}`} description={[g.location, g.endDate && 'due ' + fmtDate(g.endDate)].filter(Boolean).join(' · ')} onClose={onClose} width={520}>
      <form className="eq-form" onSubmit={(e) => { e.preventDefault(); if (n) onSave([...picked]) }}>
        {g.longTerm && <Alert tone="warning" title="This is a long-term loan">The equipment is meant to stay with {g.loanTo}. Only return it if it has really come back.</Alert>}
        <div className="eq-actions-row">
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(g.items.map((e) => e.id)))}>All</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>None</Button>
        </div>
        <ul className="eq-picklist">
          {g.items.map((e) => (
            <li key={e.id}>
              <label className="eq-pick">
                <input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} />
                <span><span className="eq-strong">{e.CHSAssetNo}</span> {e.Model}{e.SerialNo && <span className="eq-small eq-mono">{e.SerialNo}</span>}</span>
              </label>
            </li>
          ))}
        </ul>
        <p className="eq-note">Anything a booking is waiting on goes straight onto that booking. A loan with nothing left out has its Simpro job closed.</p>
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !n}>{busy ? 'Returning…' : `Return ${plural(n, 'item', 'items')}`}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function LongTermDialog({ g, busy, error, onClose, onSave }) {
  return (
    <Dialog title={`Make long-term: ${g.loanTo}`} onClose={onClose} width={480}>
      <div className="eq-form">
        <ul className="eq-bullets">
          <li>It moves to Long term, loses its end date and stops sending due-date reminders.</li>
          <li>Its Simpro job, if it has one, is closed. The devices stay listed on it.</li>
          <li>If a “Return due” calendar invite was sent to the account manager, delete it from their calendar: it can’t be withdrawn from here.</li>
        </ul>
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={onSave}>{busy ? 'Saving…' : 'Make long-term'}</Button>
        </div>
      </div>
    </Dialog>
  )
}

function ActiveDialog({ g, today, busy, error, onClose, onSave }) {
  const [date, setDate] = useState(() => suggestedReturnDate(g, today))
  const problem = returnToActiveProblem(g, date, today)
  return (
    <Dialog title={`Return to active: ${g.loanTo}`} description="An end date brings it back onto the active list, with due-date reminders." onClose={onClose} width={440}>
      <form className="eq-form" onSubmit={(e) => { e.preventDefault(); if (!problem) onSave(date) }}>
        <label className="field"><span className="field-label">End date</span>
          <input className="input" type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} required />
        </label>
        {problem && <p className="eq-note eq-problem">{problem}</p>}
        <p className="eq-note">Its Simpro job was closed when it became long term and stays closed. If it needs a new one, make it in the current tracker (Settings, Simpro job health).</p>
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !!problem}>{busy ? 'Saving…' : 'Return to active'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** A loan's details (old: the Edit Loan modal): who, where, when, the account manager and the loan form's extras. */
function EditDialog({ g, s, busy, error, onClose, onSave }) {
  const doc = g.doc || {}
  const managerOf = (name) => (s.managers || []).find((m) => m.name === name)
  const [f, setF] = useState(() => ({
    loanTo: g.loanTo || '', location: g.location || '', startDate: g.startDate || '', endDate: g.endDate || '',
    am: g.am || '', email: managerOf(g.am)?.email || g.items[0]?.BorrowerEmail || '',
    contact: doc.contactNumber || '', notes: doc.notesCell || doc.notes || '', shipping: doc.authCell || '', demoType: doc.demoType || '',
  }))
  const [otherType, setOtherType] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const problem = editProblem(g, f)
  const types = demoTypeOptions(s.demoTypes, f.demoType)
  const n = g.kind === 'booking' ? g.pending.length : g.items.length
  return (
    <Dialog title={`Edit: ${g.loanTo}`} description={`${n} ${n === 1 ? 'device' : 'devices'}`} onClose={onClose} width={620}>
      <form className="eq-form" onSubmit={(e) => { e.preventDefault(); if (!problem) onSave(f) }}>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Loan to</span><input className="input" value={f.loanTo} onChange={set('loanTo')} /></label>
          <label className="field"><span className="field-label">Location</span><input className="input" value={f.location} onChange={set('location')} /></label>
        </div>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Start</span><input className="input" type="date" value={f.startDate} onChange={set('startDate')} /></label>
          {!g.longTerm && <label className="field"><span className="field-label">End</span><input className="input" type="date" value={f.endDate} onChange={set('endDate')} /></label>}
        </div>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Account manager</span>
            <select value={f.am} onChange={(e) => { const am = e.target.value; setF((x) => ({ ...x, am, email: managerOf(am)?.email || x.email })) }}>
              <option value="">Select account manager…</option>
              {[...(s.managers || [])].sort((a, b) => (a.name || '').localeCompare(b.name || '')).map((m) => <option key={m.name} value={m.name}>{m.name}</option>)}
              {f.am && !managerOf(f.am) && <option value={f.am}>{f.am}</option>}
            </select>
          </label>
          <label className="field"><span className="field-label">Their email</span><input className="input" type="email" value={f.email} onChange={set('email')} /></label>
        </div>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Contact number</span><input className="input" value={f.contact} onChange={set('contact')} /></label>
          <label className="field"><span className="field-label">Demo type</span>
            {otherType
              ? <input className="input" value={f.demoType} onChange={set('demoType')} placeholder="Type the demo type" autoFocus />
              : <select value={f.demoType} onChange={(e) => (e.target.value === '__other__' ? (setOtherType(true), setF((x) => ({ ...x, demoType: '' }))) : set('demoType')(e))}>
                <option value="">Select demo type…</option>
                {types.map((t) => <option key={t} value={t}>{t}</option>)}
                <option value="__other__">Other…</option>
              </select>}
          </label>
        </div>
        <label className="field"><span className="field-label">Notes</span><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></label>
        <label className="field"><span className="field-label">Shipping and authorisation</span><textarea className="input" rows={2} value={f.shipping} onChange={set('shipping')} /></label>
        <p className="eq-note">A box left empty keeps what it had, as in the current tracker (notes, shipping, contact and demo type are saved as shown).</p>
        {problem && <p className="eq-note eq-problem">{problem}</p>}
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !!problem}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Delete, with the admin password (old: adminPrompt, then a confirm). */
function DeleteDialog({ g, busy, error, onClose, onSave }) {
  const [pw, setPw] = useState('')
  const booking = g.kind === 'booking'
  const list = (booking ? g.pending : g.items).map((e) => e.CHSAssetNo).join(', ')
  return (
    <Dialog title={booking ? `Cancel the booking for ${g.loanTo}?` : `Delete the loan for ${g.loanTo}?`} onClose={onClose} width={460}>
      <form className="eq-form" onSubmit={(e) => { e.preventDefault(); if (pw) onSave(pw) }}>
        <p className="confirm-text">
          {booking ? `It starts ${fmtDate(g.startDate)}. The booking goes; loans now running aren’t touched.`
            : g.kind === 'scheduled' ? `It starts ${fmtDate(g.startDate)}. These devices are cleared of it: ${list}. This can’t be undone.`
              : `These devices are marked as returned: ${list}. This can’t be undone.`}
        </p>
        <label className="field"><span className="field-label">Admin password</span>
          <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" autoFocus />
        </label>
        {error && <Alert tone="critical" title="Not done">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
          <Button type="submit" variant="danger" disabled={busy || !pw}>{busy ? 'Working…' : booking ? 'Cancel booking' : 'Delete loan'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
