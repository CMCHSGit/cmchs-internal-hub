/* History (old: the History tab, and the audit log in Settings).
     Devices    every loan, return, count, transfer and change to a device,
                newest first, searchable and by kind; a loan's entry opens
                its loan form.
     Audit log  who did what to loans, equipment and Simpro jobs, from
                either tracker (the newest 300, as the old one). */
import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Loading } from '../../../shared/ui/index.jsx'
import LoanForm from './LoanForm.jsx'
import { AdminDialog } from './Items.jsx'
import { AUDIT_LABELS, filterAudit, filterHistory, fmtDate } from './model.js'

const ACTIONS = [['', 'Everything'], ['Loan', 'Loaned out'], ['Return', 'Returned'], ['Count', 'Counted'], ['Transfer', 'Transferred'], ['Converted', 'Converted'], ['Edited', 'Edited']]
const TONE = { Loan: 'orange', Return: 'green', Count: 'green', Transfer: 'purple' }
const PAGE = 200
const when = (ts) => {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

export default function History({ s, params, setParams }) {
  const tab = params.tab === 'audit' ? 'audit' : 'devices'
  return (
    <div className="eq-history-page">
      <nav className="eq-filters" aria-label="History">
        {[['devices', 'Devices'], ['audit', 'Audit log']].map(([t, l]) => (
          <button key={t} type="button" className={`tag${tab === t ? ' tag-selected' : ''}`} aria-pressed={tab === t} onClick={() => setParams({ tab: t === 'devices' ? undefined : t })}>{l}</button>
        ))}
      </nav>
      {tab === 'audit' ? <Audit s={s} /> : <Devices s={s} params={params} setParams={setParams} />}
    </div>
  )
}

function Devices({ s, params, setParams }) {
  const [q, setQ] = useState(params.q || '')
  const action = ACTIONS.some(([a]) => a === params.action) ? params.action : ''
  const [shown, setShown] = useState(PAGE)
  const [form, setForm] = useState(null) // a loan entry's loan form key
  const [picked, setPicked] = useState(new Set()) // entries ticked to delete (old: History management)
  const [deleting, setDeleting] = useState(false)
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const rows = useMemo(() => filterHistory(s.history || [], { q, action }), [s.history, q, action])
  useEffect(() => setShown(PAGE), [q, action])
  return (
    <>
      <div className="card eq-toolbar">
        <label className="field eq-grow"><span className="field-label">Search</span>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset, model, customer, location, notes or who" />
        </label>
        <label className="field"><span className="field-label">Show</span>
          <select value={action} onChange={(e) => setParams({ ...params, action: e.target.value || undefined })}>{ACTIONS.map(([a, l]) => <option key={a} value={a}>{l}</option>)}</select>
        </label>
      </div>
      <p className="text-sm text-muted eq-shown">{rows.length} {rows.length === 1 ? 'record' : 'records'}</p>
      {picked.size > 0 && (
        <div className="card eq-selbar">
          <span className="eq-grow">{picked.size} ticked</span>
          <button type="button" className="btn btn-ghost btn-sm eq-danger" onClick={() => setDeleting(true)}>Delete</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPicked(new Set())}>Clear</button>
        </div>
      )}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th>{(() => {
            // Every entry the search and filter show, as the old Select all did.
            const ids = rows.map((h) => h.id).filter(Boolean), all = ids.length > 0 && ids.every((id) => picked.has(id))
            return <input type="checkbox" checked={all} disabled={!ids.length} onChange={() => setPicked((p) => { const n = new Set(p); ids.forEach((id) => (all ? n.delete(id) : n.add(id))); return n })} aria-label="Tick all shown" title="Tick all shown" />
          })()}</th><th>When</th><th>Asset</th><th>What</th><th>Customer</th><th>Dates</th><th>Notes</th><th>Who</th></tr></thead>
          <tbody>
            {rows.slice(0, shown).map((h) => (
              <tr key={h.id || h.ts + h.chsAssetNo} className="data-table-row">
                <td data-label="Tick">{h.id && <input type="checkbox" checked={picked.has(h.id)} onChange={() => toggle(h.id)} aria-label="Tick to delete" />}</td>
                <td data-label="When" className="eq-nowrap">{when(h.ts)}</td>
                <td data-label="Asset"><span className="eq-strong">{h.chsAssetNo}</span><span className="eq-small">{h.model}</span></td>
                <td data-label="What"><Badge tone={TONE[h.action] || 'neutral'}>{h.action}</Badge>
                  {h.action === 'Loan' && h._pdfKey && <button type="button" className="link-btn eq-small" onClick={() => setForm(h._pdfKey)}>Loan form</button>}</td>
                <td data-label="Customer">{h.loanTo}{h.location && <span className="eq-small">{h.location}</span>}</td>
                <td data-label="Dates" className="eq-nowrap">{h.loanStart ? fmtDate(h.loanStart) : ''}{h.loanEnd ? ` → ${fmtDate(h.loanEnd)}` : ''}</td>
                <td data-label="Notes" className="eq-history-notes">{h.notes}</td>
                <td data-label="Who">{h.operator}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="data-table-empty">Nothing matches that.</p>}
      </div>
      {rows.length > shown && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShown((n) => n + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more</button>}
      {form && <HistoryForm s={s} docKey={form} onClose={() => setForm(null)} />}
      {deleting && (
        <AdminDialog s={s} title={`Delete ${picked.size} history ${picked.size === 1 ? 'entry' : 'entries'}?`} message="They’re gone for good: from both trackers and the devices’ records." confirmLabel="Delete" danger
          onClose={() => setDeleting(false)} onConfirm={async () => { await s.deleteHistory([...picked]); setPicked(new Set()); setDeleting(false) }} />
      )}
    </>
  )
}

/** A past loan's form, from its stored copy (old: viewHistoryPDF). */
function HistoryForm({ s, docKey, onClose }) {
  const doc = s.loanDocs?.[docKey]
  if (!doc) {
    return (
      <div className="eq-note-pop" role="status">
        <Alert tone="info" title="No loan form kept">That loan’s form isn’t stored any more: forms are removed when everything on a loan comes back.</Alert>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>OK</button>
      </div>
    )
  }
  return <LoanForm s={s} docKey={docKey} doc={doc} items={doc.items || []} info={{ loanTo: doc.loanTo, location: doc.location, startDate: doc.startDate, endDate: doc.endDate, accountManager: doc.accountManager, longTerm: !!doc.longTerm, jobType: doc.jobType, demoType: doc.demoType, island: doc.island }} onClose={onClose} onDone={onClose} />
}

function Audit({ s }) {
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  useEffect(() => { s.loadAudit().then(setEntries, (e) => setError(e.message || String(e))) }, [s.loadedAt]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => filterAudit(entries || [], { q, kind }), [entries, q, kind])
  if (error) return <Alert tone="critical" title="The audit log didn’t load">{error}</Alert>
  if (!entries) return <Loading />
  return (
    <>
      <div className="card eq-toolbar">
        <label className="field eq-grow"><span className="field-label">Search</span><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="What, who or an asset number" /></label>
        <label className="field"><span className="field-label">Show</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Everything</option><option value="loans">Loans</option><option value="database">Equipment</option><option value="simpro">Simpro</option></select>
        </label>
      </div>
      <p className="text-sm text-muted eq-shown">{rows.length} of the newest {entries.length}</p>
      <ul className="card eq-audit">
        {rows.map((e) => (
          <li key={e.id}>
            <div className="eq-audit-top"><Badge tone="neutral">{AUDIT_LABELS[e.type] || e.type}</Badge><span className="eq-small">{when(e.ts)}</span></div>
            <div className="eq-audit-what">{e.summary}</div>
            {e.detail?.items?.length > 0 && <div className="eq-small eq-mono">{e.detail.items.join(', ')}</div>}
            {(e.operator || e.source) && <div className="eq-small">{e.operator ? `by ${e.operator}` : ''}{e.source ? `${e.operator ? ' · ' : ''}${e.source === 'mobile' ? 'phone' : e.source === 'hub' ? 'new tracker' : 'desktop'}` : ''}</div>}
          </li>
        ))}
        {!rows.length && <li className="eq-note">Nothing matches that.</li>}
      </ul>
    </>
  )
}
