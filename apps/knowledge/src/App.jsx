/* The knowledge base under Service: articles (quirks, faults, fixes), a parts catalogue, the installed devices and past jobs,
   found with one search box. Everyone signed in reads; admins and people given the editor switch (Settings → People and
   access) add, change, import and remove. Searching is on the device over what is already loaded (model.js): every word of
   the question must be somewhere in the record, so "N17 waikato CCU" lists those devices and the count is the answer. */
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BookOpen, FileSpreadsheet, Plus, Search } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Loading, Toast, useToast } from '../../../shared/ui/index.jsx'
import { canEditKb, countBy, groupFields, KIND_IDS, KINDS, searchRecords } from './model.js'
import { watch } from './store.js'
import { Detail } from './Detail.jsx'
import { Editor, ImportDialog } from './Editor.jsx'

const SHOW = 40 // rows drawn at a time; the rest are a click away
const TABS = [['all', 'All'], ['article', 'Articles'], ['part', 'Parts'], ['device', 'Devices'], ['job', 'Past jobs']]
const PREVIEW = { all: 6 }

export default function App() {
  return (
    <AuthProvider>
      <Page />
    </AuthProvider>
  )
}

const fromHash = () => {
  const m = /^#\/(article|part|device|job)\/([^/?]+)/.exec(location.hash)
  return m ? { kind: m[1], id: decodeURIComponent(m[2]) } : null
}

/** One live list per kind, each started once this page opens. null = not here yet. */
function useLists() {
  const [lists, setLists] = useState({ article: null, part: null, device: null, job: null })
  const [error, setError] = useState('')
  useEffect(() => {
    const stops = KIND_IDS.map((k) => watch(k, (rows) => setLists((l) => ({ ...l, [k]: rows })), (e) => {
      setError(e.code === 'permission-denied'
        ? 'Firestore refused to read the knowledge base. Its security rules may not be published yet.'
        : 'Could not load the knowledge base: ' + (e.message || e))
    }))
    return () => stops.forEach((s) => s())
  }, [])
  return [lists, error]
}

const EMPTY_ORDER = {
  article: (a, b) => (a.title || '').localeCompare(b.title || ''),
  part: (a, b) => (a.partNo || '').localeCompare(b.partNo || '', undefined, { numeric: true }),
  device: (a, b) => (a.site + a.dept + a.model + a.serial).localeCompare(b.site + b.dept + b.model + b.serial, undefined, { numeric: true }),
  job: (a, b) => (b.date || '').localeCompare(a.date || ''),
}

function Page() {
  const { user, profile } = useAuth()
  const canEdit = canEditKb(profile)
  const by = profile?.displayName || user?.email || ''
  const [lists, error] = useLists()
  const [q, setQ] = useState('')
  const [tab, setTab] = useState('all')
  const [more, setMore] = useState(SHOW)
  const [groupBy, setGroupBy] = useState('model')
  const [open, setOpen] = useState(fromHash)
  const [editing, setEditing] = useState(null) // { kind, record? }
  const [importing, setImporting] = useState(false)
  const [toastMsg, toast] = useToast()
  const query = useDeferredValue(q)

  useEffect(() => {
    const on = () => setOpen(fromHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const openItem = (kind, id) => { location.hash = `#/${kind}/${encodeURIComponent(id)}` }
  const closeItem = () => { history.replaceState(null, '', location.pathname + location.search); setOpen(null) }
  useEffect(() => setMore(SHOW), [query, tab])

  const results = useMemo(() => {
    const out = {}
    for (const k of KIND_IDS) out[k] = lists[k] ? (query.trim() ? searchRecords(k, lists[k], query) : [...lists[k]].sort(EMPTY_ORDER[k])) : null
    return out
  }, [lists, query])

  const loaded = KIND_IDS.every((k) => lists[k])
  const total = KIND_IDS.reduce((n, k) => n + (lists[k]?.length || 0), 0)
  const kinds = tab === 'all' ? KIND_IDS : [tab]
  const devices = results.device || []
  const fields = useMemo(() => groupFields(lists.device || []), [lists.device])
  const shownGroup = fields.includes(groupBy) ? groupBy : fields[0]

  const found = open && lists[open.kind]?.find((r) => r.id === open.id)

  return (
    <div className="kb-page">
      <div className="kb-head">
        <div>
          <h1 className="kb-title">Knowledge base</h1>
          <p className="kb-sub">Part numbers and the other names for them, quirks and fixes, what is installed where, and what was done on past jobs. Type any words; every word has to match.</p>
        </div>
        {canEdit && (
          <div className="kb-actions">
            <Button variant="secondary" iconLeft={<FileSpreadsheet size={16} />} onClick={() => setImporting(true)}>Import</Button>
            <Button variant="secondary" iconLeft={<Plus size={16} />} onClick={() => setEditing({ kind: 'part' })}>Add part</Button>
            <Button iconLeft={<Plus size={16} />} onClick={() => setEditing({ kind: 'article' })}>Add article</Button>
          </div>
        )}
      </div>

      <div className="kb-searchrow">
        <Search size={18} className="kb-searchicon" aria-hidden="true" />
        <input className="input kb-search" type="search" autoFocus={window.matchMedia?.('(hover: hover)').matches} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Part number, model, fault, site… e.g. AB-123, N17 waikato ccu, psu" aria-label="Search the knowledge base" enterKeyHint="search" />
        {q && <Button variant="ghost" size="sm" onClick={() => setQ('')}>Clear</Button>}
      </div>

      <div className="kb-tabs" role="tablist" aria-label="What to search">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`kb-tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
            {label}
            <span className="kb-count">{id === 'all' ? KIND_IDS.reduce((n, k) => n + (results[k]?.length || 0), 0) : results[id]?.length ?? '…'}</span>
          </button>
        ))}
      </div>

      {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
      {!error && !loaded && <Loading />}

      {loaded && total === 0 && (
        <Alert tone="info" title="Nothing here yet" icon={<BookOpen size={18} />}>
          {canEdit ? 'Add an article or a part, or Import a parts list, an asset list or past jobs from Excel or CSV.' : 'An admin or editor needs to add the first entries.'}
        </Alert>
      )}

      {loaded && total > 0 && (tab === 'device' || (tab === 'all' && query.trim() && devices.length > 0)) && devices.length > 0 && (
        <div className="card kb-group">
          <div className="kb-group-head">
            <b>{devices.length}</b> device{devices.length === 1 ? '' : 's'}{query.trim() ? ' match' : ' in all'}
            <span className="kb-group-by">
              <label htmlFor="kb-gb">Count by</label>
              <select id="kb-gb" value={shownGroup} onChange={(e) => setGroupBy(e.target.value)}>
                {fields.map((f) => <option key={f} value={f}>{f === 'dept' ? 'department' : f}</option>)}
              </select>
            </span>
          </div>
          <ul className="kb-bars">
            {countBy(devices, shownGroup).slice(0, 12).map(({ value, n }) => (
              <li key={value}>
                <button type="button" className="kb-bar" title="Add to the search" onClick={() => value !== '(blank)' && setQ((q.trim() + ' ' + value).trim())}>
                  <span className="kb-bar-name">{value}</span>
                  <span className="kb-bar-track"><span style={{ width: `${Math.max(4, (n / devices.length) * 100)}%` }} /></span>
                  <b>{n}</b>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loaded && total > 0 && kinds.map((k) => {
        const rows = results[k] || []
        if (tab === 'all' && !rows.length) return null
        const limit = tab === 'all' ? PREVIEW.all : more
        return (
          <section key={k} className="kb-section" aria-label={KINDS[k].label}>
            {tab === 'all' && <h2 className="kb-h2">{KINDS[k].label} <span className="kb-count">{rows.length}</span></h2>}
            {rows.length === 0 && <p className="kb-none">{query.trim() ? `No ${KINDS[k].label.toLowerCase()} match “${query.trim()}”.` : `No ${KINDS[k].label.toLowerCase()} yet.`}</p>}
            <ul className="kb-list">
              {rows.slice(0, limit).map((r) => <li key={r.id}><Row kind={k} rec={r} onOpen={() => openItem(k, r.id)} /></li>)}
            </ul>
            {rows.length > limit && (
              tab === 'all'
                ? <Button variant="ghost" size="sm" onClick={() => setTab(k)}>Show all {rows.length}</Button>
                : <Button variant="ghost" size="sm" onClick={() => setMore((m) => m + SHOW)}>Show {Math.min(SHOW, rows.length - limit)} more ({rows.length - limit} left)</Button>
            )}
          </section>
        )
      })}

      {open && loaded && !found && (
        <Alert tone="warning" title="That entry isn’t here any more" action={<Button variant="ghost" size="sm" onClick={closeItem}>Close</Button>}>It may have been removed.</Alert>
      )}
      {found && (
        <Detail kind={open.kind} rec={found} lists={lists} canEdit={canEdit} onClose={closeItem} onOpen={openItem}
          onEdit={() => { setEditing({ kind: open.kind, record: found }); closeItem() }} onToast={toast} />
      )}
      {editing && <Editor kind={editing.kind} record={editing.record} categories={[...new Set((lists.article || []).map((a) => a.category).filter(Boolean))].sort()} by={by}
        onClose={() => setEditing(null)} onSaved={(kind, id, msg) => { setEditing(null); toast(msg); openItem(kind, id) }} />}
      {importing && <ImportDialog by={by} onClose={() => setImporting(false)} onDone={(msg) => { setImporting(false); toast(msg) }} />}
      <Toast message={toastMsg} />
    </div>
  )
}

const snippet = (s, n = 150) => { const t = String(s || '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n).trimEnd() + '…' : t }

/** One result: enough to recognise it; the rest is in its dialog. */
function Row({ kind, rec, onOpen }) {
  return (
    <button type="button" className="kb-row" onClick={onOpen}>
      {kind === 'article' && (<>
        <span className="kb-row-main"><b>{rec.title}</b>{rec.category && <Badge tone="neutral">{rec.category}</Badge>}</span>
        <span className="kb-row-sub">{snippet(rec.body)}</span>
      </>)}
      {kind === 'part' && (<>
        <span className="kb-row-main"><b className="kb-code">{rec.partNo}</b><span>{rec.name}</span></span>
        <span className="kb-row-sub">{[rec.aliases?.length ? 'Also: ' + rec.aliases.join(', ') : '', rec.fits?.length ? 'Fits: ' + rec.fits.join(', ') : ''].filter(Boolean).join(' · ') || snippet(rec.notes)}</span>
      </>)}
      {kind === 'device' && (<>
        <span className="kb-row-main"><b>{rec.model || rec.serial}</b><span>{[rec.site, rec.dept].filter(Boolean).join(' · ')}</span></span>
        <span className="kb-row-sub">{[rec.serial && 'S/N ' + rec.serial, rec.version && 'v' + rec.version, ...Object.entries(rec.extra || {}).slice(0, 5).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · ')}</span>
      </>)}
      {kind === 'job' && (<>
        <span className="kb-row-main"><b>{rec.jobNo ? `Job ${rec.jobNo}` : 'Job'}</b><span>{rec.title}</span>{rec.date && <span className="kb-date">{rec.date}</span>}</span>
        <span className="kb-row-sub">{[rec.site, snippet(rec.notes, 120)].filter(Boolean).join(' · ')}</span>
      </>)}
    </button>
  )
}
