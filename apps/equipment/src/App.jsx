/* The rebuilt demo tracker (INTEGRATION-PLAN.md step 4), at /equipment/ while
   it's built. The old one carries on at /demo/ and demo.chsnz.co.nz, on the
   same data, until this one does everything it does.

   So far: the equipment, read-only. The old Database tab and the phone's
   Equipment screen in one: search, a status filter with counts, the list
   (cards on a phone), and an item's full record with its loan, bookings and
   history. Changes are still made in the old tracker. */
import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { Alert, Badge, Dialog, Loading } from '../../../shared/ui/index.jsx'
import { StoreProvider, useStore } from './store.jsx'
import { FIELDS, STATUSES, fmtDate, historyFor, searchEquipment, statusOf, upcomingFor } from './model.js'
import { isLocal } from './db.js'

const TONE = Object.fromEntries(STATUSES.map((s) => [s.key, s.tone]))
const LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]))
const filterFromHash = () => { const k = location.hash.replace(/^#\/?/, '').split('?')[0]; return STATUSES.some((s) => s.key === k) ? k : 'all' }

export default function App() {
  return (
    <StoreProvider>
      <Equipment />
    </StoreProvider>
  )
}

function Equipment() {
  const s = useStore()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState(filterFromHash)
  const [sort, setSort] = useState({ key: 'CHSAssetNo', dir: 1 })
  const [open, setOpen] = useState(null) // an item's id

  const ctx = { today: s.today, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, testMode: s.testMode }
  const withStatus = useMemo(() => (s.equipment || []).map((e) => ({ e, st: statusOf(e, ctx) })),
    [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode]) // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c = { all: withStatus.length }
    for (const { st } of withStatus) c[st.key] = (c[st.key] || 0) + 1
    return c
  }, [withStatus])

  const rows = useMemo(() => {
    const found = new Set(searchEquipment(withStatus.map((x) => x.e), q))
    return withStatus.filter((x) => found.has(x.e) && (filter === 'all' || x.st.key === filter)).sort((a, b) => {
      const k = sort.key
      const av = k === 'status' ? a.st.key : String(a.e[k] ?? ''), bv = k === 'status' ? b.st.key : String(b.e[k] ?? '')
      return av.localeCompare(bv, undefined, { numeric: true }) * sort.dir
    })
  }, [withStatus, q, filter, sort])

  const pick = (k) => { setFilter(k); history.replaceState(null, '', k === 'all' ? location.pathname : '#/' + k) }
  const item = open && (s.equipment || []).find((e) => e.id === open)

  if (s.error && !s.ready) return <div className="eq-page"><Alert tone="critical" title="The demo tracker didn’t load">{s.error}</Alert></div>
  if (!s.ready) return <div className="eq-page"><Loading /></div>

  const COLUMNS = [['CHSAssetNo', 'Asset no.'], ['Model', 'Model'], ['SerialNo', 'Serial no.'], ['status', 'Status'], ['ShelfLocation', 'Shelf']]
  return (
    <div className="eq-page">
      <div className="eq-head">
        <div>
          <h1 className="eq-title">Demo equipment</h1>
          <p className="eq-sub">The new demo tracker, being built. It shows the same equipment as the current one, read-only for now.</p>
        </div>
        <a className="eq-old" href="/demo/">Make changes in the current tracker <ExternalLink size={14} aria-hidden="true" /></a>
      </div>
      {isLocal && <Alert tone="info" title="Made-up equipment">This is the dev server without a .env: the equipment here is made up, and kept in this browser.</Alert>}
      {s.error && <Alert tone="warning" title="Couldn’t refresh">{s.error}</Alert>}

      <nav className="eq-filters" aria-label="Show">
        {[['all', 'All'], ...STATUSES.map((x) => [x.key, x.label])].map(([k, label]) => (
          <button key={k} type="button" className={`tag${filter === k ? ' tag-selected' : ''}`} aria-pressed={filter === k} onClick={() => pick(k)}>
            {label} <span className="eq-count">{counts[k] || 0}</span>
          </button>
        ))}
      </nav>
      <label className="field eq-search"><span className="visually-hidden">Search equipment</span>
        <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Asset no., model, serial, hospital, shelf or notes" autoComplete="off" />
      </label>
      <p className="text-sm text-muted eq-shown">{rows.length} of {withStatus.length} {withStatus.length === 1 ? 'item' : 'items'}</p>

      <div className="data-table-wrap">
        <table className="data-table eq-table">
          <thead><tr>{COLUMNS.map(([k, label]) => (
            <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
              <button type="button" className="data-table-sort" onClick={() => setSort((x) => ({ key: k, dir: x.key === k ? -x.dir : 1 }))}>
                {label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}
              </button>
            </th>
          ))}</tr></thead>
          <tbody>
            {rows.map(({ e, st }) => (
              <tr key={e.id} className="data-table-row" tabIndex={0} onClick={() => setOpen(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') setOpen(e.id) }}>
                <td data-label="Asset no."><span className="eq-strong">{e.CHSAssetNo}</span></td>
                <td data-label="Model"><div>{e.Model}{e.Description && <span className="eq-small">{e.Description}</span>}</div></td>
                <td data-label="Serial no." className="eq-mono">{e.SerialNo}</td>
                <td data-label="Status"><Status st={st} /></td>
                <td data-label="Shelf">{e.ShelfLocation}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="data-table-empty">Nothing matches that.</p>}
      </div>

      {item && <ItemDialog e={item} ctx={ctx} history={s.history} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** The status badge, and the who / when line under it. */
function Status({ st }) {
  const when = st.key === 'booked' ? (st.startDate && `from ${fmtDate(st.startDate)}`)
    : st.key === 'longterm' ? 'no end date' : st.endDate ? `due back ${fmtDate(st.endDate)}` : ''
  return (
    <div>
      <Badge tone={TONE[st.key]}>{LABEL[st.key]}</Badge>
      {st.loanTo && <span className="eq-small">{[st.loanTo, when].filter(Boolean).join(' · ')}</span>}
    </div>
  )
}

function ItemDialog({ e, ctx, history, onClose }) {
  const st = statusOf(e, ctx)
  const booking = upcomingFor(e, ctx.upcoming, ctx.testMode)
  const past = historyFor(e, history).slice(0, 20)
  const shown = FIELDS.filter(([k]) => e[k])
  return (
    <Dialog title={`${e.CHSAssetNo} · ${e.Model || 'Item'}`} description={e.Description} onClose={onClose} width={720}>
      <Status st={st} />
      {booking && st.key !== 'booked' && (
        <p className="eq-note">Booked next for {booking.loanTo}, {fmtDate(booking.startDate)} to {fmtDate(booking.endDate)}.</p>
      )}
      <dl className="eq-fields">
        {shown.map(([k, label]) => (
          <div key={k}><dt>{label}</dt><dd className={/MAC|SerialNo|UUID|DeviceID/.test(k) ? 'eq-mono' : ''}>{/Date$/.test(k) ? fmtDate(e[k]) : e[k]}</dd></div>
        ))}
      </dl>
      <h3 className="eq-h3">History</h3>
      {past.length ? (
        <ul className="eq-history">
          {past.map((h) => (
            <li key={h.id}>
              <span className="eq-strong">{h.action}</span> {h.loanTo && `· ${h.loanTo}`}{h.location && `, ${h.location}`}
              <span className="eq-small">{fmtDate(String(h.ts || '').slice(0, 10))}{h.operator && ` · ${h.operator}`}{h.notes && ` · ${h.notes}`}</span>
            </li>
          ))}
        </ul>
      ) : <p className="eq-note">Nothing recorded yet.</p>}
    </Dialog>
  )
}
