/* The maintenance schedule, as a section of the one app (INTEGRATION-PLAN.md
   step 3). Planned maintenance by site: what's due, what's done. Replaces the
   PM tracking spreadsheet. Everyone reads; Engineers, Management and admins
   edit (enforced in rules/firestore.rules; the buttons here only reflect it).

   The data and the import are the tool's own modules, unchanged (store.js,
   import.js); this is the page, on the shared kit. The tile picked lives in
   the address (#/overdue), so a link lands on it. The list of PM types is in
   Settings → Maintenance (PmTypes.jsx). */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, FileSpreadsheet, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Dialog, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import {
  STATUSES, watchEntries, watchSettings, createEntry, saveEntry, removeEntry,
  createMany, removeMany, formatDue, isOverdue, isDone, yearOf,
} from '../store.js'
import { readWorkbook } from '../import.js'

export const EDIT_TEAMS = ['Engineers', 'Management']
export const READ_ONLY = 'You have read-only access: an admin, or the Engineers or Management team, can make changes.'

// The tiles. Picking one again goes back to all entries.
const ONLY = [['overdue', 'Overdue', 'critical'], ['due90', 'Due in 90 days', 'warn'], ['open', 'Outstanding', ''], ['done', 'Completed', 'ok'], ['', 'All entries', '']]
const onlyFromHash = () => { const s = location.hash.replace(/^#\/?/, '').split('?')[0]; return ONLY.some(([k]) => k && k === s) ? s : '' }

const inDays = (e, days) => {
  if (!e.due || isDone(e.status)) return false
  const limit = new Date(); limit.setDate(limit.getDate() + days)
  return new Date(e.due) <= limit && !isOverdue(e)
}
const matchesOnly = (e, only) => (only === 'overdue' ? isOverdue(e) : only === 'due90' ? inDays(e, 90)
  : only === 'open' ? !isDone(e.status) : only === 'done' ? isDone(e.status) : true)

const COLUMNS = [
  ['site', 'Site'], ['wards', 'Wards'], ['models', 'Models'], ['due', 'Due'],
  ['pmType', 'PM type'], ['status', 'Status'], ['dateComplete', 'Completed'], ['notes', 'Notes'],
]

export default function App() {
  return (
    <AuthProvider>
      <Schedule />
    </AuthProvider>
  )
}

function Schedule() {
  const { user, profile, profileReady } = useAuth()
  const canEdit = profile?.role === 'admin' || EDIT_TEAMS.includes(profile?.team)
  const [entries, setEntries] = useState(null)
  const [pmTypes, setPmTypes] = useState([])
  const [error, setError] = useState('')
  const [only, setOnly] = useState(onlyFromHash)
  const [sort, setSort] = useState({ key: 'due', dir: 1 })
  const [f, setF] = useState({ q: '', year: '', site: '', status: '', type: '' })
  const [editing, setEditing] = useState(null) // { entry } (null entry = new)
  const [importing, setImporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [toastMsg, toast] = useToast()
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    if (!user) return
    try {
      const stopSettings = watchSettings((s) => setPmTypes(s.pmTypes), () => setPmTypes([])) // the entries feed reports the real problem
      const stopEntries = watchEntries(setEntries, (err) => setError(err.code === 'permission-denied'
        ? 'Firestore refused to read the maintenance schedule. Its security rule may not be published yet.'
        : 'Could not load entries: ' + (err.message || err)))
      return () => { stopSettings(); stopEntries() }
    } catch (e) { setError('Could not load entries: ' + (e.message || e)) }
  }, [user])

  useEffect(() => {
    const h = () => setOnly(onlyFromHash())
    window.addEventListener('hashchange', h)
    return () => window.removeEventListener('hashchange', h)
  }, [])
  const pick = (k) => { location.hash = '#/' + (k === only ? '' : k) }

  const list = entries || []
  const years = useMemo(() => [...new Set(list.map(yearOf).filter(Boolean))].sort().map(String), [list])
  const sites = useMemo(() => [...new Set(list.map((e) => e.site).filter(Boolean))].sort(), [list])
  // Any type the data uses but the list has dropped is still offered, so
  // filtering by it stays possible after someone edits the list.
  const types = useMemo(() => {
    const used = [...new Set(list.map((e) => e.pmType).filter(Boolean))]
    return [...pmTypes, ...used.filter((t) => !pmTypes.includes(t))]
  }, [list, pmTypes])

  const rows = useMemo(() => {
    const q = f.q.trim().toLowerCase()
    return list.filter((e) => {
      if (f.year && String(yearOf(e)) !== f.year) return false
      if (f.site && e.site !== f.site) return false
      if (f.status && e.status !== f.status) return false
      if (f.type && e.pmType !== f.type) return false
      if (!matchesOnly(e, only)) return false
      if (q && ![e.site, e.wards, e.models, e.notes, e.extraNotes, e.pmType, e.status].join(' ').toLowerCase().includes(q)) return false
      return true
    }).sort((a, b) => {
      const k = sort.key
      const av = String(a[k] ?? ''), bv = String(b[k] ?? '')
      // Blank due dates sort last whichever way the column points: an entry
      // with no date is not "the earliest".
      if (k === 'due' && (!av || !bv)) return !av && !bv ? 0 : (!av ? 1 : -1)
      return av.localeCompare(bv, undefined, { numeric: true }) * sort.dir
    })
  }, [list, f, only, sort])

  function exportCsv() {
    const head = ['Site', 'Wards', 'Models', 'Due', 'PM type', 'Status', 'Date complete', 'Notes', 'Additional notes']
    const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
    const lines = [head.map(q).join(',')]
    for (const e of rows) lines.push([e.site, e.wards, e.models, formatDue(e.due, e.monthOnly), e.pmType, e.status, e.dateComplete, e.notes, e.extraNotes].map(q).join(','))
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }))
    a.download = `Maintenance-Schedule-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
    toast(`${rows.length} ${rows.length === 1 ? 'entry' : 'entries'} downloaded as CSV`)
  }

  async function deleteShown() {
    if (!rows.length) return
    const all = rows.length === list.length
    const what = all ? `all ${rows.length} entries` : `the ${rows.length} entries shown`
    if (!(await confirm({ title: `Delete ${what}?`, message: 'This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return
    if (!(await confirm({ title: `Really delete ${rows.length}?`, message: 'This is permanent: they can only come back by importing them again.', confirmLabel: `Delete ${rows.length}`, danger: true }))) return
    setBusy(true)
    try {
      await removeMany(rows.map((e) => e.id))
      toast(`Deleted ${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`)
    } catch (err) { toast('Could not delete: ' + (err.message || err)) }
    finally { setBusy(false) }
  }

  if (user === undefined || (user && !profileReady)) return <div className="mt-page"><Loading /></div>
  const counts = Object.fromEntries(ONLY.map(([k]) => [k, list.filter((e) => matchesOnly(e, k)).length]))

  return (
    <div className="mt-page">
      <div className="mt-head">
        <div>
          <h1 className="mt-title">Maintenance schedule</h1>
          <p className="mt-sub">Planned maintenance by site: what’s due, what’s done.</p>
        </div>
        {canEdit && (
          <div className="mt-head-actions">
            <Button variant="ghost" iconLeft={<FileSpreadsheet size={18} />} onClick={() => setImporting(true)}>Import spreadsheet</Button>
            <Button iconLeft={<Plus size={18} />} onClick={() => setEditing({ entry: null })}>Add entry</Button>
          </div>
        )}
      </div>
      {!canEdit && <Alert tone="info" title="View only">{READ_ONLY}</Alert>}
      {error && <Alert tone="critical" title="Not everything loaded">{error}</Alert>}

      <nav className="mt-tiles" aria-label="Show">
        {ONLY.map(([k, label, tone]) => (
          <a key={k || 'all'} href={'#/' + k} className={`mt-tile ${tone}${only === k ? ' on' : ''}`} aria-current={only === k ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); pick(k) }}>
            <b>{entries ? counts[k] : '–'}</b><span>{label}</span>
          </a>
        ))}
      </nav>

      <div className="card mt-filters">
        <label className="field mt-grow"><span className="field-label">Search</span>
          <input className="input" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Site, ward, model or notes" autoComplete="off" />
        </label>
        <label className="field"><span className="field-label">Year</span>
          <select value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })}><option value="">All years</option>{years.map((y) => <option key={y}>{y}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">Site</span>
          <select value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })}><option value="">All sites</option>{sites.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">Status</span>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="">Any status</option>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
        </label>
        <label className="field"><span className="field-label">PM type</span>
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}><option value="">Any PM type</option>{types.map((t) => <option key={t}>{t}</option>)}</select>
        </label>
      </div>

      <div className="mt-bar">
        <span className="text-sm text-muted">{entries ? `${rows.length} of ${list.length} ${list.length === 1 ? 'entry' : 'entries'}` : 'Loading…'}</span>
        <span className="mt-spacer" />
        {canEdit && <a className="mt-link text-sm" href="/settings/maintenance"><SettingsIcon size={15} aria-hidden="true" /> PM types</a>}
        <Button variant="ghost" size="sm" iconLeft={<Download size={16} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
        {canEdit && <Button variant="ghost" size="sm" className="mt-danger" iconLeft={<Trash2 size={16} />} onClick={deleteShown} disabled={busy || !rows.length}>Delete shown</Button>}
      </div>

      {entries === null && !error ? <Loading /> : (
        <div className="data-table-wrap">
          <table className="data-table mt-table">
            <thead>
              <tr>{COLUMNS.map(([k, label]) => (
                <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="data-table-sort" onClick={() => setSort((s) => ({ key: k, dir: s.key === k ? -s.dir : 1 }))}>
                    {label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}
                  </button>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id} className="data-table-row" tabIndex={0} onClick={() => setEditing({ entry: e })} onKeyDown={(ev) => { if (ev.key === 'Enter') setEditing({ entry: e }) }}>
                  <td data-label="Site"><span className="mt-strong">{e.site}</span></td>
                  <td data-label="Wards" className="mt-ml">{e.wards}</td>
                  <td data-label="Models" className="mt-ml mt-mono">{e.models}</td>
                  <td data-label="Due">{formatDue(e.due, e.monthOnly)}</td>
                  <td data-label="PM type">{e.pmType}</td>
                  <td data-label="Status"><StatusBadge e={e} /></td>
                  <td data-label="Completed">{formatDue(e.dateComplete, false)}</td>
                  <td data-label="Notes" className="mt-ml">{[e.notes, e.extraNotes].filter(Boolean).join('\n')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <p className="data-table-empty">Nothing matches these filters.</p>}
        </div>
      )}

      {editing && <EditDialog entry={editing.entry} pmTypes={pmTypes} canEdit={canEdit} who={user.email || user.uid} confirm={confirm} toast={toast} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog count={list.length} who={user.email || user.uid} confirm={confirm} toast={toast} onClose={() => setImporting(false)} />}
      {confirmDialog}
      <Toast message={toastMsg} />
    </div>
  )
}

function StatusBadge({ e }) {
  if (isOverdue(e)) return <Badge tone="critical">Overdue</Badge>
  // Both completed states read as done; the Biomeds one is marked differently
  // so it is still obvious at a glance who did the work.
  const tone = { 'In progress': 'purple', 'On hold': 'orange' }[e.status] || (isDone(e.status) ? 'green' : 'neutral')
  return <Badge tone={tone} className={e.status === 'Completed by Biomeds' ? 'mt-biomeds' : ''}>{e.status || 'Not started'}</Badge>
}

/* ── Edit ── */
function EditDialog({ entry, pmTypes, canEdit, who, confirm, toast, onClose }) {
  const [base, setBase] = useState(entry) // null once copied forward: Save then creates
  const [v, setV] = useState(() => {
    const e = entry || { status: 'Not started' }
    return { site: e.site || '', wards: e.wards || '', models: e.models || '', due: e.due ? e.due.slice(0, 7) : '', pmType: e.pmType || '',
      status: e.status || 'Not started', dateComplete: e.dateComplete || '', notes: e.notes || '', extraNotes: e.extraNotes || '' }
  })
  const [note, setNote] = useState(canEdit ? null : { text: READ_ONLY })
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const dueInput = useRef(null)
  const set = (k) => (e) => setV({ ...v, [k]: e.target.value })
  // An entry's own type is always offered, even if it has since left the
  // list: otherwise opening it would quietly reassign it on save.
  const options = entry?.pmType && !pmTypes.includes(entry.pmType) ? [...pmTypes, entry.pmType] : pmTypes

  async function save() {
    if (!v.site.trim()) return setNote({ text: 'Site is required.', tone: 'warning' })
    const data = {
      site: v.site.trim(), wards: v.wards.trim(), models: v.models.trim(),
      due: v.due ? `${v.due}-01` : '',
      // The form only asks for a month, which is how the sheet records most of
      // them. An imported day-level date is kept unless the month changes.
      monthOnly: base && base.due && base.due.slice(0, 7) === v.due ? !!base.monthOnly : true,
      pmType: v.pmType, status: v.status, dateComplete: v.dateComplete || '',
      notes: v.notes.trim(), extraNotes: v.extraNotes.trim(),
    }
    setBusy(true)
    try {
      if (base) await saveEntry(base.id, data, who)
      else await createEntry(data, who)
      toast(base ? 'Entry updated' : 'Entry added')
      onClose()
    } catch (err) {
      setNote({ text: 'Could not save: ' + (err.message || err), tone: 'critical' })
      setBusy(false)
    }
  }

  async function del() {
    if (!(await confirm({ title: `Delete the ${base.site} entry?`, message: 'This can’t be undone.', confirmLabel: 'Delete', danger: true }))) return
    try { await removeEntry(base.id, `${base.site}${base.pmType ? ' (' + base.pmType + ')' : ''}`); toast('Entry deleted'); onClose() }
    catch (err) { setNote({ text: 'Could not delete: ' + (err.message || err), tone: 'critical' }) }
  }

  // Roll a PM forward. The spreadsheet did this with a year tab per cycle;
  // here it reuses this dialog: same site, wards and models, a year later,
  // not yet done. Notes are kept on purpose: they are mostly standing context
  // ("not charged", "Service Contract - pending!") and they are on screen to
  // edit before saving. Status and date complete only describe the visit
  // being copied, so those reset.
  function copyForward() {
    let due = v.due
    if (due) { const [y, m] = due.split('-'); due = `${Number(y) + 1}-${m}` }
    setV({ ...v, due, status: 'Not started', dateComplete: '' })
    setBase(null)
    setCopied(true)
    setNote({ text: v.due ? `Due moved to ${due}. Change anything you need, then Save to create it.` : 'The original had no due date: set one, then Save to create it.' })
    setTimeout(() => dueInput.current?.focus(), 0)
  }

  const field = (k, label, el) => <label className="field" key={k}><span className="field-label">{label}</span>{el}</label>
  return (
    <Dialog title={copied ? 'New entry, copied' : entry ? 'Edit entry' : 'New entry'} onClose={onClose} width={680}>
      <div className="mt-grid2">
        {field('site', 'Site', <input className="input" value={v.site} onChange={set('site')} disabled={!canEdit} />)}
        {field('wards', 'Wards', <textarea className="input" rows={2} value={v.wards} onChange={set('wards')} placeholder="One per line" disabled={!canEdit} />)}
      </div>
      {field('models', 'Models', <textarea className="input mt-mono" rows={3} value={v.models} onChange={set('models')} placeholder="One per line, e.g. 16x N1" disabled={!canEdit} />)}
      <div className="mt-grid2">
        {field('due', 'Due', <input ref={dueInput} className="input" type="month" value={v.due} onChange={set('due')} disabled={!canEdit} />)}
        {field('pmType', 'PM type', <select value={v.pmType} onChange={set('pmType')} disabled={!canEdit}><option value=""></option>{options.map((t) => <option key={t}>{t}</option>)}</select>)}
        {field('status', 'Status', <select value={v.status} onChange={set('status')} disabled={!canEdit}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>)}
        {field('dateComplete', 'Date complete', <input className="input" type="date" value={v.dateComplete} onChange={set('dateComplete')} disabled={!canEdit} />)}
      </div>
      {field('notes', 'Notes', <textarea className="input" rows={2} value={v.notes} onChange={set('notes')} disabled={!canEdit} />)}
      {field('extraNotes', 'Additional notes', <textarea className="input" rows={2} value={v.extraNotes} onChange={set('extraNotes')} disabled={!canEdit} />)}
      {note && <Alert tone={note.tone || 'info'} title={note.text} />}
      <div className="dialog-actions">
        {base && canEdit && <Button variant="ghost" className="mt-danger" onClick={del}>Delete</Button>}
        {/* Only on a saved entry: copying a form not written yet is just typing it twice. */}
        {base && canEdit && <Button variant="ghost" onClick={copyForward}>Copy forward</Button>}
        <span className="spacer" />
        <Button variant="ghost" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</Button>
        {canEdit && <Button onClick={save} disabled={busy}>Save</Button>}
      </div>
    </Dialog>
  )
}

/* ── Import the spreadsheet ── */
function ImportDialog({ count, who, confirm, toast, onClose }) {
  const [sheets, setSheets] = useState([])
  const [picked, setPicked] = useState(new Set())
  const [status, setStatus] = useState(null)
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
      setPicked(new Set(parsed.map((s, i) => (s.entries.length ? i : -1)).filter((i) => i >= 0)))
      const total = parsed.reduce((n, s) => n + s.entries.length, 0)
      setStatus(total ? { text: `${total} entries found across ${parsed.length} sheets.` } : { text: 'No entries found. Is this the right workbook?', tone: 'warning' })
    } catch (err) {
      setStatus({ text: 'Could not read the file: ' + (err.message || err), tone: 'critical' })
    }
  }, [])

  const detail = (s) => {
    if (s.error) return s.error
    const bits = [`${s.entries.length} entries`]
    if (s.skipped) bits.push(`${s.skipped} blank rows skipped`)
    // Unreadable due dates are called out before anything is written: the
    // first import quietly defaulted them all and nobody could tell.
    if (s.unreadable?.length) bits.push(`${s.unreadable.length} due dates unreadable`)
    const missing = ['site', 'dueRaw', 'status'].filter((k) => s.columns?.[k] === undefined)
    if (missing.length) bits.push(`no ${missing.join('/')} column found`)
    return bits.join(', ')
  }

  async function go() {
    const all = [...picked].flatMap((i) => sheets[i].entries)
    if (!all.length) return
    // Importing twice would silently double everything, and nothing here can
    // tell a genuine repeat PM from a duplicate, so this is the one guard.
    if (count && !(await confirm({ title: `Import ${all.length} more entries?`, message: `There are already ${count}. Rows that already exist will be duplicated.`, confirmLabel: 'Import anyway' }))) return
    setBusy(true)
    try {
      await createMany(all, who, (done, total) => setStatus({ text: `Importing… ${done} of ${total}` }))
      toast(`Imported ${all.length} entries`)
      onClose()
    } catch (err) {
      setStatus({ text: 'Import failed: ' + (err.message || err), tone: 'critical' })
      setBusy(false)
    }
  }

  return (
    <Dialog title="Import from the spreadsheet" description="Pick the PM tracking workbook. Each year tab is read separately, so you can bring in just the years you want." onClose={onClose} width={620}>
      <div><Button variant="secondary" onClick={() => file.current?.click()}>Choose .xlsx file…</Button></div>
      <input ref={file} type="file" accept=".xlsx,.xlsm,.csv" hidden onChange={read} />
      {sheets.length > 0 && (
        <div className="mt-sheets">
          {sheets.map((s, i) => (
            <label key={i} className="mt-sheet">
              <input type="checkbox" checked={picked.has(i)} disabled={!s.entries.length}
                onChange={(e) => setPicked((p) => { const n = new Set(p); e.target.checked ? n.add(i) : n.delete(i); return n })} />
              <span><b>{s.name}</b><span className="mt-small">{detail(s)}</span></span>
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
