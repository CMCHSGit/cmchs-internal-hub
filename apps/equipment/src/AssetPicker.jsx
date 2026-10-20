/* Choosing devices for a loan (old: the batch loan form's device rows, the
   Add items rows and the database basket): type or scan an asset number and
   press Enter, or search the equipment and pick. Each one picked says what
   it would do: free, out on another loan (dates clash or not), on a
   long-term loan, or booked next for someone. */
import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { assetStatus, findAsset, fmtDate, kitFor, searchEquipment } from './model.js'
import BrowseEquipment from './BrowseEquipment.jsx'

/** mode 'new' (a new loan: one still out is booked to follow) or 'add' (added to a loan: the same, except to a loan already started, where it's moved across). */
export default function AssetPicker({ s, picked, onChange, when = {}, skip = [], mode = 'new' }) {
  const [q, setQ] = useState('')
  const [miss, setMiss] = useState('')
  const [kit, setKit] = useState(null) // a kit just started: { label, accessories, tick: Set }
  const [browsing, setBrowsing] = useState(false)
  const box = useRef(null)
  const ctx = { ...when, testMode: s.testMode, loanMeta: s.loanMeta, loanDocs: s.loanDocs }
  const matches = useMemo(() => {
    if (q.trim().length < 2) return []
    return searchEquipment(s.equipment, q).filter((e) => !picked.includes(e.CHSAssetNo) && !skip.includes(e.CHSAssetNo)).slice(0, 8)
  }, [q, s.equipment, picked, skip])

  const add = (no) => {
    const e = findAsset(s.equipment, no)
    if (!e) { setMiss(`${String(no).trim()} isn’t in the equipment list.`); return }
    setMiss('')
    const next = picked.includes(e.CHSAssetNo) || skip.includes(e.CHSAssetNo) ? picked : [...picked, e.CHSAssetNo]
    if (next !== picked) onChange(next)
    // A kit's trigger device offers its accessories (old: checkKitSuggestion).
    const k = kitFor(s.kits, s.equipment, e.CHSAssetNo, [...next, ...skip])
    if (k && k.accessories.some((a) => !a.picked)) setKit({ ...k, tick: new Set(k.accessories.filter((a) => a.free).map((a) => a.item.CHSAssetNo)) })
    setQ('')
    box.current?.focus()
  }

  // Several ticked in Browse equipment: added in one go, and the first kit
  // among them with accessories still to pick offers them, as one typed in does.
  const addMany = (nos) => {
    setBrowsing(false)
    const next = [...new Set([...picked, ...nos.filter((no) => !skip.includes(no))])]
    if (next.length !== picked.length) onChange(next)
    for (const no of nos) {
      const k = kitFor(s.kits, s.equipment, no, [...next, ...skip])
      if (k && k.accessories.some((a) => !a.picked)) { setKit({ ...k, tick: new Set(k.accessories.filter((a) => a.free).map((a) => a.item.CHSAssetNo)) }); break }
    }
  }

  return (
    <div className="eq-picker">
      {picked.length > 0 && (
        <ul className="eq-picklist">
          {picked.map((no) => {
            const st = assetStatus(s.equipment, s.upcoming, no, ctx)
            // Added to a loan already started, one out elsewhere is moved straight across (old: the basket); to one still to come it's booked to follow, as a new loan.
            const across = mode === 'add' && st.found && st.out && st.will === 'follow' && !(when.startDate && when.startDate > (when.today || s.today))
            const tone = !st.found || across ? 'bad' : st.will === 'follow' ? 'warn' : st.out || st.next ? 'note' : 'ok'
            return (
              <li key={no} className="eq-picked">
                <span className="eq-picked-main">
                  <span className="eq-strong">{no}</span> {st.item?.Model}{st.item?.Description && <span className="text-muted"> · {st.item.Description}</span>}
                  <span className={`eq-small eq-st-${tone}`}>
                    {!st.found ? 'Not found'
                      : across ? `${st.longTerm ? 'On a long-term loan' : 'On loan'} to ${st.item.OnLoanTo}${st.item.LoanEndDate ? ` until ${fmtDate(st.item.LoanEndDate)}` : ''}: it’s taken off that loan and moved onto this one`
                      : st.will === 'follow' ? `${st.longTerm ? 'On a long-term loan (no return date)' : 'On loan'} to ${st.item.OnLoanTo}${st.item.LoanEndDate ? ` until ${fmtDate(st.item.LoanEndDate)}` : ''}: booked on this loan to follow when it’s back`
                        : st.will === 'reclaim' ? `Booked for ${st.item.OnLoanTo} from ${fmtDate(st.item.LoanStartDate)}, no clash: goes on this loan, and that booking keeps its claim`
                          : 'Free'}
                    {st.next && ` · booked next for ${st.next.loanTo} from ${fmtDate(st.next.startDate)}`}
                  </span>
                </span>
                <button type="button" className="icon-btn icon-btn-sm" aria-label={`Take ${no} off`} onClick={() => onChange(picked.filter((x) => x !== no))}><X size={14} /></button>
              </li>
            )
          })}
        </ul>
      )}
      <div className="eq-picker-add">
        <label className="field eq-grow"><span className="field-label">Add a device</span>
          <input ref={box} className="input" value={q} onChange={(e) => { setQ(e.target.value); setMiss('') }} placeholder="Asset number (type or scan, then Enter), or search model or serial"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (matches.length === 1 && !findAsset(s.equipment, q)) add(matches[0].CHSAssetNo); else if (q.trim()) add(q) } }} autoComplete="off" />
        </label>
        <button type="button" className="btn btn-secondary" onClick={() => setBrowsing(true)}>Browse equipment</button>
      </div>
      {browsing && <BrowseEquipment s={s} taken={[...picked, ...skip]} onAdd={addMany} onClose={() => setBrowsing(false)} />}
      {miss && <p className="eq-note eq-problem">{miss}</p>}
      {kit && (
        <div className="card eq-kit-offer">
          <span className="eq-strong">{kit.label}: it usually goes with these</span>
          <ul className="eq-picklist">
            {kit.accessories.filter((a) => !a.picked).map((a) => (
              <li key={a.assetNo}><label className="eq-pick">
                <input type="checkbox" disabled={!a.free} checked={kit.tick.has(a.item?.CHSAssetNo)} onChange={() => setKit((x) => { const t = new Set(x.tick); const n = a.item.CHSAssetNo; if (t.has(n)) t.delete(n); else t.add(n); return { ...x, tick: t } })} />
                <span><span className="eq-strong">{a.item?.CHSAssetNo || a.assetNo}</span> {a.item?.Model || a.model}<span className="eq-small">{!a.item ? 'Not in the equipment list' : a.out ? `On loan to ${a.item.OnLoanTo}` : 'Free'}</span></span>
              </label></li>
            ))}
          </ul>
          <div className="eq-actions-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={!kit.tick.size} onClick={() => { onChange([...new Set([...picked, ...kit.tick])]); setKit(null) }}>Add {kit.tick.size || ''}</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKit(null)}>Not these</button>
          </div>
        </div>
      )}
      {matches.length > 0 && (
        <ul className="eq-matches" role="listbox" aria-label="Matching equipment">
          {matches.map((e) => (
            <li key={e.id}><button type="button" className="eq-match" onClick={() => add(e.CHSAssetNo)}>
              <span className="eq-strong">{e.CHSAssetNo}</span> {e.Model}{e.SerialNo && <span className="eq-small eq-mono">{e.SerialNo}</span>}
              <span className="eq-small">{e.OnLoanTo && e.Returned !== 'Yes' ? `On loan to ${e.OnLoanTo}` : 'Free'}</span>
            </button></li>
          ))}
        </ul>
      )}
    </div>
  )
}
