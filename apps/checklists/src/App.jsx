/* Checklists, as a section of the one app (INTEGRATION-PLAN.md step 3), under Service.

   A list of things to check on equipment, ticked off by a team: the N1 monitor software upgrade at North
   Shore (218 devices all over the hospital), a round of planned maintenance, a test round. Import the
   device export from the central station, say what has to be ticked on every device ("Software upgraded",
   "Changed config": a device is done when all its steps are), and share the list with the people and teams
   doing the job. They see it live, tick as they go, add devices they find that weren't on it, and export it.
   It sorts and groups by department so people can walk a ward at a time. Importing a newer export into the
   same list refreshes each device's status and location and keeps its ticks.

   Like an ask, a list is seen only by the people it is shared with. Whoever made it (an admin, or someone in
   the Engineers or Management team) imports, changes the steps, shares, renames and deletes; everyone it is
   shared with ticks, adds and exports (rules/firestore.rules, `checklists`; the buttons here only reflect it).
   An ask can attach one of your lists, which shares it with whoever the ask goes to. Which list is open
   lives in the address (#/<listId>), so a link opens it. */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Download, FileSpreadsheet, Link2, Plus, ScanBarcode, Share2, Trash2, X } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Dialog, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import { XLSXLite } from '../../simprosync/reader.js'
import {
  DEFAULT_STEPS, MAX_STEPS, NO_DEPARTMENT, mainOf, STATUSES, STATUS_ORDER, filterItems, findBySerial, groupByDepartment, latestTick, newDevice, newStepId, niceStamp,
  newOnly, parseDevices, parseManualLines, progressOf, sharedSerials, sortItems, stamp, stateOf, stepsFromText, stepsOf, summarise, tickOf,
} from './model.js'
import { downloadCsv, downloadXlsx } from './export.js'
import StepChecks from './StepChecks.jsx'
import MultiSelect from './MultiSelect.jsx'
import { NO_FILTER, loadView, saveView } from './prefs.js'
import {
  addDevice, addDevices, createList, importInto, markLost, notifyShared, removeItem, removeList, renameList, resetItem, saveSharing, saveSteps, setNote, setStep, watchItems, watchLists, watchPeople,
} from './store.js'

// The camera and its barcode reader load only when someone scans.
const Scan = lazy(() => import('./Scan.jsx'))

const EDIT_TEAMS = ['Engineers', 'Management']
// The teams an ask can go to (rules: isAsk); a list is shared with the same ones.
const TEAMS = ['Admin', 'Management', 'Engineers', 'Sales', 'Application']
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
  const canCreate = profile?.role === 'admin' || EDIT_TEAMS.includes(profile?.team)
  const me = { uid: user?.uid || '', team: profile?.team || '', name: profile?.displayName || user?.displayName || 'Someone' }
  return id ? <ListView key={id} id={id} me={me} /> : <Lists me={me} canCreate={canCreate} />
}

// ── The lists ──────────────────────────────────────────────────────────────────────────────────────

const sharedWith = (l) => Math.max(0, (l.people || []).filter((u) => u !== l.createdBy).length) + (l.teams || []).length

function Lists({ me, canCreate }) {
  const [lists, setLists] = useState(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState('') // '' | 'new' (by hand) | 'sheet' (from a spreadsheet)
  const [toastMsg, toast] = useToast()

  useEffect(() => {
    try { return watchLists(me, setLists, (e) => setError(readError(e, 'to read the checklists'))) } catch (e) { setError(readError(e, 'to read the checklists')) }
  }, [me.uid, me.team])

  return (
    <div className="cl-page">
      <div className="cl-head">
        <div>
          <h1 className="cl-title">Checklists</h1>
          <p className="cl-sub">Things to check on equipment, ticked off by a team: a software upgrade, planned maintenance, a test round. You see the ones you made or that were shared with you.</p>
        </div>
        {canCreate && (
          <div className="cl-head-actions">
            <Button iconLeft={<Plus size={18} />} onClick={() => setCreating('new')}>New checklist</Button>
            <Button variant="secondary" iconLeft={<FileSpreadsheet size={18} />} onClick={() => setCreating('sheet')}>From a spreadsheet</Button>
          </div>
        )}
      </div>
      {error && <Alert tone="critical" title="Not everything loaded">{error}</Alert>}
      {lists === null && !error && <Loading />}
      {lists?.length === 0 && (
        <div className="cl-empty">
          <p><b>No checklists here yet.</b></p>
          <p>{canCreate
            ? 'Choose New checklist to make one by hand, or From a spreadsheet to load a device export (.xlsx or .csv). Then share it with the people doing the job.'
            : 'Someone shares a checklist with you, or attaches one to an ask, and it appears here. An admin, or someone in the Engineers or Management team, makes them.'}</p>
        </div>
      )}
      {!!lists?.length && (
        <ul className="cl-lists">
          {lists.map((l) => (
            <li key={l.id}>
              <a className="cl-list-card" href={`#/${encodeURIComponent(l.id)}`}>
                <span className="cl-list-name">{l.name}</span>
                <span className="cl-list-meta">{l.total ?? '…'} devices · {stepsOf(l).length} {stepsOf(l).length === 1 ? 'step' : 'steps'}</span>
                <span className="cl-list-meta">
                  {l.createdBy === me.uid
                    ? (sharedWith(l) ? `Yours, shared with ${sharedWith(l)}` : 'Yours, not shared')
                    : `Shared with you by ${l.createdByName || 'someone'}`}
                </span>
                <span className="cl-list-meta">Started {stamp(l.createdAt) || 'just now'}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      {creating && (() => {
        const done = (msg, newId) => { setCreating(''); if (msg) toast(msg); if (newId) location.hash = '#/' + encodeURIComponent(newId) }
        return creating === 'new' ? <NewDialog by={me} onClose={done} /> : <ImportDialog by={me} onClose={done} />
      })()}
      <Toast message={toastMsg} />
    </div>
  )
}

// ── One list ───────────────────────────────────────────────────────────────────────────────────────

const COLUMNS = [
  ['department', 'Department'], ['name', 'Device'], ['serial', 'Serial number'], ['status', 'Status'],
  ['location', 'Last location'], ['version', 'Software'], ['result', 'Progress'],
]
const SORT_LABELS = { department: 'Department', facility: 'Facility', status: 'Status', serial: 'Serial number', name: 'Device name', location: 'Last location', version: 'Software version', lastSeen: 'Last seen', result: 'Progress' }

function ListView({ id, me }) {
  const by = me
  const [items, setItems] = useState(null)
  const [meta, setMeta] = useState({ pending: 0, fromCache: false })
  const [lists, setLists] = useState(null)
  const [error, setError] = useState('')
  // What was filtered and sorted last time on this list, on this device: it stays until the person clears it.
  const [view0] = useState(() => loadView(id, Object.keys(SORT_LABELS)))
  const [f, setF] = useState(view0.f)
  const [sort, setSort] = useState(view0.sort)
  useEffect(() => { saveView(id, f, sort) }, [id, f, sort])
  const [openId, setOpenId] = useState('')
  const [dialog, setDialog] = useState('') // import | export | rename | add | share | steps
  const [more, setMore] = useState(false) // the filters under the search box, on a phone
  const [manage, setManage] = useState(false) // the owner's less-used buttons, on a phone
  const [prefill, setPrefill] = useState(null) // what a scan that found nothing knows about the device to add
  const [toastMsg, toast] = useToast()
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    try {
      const a = watchItems(id, (rows, m) => { setItems(rows); setMeta(m) }, (e) => setError(readError(e, 'to read this checklist')))
      const b = watchLists(me, setLists, () => {})
      return () => { a(); b() }
    } catch (e) { setError(readError(e, 'to read this checklist')) }
  }, [id, me.uid, me.team])

  const list = lists?.find((l) => l.id === id)
  const isOwner = !!list && list.createdBy === me.uid
  const steps = stepsOf(list)
  const multi = steps.length > 1
  const all = items || []
  const summary = useMemo(() => summarise(all, steps), [all, steps])
  const shared = useMemo(() => sharedSerials(all), [all])
  const shown = useMemo(() => sortItems(filterItems(all, f, steps), sort.key, sort.dir, steps), [all, f, sort, steps])
  const grouped = sort.key === 'department'
  // What a device found on site is most likely to be: the commonest type and model on the list.
  const common = useMemo(() => {
    const top = (k) => { const n = new Map(); all.forEach((x) => x[k] && n.set(x[k], (n.get(x[k]) || 0) + 1)); return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] || '' }
    return { category: top('category'), model: top('model') }
  }, [all])
  const groups = useMemo(() => (grouped ? groupByDepartment(shown) : [{ department: null, items: shown }]), [grouped, shown])
  const deptTotals = useMemo(() => new Map(summary.departments.map((d) => [d.name, d])), [summary])
  const statuses = STATUS_ORDER.filter((s) => summary.byStatus[s]).concat(Object.keys(summary.byStatus).filter((s) => !STATUS_ORDER.includes(s)))

  const sortBy = (key) => setSort((s) => ({ key, dir: s.key === key ? -s.dir : 1 }))
  const filtered = f.q || f.status.length || f.department.length || f.facility.length || f.version.length || f.missing.length || f.show !== 'all'

  async function run(promise, failed = 'Not saved') {
    try { await promise } catch (e) { toast(e?.code === 'permission-denied' ? 'Not saved: the database refused it. The checklists rule may not be published yet.' : `${failed}: ${e?.message || e}`) }
  }
  // Tick or untick one step on one device.
  const toggle = (it, step, on) => run(setStep(id, it, step.id, on, by))
  // The big box on a one-step list does its only step.
  const bigStep = mainOf(steps) || steps[0]
  const tick = (it) => toggle(it, bigStep, !tickOf(it, bigStep.id))

  async function deleteList() {
    if (!(await confirm({ title: `Delete “${list?.name || 'this checklist'}”?`, message: `All ${all.length} devices and everyone’s ticks on it will be removed, for everyone it is shared with. This can’t be undone. Export it first if you need a copy.`, confirmLabel: 'Delete the checklist', danger: true }))) return
    try { await removeList(id, all.map((x) => x.id)); location.hash = '#/' } catch (e) { toast(readError(e, 'to delete the checklist')) }
  }

  const back = <a className="cl-back" href="#/"><ArrowLeft size={16} /> All checklists</a>
  if (error) return <div className="cl-page">{back}<Alert tone="critical" title="This checklist didn’t load">{error}</Alert></div>
  if (items === null || lists === null) return <div className="cl-page"><Loading /></div>
  if (!list) return <div className="cl-page">{back}<div className="cl-empty"><p><b>This checklist isn’t here.</b></p><p>It may have been deleted, or it hasn’t been shared with you. Ask whoever made it.</p></div></div>

  const open = all.find((x) => x.id === openId)
  const pct = summary.total ? Math.round((summary.done / summary.total) * 100) : 0
  const tiles = [['todo', 'To do', summary.todo], ['done', 'Done', summary.done], ['notfound', 'Couldn’t find', summary.notfound], ['all', 'All devices', summary.total]]
  const activeFilters = [f.department, f.facility, f.status, f.version, f.missing].filter((x) => x.length).length
  const nameOf = { department: (v) => (v === NO_DEPARTMENT ? NO_DEPT_LABEL : v), facility: (v) => (v === NO_DEPARTMENT ? 'No facility' : v), version: (v) => (v === NO_DEPARTMENT ? 'Unknown' : v), status: (v) => v, missing: (v) => steps.find((s) => s.id === v)?.label || v }
  // One chip a filter that is on, so it is plain what the list is narrowed by and each can be taken off on its own.
  const activeChips = [
    ...[['facility', 'Facility'], ['department', 'Department'], ['status', 'Status'], ['version', 'Software'], ['missing', 'Missing step']]
      .filter(([k]) => f[k].length)
      .map(([k, label]) => ({ key: k, label, text: f[k].map(nameOf[k]).join(', '), clear: () => setF({ ...f, [k]: [] }) })),
    ...(f.q ? [{ key: 'q', label: 'Search', text: `“${f.q}”`, clear: () => setF({ ...f, q: '' }) }] : []),
    ...(f.show !== 'all' ? [{ key: 'show', label: 'Showing', text: { todo: 'To do', done: 'Done', notfound: 'Couldn’t find' }[f.show], clear: () => setF({ ...f, show: 'all' }) }] : []),
  ]

  return (
    <div className="cl-page">
      {back}
      <div className="cl-head">
        <div>
          <h1 className="cl-title">{list.name}</h1>
          <p className="cl-sub">
            {summary.total} devices · {summary.uniqueSerials} different serial numbers
            {all.some((x) => x.addedOnSite) ? ` · ${all.filter((x) => x.addedOnSite).length} found on site` : ''}
            {isOwner ? (sharedWith(list) ? ` · shared with ${sharedWith(list)}` : ' · not shared') : ` · shared with you by ${list.createdByName || 'someone'}`}
          </p>
        </div>
        <div className="cl-head-actions">
          <Button size="sm" className="cl-add-head" iconLeft={<Plus size={16} />} onClick={() => { setPrefill(null); setDialog('add') }}>Add a device</Button>
          <Button variant="secondary" size="sm" className="cl-scan-head" iconLeft={<ScanBarcode size={16} />} onClick={() => setDialog('scan')}>Scan</Button>
          <Button variant="secondary" size="sm" iconLeft={<Download size={16} />} onClick={() => setDialog('export')}>Export</Button>
          {isOwner && <Button variant="secondary" size="sm" iconLeft={<Share2 size={16} />} onClick={() => setDialog('share')}>Share</Button>}
          {isOwner && <Button variant="ghost" size="sm" className="cl-manage-toggle" aria-expanded={manage} onClick={() => setManage(!manage)}>Manage</Button>}
          {isOwner && (
            <span className={`cl-manage${manage ? ' open' : ''}`}>
              <Button variant="ghost" size="sm" onClick={() => setDialog('many')}>Add several</Button>
              <Button variant="ghost" size="sm" onClick={() => setDialog('steps')}>Steps ({steps.length})</Button>
              <Button variant="ghost" size="sm" iconLeft={<FileSpreadsheet size={16} />} onClick={() => setDialog('import')}>Update from spreadsheet</Button>
              <Button variant="ghost" size="sm" onClick={() => setDialog('rename')}>Rename</Button>
              <Button variant="ghost" size="sm" className="cl-del" iconLeft={<Trash2 size={16} />} onClick={deleteList}>Delete</Button>
            </span>
          )}
        </div>
      </div>

      <div className="cl-progress">
        <div className="cl-progress-top">
          <b>{summary.done} of {summary.total} done</b>
          <span>{pct}%{summary.notfound ? ` · ${summary.notfound} couldn’t find` : ''}</span>
          {filtered && <button type="button" className="cl-flag" onClick={() => setF(NO_FILTER)} title="Clear every filter">Filtered: {shown.length} of {summary.total} <X size={14} aria-hidden="true" /></button>}
          <span className={`cl-sync${meta.pending ? ' wait' : ''}`} role="status">
            {meta.pending ? `${meta.pending} waiting to sync` : meta.fromCache ? 'Offline: showing the last copy' : 'All saved'}
          </span>
        </div>
        <div className="cl-bar" role="progressbar" aria-valuemin={0} aria-valuemax={summary.total} aria-valuenow={summary.done} aria-label="Devices done">
          <span className="cl-bar-done" style={{ width: `${summary.total ? (summary.done / summary.total) * 100 : 0}%` }} />
          <span className="cl-bar-lost" style={{ width: `${summary.total ? (summary.notfound / summary.total) * 100 : 0}%` }} />
        </div>
        {multi && (
          <div className="cl-steps-line">
            {steps.map((st) => <span key={st.id}>{st.label} <b>{summary.stepCounts[st.id]}</b></span>)}
          </div>
        )}
      </div>

      {meta.pending > 0 && <Alert tone="info" title="Waiting to sync">Your ticks are saved on this device and will go to everyone else when there is a signal. Keep this page open until it says All saved.</Alert>}
      {summary.sharedSerials > 0 && (
        <p className="cl-info">{summary.sharedSerials} serial number{summary.sharedSerials === 1 ? ' is' : 's are'} on more than one device (separate Device IDs, so separate visits). Tagged “Same serial”.</p>
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
          <input className="input" type="search" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Device name, serial, location, IP, note or who ticked" autoComplete="off" />
        </label>
        <button type="button" className={`btn btn-secondary btn-sm cl-filters-toggle${activeFilters ? ' on' : ''}`} aria-expanded={more} onClick={() => setMore(!more)}>
          Filters and sort{activeFilters ? ` (${activeFilters})` : ''}
        </button>
        <div className={`cl-more${more ? ' open' : ''}`}>
          {summary.facilities.length > 1 && (
            <MultiSelect label="Facility" all={`All facilities (${summary.facilities.length})`} noun={['facility', 'facilities']} selected={f.facility} onChange={(v) => setF({ ...f, facility: v })}
              options={summary.facilities.map((x) => ({ value: x.name || NO_DEPARTMENT, label: `${x.name || 'No facility'} (${x.count})` }))} />
          )}
          <MultiSelect label="Department" all={`All departments (${summary.departments.length})`} noun={['department', 'departments']} selected={f.department} onChange={(v) => setF({ ...f, department: v })}
            options={summary.departments.map((d) => ({ value: d.name || NO_DEPARTMENT, label: `${d.name || NO_DEPT_LABEL} (${d.total - d.done - d.notfound} to do of ${d.total})` }))} />
          <MultiSelect label="Status" all="Any status" noun={['status', 'statuses']} selected={f.status} onChange={(v) => setF({ ...f, status: v })}
            options={statuses.map((s) => ({ value: s, label: `${s} (${summary.byStatus[s]})` }))} />
          {multi && (
            <MultiSelect label="Missing a step" all="Any step" noun={['step', 'steps']} selected={f.missing} onChange={(v) => setF({ ...f, missing: v })}
              options={steps.map((st) => ({ value: st.id, label: `Missing: ${st.label} (${all.filter((x) => stateOf(x, steps) !== 'lost' && !tickOf(x, st.id)).length})` }))} />
          )}
          {summary.versions.length > 1 && (
            <MultiSelect label="Software version" all="Any version" noun={['version', 'versions']} selected={f.version} onChange={(v) => setF({ ...f, version: v })}
              options={summary.versions.map((v) => ({ value: v.name || NO_DEPARTMENT, label: `${v.name || 'Unknown'} (${v.count})` }))} />
          )}
          <div className="field cl-sort">
            <span className="field-label">Sort by</span>
            <div className="cl-sort-row">
              <select value={sort.key} onChange={(e) => setSort({ key: e.target.value, dir: 1 })} aria-label="Sort by">
                {Object.entries(SORT_LABELS).map(([k, label]) => <option key={k} value={k}>Sort: {label}</option>)}
              </select>
              <button type="button" className="icon-btn icon-btn-md" aria-label={sort.dir > 0 ? 'Ascending: switch to descending' : 'Descending: switch to ascending'}
                title={sort.dir > 0 ? 'A to Z' : 'Z to A'} onClick={() => setSort({ ...sort, dir: -sort.dir })}>
                {sort.dir > 0 ? <ArrowUp size={18} /> : <ArrowDown size={18} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {filtered && (
        <div className="cl-active" aria-label="Filters that are on">
          <span className="cl-active-title">Filters on:</span>
          {activeChips.map((c) => (
            <button key={c.key} type="button" className="cl-chip-btn" onClick={c.clear} title={`Remove this filter: ${c.label}`}>
              <b>{c.label}</b> {c.text}<X size={14} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="cl-link" onClick={() => setF(NO_FILTER)}>Clear all filters</button>
        </div>
      )}
      <div className={`cl-count${filtered ? ' filtered' : ''}`}>
        <span>Showing {shown.length} of {summary.total}{filtered ? ' (filtered)' : ''}</span>
        {filtered && <button type="button" className="cl-link" onClick={() => setF(NO_FILTER)}>Clear filters</button>}
      </div>

      <div className="data-table-wrap">
        <table className="data-table cl-table">
          <thead>
            <tr>
              <th className="cl-check-col"><span className="sr-only">Done</span></th>
              {COLUMNS.filter(([k]) => !(grouped && k === 'department')).map(([k, label]) => (
                <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
                  <button type="button" className="data-table-sort" onClick={() => sortBy(k)}>{k === 'result' && multi ? 'Steps' : label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}</button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g.department ?? 'all'} group={g} grouped={grouped} total={deptTotals.get(g.department || '')} shared={shared} steps={steps}
                onTick={tick} onToggle={toggle} onOpen={setOpenId} />
            ))}
          </tbody>
        </table>
        {!shown.length && <p className="data-table-empty">{all.length ? 'No devices match. Clear the filters to see them all.' : (isOwner ? 'This checklist has no devices yet. Add them with Add a device or Add several, or load a spreadsheet from Manage.' : 'This checklist has no devices yet.')}</p>}
      </div>

      <Button className="cl-fab" iconLeft={<Plus size={20} />} onClick={() => { setPrefill(null); setDialog('add') }}>Add device</Button>
      <button type="button" className="cl-fab-scan" aria-label="Scan a device" title="Scan a device" onClick={() => setDialog('scan')}><ScanBarcode size={24} aria-hidden="true" /></button>
      {dialog === 'scan' && (
        <Suspense fallback={null}>
          <Scan listId={id} items={all} steps={steps} onToggle={toggle} onClose={() => setDialog('')}
            onOpen={(oid) => { setDialog(''); setOpenId(oid) }}
            onAdd={(p) => { setPrefill(p); setDialog('add') }} />
        </Suspense>
      )}
      {dialog === 'add' && (
        <AddDialog plain={isOwner && !!list.manual} items={all} steps={steps} by={by} listId={id} run={run} defaults={{ ...common, ...(prefill || {}), department: f.department.length === 1 && f.department[0] !== NO_DEPARTMENT ? f.department[0] : '' }}
          onOpen={setOpenId} onClose={(msg) => { setDialog(''); if (msg) toast(msg) }} />
      )}
      {open && (
        <DetailDialog it={open} steps={steps} shared={shared.has((open.serial || '').toLowerCase())} canRemove={isOwner || (open.addedOnSite && open.addedBy === me.uid)} by={by} listId={id} run={run}
          onClose={() => setOpenId('')}
          onRemove={async () => {
            if (!(await confirm({ title: `Remove ${open.name || open.serial} from this checklist?`, message: 'Importing a spreadsheet that still has it will add it back.', confirmLabel: 'Remove', danger: true }))) return
            setOpenId('')
            run(removeItem(id, open.id), 'Not removed')
          }} />
      )}
      {dialog === 'export' && <ExportDialog name={list.name} all={all} shown={shown} steps={steps} filtered={filtered} onClose={(msg) => { setDialog(''); if (msg) toast(msg) }} />}
      {dialog === 'import' && <ImportDialog by={by} list={list} existingIds={all.map((x) => x.id)} onClose={(msg) => { setDialog(''); if (msg) toast(msg) }} />}
      {dialog === 'rename' && <RenameDialog name={list.name} onClose={(name) => { setDialog(''); if (name && name !== list.name) run(renameList(id, name)) }} />}
      {dialog === 'share' && (
        <ShareDialog list={list} me={me} run={run} onClose={(msg) => { setDialog(''); if (msg) toast(msg) }}
          onNotified={(out) => toast(`Shared. ${out.pushed} ${out.pushed === 1 ? 'person' : 'people'} told${out.unreached ? `, ${out.unreached} without notifications on` : ''}.`)} />
      )}
      {dialog === 'many' && <AddManyDialog items={all} defaults={common} listId={id} run={run} onClose={(msg) => { setDialog(''); if (msg) toast(msg) }} />}
      {dialog === 'steps' && <StepsDialog list={list} steps={steps} summary={summary} run={run} onClose={(msg) => { setDialog(''); if (msg) toast(msg) }} />}
      {confirmDialog}
      <Toast message={toastMsg} />
    </div>
  )
}

function GroupRows({ group, grouped, total, shared, steps, onTick, onToggle, onOpen }) {
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
      {group.items.map((it) => (
        <DeviceRow key={it.id} it={it} steps={steps} grouped={grouped} shared={shared.has((it.serial || '').toLowerCase())} onTick={onTick} onToggle={onToggle} onOpen={onOpen} />
      ))}
    </>
  )
}

function DeviceRow({ it, steps, grouped, shared, onTick, onToggle, onOpen }) {
  const state = stateOf(it, steps)
  const done = state === 'done'
  const lost = state === 'lost'
  const multi = steps.length > 1
  const main = mainOf(steps)
  const p = progressOf(it, steps)
  const last = latestTick(it, steps)
  return (
    <tr className={`data-table-row cl-row${done ? ' done' : ''}${lost ? ' lost' : ''}`} tabIndex={0} onClick={() => onOpen(it.id)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onOpen(it.id) }}>
      <td className="cl-check-col" data-label="">
        {multi && !main ? (
          <span className={`cl-check cl-progress-box${done ? ' on' : p.ticked ? ' part' : ''}`} aria-label={`${p.ticked} of ${p.total} steps done`}>
            {done ? <Check size={22} strokeWidth={3} aria-hidden="true" /> : `${p.ticked}/${p.total}`}
          </span>
        ) : (
          <button type="button" className={`cl-check${done ? ' on' : p.ticked ? ' part' : ''}`} aria-pressed={done}
            aria-label={`${done ? 'Untick' : 'Tick'} ${main ? main.label : ''} ${it.name || it.serial}`.replace(/\s+/g, ' ')}
            onClick={(e) => { e.stopPropagation(); onTick(it) }}>
            {done && <Check size={22} strokeWidth={3} aria-hidden="true" />}
          </button>
        )}
      </td>
      {!grouped && <td className="cl-c-dept" data-label="Department">{it.department ? <span className={it.deptGuessed ? 'cl-guess' : ''} title={it.deptGuessed ? 'Not in the export: taken from the location' : undefined}>{it.department}</span> : <span className="cl-none">{NO_DEPT_LABEL}</span>}</td>}
      <td className="cl-c-device" data-label="Device">
        <span className="cl-strong">{it.name || '(no name)'}</span>
        <span className="cl-m-serial cl-mono">{it.serial}{shared ? ' · same serial' : ''}</span>
        {it.addedOnSite && <Badge tone="neutral" className="cl-shared">Found on site</Badge>}
        <span className="cl-small">{[it.category, it.model].filter(Boolean).join(' · ')}</span>
      </td>
      <td className="cl-c-serial" data-label="Serial number">
        <span className="cl-mono">{it.serial}</span>
        {shared && <Badge tone="orange" className="cl-shared">Same serial</Badge>}
      </td>
      <td className="cl-c-status" data-label="Status">
        {it.status !== '' && <Badge tone={STATUS_TONE[it.status] || 'neutral'}>{it.status || 'Unknown'}</Badge>}
        {it.statusSince && <span className="cl-small">since {niceStamp(it.statusSince)}</span>}
      </td>
      <td className="cl-c-loc" data-label="Last location">
        {it.location || (it.status === '' ? null : <span className="cl-none">Unknown</span>)}
        {it.lastSeenAt && <span className="cl-small">seen {niceStamp(it.lastSeenAt)}</span>}
        <span className="cl-ver-inline cl-mono">{it.version}</span>
      </td>
      <td className="cl-c-ver" data-label="Software"><span className="cl-mono">{it.version}</span></td>
      <td className="cl-c-result" data-label={multi ? 'Steps' : 'Progress'}>
        {multi && <StepChecks it={it} steps={steps} onToggle={onToggle} />}
        {!multi && done && <Badge tone="green">Done</Badge>}
        {lost && <Badge tone="orange">Couldn’t find</Badge>}
        {last && (done || lost || !multi) && <span className="cl-small">{last.byName}{last.at ? ` · ${stamp(last.at)}` : ''}</span>}
        {it.note && <span className="cl-note" title={it.note}>“{it.note}”</span>}
      </td>
    </tr>
  )
}

// ── One device ─────────────────────────────────────────────────────────────────────────────────────

function DetailDialog({ it, steps, shared, canRemove, by, listId, run, onClose, onRemove }) {
  const [note, setNoteText] = useState(it.note || '')
  const state = stateOf(it, steps)
  const rows = [
    ['Department', it.department ? it.department + (it.deptGuessed ? ' (from the location: not in the export)' : '') : NO_DEPT_LABEL],
    ['Device type', [it.category, it.model].filter(Boolean).join(' · ')],
    ['Serial number', it.serial],
    ['Status', it.status === '' ? '' : (it.status || 'Unknown') + (it.statusSince ? ` since ${niceStamp(it.statusSince)}` : '')],
    ['Last location', it.location],
    ['Last seen', niceStamp(it.lastSeenAt) + (it.lastSeenIn && it.lastSeenIn !== it.location ? ` at ${it.lastSeenIn}` : '')],
    ['Facility', it.facility], ['Room', it.room], ['Bed', it.bed],
    ['Software version', it.versionFull || it.version],
    ['IP address', it.ip], ['Wireless MAC', it.wirelessMac], ['Wired MAC', it.wiredMac], ['Device ID', it.deviceId],
    ['Error', it.error],
    ['Found on site', it.addedOnSite ? `added by ${it.addedByName || 'someone'}` : ''],
  ].filter(([, v]) => v)
  const saveNote = () => { if (note.trim() !== (it.note || '')) run(setNote(listId, it.id, note.trim(), by)) }

  return (
    <Dialog title={it.name || it.serial} description={shared ? 'This serial number is on more than one device in the export.' : undefined} onClose={onClose} width={560}>
      <div className="cl-detail-state">
        {state === 'done' && <Badge tone="green">Done</Badge>}
        {state === 'lost' && <><Badge tone="orange">Couldn’t find</Badge> <span>marked by {it.doneByName}{it.doneAt ? `, ${stamp(it.doneAt)}` : ''}</span></>}
        {state === 'partial' && <Badge tone="purple">{progressOf(it, steps).ticked} of {steps.length} steps</Badge>}
        {state === 'todo' && <Badge tone="neutral">To do</Badge>}
      </div>
      <ul className="cl-step-list">
        {steps.map((st) => {
          const t = tickOf(it, st.id)
          return (
            <li key={st.id}>
              <button type="button" className={`cl-step-row${t ? ' on' : ''}`} aria-pressed={!!t} onClick={() => run(setStep(listId, it, st.id, !t, by))}>
                <span className="cl-check">{t && <Check size={20} strokeWidth={3} aria-hidden="true" />}</span>
                <span className="cl-step-label">{st.label}{st.main && <span className="cl-main-tag">Main step</span>}</span>
                {t && <span className="cl-small">{t.byName || 'someone'}{t.at ? ` · ${stamp(t.at)}` : ''}</span>}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="cl-detail-actions">
        {state !== 'lost' && <Button variant="secondary" onClick={() => run(markLost(listId, it.id, by))}>Couldn’t find it</Button>}
        {state !== 'todo' && <Button variant="ghost" onClick={() => run(resetItem(listId, it.id))}>Back to to do</Button>}
      </div>
      <label className="field"><span className="field-label">Note{it.noteByName && it.note ? ` (by ${it.noteByName})` : ''}</span>
        <textarea className="input" rows={2} value={note} onChange={(e) => setNoteText(e.target.value)} onBlur={saveNote} placeholder="Where it was, what you did, anything the next person should know" />
      </label>
      <dl className="cl-detail">
        {rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
      </dl>
      <div className="dialog-actions">
        {canRemove && <Button variant="ghost" className="cl-del" iconLeft={<Trash2 size={18} />} onClick={onRemove}>Remove from list</Button>}
        <Button variant="secondary" onClick={() => { saveNote(); onClose() }}>Close</Button>
      </div>
    </Dialog>
  )
}

function RenameDialog({ name, onClose }) {
  const [v, setV] = useState(name)
  return (
    <Dialog title="Rename the checklist" onClose={() => onClose('')} width={440}>
      <form onSubmit={(e) => { e.preventDefault(); onClose(v.trim()) }}>
        <label className="field"><span className="field-label">Name</span>
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

// ── Who it is shared with ──────────────────────────────────────────────────────────────────────────

/** The owner chooses the people and teams who see the list: they tick, add devices and export; only the owner changes the list itself. */
function ShareDialog({ list, me, run, onClose, onNotified }) {
  const [users, setUsers] = useState([])
  const [people, setPeople] = useState(() => (list.people || []).filter((u) => u !== me.uid))
  const [teams, setTeams] = useState(list.teams || [])
  const [q, setQ] = useState('')
  useEffect(() => { try { return watchPeople(setUsers, () => {}) } catch { return undefined } }, [])
  const nameOf = (uid) => users.find((u) => u.uid === uid)?.name || 'Someone'
  const hits = q.trim()
    ? users.filter((u) => u.uid !== me.uid && !people.includes(u.uid) && (u.name + ' ' + u.team).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8)
    : []
  const link = `${location.origin}/checklists/#/${encodeURIComponent(list.id)}`
  async function copy() {
    try { await navigator.clipboard.writeText(link); onClose('Link copied.') } catch { window.prompt('Copy this link', link) }
  }
  function save() {
    // Once the sharing has reached the server, the people who can now see it and haven't been told get a push.
    run(saveSharing(list.id, { people: [me.uid, ...people], teams })
      .then(() => (people.length + teams.length ? notifyShared(list.id) : null))
      .then((out) => { if (out?.success && out.people) onNotified(out) }), 'Not shared')
    onClose(people.length + teams.length ? 'Shared.' : 'Now only you can see it.')
  }
  return (
    <Dialog title="Share this checklist" onClose={() => onClose('')} width={560}
      description="Only you and the people and teams below can see it. They can tick devices, add ones they find and export the list. Only you can change the steps, import, share or delete it. New people are sent a notification.">
      <div className="cl-share">
        <label className="field"><span className="field-label">Add a person</span>
          <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Start typing a name" autoComplete="off" />
        </label>
        {hits.length > 0 && (
          <ul className="cl-share-hits">
            {hits.map((u) => <li key={u.uid}><button type="button" onClick={() => { setPeople([...people, u.uid]); setQ('') }}><Plus size={14} aria-hidden="true" /> {u.name}<span>{u.team}</span></button></li>)}
          </ul>
        )}
        {!!people.length && (
          <div className="cl-chips" aria-label="People it is shared with">
            {people.map((uid) => (
              <span key={uid} className="cl-chip">{nameOf(uid)}
                <button type="button" aria-label={`Stop sharing with ${nameOf(uid)}`} onClick={() => setPeople(people.filter((x) => x !== uid))}><X size={14} /></button>
              </span>
            ))}
          </div>
        )}
        <fieldset className="cl-teams"><legend className="field-label">Whole teams</legend>
          {TEAMS.map((t) => (
            <label key={t} className="cl-radio"><input type="checkbox" checked={teams.includes(t)} onChange={(e) => setTeams(e.target.checked ? [...teams, t] : teams.filter((x) => x !== t))} /> {t}</label>
          ))}
        </fieldset>
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" iconLeft={<Link2 size={16} />} onClick={copy}>Copy link</Button>
        <Button variant="ghost" onClick={() => onClose('')}>Cancel</Button>
        <Button onClick={save}>Save</Button>
      </div>
    </Dialog>
  )
}

// ── What has to be ticked ──────────────────────────────────────────────────────────────────────────

/** The owner's steps: add every one that has to happen on a device, so none gets missed. */
function StepsDialog({ list, steps, summary, run, onClose }) {
  const [rows, setRows] = useState(steps.map((s) => ({ ...s })))
  const set = (i, label) => setRows(rows.map((r, j) => (j === i ? { ...r, label } : r)))
  const setMain = (i) => setRows(rows.map((r, j) => ({ ...r, main: j === i })))
  const move = (i, d) => { const a = [...rows]; const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setRows(a) }
  const clean = rows.map((r) => ({ id: r.id, label: r.label.replace(/\s+/g, ' ').trim().slice(0, 60), ...(r.main ? { main: true } : {}) })).filter((r) => r.label)
  function save() {
    if (!clean.length) return
    run(saveSteps(list.id, clean), 'Steps not saved')
    onClose('Steps saved.')
  }
  return (
    <Dialog title="Steps on every device" onClose={() => onClose('')} width={560}
      description="Everything that has to happen on each device, in order, for example Software upgraded, then Changed config. Choose one as the main step and a device is done as soon as that one is ticked, whatever else is; with none chosen, every step has to be ticked.">
      <ol className="cl-steps-edit">
        {rows.map((r, i) => (
          <li key={r.id}>
            <input className="input" value={r.label} maxLength={60} onChange={(e) => set(i, e.target.value)} aria-label={`Step ${i + 1}`} placeholder="What has to be done" />
            {rows.length > 1 && <label className="cl-main-pick" title="Done when this step is ticked"><input type="radio" name="main-step" checked={!!r.main} onChange={() => setMain(i)} aria-label={`Make step ${i + 1} the main step`} /> Main</label>}
            <span className="cl-small">{summary.stepCounts[r.id] ? `${summary.stepCounts[r.id]} ticked` : ''}</span>
            <button type="button" className="icon-btn icon-btn-md" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={16} /></button>
            <button type="button" className="icon-btn icon-btn-md" aria-label="Move down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown size={16} /></button>
            <button type="button" className="icon-btn icon-btn-md" aria-label="Remove this step" disabled={rows.length === 1} onClick={() => setRows(rows.filter((_, j) => j !== i))}><X size={16} /></button>
          </li>
        ))}
      </ol>
      {rows.length < MAX_STEPS && <Button variant="secondary" size="sm" iconLeft={<Plus size={16} />} onClick={() => setRows([...rows, { id: newStepId('step', rows.map((x) => x.id)), label: '' }])}>Add a step</Button>}
      {rows.some((r) => r.main) && <Button variant="ghost" size="sm" onClick={() => setRows(rows.map((r) => ({ ...r, main: false })))}>No main step: every step must be ticked</Button>}
      <p className="cl-info">{rows.some((r) => r.main) ? 'The main step is what makes a device done; the others are still tracked and exported.' : 'A device is done when every step is ticked.'} Adding a step makes devices that were done show as in progress until it is ticked. Removing one takes it off the list; its ticks stay saved if you add it back.</p>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={() => onClose('')}>Cancel</Button>
        <Button disabled={!clean.length} onClick={save}>Save</Button>
      </div>
    </Dialog>
  )
}

// ── A checklist made by hand ─────────────────────────────────────────────────────────────────────────

/** A checklist with no spreadsheet: its name, the steps, and optionally the first items typed or pasted from Excel. */
function NewDialog({ by, onClose }) {
  const [name, setName] = useState('')
  const [stepText, setStepText] = useState('Done')
  const [itemText, setItemText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const steps = stepsFromText(stepText)
  const devices = parseManualLines(itemText)

  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const id = await createList({ name: name.trim(), devices, by, steps: steps.length ? steps : DEFAULT_STEPS, manual: true })
      onClose(devices.length ? `Checklist made with ${devices.length} items.` : 'Checklist made. Add items with Add a device or Add several.', id)
    } catch (err) {
      setError(readError(err, 'to make the checklist').replace(/^Could not /, 'Not made: could not '))
      setBusy(false)
    }
  }

  return (
    <Dialog title="New checklist" width={620} onClose={() => !busy && onClose('')}
      description="Make a checklist from scratch: name it, say what has to be ticked, and add the things to check now or later.">
      <form onSubmit={save} className="cl-form">
        <label className="field"><span className="field-label">Name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Annual PM, Waikato Hospital" autoComplete="off" />
        </label>
        <label className="field"><span className="field-label">What has to be ticked on each one? One step a line</span>
          <textarea className="input" rows={3} value={stepText} onChange={(e) => setStepText(e.target.value)} placeholder={'Visual check\nElectrical safety test\nAlarm test'} />
        </label>
        <p className="cl-info">{steps.length > 1 ? `${steps.length} steps: done when all are ticked, or when the main step is, if you choose one later (Steps).` : 'One step. Add more any time with Steps.'}</p>
        <label className="field"><span className="field-label">Items to check (optional): one a line, or paste from Excel</span>
          <textarea className="input" rows={5} value={itemText} onChange={(e) => setItemText(e.target.value)}
            placeholder={'Name, serial number, department, location\nBed 1 monitor, S-100, ICU, Bay 2\nBed 2 monitor, S-101, ICU, Bay 2'} />
        </label>
        {itemText.trim() && <p className="cl-info">{devices.length} {devices.length === 1 ? 'item' : 'items'} found.</p>}
        {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" disabled={busy} onClick={() => onClose('')}>Cancel</Button>
          <Button type="submit" disabled={busy || !name.trim()}>{busy ? 'Working…' : 'Make the checklist'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** More items for the owner of a list: typed or pasted, one a line. Ones already on the list (same serial or name) are left out. */
function AddManyDialog({ items, defaults, listId, run, onClose }) {
  const [text, setText] = useState('')
  const fresh = newOnly(parseManualLines(text, { category: defaults.category, model: defaults.model }), items)
  const total = parseManualLines(text).length
  function save(e) {
    e.preventDefault()
    if (!fresh.length) return
    // Not waited for, like a tick: with no signal it is kept on this device and sent later.
    run(addDevices(listId, fresh, items.length), 'Not added')
    onClose(`Added ${fresh.length} ${fresh.length === 1 ? 'item' : 'items'}.`)
  }
  return (
    <Dialog title="Add several items" width={620} onClose={() => onClose('')}
      description="One a line: name, then serial number, department and location, separated by commas or tabs. You can paste straight from Excel.">
      <form onSubmit={save} className="cl-form">
        <textarea className="input" rows={8} value={text} onChange={(e) => setText(e.target.value)} aria-label="Items, one a line"
          placeholder={'Bed 3 monitor, S-102, ICU, Bay 3\nBed 4 monitor, S-103, ICU, Bay 3'} />
        {text.trim() && (
          <p className="cl-info">
            {fresh.length} new {fresh.length === 1 ? 'item' : 'items'}{total > fresh.length ? `, ${total - fresh.length} already on the list or repeated, left out` : ''}.
          </p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onClose('')}>Cancel</Button>
          <Button type="submit" disabled={!fresh.length} iconLeft={<Plus size={18} />}>Add {fresh.length || ''} {fresh.length === 1 ? 'item' : 'items'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ── A device found on site ───────────────────────────────────────────────────────────────────────────

/** Anyone who can see the list can add a device the spreadsheet didn't list. It goes on at once, and the team sees it. */
function AddDialog({ plain = false, items, steps, by, listId, run, defaults, onOpen, onClose }) {
  const [v, setV] = useState({ name: defaults.name || '', serial: '', department: defaults.department, location: '', status: 'Working', version: '', note: '' })
  const [ticked, setTicked] = useState([])
  const [err, setErr] = useState('')
  const set = (k) => (e) => { setV({ ...v, [k]: e.target.value }); setErr('') }
  const dupe = findBySerial(items, v.serial)
  const distinct = (k) => [...new Set(items.map((x) => x[k]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))

  function save(e) {
    e.preventDefault()
    // An item the owner of a list made by hand adds is theirs, not found on site: no status, and an id that is not found-…
    const out = newDevice(plain ? { ...v, status: '' } : v, { category: defaults.category, model: defaults.model })
    if (out.error) { setErr(out.error); return }
    if (plain) out.device.id = out.device.id.replace(/^found-/, 'manual-')
    // Not waited for: with no signal the write is kept on this device and sent later, and the device is on the list already.
    run(addDevice(listId, out.device, { note: out.note, stepIds: ticked, plain }, by), 'Not added')
    onClose(`Added ${out.device.name || out.device.serial}${ticked.length ? ' with its ticks' : ''}.`)
  }

  return (
    <Dialog title="Add a device" description="Found one that isn’t on the list? Add it so it’s counted, and the rest of the team can see it." onClose={() => onClose('')} width={600}>
      <form onSubmit={save} className="cl-form">
        <div className="cl-form-grid">
          <label className="field"><span className="field-label">Device name</span>
            <input className="input" value={v.name} onChange={set('name')} placeholder="N1-WHA…" autoComplete="off" /></label>
          <label className="field"><span className="field-label">Serial number</span>
            <input className="input" value={v.serial} onChange={set('serial')} placeholder="AA3-…" autoComplete="off" /></label>
          <label className="field"><span className="field-label">Department</span>
            <input className="input" list="cl-depts" value={v.department} onChange={set('department')} placeholder="Where it lives" autoComplete="off" /></label>
          <label className="field"><span className="field-label">{plain ? 'Location' : 'Where you found it'}</span>
            <input className="input" value={v.location} onChange={set('location')} placeholder="Ward, room or bed" autoComplete="off" /></label>
          {!plain && <label className="field"><span className="field-label">Status</span>
            <select value={v.status} onChange={set('status')}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select></label>}
          {!plain && <label className="field"><span className="field-label">Software version</span>
            <input className="input" list="cl-versions" value={v.version} onChange={set('version')} placeholder="If you know it" autoComplete="off" /></label>}
        </div>
        <datalist id="cl-depts">{distinct('department').map((d) => <option key={d} value={d} />)}</datalist>
        <datalist id="cl-versions">{distinct('version').map((d) => <option key={d} value={d} />)}</datalist>
        <label className="field"><span className="field-label">Note</span>
          <textarea className="input" rows={2} value={v.note} onChange={set('note')} placeholder="Anything the next person should know" /></label>
        <fieldset className="cl-teams"><legend className="field-label">{steps.length > 1 ? 'Already done' : 'Already done?'}</legend>
          {steps.map((st) => (
            <label key={st.id} className="cl-radio"><input type="checkbox" checked={ticked.includes(st.id)} onChange={(e) => setTicked(e.target.checked ? [...ticked, st.id] : ticked.filter((x) => x !== st.id))} /> {steps.length > 1 ? st.label : 'It’s already done: tick it'}</label>
          ))}
        </fieldset>
        {dupe && (
          <Alert tone="info" title="That serial number is already on the list"
            action={<Button variant="secondary" size="sm" onClick={() => { onOpen(dupe.id); onClose('') }}>Open it</Button>}>
            {dupe.name || dupe.serial}{dupe.department ? ` in ${dupe.department}` : ''}. You can still add it as a separate device if it is one.
          </Alert>
        )}
        {err && <Alert tone="critical">{err}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={() => onClose('')}>Cancel</Button>
          <Button type="submit" iconLeft={<Plus size={18} />}>{dupe ? 'Add anyway' : 'Add to the list'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Export ─────────────────────────────────────────────────────────────────────────────────────────

function ExportDialog({ name, all, shown, steps, filtered, onClose }) {
  const [which, setWhich] = useState(filtered ? 'shown' : 'all')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const rows = which === 'shown' ? shown : all
  // In the order they are on screen, so what is exported reads the way it was sorted.
  async function go(kind) {
    setBusy(true); setError('')
    try {
      if (kind === 'xlsx') await downloadXlsx(name, rows, steps); else downloadCsv(name, rows, steps)
      onClose(`${rows.length} devices downloaded as ${kind === 'xlsx' ? 'an Excel file' : 'CSV'}.`)
    } catch (e) { setError('Could not make the file: ' + (e.message || e)); setBusy(false) }
  }
  return (
    <Dialog title="Export the checklist" description="Every device with its status, department, last location, each step with who ticked it and when, and the notes." onClose={() => !busy && onClose('')} width={480}>
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

/** Pick the export, check what it holds, then save: a new checklist, or an update of the one that is open. */
function ImportDialog({ by, list, existingIds = [], onClose }) {
  const [parsed, setParsed] = useState(null)
  const [name, setName] = useState('')
  const [stepText, setStepText] = useState('Done')
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
  const steps = stepsFromText(stepText)

  async function save() {
    setBusy(true); setError('')
    try {
      if (list) {
        const r = await importInto(list.id, parsed.devices, existingIds, by)
        onClose(`${r.added} added, ${r.updated} refreshed. Ticks were kept.`)
      } else {
        const id = await createList({ name: name.trim() || 'Checklist', devices: parsed.devices, by, steps: steps.length ? steps : DEFAULT_STEPS })
        onClose(`Checklist made with ${parsed.devices.length} devices.`, id)
      }
    } catch (err) {
      setError(readError(err, 'to save the checklist').replace(/^Could not /, 'Not saved: could not '))
      setBusy(false)
    }
  }

  return (
    <Dialog title={list ? 'Update from a spreadsheet' : 'New checklist from a spreadsheet'} onClose={() => !busy && onClose('')} width={620}
      description={list
        ? 'Choose a newer export of the same devices. Each device’s status, location and software are refreshed, new ones are added, and nobody’s ticks or notes are touched.'
        : 'Choose the device export (.xlsx or .csv) from the central station. Each row becomes a device on the checklist.'}>
      <div className="cl-import">
        <input ref={input} type="file" accept=".xlsx,.csv" onChange={pick} disabled={busy} aria-label="Spreadsheet file" />
        {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
        {parsed && summary && (
          <>
            <p className="cl-import-line"><b>{parsed.devices.length} devices</b> found · {summary.uniqueSerials} different serial numbers · {summary.departments.length} departments</p>
            {list && <p className="cl-import-line">{added} new to this checklist, {parsed.devices.length - added} already on it.</p>}
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
              <>
                <label className="field"><span className="field-label">Checklist name</span>
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="N1 software upgrade, North Shore" />
                </label>
                <label className="field"><span className="field-label">What has to be ticked on each device? One step a line</span>
                  <textarea className="input" rows={3} value={stepText} onChange={(e) => setStepText(e.target.value)} placeholder={'Software upgraded\nChanged config'} />
                </label>
                <p className="cl-info">{steps.length > 1 ? `${steps.length} steps: a device is done when all of them are ticked.` : 'One step. Add more any time with Steps.'}</p>
              </>
            )}
          </>
        )}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={() => onClose('')}>Cancel</Button>
        <Button disabled={!parsed || busy || (!list && !name.trim())} onClick={save}>{busy ? 'Working…' : list ? 'Update the checklist' : 'Make the checklist'}</Button>
      </div>
    </Dialog>
  )
}
