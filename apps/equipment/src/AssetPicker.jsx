/* Choosing devices for a loan (old: the batch loan form's device rows, the
   Add items rows and the database basket): type or scan an asset number and
   press Enter, or search the equipment and pick. Each one picked says what
   it would do: free, out on another loan (dates clash or not), on a
   long-term loan, or booked next for someone. */
import { useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { assetStatus, findAsset, fmtDate, searchEquipment } from './model.js'

/** mode 'new' (a new loan: one still out is booked to follow) or 'add' (added to a loan: one whose dates clash is left out). */
export default function AssetPicker({ s, picked, onChange, when = {}, skip = [], mode = 'new' }) {
  const [q, setQ] = useState('')
  const [miss, setMiss] = useState('')
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
    if (!picked.includes(e.CHSAssetNo) && !skip.includes(e.CHSAssetNo)) onChange([...picked, e.CHSAssetNo])
    setQ('')
    box.current?.focus()
  }

  return (
    <div className="eq-picker">
      {picked.length > 0 && (
        <ul className="eq-picklist">
          {picked.map((no) => {
            const st = assetStatus(s.equipment, s.upcoming, no, ctx)
            const tone = !st.found || (mode === 'add' && st.clash) ? 'bad' : st.will === 'follow' ? 'warn' : st.out || st.next ? 'note' : 'ok'
            return (
              <li key={no} className="eq-picked">
                <span className="eq-picked-main">
                  <span className="eq-strong">{no}</span> {st.item?.Model}{st.item?.Description && <span className="text-muted"> · {st.item.Description}</span>}
                  <span className={`eq-small eq-st-${tone}`}>
                    {!st.found ? 'Not found'
                      : mode === 'add' && st.out ? (st.clash ? `On loan to ${st.item.OnLoanTo}${st.item.LoanEndDate ? ` until ${fmtDate(st.item.LoanEndDate)}` : ''}: dates clash, so it can’t be added` : `On loan to ${st.item.OnLoanTo}, dates don’t clash: moves onto this loan${st.will === 'reclaim' ? ', and that booking keeps its claim' : ''}`)
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
      </div>
      {miss && <p className="eq-note eq-problem">{miss}</p>}
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
