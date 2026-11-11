/* Add the ticked devices (Equipment list) to a loan that already exists: any active, scheduled, long-term or
   booked loan. Search for it; the signed-in person's own loans come first. What each device will do is told
   before it's added: on now, booked to follow (still out elsewhere), or taken from a later booking. */
import { useMemo, useState } from 'react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { addedText, assetStatus, loanLabel, loanSections, matchLoan, transferTargets } from './model.js'

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const keyOf = (x) => x.kind + ':' + x.key

export default function AddToLoan({ s, items, onClose, onDone }) {
  const sections = useMemo(() => loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode, team: s.managers }),
    [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode, s.managers])
  const all = [...sections.needsReassign, ...sections.upcoming, ...sections.current, ...sections.longTerm]
  const [q, setQ] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const am = s.me?.name || ''
  const shown = transferTargets(all, { am }).filter(({ x }) => keyOf(x) === to || matchLoan(x, q))
  const chosen = to || (shown.length === 1 ? keyOf(shown[0].x) : '') // one match left: that's the one
  const target = all.find((x) => keyOf(x) === chosen)
  const mineList = shown.filter((o) => o.mine), others = shown.filter((o) => !o.mine)
  const option = ({ x }) => <option key={keyOf(x)} value={keyOf(x)}>{loanLabel(x, am)}</option>

  // What adding does, per device, to the chosen loan.
  const on = new Set(target ? [...target.items, ...target.pending].map((e) => e.CHSAssetNo) : [])
  const fresh = items.filter((e) => !on.has(e.CHSAssetNo))
  const kinds = { now: [], follow: [], reclaim: [] }
  if (target) {
    for (const e of fresh) {
      const st = assetStatus(s.equipment, s.upcoming, e.CHSAssetNo, { startDate: target.startDate || s.today, endDate: target.endDate || '', loanTo: target.loanTo, testMode: s.testMode, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today })
      kinds[st.found ? st.will : 'now'].push(e.CHSAssetNo)
    }
  }

  async function submit(ev) {
    ev.preventDefault()
    if (!target || !fresh.length || busy) return
    setBusy(true); setError('')
    try {
      const r = await s.addItems(target, fresh.map((e) => e.CHSAssetNo))
      onDone?.(addedText(target, r))
    } catch (e) { setError(e.message || String(e)); setBusy(false) }
  }

  return (
    <Dialog title={`Add ${plural(items.length, 'device', 'devices')} to a loan`} description="They go on the loan you choose, and its loan form and Simpro job are updated." onClose={onClose} width={560}>
      <form className="eq-form" onSubmit={submit}>
        <ul className="eq-picklist">
          {items.map((e) => <li key={e.id}><span className="eq-strong">{e.CHSAssetNo}</span> {e.Model || e.Description}</li>)}
        </ul>
        <label className="field"><span className="field-label">Find a loan</span>
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Customer, location, account manager or job number" autoComplete="off" autoFocus />
        </label>
        <label className="field"><span className="field-label">Add them to</span>
          <select value={chosen} onChange={(e) => setTo(e.target.value)}>
            <option value="">Choose a loan…</option>
            {mineList.length > 0 && <optgroup label={`${am}’s loans`}>{mineList.map(option)}</optgroup>}
            {others.length > 0 && <optgroup label={mineList.length ? 'Everyone else’s loans' : 'Loans'}>{others.map(option)}</optgroup>}
          </select>
        </label>
        <p className="eq-note">{shown.length === all.length ? `All ${plural(all.length, 'loan', 'loans')}.` : `${shown.length} of ${plural(all.length, 'loan', 'loans')} match: clear the search to see the rest.`}</p>
        {target && (
          <div className="eq-note" aria-live="polite">
            {fresh.length < items.length && <p>{plural(items.length - fresh.length, 'ticked device is', 'ticked devices are')} already on {target.loanTo} and left as {items.length - fresh.length === 1 ? 'it is' : 'they are'}.</p>}
            {kinds.now.length > 0 && <p>{plural(kinds.now.length, 'device', 'devices')} {target.kind === 'booking' ? 'reserved for the booking now' : 'go on the loan now'}.</p>}
            {kinds.follow.length > 0 && <p>{kinds.follow.join(', ')}: still out on another loan, so booked to follow.</p>}
            {kinds.reclaim.length > 0 && <p>{kinds.reclaim.join(', ')}: booked for a later loan that hasn’t started; taken from it, so make sure {kinds.reclaim.length === 1 ? 'it’s' : 'they’re'} back in time.</p>}
          </div>
        )}
        {error && <Alert tone="critical" title="Not added">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || !target || !fresh.length}>{busy ? 'Adding…' : `Add ${plural(fresh.length, 'device', 'devices')}`}</Button>
        </div>
      </form>
    </Dialog>
  )
}
