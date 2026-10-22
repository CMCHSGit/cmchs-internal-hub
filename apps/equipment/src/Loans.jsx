/* Loans (the old Loans tab, and the phone's Loans list): the same
   sections in the same order, from the same rules (loanSections in
   model.js). Needs reassign, then Upcoming (scheduled loans and bookings),
   Current (overdue ones marked), then Long term. A loan opens to show its
   devices, what it's still waiting on, and anything since moved to another
   loan, and what can be done to it so far (LoanActions.jsx). */
import { useEffect, useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Badge, Dialog, Toast, useToast } from '../../../shared/ui/index.jsx'
import LoanActions from './LoanActions.jsx'
import { AdminDialog } from './Items.jsx'
import { auditTone, AUDIT_LABELS, daysBetween, filterLoans, fmtDate, fmtWhen, jobOf, loanSections, loanUpdates, readinessOf, relTime } from './model.js'

// The old tab's sorts, in its order, Most recent loan first by default; Order added kept as well.
const SORTS = [['manager', 'Account manager'], ['recent', 'Most recent loan'], ['alpha', 'Customer A–Z'], ['expiry', 'Expiry (soonest)'], ['start', 'Loan date'], ['added', 'Order added']]

export default function Loans({ s, params, setParams, go }) {
  // ?open=kind:key opens one loan (Overview's rows); ?at= scrolls to a section.
  const [openKey, setOpenKey] = useState(params.open || null)
  const [toast, showToast] = useToast()
  // The newest audit entries, for each loan's "updated … ago" (old: auditLog, loaded with the data), again after each change.
  const [audit, setAudit] = useState([])
  useEffect(() => { s.loadAudit().then(setAudit, () => setAudit([])) }, [s.loadedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (params.open) setOpenKey(params.open)
    const el = params.open ? document.querySelector(`[data-loan="${CSS.escape(params.open)}"]`) : params.at && document.getElementById('loans-' + params.at)
    el?.scrollIntoView({ block: params.open ? 'center' : 'start' })
  }, [params.open, params.at])
  const sections = useMemo(() => loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode }),
    [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode])
  const f = { q: params.q || '', am: params.am || '', overdueOnly: params.overdue === '1', sort: params.sort || 'recent' }
  const all = [...sections.needsReassign, ...sections.upcoming, ...sections.current, ...sections.longTerm]
  const ams = [...new Set(all.map((g) => g.am).filter(Boolean))].sort()
  // Overdue only applies to started loans, as the old tab's checkbox did.
  const show = (list, started = true) => filterLoans([...list], { ...f, overdueOnly: started && f.overdueOnly }, s.today)
  const lists = [
    ['needsReassign', 'Needs reassigning', 'Started, but still waiting on devices that are out on another loan.', show(sections.needsReassign)],
    ['upcoming', 'Upcoming', 'Scheduled to start, and bookings waiting on devices.', f.overdueOnly ? [] : show(sections.upcoming, false)],
    ['current', 'Current', '', show(sections.current)],
    ['longTerm', 'Long term', 'No end date.', show(sections.longTerm)],
  ]
  // The old tab's count line, counted its way: active includes long term;
  // upcoming is every booking (even one that's a loan's pending items) plus
  // the scheduled loans.
  const active = [...sections.needsReassign, ...sections.current, ...sections.longTerm]
  const devices = active.reduce((n, g) => n + g.items.length, 0)
  const upcomingCount = s.upcoming.filter((u) => s.testMode || !String(u.id || '').startsWith('testbatch_')).length +
    sections.upcoming.filter((g) => g.kind === 'scheduled').length
  const set = (k, v) => setParams({ ...params, open: undefined, at: undefined, [k]: v || undefined })

  return (
    <>
      {!s.extrasReady && <p className="text-sm text-muted eq-loading-extras"><span className="spinner" style={{ width: 14, height: 14 }} aria-hidden="true" /> Loading the loan forms: job numbers, demo types and some account managers are still to come.</p>}
      <p className="text-sm text-muted eq-shown">
        {active.length} active {active.length === 1 ? 'loan' : 'loans'} · {devices} devices
        {upcomingCount > 0 && ` · ${upcomingCount} upcoming`}{sections.longTerm.length > 0 && ` · ${sections.longTerm.length} long-term`}
      </p>
      <div className="card eq-toolbar">
        <label className="field eq-grow"><span className="field-label">Search</span>
          <input className="input" type="search" value={f.q} onChange={(e) => set('q', e.target.value)} placeholder="Customer or location" autoComplete="off" />
        </label>
        <label className="field"><span className="field-label">Account manager</span>
          <select value={f.am} onChange={(e) => set('am', e.target.value)}><option value="">All account managers</option>{ams.map((a) => <option key={a}>{a}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">Sort</span>
          <select value={f.sort} onChange={(e) => set('sort', e.target.value === 'recent' ? '' : e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <label className="eq-check"><input type="checkbox" checked={f.overdueOnly} onChange={(e) => set('overdue', e.target.checked ? '1' : '')} /> Overdue only</label>
      </div>

      {lists.map(([id, title, hint, list]) => list.length > 0 && (
        <section key={id} id={'loans-' + id} className={`eq-loans eq-loans-${id}`} aria-label={title}>
          <h2 className="eq-section-title">{title} <span className="eq-count">{list.length}</span></h2>
          {hint && <p className="eq-note">{hint}</p>}
          {list.map((g) => { const k = g.kind + ':' + g.key; return <LoanCard key={k} g={g} s={s} audit={audit} all={all} go={go} onDone={showToast} start={params.open === k && params.act ? { act: params.act, to: params.to, nos: params.nos } : null} onStarted={() => setParams({ ...params, act: undefined, to: undefined, nos: undefined })} open={openKey === k} onToggle={() => setOpenKey(openKey === k ? null : k)} /> })}
        </section>
      ))}
      {lists.every(([, , , l]) => !l.length) && <p className="data-table-empty">{all.length ? 'No loans match that.' : 'No active loans.'}</p>}
      <Toast message={toast} />
    </>
  )
}

function LoanCard({ g, s, audit = [], all, go, open, onToggle, onDone, start, onStarted }) {
  const [removing, setRemoving] = useState(null) // { e } a device on the loan, or { p } one on its booking list
  const count = g.items.length
  const upcomingKind = g.kind === 'scheduled' || g.kind === 'booking'
  const days = upcomingKind ? daysBetween(s.today, g.startDate) : 0
  const when = upcomingKind
    ? `Starts ${fmtDate(g.startDate)} (${days > 0 ? `in ${days} day${days === 1 ? '' : 's'}` : 'today'})${g.endDate ? ` · due back ${fmtDate(g.endDate)}` : ''}`
    : g.longTerm ? `Since ${fmtDate(g.startDate)} · no end date` : `${fmtDate(g.startDate)} to ${fmtDate(g.endDate)}`
  const what = g.kind === 'booking'
    ? `${g.pending.length} ${g.pending.length === 1 ? 'device' : 'devices'} booked`
    : `${count} ${count === 1 ? 'device' : 'devices'}${g.pending.length ? ` (+${g.pending.length} pending pickup)` : ''}${g.ghosts.length ? ` (+${g.ghosts.length} transferred out)` : ''}`
  const job = jobOf(g.doc)
  const demoType = g.doc?.demoType || ''
  const ready = readinessOf(g, { loanMeta: s.loanMeta, today: s.today })
  const byId = (id, assetNo) => s.equipment.find((e) => e.id === id || e.CHSAssetNo === assetNo)
  // Each device's later bookings, soonest first (old: buildLoanDeviceRow's "Scheduled for …", "Then scheduled for …").
  const nextFor = (no) => (s.upcoming || []).filter((u) => u.id !== g.batchId && (s.testMode || !String(u.id || '').startsWith('testbatch_')) && (u.items || []).some((i) => i.CHSAssetNo === no))
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
  // How many of its waiting devices are still out elsewhere (old: "Awaiting return before pickup (n of m)").
  const waiting = g.kind === 'booking' ? 0 : g.pending.filter((p) => { const e = byId(p.id, p.CHSAssetNo); return e && e.OnLoanTo && e.Returned !== 'Yes' && e.BatchID !== g.batchId }).length
  // When a device was moved off (old: the ghost row's "on <date>"): its newest Transfer entry.
  const movedOn = (no) => { const h = (s.history || []).find((x) => x.action === 'Transfer' && x.chsAssetNo === no); return h ? fmtDate(String(h.ts || '').slice(0, 10)) : '' }
  // Its changes, and whether any are new since it was last looked at here (old: buildLoanUpdateBadge; the same loanSeen_ keys).
  const updates = useMemo(() => loanUpdates(audit, g), [audit, g])
  const seenKey = 'loanSeen_' + (g.batchId || encodeURIComponent(g.loanTo || ''))
  const [seen, setSeen] = useState(() => { try { return localStorage.getItem(seenKey) || '' } catch { return '' } })
  // Compared as moments; what's kept is the newest entry's own time (the old +12:00 stamps run an hour ahead in summer, so "now" could be earlier).
  const unseen = updates.length > 0 && (!seen || Date.parse(updates[0].ts) > Date.parse(seen))
  const [showUpdates, setShowUpdates] = useState(false)
  const openUpdates = () => {
    setShowUpdates(true)
    const at = [String(updates[0]?.ts || ''), new Date().toISOString()].sort((a, b) => Date.parse(b) - Date.parse(a))[0]
    setSeen(at); try { localStorage.setItem(seenKey, at) } catch { /* private mode */ }
  }
  return (
    <article data-loan={g.kind + ':' + g.key} className={`card eq-loan${g.overdue ? ' overdue' : ''}${upcomingKind && g.startingSoon ? ' soon' : ''}`}>
      <button type="button" className="eq-loan-head" aria-expanded={open} onClick={onToggle}>
        <span className="eq-loan-main">
          <span className="eq-loan-who">{g.loanTo}</span>
          <span className="eq-small">{[g.am, g.location, when, what].filter(Boolean).join(' · ')}</span>
          {(job || demoType) && (
            <span className="eq-small">
              {job && <span className={job.closed ? 'eq-job closed' : 'eq-job'}>{job.closed ? '✓ ' : ''}{job.label}{job.closed ? ' (Closed)' : ''}</span>}
              {job && demoType && ' · '}
              {demoType && <span className={demoType === 'Clinical Trial' ? 'eq-demo clinical' : 'eq-demo'}>{demoType}</span>}
            </span>
          )}
          {(ready.noTestRequired || ready.tested || ready.dispatched) && (
            <span className="eq-small eq-ready">
              {ready.noTestRequired && <span>— No test required</span>}
              {ready.tested && <span>✔ Tested{fmtWhen(ready.tested) && ` ${fmtWhen(ready.tested)}`}</span>}
              {ready.dispatched && <span>Dispatched{fmtWhen(ready.dispatched) && ` ${fmtWhen(ready.dispatched)}`}</span>}
            </span>
          )}
        </span>
        <span className="eq-loan-badges">
          {g.overdue && <Badge tone="critical">Overdue</Badge>}
          {ready.notTested && <Badge tone="orange">Not tested</Badge>}
          {g.kind === 'scheduled' && !ready.tested && !ready.noTestRequired && <Badge tone="neutral">Awaiting test</Badge>}
          {upcomingKind && (g.startingSoon ? <Badge tone="orange">Starting soon</Badge> : <Badge tone="purple">{g.kind === 'booking' ? 'Booked' : 'Scheduled'}</Badge>)}
          {g.longTerm && <Badge tone="neutral">Long term</Badge>}
          {g.kind === 'loan' && g.pending.length > 0 && !g.longTerm && <Badge tone="orange">Needs reassigning</Badge>}
          {g.batchId?.startsWith('testbatch_') && <Badge tone="neutral">Test</Badge>}
          {updates.length > 0 && <span className={`eq-small eq-updated${unseen ? ' new' : ''}`} title={unseen ? 'Changed since you last looked' : 'Last changed'}>{unseen && <i aria-hidden="true" />}{relTime(updates[0].ts)}</span>}
          <ChevronDown size={18} aria-hidden="true" className={`eq-chev${open ? ' open' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="eq-loan-body">
          {g.notes && <p className="eq-loan-notes">{g.notes}</p>}
          <ul className="eq-devices">
            {g.items.map((e) => <Device key={e.id} e={e} next={nextFor(e.CHSAssetNo)} onRemove={() => setRemoving({ e })} />)}
            {g.kind !== 'booking' && g.pending.length > 0 && (
              <li className="eq-device-head">{waiting ? `⏳ Awaiting return before pickup (${waiting} of ${g.pending.length})` : '✓ All items now available for pickup'}</li>
            )}
            {g.pending.map((p) => {
              const e = byId(p.id, p.CHSAssetNo)
              const now = e && e.OnLoanTo && e.Returned !== 'Yes' && e.BatchID !== g.batchId ? e : null
              return (
                <li key={'p' + (p.id || p.CHSAssetNo)} className="eq-device pending">
                  <a className="eq-strong" href={e ? '#/equipment?item=' + encodeURIComponent(e.id) : undefined}>{p.CHSAssetNo}</a> {p.Model || e?.Model}
                  <span className="eq-small">{now ? `Still on loan to ${now.OnLoanTo}${now.LoanEndDate ? `, due back ${fmtDate(now.LoanEndDate)}` : ''}` : 'Waiting to be picked up'}</span>
                  <button type="button" className="icon-btn icon-btn-sm eq-device-x" aria-label={`Take ${p.CHSAssetNo} off the booking`} title="Take off the booking" onClick={() => setRemoving({ p })}>×</button>
                </li>
              )
            })}
            {g.ghosts.map((e) => (
              <li key={'g' + e.id} className="eq-device ghost">
                <span className="eq-strong">{e.CHSAssetNo}</span> {e.Model}
                <span className="eq-small">Transferred to {e.OnLoanTo}{movedOn(e.CHSAssetNo) && ` on ${movedOn(e.CHSAssetNo)}`}</span>
              </li>
            ))}
          </ul>
          {updates.length > 0 && <button type="button" className="link-btn eq-small" onClick={openUpdates}>Loan updates ({updates.length}){unseen ? ', some new' : ''}</button>}
          <LoanActions g={g} s={s} all={all} go={go} onDone={onDone} start={start} onStarted={onStarted} />
          {showUpdates && (
            <Dialog title={`Loan updates: ${g.loanTo}`} onClose={() => setShowUpdates(false)} width={600}>
              <ul className="eq-audit">
                {updates.map((e) => (
                  <li key={e.id || e.ts + e.type}>
                    <div className="eq-audit-top"><Badge tone={auditTone(e.type)}>{AUDIT_LABELS[e.type] || e.type}</Badge><span className="eq-small">{fmtWhen(e.ts) || e.ts}</span></div>
                    <div className="eq-audit-what">{e.summary}</div>
                    {e.detail?.items?.length > 0 && <div className="eq-small eq-mono">{e.detail.items.join(', ')}</div>}
                    {e.operator && <div className="eq-small">by {e.operator}</div>}
                  </li>
                ))}
              </ul>
            </Dialog>
          )}
          {removing?.e && (
            <AdminDialog s={s} title={`Take ${removing.e.CHSAssetNo} off this loan?`} confirmLabel="Take it off" danger onClose={() => setRemoving(null)}
              message="For putting a mistake right: it comes off the loan and its form with no history entry. If it has come back, use Return items instead."
              onConfirm={async () => { await s.removeFromLoan(g, removing.e); setRemoving(null); onDone?.(`${removing.e.CHSAssetNo} taken off the loan.`) }} />
          )}
          {removing?.p && (
            <AdminDialog s={s} title={`Take ${removing.p.CHSAssetNo} off the booking for ${g.loanTo}?`} confirmLabel="Take it off" danger onClose={() => setRemoving(null)}
              onConfirm={async () => { const r = await s.removeFromBooking(g, removing.p.CHSAssetNo); setRemoving(null); onDone?.(r.emptied ? `${removing.p.CHSAssetNo} taken off: the booking had nothing left, so it’s cancelled.` : `${removing.p.CHSAssetNo} taken off the booking.`) }} />
          )}
        </div>
      )}
    </article>
  )
}

function Device({ e, next = [], onRemove }) {
  return (
    <li className="eq-device">
      <span><a className="eq-strong" href={'#/equipment?item=' + encodeURIComponent(e.id)} title="Open its record">{e.CHSAssetNo}</a> {e.Model}{e.Description && <span className="text-muted"> · {e.Description}</span>}</span>
      {e.SerialNo && <span className="eq-small eq-mono">{e.SerialNo}</span>}
      {next.map((u, i) => <span key={u.id} className="eq-small eq-next">{i ? '↪ Then scheduled' : '⏳ Scheduled'} for {u.loanTo} from {fmtDate(u.startDate)}{u.endDate ? ` – ${fmtDate(u.endDate)}` : ''}</span>)}
      {onRemove && <button type="button" className="icon-btn icon-btn-sm eq-device-x" aria-label={`Take ${e.CHSAssetNo} off this loan`} title="Take off this loan (admin)" onClick={onRemove}>×</button>}
    </li>
  )
}
