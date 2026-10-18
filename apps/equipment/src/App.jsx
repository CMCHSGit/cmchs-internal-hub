/* The demo tracker (INTEGRATION-PLAN.md step 4), rebuilt as a section of the
   one app at /equipment/. It replaced the old one on 19 Oct 2026: /demo/ and
   demo.chsnz.co.nz forward here, and the old addresses still work (linkTarget).
   It runs on the old one's Realtime Database until step 5 (STEP-5-PLAN.md).

   Views (which one, and its filters, live in the address: #/loans?am=…):
     Overview   your loans if you're an account manager, then everyone's
     Equipment  the list, search, status filters, an item's record and changes
     Loans      every loan and booking, and what can be done to each (LoanActions)
     New loan   (NewLoan), finished on its loan form (LoanForm)
     Scan       return, count, stocktake, by keyboard, scanner or camera
     Calendar   loans across the weeks
     History    devices' history and the audit log
     Manage     retired items, kits, import/export, Simpro, test mode */
import { useEffect, useMemo, useState } from 'react'
import { Boxes, CalendarDays, History as HistoryIcon, LayoutDashboard, PlusCircle, ScanLine, SlidersHorizontal, Truck } from 'lucide-react'
import { Alert, Badge, Button, Dialog, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import { StoreProvider, useStore } from './store.jsx'
import { FIELDS, STATUSES, fmtDate, historyFor, isLoanLongTerm, isOut, linkTarget, loanSections, searchEquipment, statusOf, upcomingFor } from './model.js'
import { isLocal } from './db.js'
import Loans from './Loans.jsx'
import { AdminDialog, ItemForm, RetireDialog } from './Items.jsx'
import Overview from './Overview.jsx'
import NewLoan from './NewLoan.jsx'
import { Status } from './BrowseEquipment.jsx'
import Scan from './Scan.jsx'
import Calendar from './Calendar.jsx'
import History from './History.jsx'
import Manage from './Manage.jsx'

const VIEWS = [['overview', 'Overview', LayoutDashboard], ['equipment', 'Equipment', Boxes], ['loans', 'Loans', Truck], ['new', 'New loan', PlusCircle], ['scan', 'Scan', ScanLine], ['calendar', 'Calendar', CalendarDays], ['history', 'History', HistoryIcon], ['manage', 'Manage', SlidersHorizontal]]

function routeOf() {
  const [v, q] = location.hash.replace(/^#\/?/, '').split('?')
  const view = VIEWS.some(([id]) => id === v) ? v : 'overview'
  return { view, params: Object.fromEntries(new URLSearchParams(q || '')) }
}
const hashOf = (view, params = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return '#/' + view + (q ? '?' + q : '')
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  )
}

function Shell() {
  const s = useStore()
  const [route, setRoute] = useState(routeOf)
  useEffect(() => {
    const f = () => setRoute(routeOf())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  // Filters change the address without a new history entry for every key typed.
  const setParams = (params) => { history.replaceState(null, '', hashOf(route.view, params)); setRoute({ view: route.view, params }) }
  // Another view, as a new history entry (Back returns).
  const go = (view, params = {}) => { location.hash = hashOf(view, params) }
  const [toast, showToast] = useToast()
  // An old-style link (?newLoan=, ?return=, ?extend=, ?reassign=, ?tab=), once the data is in: to its view, the query dropped.
  useEffect(() => {
    if (!s.ready || !location.search) return
    const sections = loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode })
    const t = linkTarget(location.search, sections, s.upcoming, s.equipment)
    history.replaceState(null, '', location.pathname + (t ? hashOf(t.view, t.params) : location.hash))
    if (t) { setRoute({ view: t.view, params: t.params }); if (t.note) showToast(t.note) }
  }, [s.ready]) // eslint-disable-line react-hooks/exhaustive-deps
  // Test mode is for admins and the testers an admin marks (users.trackerTester, shared/can.js); anyone else
  // signed in here has it switched off (old: updateTestModeUI, with two names written in).
  useEffect(() => { if (s.testMode && s.profile && !s.canTestMode) s.setTestMode(false) }, [s.testMode, s.profile, s.canTestMode]) // eslint-disable-line react-hooks/exhaustive-deps

  if (s.error && !s.ready) return <div className="eq-page"><Alert tone="critical" title="The demo tracker didn’t load">{s.error}</Alert></div>
  if (!s.ready) return <div className="eq-page"><Loading /></div>
  return (
    <div className="eq-page">
      <div className="eq-head">
        <div>
          <h1 className="eq-title">Demo equipment</h1>
          <p className="eq-sub">Demo equipment, loans and bookings.</p>
        </div>
      </div>
      {isLocal && <Alert tone="info" title="Made-up equipment">This is the dev server without a .env: the equipment here is made up, and kept in this browser.</Alert>}
      {s.cutover?.readOnly && <Alert tone="warning" title="Read-only for a few minutes">The tracker’s data is moving to its new home. Everything shows as usual, but changes wait until it’s done.</Alert>}
      {s.error && <Alert tone="warning" title="Couldn’t refresh">{s.error}</Alert>}
      <nav className="eq-views" aria-label="Demo equipment">
        {VIEWS.map(([id, label, Icon]) => (
          <a key={id} href={hashOf(id)} className={`eq-view${route.view === id ? ' on' : ''}`} aria-current={route.view === id ? 'page' : undefined}>
            <Icon size={18} aria-hidden="true" />{label}
          </a>
        ))}
      </nav>
      {route.view === 'manage' ? <Manage s={s} params={route.params} setParams={setParams} onDone={showToast} />
        : route.view === 'calendar' ? <Calendar s={s} params={route.params} setParams={setParams} go={go} />
        : route.view === 'history' ? <History s={s} params={route.params} setParams={setParams} />
        : route.view === 'scan' ? <Scan s={s} params={route.params} setParams={setParams} onDone={showToast} />
        : route.view === 'new' ? <NewLoan key={JSON.stringify(route.params)} s={s} params={route.params} go={go} onDone={showToast} />
        : route.view === 'loans' ? <Loans s={s} params={route.params} setParams={setParams} go={go} />
        : route.view === 'equipment' ? <Equipment s={s} params={route.params} setParams={setParams} go={go} onDone={showToast} />
          : <Overview s={s} />}
      <Toast message={toast} />
    </div>
  )
}

function Equipment({ s, params, setParams, go, onDone }) {
  const [q, setQ] = useState('')
  // Ticked rows (old: the Database tab's tick boxes and selection bar): kept
  // across filters and searches, as the old basket was.
  const [sel, setSel] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [confirmDialog, confirm] = useConfirm()
  const filter = STATUSES.some((x) => x.key === params.show) ? params.show : 'all'
  const [sort, setSort] = useState({ key: 'CHSAssetNo', dir: 1 })
  const [open, setOpen] = useState(null) // an item's id
  const [mode, setMode] = useState('view') // what's open for it: view | edit | retire | delete; or 'add' with no item
  const show = (id, m = 'view') => { setOpen(id); setMode(m) }
  const done = (msg) => { setOpen(null); setMode('view'); onDone?.(msg) }

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

  const pick = (k) => setParams({ ...params, show: k === 'all' ? '' : k })
  const item = open && (s.equipment || []).find((e) => e.id === open)

  const ticked = (s.equipment || []).filter((e) => e && sel.has(e.id))
  // A device on a loan that hasn't started is still on the shelf: it isn't
  // returned, and counting it keeps it on that loan (the old count cleared it).
  const notLeft = (e) => isOut(e) && !!e.LoanStartDate && e.LoanStartDate > s.today
  const tickedOut = ticked.filter((e) => isOut(e) && !notLeft(e))
  const toggle = (id) => setSel((t) => { const n = new Set(t); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const allShown = rows.length > 0 && rows.every((x) => sel.has(x.e.id))
  const toggleShown = () => setSel((t) => { const n = new Set(t); rows.forEach((x) => (allShown ? n.delete(x.e.id) : n.add(x.e.id))); return n })
  const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
  async function act(fn) {
    setBusy(true)
    try { await fn() } catch (err) { onDone?.(err.message || String(err)) } finally { setBusy(false) }
  }
  // Return (old: returnFromSelection): the ticked ones that are out, from
  // whichever loans, as Scan's return list does; bookings waiting on them start.
  const returnTicked = () => act(async () => {
    const longTerm = tickedOut.some((e) => isLoanLongTerm(e.BatchID, ctx))
    const rest = ticked.length - tickedOut.length
    if (!(await confirm({ title: `Return ${plural(tickedOut.length, 'device')}?`, confirmLabel: 'Return',
      message: `${tickedOut.length === 1 ? 'It’s' : 'They’re'} marked as back in the office.`
        + (rest ? ` The other ${plural(rest, 'ticked device')} ${rest === 1 ? 'isn’t' : 'aren’t'} out, so ${rest === 1 ? 'it’s' : 'they’re'} left as ${rest === 1 ? 'it is' : 'they are'}.` : '')
        + (longTerm ? ' Some are on long-term loans: only return them if they’ve really come back.' : '') }))) return
    const r = await s.returnItems({ loanTo: '' }, tickedOut.map((e) => e.id))
    setSel(new Set())
    onDone?.(`${plural(r.returned, 'device')} returned${r.started ? `; ${plural(r.started, 'booking')} waiting on them started` : ''}.`)
  })
  // Count (old: countFromSelection): counted today, and any out marked back, as Scan's "Count it, it's back".
  const countTicked = () => act(async () => {
    if (!(await confirm({ title: `Count ${plural(ticked.length, 'device')}?`, confirmLabel: 'Count',
      message: `Each is marked as counted today${tickedOut.length ? `, and ${tickedOut.length === 1 ? 'the one on loan is' : `the ${tickedOut.length} on loan are`} marked as returned` : ''}.`
        + (ticked.some(notLeft) ? ' Any booked for a loan that hasn’t started stay on it.' : '') }))) return
    let back = 0
    for (const e of ticked) { const r = await s.countItem(e.id, { keepOnLoan: notLeft(e) }); if (r?.was?.out && !notLeft(e)) back++ }
    setSel(new Set())
    onDone?.(`${plural(ticked.length, 'device')} counted${back ? `, ${back} marked as returned` : ''}.`)
  })
  const COLUMNS = [['CHSAssetNo', 'Asset no.'], ['Model', 'Model'], ['SerialNo', 'Serial no.'], ['status', 'Status'], ['ShelfLocation', 'Shelf']]

  return (
    <>
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
      <div className="eq-actions-row eq-shown">
        <p className="text-sm text-muted eq-grow">{rows.length} of {withStatus.length} {withStatus.length === 1 ? 'item' : 'items'}</p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => show(null, 'add')}>Add equipment</button>
      </div>
      {sel.size > 0 && (
        <div className="eq-selbar" role="region" aria-label="Ticked equipment">
          <span className="eq-strong eq-grow">{sel.size} ticked</span>
          <Button size="sm" disabled={busy} onClick={() => go('new', { add: ticked.map((e) => e.CHSAssetNo).join(',') })}>New loan with these</Button>
          <Button size="sm" variant="secondary" disabled={busy || !tickedOut.length} title={tickedOut.length ? '' : 'None of the ticked ones are out'} onClick={returnTicked}>Return{tickedOut.length ? ` ${tickedOut.length}` : ''}</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={countTicked}>Count</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setSel(new Set())}>Clear</Button>
        </div>
      )}

      <div className="data-table-wrap">
        <table className="data-table eq-table">
          <thead><tr>
            <th className="eq-browse-tick"><input type="checkbox" checked={allShown} disabled={!rows.length} onChange={toggleShown} aria-label="Tick all shown" title="Tick all shown" /></th>
            {COLUMNS.map(([k, label]) => (
            <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
              <button type="button" className="data-table-sort" onClick={() => setSort((x) => ({ key: k, dir: x.key === k ? -x.dir : 1 }))}>
                {label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}
              </button>
            </th>
          ))}</tr></thead>
          <tbody>
            {rows.map(({ e, st }) => (
              <tr key={e.id} className={`data-table-row${sel.has(e.id) ? ' eq-browse-on' : ''}`} tabIndex={0} onClick={() => show(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter') show(e.id) }}>
                <td className="eq-browse-tick" data-label="Tick" onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" checked={sel.has(e.id)} onChange={() => toggle(e.id)} onKeyDown={(ev) => ev.stopPropagation()} aria-label={`Tick ${e.CHSAssetNo}`} />
                </td>
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

      {confirmDialog}
      {item && mode === 'view' && <ItemDialog e={item} ctx={ctx} history={s.history} onClose={() => setOpen(null)} onAction={(m) => setMode(m)} />}
      {mode === 'add' && <ItemForm s={s} onClose={() => setMode('view')} onDone={done} />}
      {item && mode === 'edit' && <ItemForm s={s} item={item} onClose={() => setMode('view')} onDone={done} />}
      {item && mode === 'retire' && <RetireDialog s={s} item={item} onClose={() => setMode('view')} onDone={done} />}
      {item && mode === 'delete' && (
        <AdminDialog s={s} title={`Delete ${item.CHSAssetNo} for good?`} message="It’s removed from the equipment list and can’t be brought back. To keep a record of it, retire it instead." confirmLabel="Delete it" danger
          onClose={() => setMode('view')} onConfirm={async () => { await s.deleteItem(item.id); done(`${item.CHSAssetNo} deleted.`) }} />
      )}
    </>
  )
}

function ItemDialog({ e, ctx, history, onClose, onAction }) {
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
      <div className="dialog-actions">
        <button type="button" className="btn btn-ghost btn-md eq-danger" onClick={() => onAction('delete')}>Delete</button>
        <button type="button" className="btn btn-secondary btn-md" onClick={() => onAction('retire')}>Retire</button>
        <button type="button" className="btn btn-primary btn-md" onClick={() => onAction('edit')}>Edit</button>
      </div>
    </Dialog>
  )
}
