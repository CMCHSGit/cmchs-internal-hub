/* Project checklists, as a section of the one app (INTEGRATION-PLAN.md step 3), under Service.

   For a job where a team visits many devices (the N1 monitor software upgrade at North Shore, 218 of
   them all over the hospital): import the device export from the central station, and everyone who
   signs in sees the same list and ticks off what they have done. It sorts by department so people can
   walk a ward at a time, shows who ticked what and when, and exports to Excel or CSV. Importing a newer
   export into the same list refreshes each device's status and location and keeps its ticks.

   Everyone signed in can read and tick; Engineers, Management and admins also import, rename and
   delete (rules/firestore.rules, `checklists`; the buttons here only reflect it). Which list is open
   lives in the address (#/<listId>), so a link opens it. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, FileSpreadsheet, Trash2 } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Dialog, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import { XLSXLite } from '../../simprosync/reader.js'
import {
  NO_DEPARTMENT, RESULTS, STATUS_ORDER, filterItems, groupByDepartment, niceStamp, parseDevices, sharedSerials, sortItems, stamp, summarise,
} from './model.js'
import { downloadCsv, downloadXlsx } from './export.js'
import { createList, importInto, removeItem, removeList, renameList, setNote, setResult, watchItems, watchLists } from './store.js'

const EDIT_TEAMS = ['Engineers', 'Management']
const NO_DEPT_LABEL = 'No department'
const STATUS_TONE = { Working: 'green', Standby: 'purple', Offline: 'orange', Shutdown: 'neutral' }

const readError = (e, what) => (e?.code === 'permission-denied'
  ? `The database refused ${what}. The checklists rule may not be published in Firebase yet: an admin pastes rules/firestore.rules into the console.`
  : `Could not ${what.replace(/^to /, '')}: ${e?.message || e}`)

/** Which list is open: the address's #/<listId>, or '' for the lists. */
function useHashId() {
  const read = () => decodeURIComponent(location.hash.replace(/^#\/?/, '').split(/[?/]/)[0] || '')
  const [id, setId] = useState(read)
  useEffect(() => {
    const f = () => setId(read())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  return id
}

export default function App() {
  return (
    <AuthProvider>
      <Checklists />
    </AuthProvider>
  )
}

function Checklists() {
  const { user, profile, profileReady } = useAuth()
  const id = useHashId()
  if (user === undefined || (user && !profileReady)) return <div className="cl-page"><Loading /></div>
  const canEdit = profile?.role === 'admin' || EDIT_TEAMS.includes(profile?.team)
  const by = { uid: user?.uid || '', name: profile?.displayName || user?.displayName || 'Someone' }
  return id ? <ListView key={id} id={id} by={by} canEdit={canEdit} /> : <Lists by={by} canEdit={canEdit} />
}

// ── The lists ──────────────────────────────────────────────────────────────────────────────────────

function Lists({ by, canEdit }) {
  const [lists, setLists] = useState(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [toastMsg, toast] = useToast()

  useEffect(() => {
    try { return watchLists(setLists, (e) => setError(readError(e, 'to read the checklists'))) } catch (e) { setError(readError(e, 'to read the checklists')) }
  }, [])

  return (
    <div className="cl-page">
      <div className="cl-head">
        <div>
          <h1 className="cl-title">Project checklists</h1>
          <p className="cl-sub">A list of devices for a job, ticked off by everyone on the team as they go.</p>
        </div>
        {canEdit && <div className="cl-head-actions"><Button iconLeft={<FileSpreadsheet size={18} />} onClick={() => setImporting(true)}>New list from spreadsheet</Button></div>}
      </div>
      {error && <Alert tone="critical" title="Not everything loaded">{error}</Alert>}
      {lists === null && !error && <Loading />}
      {lists?.length === 0 && (
        <div className="cl-empty">
          <p><b>No checklists yet.</b></p>
          <p>{canEdit
            ? 'Choose New list from spreadsheet and pick the device export (.xlsx or .csv). Everyone signed in will then see the list and can tick devices off.'
            : 'An admin, or someone in the Engineers or Management team, starts a list by importing a spreadsheet of devices.'}</p>
        </div>
      )}
      {!!lists?.length && (
        <ul className="cl-lists">
          {lists.map((l) => (
            <li key={l.id}>
              <a className="cl-list-card" href={`#/${encodeURIComponent(l.id)}`}>
                <span className="cl-list-name">{l.name}</span>
                <span className="cl-list-meta">{l.total ?? '…'} devices</span>
                <span className="cl-list-meta">Started {stamp(l.createdAt) || 'just now'}{l.createdByName ? ` by ${l.createdByName}` : ''}</span>
                {l.importedAt && <span className="cl-list-meta">Spreadsheet loaded {stamp(l.importedAt)}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {importing && (
        <ImportDialog by={by} onClose={(msg, newId) => { setImporting(false); if (msg) toast(msg); if (newId) location.hash = '#/' + encodeURIComponent(newId) }} />
      )}
      <Toast message={toastMsg} />
    </div>
  )
}

// ── One list ───────────────────────────────────────────────────────────────────────────────────────

const COLUMNS = [
  ['department', 'Department'], ['name', 'Device'], ['serial', 'Serial number'], ['status', 'Status'],
  ['location', 'Last location'], ['version', 'Software'], ['result', 'Result'],
]
const SORT_LABELS = { department: 'Department', status: 'Status', serial: 'Serial number', name: 'Device name', location: 'Last location', version: 'Software version', lastSeen: 'Last seen', result: 'Result' }

function ListView({ id, by, canEdit }) {
  const [items, setItems] = useState(null)
  const [meta, setMeta] = useState({ pending: 0, fromCache: false })
  const [lists, setLists] = useState(null)
  const [error, setError] = useState('')
  const [f, setF] = useState({ q: '', status: '', department: '', version: '', show: 'all' })
  const [sort, setSort] = useState({ key: 'department', dir: 1 })
  const [openId, setOpenId] = useState('')
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [toastMsg, toast] = useToast()
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    try {
      const a = watchItems(id, (rows, m) => { setItems(rows); setMeta(m) }, (e) => setError(readError(e, 'to read this list')))
      const b = watchLists(setLists, () => {})
      return () => { a(); b() }
    } catch (e) { setError(readError(e, 'to read this list')) }
  }, [id])

  const list = lists?.find((l) => l.id === id)
  const all = items || []
  const summary = useMemo(() => summarise(all), [all])
  const shared = useMemo(() => sharedSerials(all), [all])
  const shown = useMemo(() => sortItems(filterItems(all, f), sort.key, sort.dir), [all, f, sort])
  const grouped = sort.key === 'department'
  const groups = useMemo(() => (grouped ? groupByDepartment(shown) : [{ department: null, items: shown }]), [grouped, shown])
  const deptTotals = useMemo(() => new Map(summary.departments.map((d) => [d.name, d])), [summary])
  const statuses = STATUS_ORDER.filter((s) => summary.byStatus[s]).concat(Object.keys(summary.byStatus).filter((s) => !STATUS_ORDER.includes(s)))

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))
  const filtered = f.q || f.status || f.department || f.version || f.show !== 'all'

  async function run(promise, failed = 'Not saved') {
    try { await promise } catch (e) { toast(e?.code === 'permission-denied' ? 'Not saved: the database refused it. The checklists rule may not be published yet.' : `${failed}: ${e?.message || e}`) }
  }
  const tick = (it) => run(setResult(id, it.id, it.result === RESULTS.done ? '' : RESULTS.done, by))

  async function deleteList() {
    if (!(await confirm({ title: `Delete “${list?.name || 'this list'}”?`, message: `All ${all.length} devices and everyone’s ticks on it will be removed. This can’t be undone. Export it first if you need a copy.`, confirmLabel: 'Delete the list', danger: true }))) return
    try { await removeList(id, all.map((x) => x.id)); location.hash = '#/' } catch (e) { toast(readError(e, 'to delete the list')) }
  }

  if (error) return <div className="cl-page"><a className="cl-back" href="#/"><ArrowLeft size={16} /> All lists</a><Alert tone="critical" title="This list didn’t load">{error}</Alert></div>
  if (items === null || lists === null) return <div className="cl-page"><Loading /></div>
  if (!list && !all.length) return <div className="cl-page"><a className="cl-back" href="#/"><ArrowLeft size={16} /> All lists</a><div className="cl-empty"><p><b>This list isn’t here.</b></p><p>It may have been deleted.</p></div></div>

  const open = all.find((x) => x.id === openId)
  const pct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0
  const tiles = [['todo', 'To do', summary.todo], ['done', 'Done', summary.done], ['notfound', 'Couldn’t find', summary.notfound], ['all', 'All devices', summary.total]]

  return (
    <div className="cl-page">
      <a className="cl-back" href="#/"><ArrowLeft size={16} /> All lists</a>
      <div className="cl-head">
        <div>
          <h1 className="cl-title">{list?.name || 'Checklist'}</h1>
          <p className="cl-sub">
            {summary.total} devices · {summary.uniqueSerials} different serial numbers
            {list?.importedAt ? ` · spreadsheet loaded ${stamp(list.importedAt)}` : ''}
          </p>
        </div>
        <div className="cl-head-actions">
          <Button variant="secondary" iconLeft={<Download size={18} />} onClick={() => setExporting(true)}>Export</Button>
          {canEdit && <Button variant="ghost" iconLeft={<FileSpreadsheet size={18} />} onClick={() => setImporting(true)}>Update from spreadsheet</Button>}
          {canEdit && <Button variant="ghost" onClick={() => setRenaming(true)}>Rename</Button>}
          {canEdit && <Button variant="ghost" className="cl-del" iconLeft={<Trash2 size={18} />} onClick={deleteList}>Delete</Button>}
        </div>
      </div>

      <div className="cl-progress">
        <div className="cl-progress-top">
          <b>{summary.done} of {summary.total} done</b>
          <span>{pct}%{summary.notfound ? ` · ${summary.notfound} couldn’t find` : ''}</span>
          <span className={`cl-sync${meta.pending ? ' wait' : ''}`} role="status">
            {meta.pending ? `${meta.pending} waiting to sync` : meta.fromCache ? 'Offline: showing the last copy' : 'All saved'}
          </span>
        </div>
        <div className="cl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.done} aria-label="Devices done">
          <span className="cl-bar-done" style={{ width: `${summary.total ? (summary.done / summary.total) * 100 : 0}%` }} />
          <span className="cl-bar-lost" style={{ width: `${summary.total ? (summary.notfound / summary.total) * 100 : 0}%` }} />
        </div>
      </div>

      {meta.pending > 0 && <Alert tone="info" title="Waiting to sync">Your ticks are saved on this device and will go to everyone else when there is a signal. Keep this page open until it says All saved.</Alert>}
      {summary.sharedSerials > 0 && (
        <Alert tone="info" title={`${summary.sharedSerials} serial number${summary.sharedSerials === 1 ? ' is' : 's are'} on more than one device`}>
          The export lists them as separate devices (different Device ID), so they count as separate visits here. They’re tagged “Same serial” below.
        </Alert>
      )}

      <nav className="cl-tiles" aria-label="Show">
        {tiles.map(([key, label, n]) => (
          <button key={key} type="button" className={`cl-tile${f.show === key ? ' on' : ''}`} aria-pressed={f.show === key} onClick={() => setF({ ...f, show: key })}>
            <b>{n}</b><span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="cl-filters card-like">
        <label className="field cl-grow"><span className="field-label">Search</span>
          <input className="input" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Device name, serial, location, IP or note" autoComplete="off" />
        </label>
        <label className="field"><span className="field-label">Department</span>
          <select value={f.department} onChange={(e) => setF({ ...f, department: e.target.value })}>
            <option value="">All departments ({summary.departments.length})</option>
            {summary.departments.map((d) => <option key={d.name || NO_DEPARTMENT} value={d.name || NO_DEPARTMENT}>{d.name || NO_DEPT_LABEL} ({d.total - d.done - d.notfound} to do of {d.total})</option>)}
          </select>
        </label>
        <label className="field"><span className="field-label">Status</span>
          <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="">Any status</option>
            {statuses.map((s) => <option key={s} value={s}>{s} ({summary.byStatus[s]})</option>)}
          </select>
        </label>
        {summary.versions.length > 1 && (
          <label className="field"><span className="field-label">Software version</span>
            <select value={f.version} onChange={(e) => setF({ ...f, version: e.target.value })}>
              <option value="">Any version</option>
              {summary.versions.map((v) => <option key={v.name} value={v.name}>{v.name || 'Unknown'} ({v.count})</option>)}
            </select>
          </label>
        )}
        <div className="field cl-sort">
          <span className="field-label">Sort by</span>
          <div className="cl-sort-row">
            <select value={sort.key} onChange={(e) => setSort({ key: e.target.value, dir: 1 })} aria-label="Sort by">
              {Object.entries(SORT_LABELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
            <button type="button" className="icon-btn icon-btn-md" aria-label={sort.dir > 0 ? 'Ascending: switch to descending' : 'Descending: switch to ascending'}
              title={sort.dir > 0 ? 'A to Z' : 'Z to A'} onClick={() => setSort({ ...sort, dir: -sort.dir })}>
              {sort.dir > 0 ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
            </button>
          </div>
        </div>
      </div>

      <div className="cl-count">
        <span>Showing {shown.length} of {summary.total}</span>
        {filtered && <button type="button" className="cl-link" onClick={() => setF({ q: '', status: '', department: '', version: '', show: 'all' })}>Clear filters</button>}
      </div>

      <div className="data-table-wrap">
        <table className="data-table cl-table">
          <thead>
            <tr>
              <th className="cl-check-col"><span className="sr-only">Done</span></th>
              {COLUMNS.filter(([k]) => !(grouped && k === 'department')).map(([k, label]) => (
                <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="data-table-sort" onClick={() => sortBy(k)}>{label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.department ?? 'all'} group={g} grouped={grouped} total={deptTotals.get(g.department || '')} shared={shared} onTick={tick} onOpen={setOpenId} />
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="data-table-empty">{all.length ? 'No devices match. Clear the filters to see them all.' : 'This list has no devices yet.'}</p>}
      </div>

      {open && (
        <DetailDialog it={open} shared={shared.has((open.serial || '').toLowerCase())} canEdit={canEdit} by={by} listId={id} run={run}
          onClose={() => setOpenId('')}
          onRemove={async () => {
            if (!(await confirm({ title: `Remove ${open.name || open.serial} from this list?`, message: 'Importing a spreadsheet that still has it will add it back.', confirmLabel: 'Remove', danger: true }))) return
            setOpenId('')
            run(removeItem(id, open.id), 'Not removed')
          }} />
      )}
      {exporting && <ExportDialog name={list?.name} all={all} shown={shown} filtered={filtered} onClose={(msg) => { setExporting(false); if (msg) toast(msg) }} />}
      {importing && <ImportDialog by={by} list={list} existingIds={all.map((x) => x.id)} onClose={(msg) => { setImporting(false); if (msg) toast(msg) }} />}
      {renaming && <RenameDialog name={list?.name || ''} onClose={(name) => { setRenaming(false); if (name && name !== list?.name) run(renameList(id, name)) }} />}
      {confirmDialog}
      <Toast message={toastMsg} />
    </div>
  )
}

function GroupRows({ group, grouped, total, shared, onTick, onOpen }) {
  return (
    <>
      {grouped && (
        <tr className="cl-group">
          <td colSpan={COLUMNS.length}>
            <b>{group.department || NO_DEPT_LABEL}</b>
            <span>{total ? `${total.done} of ${total.total} done` : ''}{group.items.length !== total?.total ? ` · showing ${group.items.length}` : ''}</span>
          </td>
        </tr>
      )}
      {group.items.map((it) => <DeviceRow key={it.id} it={it} grouped={grouped} shared={shared.has((it.serial || '').toLowerCase())} onTick={onTick} onOpen={onOpen} />)}
    </>
  )
}

function DeviceRow({ it, grouped, shared, onTick, onOpen }) {
  const done = it.result === RESULTS.done
  const lost = it.result === RESULTS.notfound
  return (
    <tr className={`data-table-row cl-row${done ? ' done' : ''}${lost ? ' lost' : ''}`} tabIndex={0} onClick={() => onOpen(it.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(it.id) }}>
      <td className="cl-check-col" data-label="">
        <button type="button" className={`cl-check${done ? ' on' : ''}`} aria-pressed={done} aria-label={`${done ? 'Untick' : 'Tick'} ${it.name || it.serial}`}
          onClick={(e) => { e.stopPropagation(); onTick(it) }}>
          {done && <Check size={22} strokeWidth={3} aria-hidden="true" />}
        </button>
      </td>
      {!grouped && <td className="cl-c-dept" data-label="Department">{it.department ? <span className={it.deptGuessed ? 'cl-guess' : ''} title={it.deptGuessed ? 'Not in the export: taken from the location' : undefined}>{it.department}</span> : <span className="cl-none">{NO_DEPT_LABEL}</span>}</td>}
      <td className="cl-c-device" data-label="Device">
        <span className="cl-strong">{it.name || '(no name)'}</span>
        <span className="cl-small">{[it.category, it.model].filter(Boolean).join(' · ')}</span>
      </td>
      <td className="cl-c-serial" data-label="Serial number">
        <span className="cl-mono">{it.serial}</span>
        {shared && <Badge tone="orange" className="cl-shared">Same serial</Badge>}
      </td>
      <td className="cl-c-status" data-label="Status">
        <Badge tone={STATUS_TONE[it.status] || 'neutral'}>{it.status || 'Unknown'}</Badge>
        {it.statusSince && <span className="cl-small">since {niceStamp(it.statusSince)}</span>}
      </td>
      <td className="cl-c-loc" data-label="Last location">
        {it.location || <span className="cl-none">Unknown</span>}
        {it.lastSeenAt && <span className="cl-small">seen {niceStamp(it.lastSeenAt)}</span>}
      </td>
      <td className="cl-c-ver" data-label="Software"><span className="cl-mono">{it.version}</span></td>
      <td className="cl-c-result" data-label="Result">
        {done && <><Badge tone="green">Done</Badge><span className="cl-small">{it.doneByName}{it.doneAt ? ` · ${stamp(it.doneAt)}` : ''}</span></>}
        {lost && <><Badge tone="orange">Couldn’t find</Badge><span className="cl-small">{it.doneByName}{it.doneAt ? ` · ${stamp(it.doneAt)}` : ''}</span></>}
        {it.note && <span className="cl-note" title={it.note}>“{it.note}”</span>}
      </td>
    </tr>
  )
}

// ── One device ─────────────────────────────────────────────────────────────────────────────────────

function DetailDialog({ it, shared, canEdit, by, listId, run, onClose, onRemove }) {
  const [note, setNoteText] = useState(it.note || '')
  const done = it.result === RESULTS.done
  const lost = it.result === RESULTS.notfound
  const rows = [
    ['Department', it.department ? it.department + (it.deptGuessed ? ' (from the location: not in the export)' : '') : NO_DEPT_LABEL],
    ['Device type', [it.category, it.model].filter(Boolean).join(' · ')],
    ['Serial number', it.serial],
    ['Status', (it.status || 'Unknown') + (it.statusSince ? ` since ${niceStamp(it.statusSince)}` : '')],
    ['Last location', it.location],
    ['Last seen', niceStamp(it.lastSeenAt) + (it.lastSeenIn && it.lastSeenIn !== it.location ? ` at ${it.lastSeenIn}` : '')],
    ['Facility', it.facility], ['Room', it.room], ['Bed', it.bed],
    ['Software version', it.versionFull || it.version],
    ['IP address', it.ip], ['Wireless MAC', it.wirelessMac], ['Wired MAC', it.wiredMac], ['Device ID', it.deviceId],
    ['Error', it.error],
  ].filter(([, v]) => v)
  const saveNote = () => { if (note.trim() !== (it.note || '')) run(setNote(listId, it.id, note.trim(), by)) }

  return (
    <Dialog title={it.name || it.serial} description={shared ? 'This serial number is on more than one device in the export.' : undefined} onClose={onClose} width={560}>
      <div className="cl-detail-state">
        {done && <><Badge tone="green">Done</Badge> <span>by {it.doneByName}{it.doneAt ? `, ${stamp(it.doneAt)}` : ''}</span></>}
        {lost && <><Badge tone="orange">Couldn’t find</Badge> <span>marked by {it.doneByName}{it.doneAt ? `, ${stamp(it.doneAt)}` : ''}</span></>}
        {!done && !lost && <><Badge tone="neutral">To do</Badge></>}
      </div>
      <div className="cl-detail-actions">
        {!done && <Button iconLeft={<Check size={18} />} onClick={() => run(setResult(listId, it.id, RESULTS.done, by))}>Mark done</Button>}
        {!lost && <Button variant="secondary" onClick={() => run(setResult(listId, it.id, RESULTS.notfound, by))}>Couldn’t find it</Button>}
        {(done || lost) && <Button variant="ghost" onClick={() => run(setResult(listId, it.id, '', by))}>Back to to do</Button>}
      </div>
      <label className="field"><span className="field-label">Note{it.noteByName && it.note ? ` (by ${it.noteByName})` : ''}</span>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNoteText(e.target.value)} onBlur={saveNote} placeholder="Where it was, what you did, anything the next person should know" />
      </label>
      <dl className="cl-detail">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="dialog-actions">
        {canEdit && <Button variant="ghost" className="cl-del" iconLeft={<Trash2 size={18} />} onClick={onRemove}>Remove from list</Button>}
        <Button variant="secondary" onClick={() => { saveNote(); onClose() }}>Close</Button>
      </div>
    </Dialog>
  )
}

function RenameDialog({ name, onClose }) {
  const [v, setV] = useState(name)
  return (
    <Dialog title="Rename the list" onClose={() => onClose('')} width={440}>
      <form onSubmit={(e) => { e.preventDefault(); onClose(v.trim()) }}>
        <label className="field"><span className="field-label">List name</span>
          <input className="input" value={v} onChange={(e) => setV(e.target.value)} />
        </label>
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onClose('')}>Cancel</Button>
          <Button type="submit" disabled={!v.trim()}>Save</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Export ─────────────────────────────────────────────────────────────────────────────────────────

function ExportDialog({ name, all, shown, filtered, onClose }) {
  const [which, setWhich] = useState(filtered ? 'shown' : 'all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rows = which === 'shown' ? shown : all
  // In the order they are on screen, so what is exported reads the way it was sorted.
  async function go(kind) {
    setBusy(true); setError('')
    try {
      if (kind === 'xlsx') await downloadXlsx(name, rows); else downloadCsv(name, rows)
      onClose(`${rows.length} devices downloaded as ${kind === 'xlsx' ? 'an Excel file' : 'CSV'}.`)
    } catch (e) { setError('Could not make the file: ' + (e.message || e)); setBusy(false) }
  }
  return (
    <Dialog title="Export the list" description="Every device with its status, department, last location, result, who did it and when." onClose={() => !busy && onClose('')} width={480}>
      <div className="cl-radios" role="radiogroup" aria-label="What to export">
        <label className="cl-radio"><input type="radio" name="which" checked={which === 'all'} onChange={() => setWhich('all')} /> Everything on the list ({all.length})</label>
        <label className="cl-radio"><input type="radio" name="which" checked={which === 'shown'} onChange={() => setWhich('shown')} disabled={!filtered} /> Only what’s showing now ({shown.length}){!filtered && ' (no filter is on)'}</label>
      </div>
      {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
      <div className="dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={() => onClose('')}>Cancel</Button>
        <Button variant="secondary" disabled={busy || !rows.length} onClick={() => go('csv')}>CSV</Button>
        <Button disabled={busy || !rows.length} iconLeft={<Download size={18} />} onClick={() => go('xlsx')}>{busy ? 'Working…' : 'Excel (.xlsx)'}</Button>
      </div>
    </Dialog>
  )
}

// ── Import ─────────────────────────────────────────────────────────────────────────────────────────

/** Reads the first sheet of the file that has devices on it. */
async function readDevices(file) {
  const book = await XLSXLite.read(file)
  let last = null
  for (let i = 0; i < book.sheets.length; i++) {
    last = parseDevices(await book.rows(i))
    if (!last.error && last.devices.length) return last
  }
  return last || { devices: [], skipped: 0, duplicates: 0, error: 'That file has no sheets.' }
}

/** Pick the export, check what it holds, then save: a new list, or an update of the one that is open. */
function ImportDialog({ by, list, existingIds = [], onClose }) {
  const [parsed, setParsed] = useState(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)
  const existing = useMemo(() => new Set(existingIds), [existingIds])

  async function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(''); setParsed(null)
    try {
      const out = await readDevices(file)
      if (out.error) throw new Error(out.error)
      if (!out.devices.length) throw new Error('No devices found in that file.')
      setParsed(out)
      if (!list && !name) setName(file.name.replace(/\.[^.]+$/, ''))
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }

  const summary = useMemo(() => (parsed ? summarise(parsed.devices) : null), [parsed])
  const added = parsed ? parsed.devices.filter((d) => !existing.has(d.id)).length : 0

  async function save() {
    setBusy(true); setError('')
    try {
      if (list) {
        const r = await importInto(list.id, parsed.devices, existingIds, by)
        onClose(`${r.added} added, ${r.updated} refreshed. Ticks were kept.`)
      } else {
        const id = await createList({ name: name.trim() || 'Checklist', devices: parsed.devices, by })
        onClose(`List made with ${parsed.devices.length} devices.`, id)
      }
    } catch (err) {
      setError(readError(err, 'to save the list').replace(/^Could not /, 'Not saved: could not '))
      setBusy(false)
    }
  }

  return (
    <Dialog title={list ? 'Update from a spreadsheet' : 'New list from a spreadsheet'} onClose={() => !busy && onClose('')} width={620}
      description={list
        ? 'Choose a newer export of the same devices. Each device’s status, location and software are refreshed, new ones are added, and nobody’s ticks or notes are touched.'
        : 'Choose the device export (.xlsx or .csv) from the central station. Each row becomes a device on the list.'}>
      <div className="cl-import">
        <input ref={input} type="file" accept=".xlsx,.csv" onChange={pick} disabled={busy} aria-label="Spreadsheet file" />
        {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
        {parsed && summary && (
          <>
            <p className="cl-import-line"><b>{parsed.devices.length} devices</b> found · {summary.uniqueSerials} different serial numbers · {summary.departments.length} departments</p>
            {list && <p className="cl-import-line">{added} new to this list, {parsed.devices.length - added} already on it.</p>}
            {summary.sharedSerials > 0 && <Alert tone="info">{summary.sharedSerials} serial number{summary.sharedSerials === 1 ? ' is' : 's are'} on more than one row. They’re kept as separate devices (different Device ID) and tagged on the list.</Alert>}
            {parsed.duplicates > 0 && <Alert tone="info">{parsed.duplicates} row{parsed.duplicates === 1 ? ' repeats' : 's repeat'} a Device ID already in the file; the later one is used.</Alert>}
            {parsed.skipped > 0 && <Alert tone="info">{parsed.skipped} row{parsed.skipped === 1 ? ' has' : 's have'} no Device ID or serial number and {parsed.skipped === 1 ? 'was' : 'were'} skipped.</Alert>}
            <div className="cl-import-chips">
              {Object.entries(summary.byStatus).map(([s, n]) => <Badge key={s} tone={STATUS_TONE[s] || 'neutral'}>{s} {n}</Badge>)}
            </div>
            <div className="cl-import-depts">
              {summary.departments.map((d) => <span key={d.name || '-'}>{d.name || NO_DEPT_LABEL} <b>{d.total}</b></span>)}
            </div>
            {!list && (
              <label className="field"><span className="field-label">List name</span>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="N1 software upgrade, North Shore" />
              </label>
            )}
          </>
        )}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={() => onClose('')}>Cancel</Button>
        <Button disabled={!parsed || busy || (!list && !name.trim())} onClick={save}>{busy ? 'Working…' : list ? 'Update the list' : 'Make the list'}</Button>
      </div>
    </Dialog>
  )
}
