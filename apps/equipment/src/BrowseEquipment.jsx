/* Browsing the whole equipment list for a loan's devices (old: the loan
   form's "Browse Database" button, which went to the Database tab to tick
   devices into the basket, then back to the form with them). Here it opens
   over the form instead, so nothing typed into it is lost: the same status
   filters, search and columns as the Equipment tab, a tick box on each row,
   then "Add". What each one will do on the loan (free, booked to follow,
   dates clash) is said on the form's list once added, as for one typed in. */
import { useMemo, useState } from 'react'
import { Badge, Button, Dialog } from '../../../shared/ui/index.jsx'
import { STATUSES, fmtDate, searchEquipment, statusOf } from './model.js'

const TONE = Object.fromEntries(STATUSES.map((s) => [s.key, s.tone]))
const LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]))

/** The status badge, and the who / when line under it (also the Equipment tab's). */
export function Status({ st }) {
  const when = st.key === 'booked' ? (st.startDate && `from ${fmtDate(st.startDate)}`)
    : st.key === 'longterm' ? 'no end date' : st.endDate ? `due back ${fmtDate(st.endDate)}` : ''
  return (
    <div>
      <Badge tone={TONE[st.key]}>{LABEL[st.key]}</Badge>
      {st.loanTo && <span className="eq-small">{[st.loanTo, when].filter(Boolean).join(' · ')}</span>}
    </div>
  )
}

const COLUMNS = [['CHSAssetNo', 'Asset no.'], ['Model', 'Model'], ['SerialNo', 'Serial no.'], ['status', 'Status'], ['ShelfLocation', 'Shelf']]

/** taken: asset numbers already on the loan (shown ticked, can't be unticked here). onAdd gets the newly ticked ones. */
export default function BrowseEquipment({ s, taken = [], onAdd, onClose }) {
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [sort, setSort] = useState({ key: 'CHSAssetNo', dir: 1, auto: true })
  const [tick, setTick] = useState(() => new Set())
  const already = useMemo(() => new Set(taken), [taken])

  const ctx = { today: s.today, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, testMode: s.testMode }
  const withStatus = useMemo(() => (s.equipment || []).filter(Boolean).map((e) => ({ e, st: statusOf(e, ctx) })),
    [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c = { all: withStatus.length }
    for (const { st } of withStatus) c[st.key] = (c[st.key] || 0) + 1
    return c
  }, [withStatus])
  const rows = useMemo(() => {
    const hits = searchEquipment(withStatus.map((x) => x.e), q), found = new Set(hits)
    const byRank = q.trim() && sort.auto // searching: best matches first, until a column heading is clicked
    const place = new Map(hits.map((e, i) => [e, i]))
    return withStatus.filter((x) => found.has(x.e) && (filter === 'all' || x.st.key === filter)).sort((a, b) => {
      if (byRank) return place.get(a.e) - place.get(b.e)
      const k = sort.key
      const av = k === 'status' ? a.st.key : String(a.e[k] ?? ''), bv = k === 'status' ? b.st.key : String(b.e[k] ?? '')
      return av.localeCompare(bv, undefined, { numeric: true }) * sort.dir
    })
  }, [withStatus, q, filter, sort])

  const toggle = (no) => {
    if (already.has(no)) return
    setTick((t) => { const n = new Set(t); if (n.has(no)) n.delete(no); else n.add(no); return n })
  }
  const shownFree = rows.map((x) => x.e.CHSAssetNo).filter((no) => !already.has(no))
  const allShown = shownFree.length > 0 && shownFree.every((no) => tick.has(no))
  const toggleShown = () => setTick((t) => { const n = new Set(t); shownFree.forEach((no) => (allShown ? n.delete(no) : n.add(no))); return n })

  return (
    <Dialog title="Browse equipment" description="Tick the devices for this loan, then add them." onClose={onClose} width={980}>
      <div className="eq-browse">
        <nav className="eq-filters" aria-label="Show">
          {[['all', 'All'], ...STATUSES.map((x) => [x.key, x.label])].map(([k, label]) => (
            <button key={k} type="button" className={`tag${filter === k ? ' tag-selected' : ''}`} aria-pressed={filter === k} onClick={() => setFilter(k)}>
              {label} <span className="eq-count">{counts[k] || 0}</span>
            </button>
          ))}
        </nav>
        <label className="field eq-search"><span className="visually-hidden">Search equipment</span>
          {/* Opens inside the loan's form: Enter here mustn't make the loan. */}
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
            placeholder="Asset no., model, serial, hospital, shelf or notes" autoComplete="off" />
        </label>
        <div className="data-table-wrap eq-browse-table">
          <table className="data-table eq-table">
            <thead><tr>
              <th className="eq-browse-tick">
                <input type="checkbox" checked={allShown} disabled={!shownFree.length} onChange={toggleShown} aria-label="Tick all shown" title="Tick all shown" />
              </th>
              {COLUMNS.map(([k, label]) => (
                <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="data-table-sort" onClick={() => setSort((x) => ({ key: k, dir: x.key === k && !x.auto ? -x.dir : 1 }))}>
                    {label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map(({ e, st }) => {
                const no = e.CHSAssetNo
                const on = already.has(no) || tick.has(no)
                return (
                  <tr key={e.id} className={`data-table-row${on ? ' eq-browse-on' : ''}`} onClick={() => toggle(no)}>
                    <td className="eq-browse-tick" data-label="Pick">
                      <input type="checkbox" checked={on} disabled={already.has(no)} onChange={() => toggle(no)} onClick={(ev) => ev.stopPropagation()}
                        aria-label={`${already.has(no) ? 'Already on this loan: ' : 'Pick '}${no}`} />
                    </td>
                    <td data-label="Asset no."><span className="eq-strong">{no}</span>{already.has(no) && <span className="eq-small">On this loan</span>}</td>
                    <td data-label="Model"><div>{e.Model}{e.Description && <span className="eq-small">{e.Description}</span>}</div></td>
                    <td data-label="Serial no." className="eq-mono">{e.SerialNo}</td>
                    <td data-label="Status"><Status st={st} /></td>
                    <td data-label="Shelf">{e.ShelfLocation}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {!rows.length && <p className="data-table-empty">Nothing matches that.</p>}
        </div>
        <div className="dialog-actions eq-browse-foot">
          <p className="text-sm text-muted eq-grow">{rows.length} of {withStatus.length} shown · {tick.size} ticked</p>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={!tick.size} onClick={() => onAdd([...tick])}>{tick.size ? `Add ${tick.size} device${tick.size === 1 ? '' : 's'}` : 'Add'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
