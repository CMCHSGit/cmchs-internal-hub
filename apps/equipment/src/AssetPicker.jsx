/* Choosing devices for a loan (old: the batch loan form's device rows, the
   Add items rows and the database basket): type or scan an asset number and
   press Enter, or search the equipment and pick. Each one picked says what
   it would do: free, out on another loan (dates clash or not), on a
   long-term loan, or booked next for someone. A kit's trigger (any device
   of its model) offers the kit's accessories by model: tap a model to
   choose which of its units goes. */
import { useMemo, useRef, useState } from 'react'
import { Camera, ChevronDown, X } from 'lucide-react'
import Scanner from './Scanner.jsx'
import { assetStatus, dateRange, findAsset, fmtDate, kitFor, searchEquipment } from './model.js'
import BrowseEquipment from './BrowseEquipment.jsx'

/** mode 'new' (a new loan: one still out is booked to follow) or 'add' (added to a loan: the same, except to a loan already started, where it's moved across). */
export default function AssetPicker({ s, picked, onChange, when = {}, skip = [], mode = 'new' }) {
  const [q, setQ] = useState('')
  const [miss, setMiss] = useState('')
  const [kit, setKit] = useState(null) // a kit just started: { label, accessories, tick: Set }
  const [browsing, setBrowsing] = useState(false)
  const [camera, setCamera] = useState(false)
  const box = useRef(null)
  const ctx = { ...when, testMode: s.testMode, loanMeta: s.loanMeta, loanDocs: s.loanDocs }
  const matches = useMemo(() => {
    if (q.trim().length < 2) return []
    return searchEquipment(s.equipment, q).filter((e) => !picked.includes(e.CHSAssetNo) && !skip.includes(e.CHSAssetNo)).slice(0, 8)
  }, [q, s.equipment, picked, skip])

  // A kit's trigger (or any device of its model) offers its accessories by model (old: checkKitSuggestion).
  const offerKit = (no, all) => {
    const k = kitFor(s.kits, s.equipment, no, all, { ...ctx, upcoming: s.upcoming })
    if (!k || !k.models.some((m) => m.need > 0)) return false
    setKit({ ...k, tick: new Set(k.models.flatMap((m) => m.pick)), open: '' })
    return true
  }

  const add = (no) => {
    const e = findAsset(s.equipment, no)
    if (!e) { setMiss(`${String(no).trim()} isn’t in the equipment list.`); return }
    setMiss('')
    const next = picked.includes(e.CHSAssetNo) || skip.includes(e.CHSAssetNo) ? picked : [...picked, e.CHSAssetNo]
    if (next !== picked) onChange(next)
    offerKit(e.CHSAssetNo, [...next, ...skip])
    setQ('')
    if (!camera) box.current?.focus() // scanning with the camera: the phone's keyboard stays down
  }

  // Several ticked in Browse equipment: added in one go, and the first kit
  // among them with accessories still to pick offers them, as one typed in does.
  const addMany = (nos) => {
    setBrowsing(false)
    const next = [...new Set([...picked, ...nos.filter((no) => !skip.includes(no))])]
    if (next.length !== picked.length) onChange(next)
    for (const no of nos) if (offerKit(no, [...next, ...skip])) break
  }

  return (
    <div className="eq-picker">
      {picked.length > 0 && (
        <ul className="eq-picklist">
          {picked.map((no) => {
            const st = assetStatus(s.equipment, s.upcoming, no, ctx)
            // Added to a loan already started, one out elsewhere is moved straight across (old: the basket); to one still to come it's booked to follow, as a new loan.
            const across = mode === 'add' && st.found && st.out && st.will === 'follow' && !(when.startDate && when.startDate > (when.today || s.today))
            const clashWith = st.waiting || [] // other bookings already waiting for it on these dates (clashesFor)
            const tone = !st.found || across ? 'bad' : st.will === 'follow' || clashWith.length ? 'warn' : st.out || st.next ? 'note' : 'ok'
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
                    {clashWith.length > 0
                      ? clashWith.map((c) => ` · ⚠ clashes: ${c.loanTo} is waiting for it ${dateRange(c.startDate, c.endDate)}`).join('')
                      : st.next && ` · booked next for ${st.next.loanTo} from ${fmtDate(st.next.startDate)}`}
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
        {!camera && <button type="button" className="btn btn-secondary btn-md" onClick={() => setCamera(true)}><Camera size={16} aria-hidden="true" /> Camera</button>}
        <button type="button" className="btn btn-secondary btn-md" onClick={() => setBrowsing(true)}>Browse equipment</button>
      </div>
      {/* Scanning devices onto a loan with the phone's camera (old: the phone's Scan, Check out, then Book). */}
      {camera && <Scanner onCode={add} onClose={() => setCamera(false)} />}
      {browsing && <BrowseEquipment s={s} taken={[...picked, ...skip]} onAdd={addMany} onClose={() => setBrowsing(false)} />}
      {miss && <p className="eq-note eq-problem">{miss}</p>}
      {kit && <KitOffer kit={kit} setKit={setKit} today={when.today || s.today}
        onAdd={() => { onChange([...new Set([...picked, ...kit.tick])]); setKit(null) }} onClose={() => setKit(null)} />}
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

/**
 * What a kit offers, model by model (kitFor): each row says how many of the model are free; tapped, it
 * opens that model's units to choose from (free first, the kit's own first among them; ones out on these
 * dates shown but not choosable). Where one of a model goes, choosing a unit swaps it for the one chosen.
 */
function KitOffer({ kit, setKit, today, onAdd, onClose }) {
  const rows = kit.models.filter((m) => m.need > 0)
  const toggle = (m, no) => setKit((x) => {
    const t = new Set(x.tick)
    if (t.has(no)) t.delete(no)
    else { if (m.need === 1) m.units.forEach((u) => t.delete(u.no)); t.add(no) }
    return { ...x, tick: t, open: m.need === 1 && t.has(no) ? '' : x.open }
  })
  const note = (u) => {
    const e = u.item
    if (u.status === 'out') return `${e.LoanStartDate && e.LoanStartDate > today ? 'Booked for' : 'On loan to'} ${e.OnLoanTo}${e.LoanStartDate && e.LoanStartDate > today ? ` from ${fmtDate(e.LoanStartDate)}` : ''}${e.LoanEndDate ? ` until ${fmtDate(e.LoanEndDate)}` : ''}${u.own ? ' · usually goes with this one' : ''}`
    if (u.status === 'clash') return u.waiting.map((c) => `⚠ Clash: ${c.loanTo} is waiting for it ${dateRange(c.startDate, c.endDate)}`).join(' · ')
    return ['Free', u.own && 'usually goes with this one',
      u.will === 'reclaim' && `booked for ${e.OnLoanTo} from ${fmtDate(e.LoanStartDate)}, after this loan`,
      u.next && `booked next for ${u.next.loanTo} from ${fmtDate(u.next.startDate)}`].filter(Boolean).join(' · ')
  }
  return (
    <div className="card eq-kit-offer">
      <span className="eq-strong">{kit.label}: it usually goes with these</span>
      <span className="eq-small eq-kit-hint">Tap a model to choose which unit goes.</span>
      <ul className="eq-kit-models">
        {rows.map((m) => {
          const chosen = m.units.filter((u) => kit.tick.has(u.no))
          const free = m.units.filter((u) => u.status !== 'out').length
          const out = m.units.length - free
          const open = kit.open === m.key
          return (
            <li key={m.key} className="eq-kit-model">
              <button type="button" className="eq-kit-head" aria-expanded={open} disabled={!m.units.length}
                onClick={() => setKit((x) => ({ ...x, open: x.open === m.key ? '' : m.key }))}>
                <span className="eq-grow">
                  <span className="eq-strong">{m.model}</span>{m.need > 1 && <span className="eq-kit-qty"> ×{m.need}</span>}
                  <span className={`eq-small ${free ? '' : 'eq-st-warn'}`}>
                    {!m.units.length ? 'None in the equipment list' : `${free ? `${free} free` : 'None free'}${out ? ` · ${out} on loan or booked` : ''}`}
                  </span>
                </span>
                {m.units.length > 0 && <span className={`eq-kit-chosen${chosen.length ? '' : ' eq-kit-choose'}`}>{chosen.length ? chosen.map((u) => u.no).join(', ') : 'Choose'}</span>}
                {m.units.length > 0 && <ChevronDown size={16} aria-hidden="true" className={`eq-kit-chev${open ? ' eq-kit-chev-open' : ''}`} />}
              </button>
              {open && (
                <ul className="eq-kit-units" aria-label={`${m.model} units`}>
                  {m.units.map((u) => (
                    <li key={u.no}><label className={`eq-pick${u.status === 'out' ? ' eq-pick-off' : ''}`}>
                      <input type="checkbox" disabled={u.status === 'out'} checked={kit.tick.has(u.no)} onChange={() => toggle(m, u.no)} />
                      <span><span className="eq-strong">{u.no}</span>{u.item.SerialNo && <span className="eq-mono text-muted"> {u.item.SerialNo}</span>}
                        <span className={`eq-small eq-st-${u.status === 'free' ? 'ok' : u.status === 'clash' ? 'warn' : 'note'}`}>{note(u)}</span></span>
                    </label></li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      <div className="eq-actions-row">
        <button type="button" className="btn btn-primary btn-sm" disabled={!kit.tick.size} onClick={onAdd}>Add {kit.tick.size || ''}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>Not these</button>
      </div>
    </div>
  )
}
