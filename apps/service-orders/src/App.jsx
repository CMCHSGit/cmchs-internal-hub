/* Service orders, as a section of the one app (INTEGRATION-PLAN.md step 3).

   Replaces the service order spreadsheet and folds in the Service Order
   Parser: paste a service order, check the fields, save, and it lands in the
   In progress tab. Everyone reads; Engineers, Management and admins edit
   (enforced in rules/firestore.rules; the buttons here only reflect it).

   The data and the parsing are the tool's own modules, unchanged (store.js,
   parse.js, import.js, simpro.js); this is the page, on the shared kit. Which
   tab is open lives in the address (#/received), so a link lands on it. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardPaste, Download, FileSpreadsheet, Plus } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Dialog, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import {
  STAGES, FIELDS, LATE_DAYS, nextStage, watchOrders, createOrder, saveOrder, removeOrder,
  createMany, formatDate, today, daysWaiting,
} from '../store.js'
import { parseServiceOrder, AUTO_FIELDS } from '../parse.js'
import { readWorkbook } from '../import.js'
import { findJobsBySerial, jobLabel } from '../simpro.js'

const EDIT_TEAMS = ['Engineers', 'Management']
const READ_ONLY = 'You have read-only access: an admin, or the Engineers or Management team, can make changes.'

// The tabs: each stage, then the late ones, then everything. Slugs for the address.
const VIEWS = [
  ['in-progress', 'In progress'], ['received', 'Received'], ['shipping', 'Ready for shipping'],
  ['completed', 'Completed or sent back'], ['spares', 'CHS spare parts order'], ['late', 'late'], ['all', 'all'],
]
const viewFromHash = () => {
  const slug = location.hash.replace(/^#\/?/, '').split('?')[0]
  return (VIEWS.find(([s]) => s === slug) || VIEWS[0])[1]
}
const hashFor = (view) => '#/' + (VIEWS.find(([, v]) => v === view) || VIEWS[0])[0]

const STAGE_TONE = {
  'In progress': 'purple', Received: 'neutral', 'Ready for shipping': 'orange',
  'Completed or sent back': 'green', 'CHS spare parts order': 'neutral',
}

// Getting the replacement parts in and sending the faulty part back are two
// separate events, so Received is a record, not just a stage: an order stays
// listed there after it moves on to Ready for shipping or Completed, with a
// badge saying where it is now. Every other tab is just the order's stage.
function inTab(o, tab) {
  if (o.stage === tab) return true
  return tab === 'Received' && !!o.receivedDate && o.stage !== 'In progress' && o.stage !== 'CHS spare parts order'
}
const isLate = (o) => (daysWaiting(o) ?? 0) >= LATE_DAYS
const inView = (o, view) => (view === 'all' ? true : view === 'late' ? isLate(o) : inTab(o, view))

/** Where this order goes next. Nothing to send back means no shipping step. */
function nextFor(o) {
  const n = nextStage(o.stage)
  return n === 'Ready for shipping' && o.needReturn === 'NO' ? 'Completed or sent back' : n
}

// Newest first. On Received that means the latest parts to arrive; everywhere
// else, the latest order raised. A column header overrides it until the tab changes.
const defaultSort = (view) => ({ key: view === 'Received' ? 'receivedDate' : 'dateRaised', dir: -1 })

const COLUMNS = [
  ['so', 'S.O'], ['sn', 'SN'], ['partName', 'Part'], ['needReturn', 'Return'], ['site', 'Site'],
  ['notes', 'Notes'], ['jobs', 'Jobs'], ['appliedBy', 'Applied by'], ['dateRaised', 'Raised'], ['receivedDate', 'Received'],
]

export default function App() {
  return (
    <AuthProvider>
      <Orders />
    </AuthProvider>
  )
}

function Orders() {
  const { user, profile, profileReady } = useAuth()
  const canEdit = profile?.role === 'admin' || EDIT_TEAMS.includes(profile?.team)
  const [orders, setOrders] = useState(null)
  const [error, setError] = useState('')
  const [view, setView] = useState(viewFromHash)
  const [sort, setSort] = useState(() => defaultSort(viewFromHash()))
  const [f, setF] = useState({ q: '', site: '', ret: '', now: '' })
  const [editing, setEditing] = useState(null) // { order, prefill, auto }
  const [pasting, setPasting] = useState(false)
  const [importing, setImporting] = useState(false)
  const [toastMsg, toast] = useToast()
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    if (!user) return
    try {
      return watchOrders(setOrders, (err) => setError(err.code === 'permission-denied'
        ? 'Firestore refused to read the service orders. Their security rule may not be published yet.'
        : 'Could not load service orders: ' + (err.message || err)))
    } catch (e) { setError('Could not load service orders: ' + (e.message || e)) }
  }, [user])

  // The tab follows the address: Back, a link, or a tab clicked here.
  useEffect(() => {
    const f = () => { const v = viewFromHash(); setView(v); setSort(defaultSort(v)) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  const pick = (v) => { location.hash = hashFor(v) }

  const list = orders || []
  const sites = useMemo(() => [...new Set(list.map((o) => o.site).filter(Boolean))].sort(), [list])
  // Where the orders in this tab are now. Only worth asking when a tab mixes
  // stages (Received, All): there, "Received" means the parts are in but the
  // faulty part isn't ready to ship back yet.
  const here = STAGES.filter((s) => list.some((o) => o.stage === s && inView(o, view)))
  const now = here.length < 2 ? '' : f.now

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return list.filter((o) => {
      if (!inView(o, view)) return false
      if (now && o.stage !== now) return false
      if (f.site && o.site !== f.site) return false
      if (f.ret && o.needReturn !== f.ret) return false
      if (q && !FIELDS.map((k) => o[k]).join(' ').toLowerCase().includes(q)) return false
      return true
    }).sort((a, b) => {
      const k = sort.key
      const av = String(a[k] ?? ''), bv = String(b[k] ?? '')
      // Blanks last whichever way the column points: no date isn't "earliest".
      if (!av || !bv) { if (av || bv) return !av ? 1 : -1 }
      else { const c = av.localeCompare(bv, undefined, { numeric: true }); if (c) return c * sort.dir }
      // Same day (or both blank): newest raised, then highest S.O, on top.
      return String(b.dateRaised ?? '').localeCompare(String(a.dateRaised ?? '')) ||
        String(b.so ?? '').localeCompare(String(a.so ?? ''), undefined, { numeric: true })
    })
  }, [list, view, now, f, sort])

  const sortBy = (k) => {
    // Dates start newest-first, like the default; text starts A–Z.
    const first = /date|raised/i.test(k) ? -1 : 1
    setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : first }))
  }

  function exportCsv() {
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const head = ['Stage', 'S.O', 'SO Title', 'SN', 'PN', 'Part Name', 'Need Return', 'Site', 'Notes', 'Jobs', 'Applied By', 'Date Raised', 'Received Date', 'Old SO', 'Additional Notes']
    const lines = [head.map(q).join(',')]
    for (const o of rows) {
      lines.push([o.stage, o.so, o.title, o.sn, o.pn, o.partName, o.needReturn, o.site, o.notes, o.jobs, o.appliedBy,
        o.dateRaised, o.receivedDate, o.oldSo, o.extraNotes].map(q).join(','))
    }
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    a.download = `Service-Orders-${today()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`${rows.length} ${rows.length === 1 ? 'order' : 'orders'} downloaded as CSV`)
  }

  // Pasting an S.O that's already here updates it rather than adding a second
  // copy. Only what the service order actually says goes over the saved
  // record: a blank parsed field never wipes a value, and the fields only we
  // keep (stage, job, received date, notes added here) are left alone.
  function pasted(order, auto) {
    setPasting(false)
    const existing = order.so && list.filter((x) => x.so === order.so)
      .sort((a, b) => (b.updatedAt?.seconds ?? 0) - (a.updatedAt?.seconds ?? 0))[0]
    if (!existing) return setEditing({ order: null, prefill: order, auto })
    const changed = Object.fromEntries(auto.filter((k) => order[k] !== (existing[k] || '')).map((k) => [k, order[k]]))
    setEditing({ order: existing, prefill: changed, auto: Object.keys(changed) })
  }

  if (user === undefined || (user && !profileReady)) return <div className="so-page"><Loading /></div>
  const scope = view === 'all' ? '' : view === 'late' ? ` waiting ${LATE_DAYS}+ days` : ` in ${view}`
  const tiles = [
    ...STAGES.map((s) => [s, s, list.filter((o) => inTab(o, s)).length, false]),
    ['late', `Waiting ${LATE_DAYS}+ days`, list.filter(isLate).length, true],
    ['all', 'All', list.length, false],
  ]

  return (
    <div className="so-page">
      <div className="so-head">
        <div>
          <h1 className="so-title">Service orders</h1>
          <p className="so-sub">Parts on order, received and shipping back. Paste a service order to add one.</p>
        </div>
        {canEdit && (
          <div className="so-head-actions">
            <Button variant="ghost" iconLeft={<FileSpreadsheet size={18} />} onClick={() => setImporting(true)}>Import spreadsheet</Button>
            <Button variant="secondary" iconLeft={<Plus size={18} />} onClick={() => setEditing({ order: null, prefill: null, auto: [] })}>Add manually</Button>
            <Button iconLeft={<ClipboardPaste size={18} />} onClick={() => setPasting(true)}>Paste service order</Button>
          </div>
        )}
      </div>
      {!canEdit && <Alert tone="info" title="View only">{READ_ONLY}</Alert>}
      {error && <Alert tone="critical" title="Not everything loaded">{error}</Alert>}

      <nav className="so-tiles" aria-label="Stages">
        {tiles.map(([key, label, n, warn]) => (
          <a key={key} href={hashFor(key)} className={`so-tile${view === key ? ' on' : ''}${warn && n ? ' warn' : ''}`} aria-current={view === key ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); pick(key) }}>
            <b>{orders ? n : '–'}</b><span>{label}</span>
          </a>
        ))}
      </nav>

      <div className="card so-filters">
        <label className="field so-grow"><span className="field-label">Search</span>
          <input className="input" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="S.O, serial, part, site, job or notes" autoComplete="off" />
        </label>
        <label className="field"><span className="field-label">Site</span>
          <select value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })}><option value="">All sites</option>{sites.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        {here.length >= 2 && (
          <label className="field"><span className="field-label">Now at</span>
            <select value={now} onChange={(e) => setF({ ...f, now: e.target.value })}><option value="">Any</option>{here.map((s) => <option key={s}>{s}</option>)}</select>
          </label>
        )}
        <label className="field"><span className="field-label">Need return</span>
          <select value={f.ret} onChange={(e) => setF({ ...f, ret: e.target.value })}><option value="">Either</option><option>YES</option><option>NO</option></select>
        </label>
      </div>

      <div className="so-bar">
        <span className="text-sm text-muted">{orders ? `${rows.length} ${rows.length === 1 ? 'order' : 'orders'}${scope}` : 'Loading…'}</span>
        <span className="so-spacer" />
        <Button variant="ghost" size="sm" iconLeft={<Download size={16} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
      </div>

      {orders === null && !error ? <Loading /> : (
        <div className="data-table-wrap">
          <table className="data-table so-table">
            <thead>
              <tr>{COLUMNS.map(([k, label]) => (
                <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="data-table-sort" onClick={() => sortBy(k)}>{label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}</button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((o) => <Row key={o.id} o={o} view={view} onOpen={() => setEditing({ order: o, prefill: null, auto: [] })} />)}
            </tbody>
          </table>
          {!rows.length && <p className="data-table-empty">Nothing here.</p>}
        </div>
      )}

      {pasting && <PasteDialog onClose={() => setPasting(false)} onParsed={pasted} />}
      {editing && (
        <EditDialog {...editing} canEdit={canEdit} who={user.email || user.uid} orders={list} sites={sites}
          confirm={confirm} toast={toast} onClose={() => setEditing(null)} />
      )}
      {importing && <ImportDialog orders={list} who={user.email || user.uid} confirm={confirm} toast={toast} onClose={() => setImporting(false)} />}
      {confirmDialog}
      <Toast message={toastMsg} />
    </div>
  )
}

function Row({ o, view, onOpen }) {
  const wait = daysWaiting(o)
  const more = [o.oldSo && `Old SO ${o.oldSo}`, o.extraNotes].filter(Boolean).join('\n')
  return (
    <tr className="data-table-row" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter') onOpen() }}>
      <td data-label="S.O"><div>
        <span className="so-strong">{o.so || '–'}</span>
        {o.title && <span className="so-small">{o.title}</span>}
        {o.stage !== view && <span className="so-small"><Badge tone={STAGE_TONE[o.stage] || 'neutral'}>{o.stage}</Badge></span>}
      </div></td>
      <td data-label="SN" className="so-mono">{o.sn}</td>
      <td data-label="Part"><div><span className="so-mono">{o.pn}</span>{o.partName && <span className="so-small">{o.partName}</span>}</div></td>
      <td data-label="Return">{o.needReturn && <Badge tone={o.needReturn === 'YES' ? 'orange' : 'neutral'}>{o.needReturn}</Badge>}</td>
      <td data-label="Site">{o.site}</td>
      <td data-label="Notes"><div className="so-ml">{o.notes}{more && <span className="so-small so-ml">{more}</span>}</div></td>
      <td data-label="Jobs">{o.jobs}</td>
      <td data-label="Applied by">{o.appliedBy}</td>
      <td data-label="Raised"><div>{formatDate(o.dateRaised)}{wait != null && wait >= LATE_DAYS && <span className="so-small"><Badge tone="critical">{wait} days</Badge></span>}</div></td>
      <td data-label="Received">{formatDate(o.receivedDate)}</td>
    </tr>
  )
}

/* ── Paste a service order ── */
function PasteDialog({ onClose, onParsed }) {
  const [text, setText] = useState('')
  const [err, setErr] = useState('')
  const area = useRef(null)
  function go() {
    if (!text.trim()) return setErr('Paste a service order first.')
    const { order, auto } = parseServiceOrder(text)
    if (!auto.length) return setErr('Nothing recognisable in that. Is it the full service order text?')
    onParsed(order, auto)
  }
  return (
    <Dialog title="Paste a service order" description="Copy the whole service order and paste it below. The fields it can find are filled in for you to check before saving." onClose={onClose} width={720} initialFocus={area}>
      <textarea ref={area} className="input so-paste" value={text} onChange={(e) => { setText(e.target.value); setErr('') }} placeholder="Paste the full service order text here…" />
      {err && <Alert tone="warning" title={err} />}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={go}>Extract fields</Button>
      </div>
    </Dialog>
  )
}

/* ── Edit ── */
const LABELS = {
  so: 'S.O', stage: 'Stage', needReturn: 'Need return', title: 'SO title', sn: 'SN', pn: 'PN', partName: 'Part name',
  site: 'Site', jobs: 'Jobs', appliedBy: 'Applied by', notes: 'Notes', dateRaised: 'Date raised', receivedDate: 'Received date',
  oldSo: 'Old SO', extraNotes: 'Additional notes',
}

/** With both `order` and `prefill`, it's a re-pasted service order: the pasted fields go over the saved ones; `auto` are marked to check. */
function EditDialog({ order, prefill, auto, canEdit, who, orders, sites, confirm, toast, onClose }) {
  const start = order ? { ...order, ...prefill } : { stage: STAGES[0], ...prefill }
  const [v, setV] = useState(() => Object.fromEntries(FIELDS.map((k) => [k, start[k] || ''])))
  const [marked, setMarked] = useState(() => new Set(auto))
  const [note, setNote] = useState(() => {
    if (!canEdit) return { text: READ_ONLY }
    if (prefill && order) return { text: auto.length
      ? `S.O ${order.so} is already on the list (${order.stage}): saving updates it. ${auto.length} ${auto.length === 1 ? 'field' : 'fields'} changed by the service order, marked in green.`
      : `S.O ${order.so} is already on the list (${order.stage}) and the service order matches it: nothing new.` }
    if (prefill) return { text: `${auto.length} of ${AUTO_FIELDS.length} fields found. The green ones came from the service order.` }
    return null
  })
  const [busy, setBusy] = useState(false)
  const [jobHint, setJobHint] = useState('Simpro job number')
  const open = useRef(true)
  useEffect(() => () => { open.current = false }, [])
  const current = useRef(v)
  current.current = v

  const set = (k) => (e) => { const val = e.target.value; setV((x) => ({ ...x, [k]: val })); setMarked((m) => { const n = new Set(m); n.delete(k); return n }) }

  /*
   * Fills the Simpro job from the serial, if exactly one job matches.
   * Deliberately quiet about failures. Editing service orders is open to
   * Engineers and Management; querying Simpro needs an admin or someone given
   * Simpro access. Someone without it should see a job field they can type
   * into, not an error about a lookup they didn't ask for.
   */
  useEffect(() => {
    if (!prefill || !canEdit || !start.sn || start.jobs) return
    const dup = !!order
    const tell = (text, tone) => { if (!dup) setNote({ text, tone }) }
    setJobHint('Looking for a matching job…')
    findJobsBySerial(start.sn).then(({ jobs, error }) => {
      if (!open.current) return
      setJobHint('Simpro job number')
      if (current.current.jobs.trim()) return // they typed one while we were asking
      if (error) return tell(`Add the Simpro job if there is one (${error}).`)
      if (!jobs.length) return tell(`No Simpro job mentions ${start.sn}. Add the job number if there is one.`)
      // More than one: filling in the wrong job is worse than filling in none.
      if (jobs.length > 1) return tell(`${jobs.length} Simpro jobs mention ${start.sn}: ${jobs.map((j) => j.ID).join(', ')}. Pick the right one.`)
      setV((x) => ({ ...x, jobs: String(jobs[0].ID) }))
      setMarked((m) => new Set([...m, 'jobs']))
      tell(`Simpro job ${jobLabel(jobs[0])} matched on serial ${start.sn}.`, 'success')
    }).catch(() => { if (open.current) setJobHint('Simpro job number') })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const next = canEdit && order ? nextFor({ stage: v.stage, needReturn: v.needReturn }) : null
  const title = order && prefill ? `Update S.O ${order.so} from service order`
    : order ? `S.O ${order.so || '(no number)'}` : prefill ? 'New from service order' : 'New service order'

  async function save(advance) {
    const data = Object.fromEntries(FIELDS.map((k) => [k, String(v[k] ?? '').trim()]))
    if (!data.so && !data.partName && !data.pn) return setNote({ text: 'Give it at least an S.O or a part.', tone: 'warning' })
    if (advance) data.stage = nextFor(data)
    // Received is the day it moved to Received, unless someone said otherwise.
    if (data.stage === 'Received' && !data.receivedDate && (!order || order.stage !== 'Received')) data.receivedDate = today()
    if (!order && data.so && orders.some((x) => x.so === data.so) &&
      !(await confirm({ title: `S.O ${data.so} is already on the list`, message: 'Add it again anyway?', confirmLabel: 'Add it again' }))) return
    setBusy(true)
    try {
      if (order) await saveOrder(order.id, data, who, data.stage !== order.stage)
      else await createOrder(data, who)
      toast(advance ? `S.O ${data.so} moved to ${data.stage}` : order ? 'Saved' : `S.O ${data.so} added to ${data.stage}`)
      onClose()
    } catch (err) {
      setNote({ text: 'Could not save: ' + (err.message || err), tone: 'critical' })
      setBusy(false)
    }
  }

  async function del() {
    if (!(await confirm({ title: `Delete S.O ${order.so || '(no number)'}?`, message: 'This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return
    try { await removeOrder(order.id); toast('Deleted'); onClose() }
    catch (err) { setNote({ text: 'Could not delete: ' + (err.message || err), tone: 'critical' }) }
  }

  const input = (k, extra = {}) => (
    <label className="field" key={k}><span className="field-label">{LABELS[k]}</span>
      <input className={`input${marked.has(k) ? ' so-auto' : ''}${k === 'pn' ? ' so-mono' : ''}`} value={v[k]} onChange={set(k)} disabled={!canEdit} {...extra} />
    </label>
  )
  const area = (k) => (
    <label className="field" key={k}><span className="field-label">{LABELS[k]}</span>
      <textarea className={`input${marked.has(k) ? ' so-auto' : ''}`} rows={2} value={v[k]} onChange={set(k)} disabled={!canEdit} />
    </label>
  )

  return (
    <Dialog title={title} onClose={onClose} width={760} className="so-edit">
      <div className="so-grid3">
        {input('so')}
        <label className="field"><span className="field-label">Stage</span>
          <select value={v.stage} onChange={set('stage')} disabled={!canEdit}>{STAGES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">Need return</span>
          <select className={marked.has('needReturn') ? 'so-auto' : ''} value={v.needReturn} onChange={set('needReturn')} disabled={!canEdit}><option value=""></option><option>YES</option><option>NO</option></select>
        </label>
      </div>
      {input('title')}
      <div className="so-grid2">{input('sn')}{input('pn')}</div>
      {input('partName')}
      <div className="so-grid3">
        {input('site', { list: 'so-sites' })}
        {input('jobs', { placeholder: jobHint })}
        {input('appliedBy', { placeholder: 'Who applied for the RMA' })}
      </div>
      <datalist id="so-sites">{sites.map((s) => <option key={s} value={s} />)}</datalist>
      {area('notes')}
      <div className="so-grid3">{input('dateRaised', { type: 'date' })}{input('receivedDate', { type: 'date' })}{input('oldSo')}</div>
      {area('extraNotes')}
      {note && <Alert tone={note.tone || 'info'} title={note.text} />}
      <div className="dialog-actions">
        {order && canEdit && <Button variant="ghost" className="so-del" onClick={del}>Delete</Button>}
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
        {next && <Button variant="secondary" onClick={() => save(true)} disabled={busy}>Save and move to {next} →</Button>}
        {canEdit && <Button onClick={() => save(false)} disabled={busy}>Save</Button>}
      </div>
    </Dialog>
  )
}

/* ── Import the spreadsheet ── */
// The same part on the same S.O is the same row, whichever tab it came from.
const keyOf = (o) => `${o.so}|${o.pn || o.partName}`.toLowerCase()

function ImportDialog({ orders, who, confirm, toast, onClose }) {
  const [sheets, setSheets] = useState([])
  const [picked, setPicked] = useState(new Set())
  const [status, setStatus] = useState(null) // { text, tone }
  const [busy, setBusy] = useState(false)
  const file = useRef(null)

  const read = useCallback(async (e) => {
    const f = e.target.files[0]
    e.target.value = '' // so picking the same file again still reads it
    if (!f) return
    setStatus({ text: 'Reading…' })
    try {
      const parsed = await readWorkbook(f)
      setSheets(parsed)
      setPicked(new Set(parsed.map((s, i) => (s.orders.length ? i : -1)).filter((i) => i >= 0)))
      const total = parsed.reduce((n, s) => n + s.orders.length, 0)
      setStatus(total ? { text: `${total} orders found.` } : { text: 'No orders found. Is this the right workbook?', tone: 'warning' })
    } catch (err) {
      setStatus({ text: 'Could not read the file: ' + (err.message || err), tone: 'critical' })
    }
  }, [])

  async function go() {
    const have = new Set(orders.filter((o) => o.so).map(keyOf))
    const all = [...picked].flatMap((i) => sheets[i].orders)
    // Importing the workbook again should top up, not double everything.
    const fresh = all.filter((o) => !o.so || !have.has(keyOf(o)))
    const dupes = all.length - fresh.length
    if (!fresh.length) return setStatus({ text: `All ${all.length} are already here: nothing to import.` })
    if (!(await confirm({ title: `Import ${fresh.length} orders?`, message: dupes ? `${dupes} already here will be skipped.` : '', confirmLabel: 'Import' }))) return
    setBusy(true)
    try {
      await createMany(fresh, who, (done, total) => setStatus({ text: `Importing… ${done} of ${total}` }))
      toast(`Imported ${fresh.length} orders${dupes ? `, skipped ${dupes} already here` : ''}`)
      onClose()
    } catch (err) {
      setStatus({ text: 'Import failed: ' + (err.message || err), tone: 'critical' })
      setBusy(false)
    }
  }

  return (
    <Dialog title="Import from the spreadsheet" description="Pick the service order workbook. Each tab becomes a stage: In Progress, Received, Ready for shipping, Completed or Sent Back, CHS spare parts order." onClose={onClose} width={620}>
      <div><Button variant="secondary" onClick={() => file.current?.click()}>Choose .xlsx file…</Button></div>
      <input ref={file} type="file" accept=".xlsx,.xlsm" hidden onChange={read} />
      {sheets.length > 0 && (
        <div className="so-sheets">
          {sheets.map((s, i) => (
            <label key={i} className="so-sheet">
              <input type="checkbox" checked={picked.has(i)} disabled={!s.orders.length}
                onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(i) : n.delete(i); return n })} />
              <span><b>{s.name}</b><span className="so-small">{s.error || `${s.orders.length} orders → ${s.stage}${s.skipped ? `, ${s.skipped} rows skipped` : ''}`}</span></span>
            </label>
          ))}
        </div>
      )}
      {status && <Alert tone={status.tone || 'info'} title={status.text} />}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>Close</Button>
        <Button onClick={go} disabled={busy || !picked.size}>Import selected</Button>
      </div>
    </Dialog>
  )
}
