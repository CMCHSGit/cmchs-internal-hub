/* Scan (old: the Scan / Loan tab's Return and Count modes, and the phone's
   Scan with Stocktake). Asset numbers are typed, come from a scanner gun
   (it types them and presses Enter), or are read by the camera (Scanner.jsx).

     Return     scanned devices gather in a list, then are returned together
                (as Return items: bookings waiting on them start, emptied
                loans have their Simpro job closed).
     Count      one at a time: counted and back in the office, or counted
                where it is if it's out on loan; the count so far above.
     Stocktake  every scan is counted and returned straight away, for going
                along a shelf. For hub admins (the old one asked for the admin password).
   New loans are made in New loan. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Alert, Badge, Button } from '../../../shared/ui/index.jsx'
import Scanner from './Scanner.jsx'
import { assetNoFromScan, countCategory, findAsset, fmtDate, isLoanLongTerm, isOut, statusOf } from './model.js'
import { Status } from './BrowseEquipment.jsx'

const MODES = [['return', 'Return'], ['count', 'Count'], ['stocktake', 'Stocktake'], ['lookup', 'Look up']]

export default function Scan({ s, params, setParams, go, onDone }) {
  const mode = MODES.some(([m]) => m === params.mode) ? params.mode : 'return'
  const [code, setCode] = useState('')
  // A phone (a touch screen) starts with the camera on and the keyboard down, as the old phone's Scan did.
  const phone = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  const [camera, setCamera] = useState(phone)
  const [log, setLog] = useState([]) // Return and Count: what's been done here (old: addSession, "N actions this session")
  const logged = (rows) => setLog((l) => [...rows.map((r) => ({ ...r, at: new Date().toLocaleTimeString('en-NZ', { hour: '2-digit', minute: '2-digit' }) })), ...l].slice(0, 100))
  const [msg, setMsg] = useState(null) // { tone, text }
  const [queue, setQueue] = useState([]) // Return: item ids
  const [current, setCurrent] = useState(null) // Count: an item id
  const [session, setSession] = useState([]) // Stocktake: what's been counted
  const [busy, setBusy] = useState(false)
  const box = useRef(null)
  const ctx = { loanMeta: s.loanMeta, loanDocs: s.loanDocs }
  const byId = (id) => s.equipment.find((e) => e && e.id === id)

  async function run(fn) {
    setBusy(true)
    try { return await fn() } catch (e) { setMsg({ tone: 'critical', text: e.message || String(e) }) } finally { setBusy(false) }
  }

  function scanned(raw) {
    // A label's QR holds a link to the item (labelUrl); older labels and typed numbers are just the asset number
    const no = assetNoFromScan(raw)
    setCode('')
    if (!no) return
    const e = findAsset(s.equipment, no)
    if (!e) { setMsg({ tone: 'critical', text: `“${no}” isn’t in the equipment list. Check the number, or add it under Equipment.` }); return }
    if (mode === 'lookup') {
      go('equipment', { item: e.id }) // its record: status, current loan, history
      return
    }
    if (mode === 'return') {
      if (!isOut(e)) setMsg({ tone: 'info', text: `${e.CHSAssetNo} is already in the office.` })
      // On a loan that hasn't started, it hasn't left: returning it would take it off that loan (old: refused, "booked ahead").
      else if (e.LoanStartDate && e.LoanStartDate > s.today) setMsg({ tone: 'info', text: `${e.CHSAssetNo} is booked ahead for ${e.OnLoanTo}, from ${fmtDate(e.LoanStartDate)}: it hasn’t gone out yet, so there’s nothing to return.` })
      else if (queue.includes(e.id)) setMsg({ tone: 'info', text: `${e.CHSAssetNo} is already in the list.` })
      else { setQueue((q) => [...q, e.id]); setMsg(null) }
    } else if (mode === 'count') {
      setCurrent(e.id); setMsg(null)
    } else if (mode === 'stocktake') {
      run(async () => {
        const r = await s.countItem(e.id)
        setSession((x) => [{ no: e.CHSAssetNo, model: e.Model, from: r.was.out ? r.was.loanTo : '' }, ...x].slice(0, 50))
        setMsg({ tone: 'success', text: `${e.CHSAssetNo} counted${r.was.out ? `, and back from ${r.was.loanTo}` : ''}.` })
      })
    }
    if (!phone) box.current?.focus()
  }

  // A number typed and left for a moment is looked up without Enter (old: 500 ms after 3 characters),
  // once it's an asset number on the list, so a scanner gun's Enter still wins and a part-typed one waits.
  useEffect(() => {
    const no = code.trim()
    if (no.length < 3 || !findAsset(s.equipment, no)) return undefined
    const t = setTimeout(() => scanned(no), 500)
    return () => clearTimeout(t)
  }, [code]) // eslint-disable-line react-hooks/exhaustive-deps

  const counts = useMemo(() => {
    const c = { never: 0, new: 0, old: 0 }
    for (const e of s.equipment) c[countCategory(e)]++
    return { ...c, total: s.equipment.length, done: c.new + c.old }
  }, [s.equipment])

  const switchMode = (m) => { setParams({ mode: m === 'return' ? undefined : m }); setQueue([]); setCurrent(null); setMsg(null); setCamera(phone) }
  // A stocktake is for hub admins (step 5A: the role, in place of the old admin password).
  const locked = mode === 'stocktake' && !s.isAdmin

  return (
    <div className="eq-scan">
      <nav className="eq-filters" aria-label="What scanning does">
        {MODES.map(([m, label]) => <button key={m} type="button" className={`tag${mode === m ? ' tag-selected' : ''}`} aria-pressed={mode === m} onClick={() => switchMode(m)}>{label}</button>)}
      </nav>
      <p className="eq-note">
        {mode === 'return' ? 'Scan what’s come back, then return them together.'
          : mode === 'count' ? 'Scan an item to count it.'
            : mode === 'lookup' ? 'Scan an asset’s QR label to open its record: status, current loan and history.'
              : 'Every scan is counted and returned straight away. Keep scanning; the camera stays on.'}
      </p>

      {locked ? (
        <Alert tone="info" title="Hub admins only">A stocktake counts and returns everything scanned, so it’s for admins. Ask one, or use Count.</Alert>
      ) : (
        <>
          <div className="eq-picker-add">
            <label className="field eq-grow"><span className="field-label">Asset number</span>
              <input ref={box} className="input eq-scan-input" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanned(code) } }}
                placeholder="Type or scan, then Enter" autoComplete="off" autoFocus={!phone} inputMode="text" />
            </label>
            {!camera && <Button variant="secondary" iconLeft={<Camera size={16} />} onClick={() => setCamera(true)}>Camera</Button>}
          </div>
          {camera && <Scanner onCode={scanned} onClose={() => setCamera(false)} />}
        </>
      )}
      {msg && <Alert tone={msg.tone} title={msg.tone === 'critical' ? 'Not done' : ''}>{msg.text}</Alert>}

      {mode === 'return' && queue.length > 0 && (
        <section className="card eq-scan-list">
          <ul className="eq-picklist">
            {queue.map((id) => {
              const e = byId(id)
              if (!e) return null
              return (
                <li key={id} className="eq-picked">
                  <span className="eq-picked-main"><span className="eq-strong">{e.CHSAssetNo}</span> {e.Model}
                    <span className="eq-small">from {e.OnLoanTo}{e.LoanEndDate ? `, due ${fmtDate(e.LoanEndDate)}` : ''}{isLoanLongTerm(e.BatchID, ctx) ? ' · long-term loan' : ''}</span>
                  </span>
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Take ${e.CHSAssetNo} off the list`} onClick={() => setQueue((q) => q.filter((x) => x !== id))}>×</button>
                </li>
              )
            })}
          </ul>
          {queue.some((id) => isLoanLongTerm(byId(id)?.BatchID, ctx)) && <Alert tone="warning" title="Some are on long-term loans">That equipment is meant to stay with the customer. Only return it if it has really come back.</Alert>}
          <div className="eq-actions-row">
            <Button disabled={busy} onClick={() => run(async () => {
              const back = queue.map(byId).filter(Boolean)
              const r = await s.returnItems({ loanTo: '' }, queue)
              logged(back.map((e) => ({ no: e.CHSAssetNo, model: e.Model, action: 'Returned', loanTo: e.OnLoanTo, location: e.Location })))
              setQueue([])
              onDone(`${r.returned} ${r.returned === 1 ? 'item' : 'items'} returned${r.started ? `; ${r.started} ${r.started === 1 ? 'booking' : 'bookings'} waiting on them started` : ''}.`)
            })}>{busy ? 'Returning…' : `Return ${queue.length} ${queue.length === 1 ? 'item' : 'items'}`}</Button>
            <Button variant="ghost" onClick={() => setQueue([])}>Clear the list</Button>
          </div>
        </section>
      )}

      {mode === 'count' && (() => {
        const e = current && byId(current)
        return (
          <>
            {e && (
              <section className="card eq-scan-item">
                <div className="eq-strong">{e.CHSAssetNo} · {e.Model}</div>
                <p className="eq-note">{e.SerialNo && <span className="eq-mono">{e.SerialNo} · </span>}{e.Counted && e.Counted !== 'No' ? e.Counted : 'Not counted yet'}{e.ShelfLocation ? ` · ${e.ShelfLocation}` : ''}</p>
                {isOut(e) && <p className="eq-note">On loan to <b>{e.OnLoanTo}</b>{e.LoanEndDate ? `, due ${fmtDate(e.LoanEndDate)}` : ''}. Is it back, or counted where it is?</p>}
                <div className="eq-actions-row">
                  <Button disabled={busy} onClick={() => run(async () => { const r = await s.countItem(e.id); logged([{ no: e.CHSAssetNo, model: e.Model, action: r.was.out ? 'Counted, returned' : 'Counted', loanTo: r.was.out ? e.OnLoanTo : '', location: r.was.out ? e.Location : e.ShelfLocation }]); setCurrent(null); onDone(`${e.CHSAssetNo} counted${r.was.out ? ' and marked as returned' : ''}.`) })}>{isOut(e) ? 'Count it, it’s back' : 'Count it'}</Button>
                  {isOut(e) && <Button variant="secondary" disabled={busy} onClick={() => run(async () => { await s.countItem(e.id, { keepOnLoan: true }); logged([{ no: e.CHSAssetNo, model: e.Model, action: 'Counted, on loan', loanTo: e.OnLoanTo, location: e.Location }]); setCurrent(null); onDone(`${e.CHSAssetNo} counted, still on loan to ${e.OnLoanTo}.`) })}>Count it, still on loan</Button>}
                  <Button variant="ghost" onClick={() => setCurrent(null)}>Skip</Button>
                </div>
              </section>
            )}
            <section className="card eq-count">
              <div className="eq-util-head"><span>Count</span><span className="eq-mono">{counts.done} of {counts.total} counted ({counts.total ? Math.round((counts.done / counts.total) * 100) : 0}%)</span></div>
              <div className="eq-util-bar" role="img" aria-label={`${counts.new} counted here, ${counts.old} counted before, ${counts.never} never`}>
                <span className="ok" style={{ width: (counts.total ? (counts.new / counts.total) * 100 : 0) + '%' }} />
                <span className="today" style={{ width: (counts.total ? (counts.old / counts.total) * 100 : 0) + '%' }} />
              </div>
              <div className="eq-util-key"><span><i className="ok" />Counted here {counts.new}</span><span><i className="today" />Counted before (old spreadsheet) {counts.old}</span><span><i />Never {counts.never}</span></div>
            </section>
            <CountList s={s} counts={counts} />
          </>
        )
      })()}

      {mode !== 'stocktake' && log.length > 0 && (
        <section className="card eq-scan-list" aria-label="Done this session">
          <div className="eq-actions-row"><span className="eq-strong eq-grow">{log.length} {log.length === 1 ? 'action' : 'actions'} this session</span><Button size="sm" variant="ghost" onClick={() => setLog([])}>Clear</Button></div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead><tr><th>Asset</th><th>Model</th><th>Action</th><th>On loan to</th><th>Location</th><th>Time</th></tr></thead>
              <tbody>{log.map((x, i) => (
                <tr key={i} className="data-table-row">
                  <td data-label="Asset"><span className="eq-strong">{x.no}</span></td><td data-label="Model">{x.model}</td>
                  <td data-label="Action"><Badge tone="green">{x.action}</Badge></td><td data-label="On loan to">{x.loanTo}</td>
                  <td data-label="Location">{x.location}</td><td data-label="Time" className="eq-nowrap">{x.at}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </section>
      )}

      {mode === 'stocktake' && !locked && (
        <section className="card eq-scan-list">
          <div className="eq-strong">{session.length} counted this session</div>
          {session.length ? (
            <ul className="eq-picklist">{session.map((x, i) => <li key={i} className="eq-picked"><span className="eq-picked-main"><span className="eq-strong">{x.no}</span> {x.model}{x.from && <span className="eq-small">back from {x.from}</span>}</span><Badge tone="green">Counted</Badge></li>)}</ul>
          ) : <p className="eq-note">Scan the first item to start.</p>}
        </section>
      )}
    </div>
  )
}

/** Every item by how it's been counted (old: the count overview's four cards and its table): pick one to list them. */
function CountList({ s, counts }) {
  const [show, setShow] = useState('')
  const KINDS = [['', 'Total', counts.total], ['new', 'This system', counts.new], ['old', 'Old system', counts.old], ['never', 'Never counted', counts.never]]
  const LABEL = { new: 'Counted here', old: 'Counted before', never: 'Never counted' }
  const ctx = { today: s.today, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, testMode: s.testMode }
  const [open, setOpen] = useState(false)
  const rows = useMemo(() => (open ? s.equipment.filter((e) => e && (!show || countCategory(e) === show))
    .sort((a, b) => String(a.CHSAssetNo || '').localeCompare(String(b.CHSAssetNo || ''), undefined, { numeric: true })) : []), [open, show, s.equipment])
  return (
    <section className="card eq-scan-list" aria-label="Count overview">
      <nav className="eq-filters" aria-label="Which items">
        {KINDS.map(([k, label, n]) => (
          <button key={k || 'all'} type="button" className={`tag${open && show === k ? ' tag-selected' : ''}`} aria-pressed={open && show === k}
            onClick={() => { if (open && show === k) setOpen(false); else { setShow(k); setOpen(true) } }}>{label} <span className="eq-count">{n}</span></button>
        ))}
      </nav>
      {open && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Asset</th><th>Model</th><th>Status</th><th>Count</th><th>Last counted</th></tr></thead>
            <tbody>{rows.map((e) => { const st = statusOf(e, ctx), k = countCategory(e); return (
              <tr key={e.id} className="data-table-row">
                <td data-label="Asset"><a className="eq-strong" href={'#/equipment?item=' + encodeURIComponent(e.id)}>{e.CHSAssetNo}</a></td>
                <td data-label="Model">{e.Model}</td>
                <td data-label="Status"><Status st={st} /></td>
                <td data-label="Count"><Badge tone={k === 'new' ? 'green' : k === 'old' ? 'orange' : 'neutral'}>{LABEL[k]}</Badge></td>
                <td data-label="Last counted">{k === 'never' ? '—' : e.Counted}</td>
              </tr>
            ) })}</tbody>
          </table>
          <p className="eq-note">{rows.length} {rows.length === 1 ? 'item' : 'items'}</p>
        </div>
      )}
    </section>
  )
}
