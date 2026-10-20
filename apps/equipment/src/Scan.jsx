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
import { useMemo, useRef, useState } from 'react'
import { Camera } from 'lucide-react'
import { Alert, Badge, Button } from '../../../shared/ui/index.jsx'
import Scanner from './Scanner.jsx'
import { countCategory, findAsset, fmtDate, isLoanLongTerm, isOut } from './model.js'

const MODES = [['return', 'Return'], ['count', 'Count'], ['stocktake', 'Stocktake']]

export default function Scan({ s, params, setParams, onDone }) {
  const mode = MODES.some(([m]) => m === params.mode) ? params.mode : 'return'
  const [code, setCode] = useState('')
  const [camera, setCamera] = useState(false)
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
    const no = String(raw || '').trim()
    setCode('')
    if (!no) return
    const e = findAsset(s.equipment, no)
    if (!e) { setMsg({ tone: 'critical', text: `“${no}” isn’t in the equipment list. Check the number, or add it under Equipment.` }); return }
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
    box.current?.focus()
  }

  const counts = useMemo(() => {
    const c = { never: 0, new: 0, old: 0 }
    for (const e of s.equipment) c[countCategory(e)]++
    return { ...c, total: s.equipment.length, done: c.new + c.old }
  }, [s.equipment])

  const switchMode = (m) => { setParams({ mode: m === 'return' ? undefined : m }); setQueue([]); setCurrent(null); setMsg(null); setCamera(false) }
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
            : 'Every scan is counted and returned straight away. Keep scanning; the camera stays on.'}
      </p>

      {locked ? (
        <Alert tone="info" title="Hub admins only">A stocktake counts and returns everything scanned, so it’s for admins. Ask one, or use Count.</Alert>
      ) : (
        <>
          <div className="eq-picker-add">
            <label className="field eq-grow"><span className="field-label">Asset number</span>
              <input ref={box} className="input eq-scan-input" value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); scanned(code) } }}
                placeholder="Type or scan, then Enter" autoComplete="off" autoFocus inputMode="text" />
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
              const r = await s.returnItems({ loanTo: '' }, queue)
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
                  <Button disabled={busy} onClick={() => run(async () => { const r = await s.countItem(e.id); setCurrent(null); onDone(`${e.CHSAssetNo} counted${r.was.out ? ' and marked as returned' : ''}.`) })}>{isOut(e) ? 'Count it, it’s back' : 'Count it'}</Button>
                  {isOut(e) && <Button variant="secondary" disabled={busy} onClick={() => run(async () => { await s.countItem(e.id, { keepOnLoan: true }); setCurrent(null); onDone(`${e.CHSAssetNo} counted, still on loan to ${e.OnLoanTo}.`) })}>Count it, still on loan</Button>}
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
          </>
        )
      })()}

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
