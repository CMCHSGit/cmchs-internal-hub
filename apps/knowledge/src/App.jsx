/* The knowledge base under Service: articles (quirks, faults, fixes), a parts catalogue, the installed devices and past jobs,
   found with one search box. Everyone signed in reads; admins and people given the editor switch (Settings → People and
   access) add, change, import and remove. Searching is on the device over what is already loaded (model.js): every word of
   the question must be somewhere in the record, so "N17 waikato CCU" lists those devices and the count is the answer. */
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { BookOpen, CheckSquare, FileSpreadsheet, Plus, Search, Trash2 } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Loading, Toast, useToast } from '../../../shared/ui/index.jsx'
import { alsoMatching, canEditKb, countBy, groupFields, highlightRegex, KIND_IDS, KINDS, partInfo, searchRecords, snippet, splitHits } from './model.js'
import { Hl } from './Hl.jsx'
import { BulkRemove } from './Bulk.jsx'
import { watch } from './store.js'
import { Detail, statusTone } from './Detail.jsx'
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
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState(() => new Set()) // 'kind:id'
  const [removing, setRemoving] = useState(false)
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

  const also = useMemo(() => alsoMatching(query), [query])
  const re = useMemo(() => highlightRegex(query), [query])
  const loaded = KIND_IDS.every((k) => lists[k])
  const total = KIND_IDS.reduce((n, k) => n + (lists[k]?.length || 0), 0)
  const kinds = tab === 'all' ? KIND_IDS : [tab]
  const devices = results.device || []
  const fields = useMemo(() => groupFields(lists.device || []), [lists.device])
  const shownGroup = fields.includes(groupBy) ? groupBy : fields[0]

  const found = open && lists[open.kind]?.find((r) => r.id === open.id)
  const toggle = (key) => setPicked((p) => { const n = new Set(p); n.has(key) ? n.delete(key) : n.add(key); return n })
  // the picked entries as { kind: [records] }, for the removal dialog (an entry that has gone since is left out)
  const pickedGroups = useMemo(() => Object.fromEntries(KIND_IDS.map((k) => [k, (lists[k] || []).filter((r) => picked.has(k + ':' + r.id))])), [lists, picked])

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
            <Button variant="secondary" iconLeft={<CheckSquare size={16} />} onClick={() => { setSelecting((on) => !on); setPicked(new Set()) }} aria-pressed={selecting}>{selecting ? 'Stop selecting' : 'Select'}</Button>
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

      {also.length > 0 && <p className="kb-also">Also matching: {also.slice(0, 8).join(', ')}{also.length > 8 ? '…' : ''}</p>}

      <div className="kb-tabs" role="tablist" aria-label="What to search">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={`kb-tab${tab === id ? ' on' : ''}`} onClick={() => setTab(id)}>
            {label}
            <span className="kb-count">{id === 'all' ? KIND_IDS.reduce((n, k) => n + (results[k]?.length || 0), 0) : results[id]?.length ?? '…'}</span>
          </button>
        ))}
      </div>

      {selecting && loaded && (
        <div className="kb-bulk" role="region" aria-label="Remove several entries">
          <span><b>{picked.size.toLocaleString('en-NZ')}</b> selected</span>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(kinds.flatMap((k) => (results[k] || []).map((r) => k + ':' + r.id))))}>
            Select all {kinds.reduce((n, k) => n + (results[k]?.length || 0), 0).toLocaleString('en-NZ')} {query.trim() ? 'found' : tab === 'all' ? 'entries' : KINDS[tab].label.toLowerCase()}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setPicked(new Set())} disabled={!picked.size}>Clear</Button>
          <span className="spacer" />
          <Button variant="danger" size="sm" iconLeft={<Trash2 size={16} />} onClick={() => setRemoving(true)} disabled={!picked.size}>Remove {picked.size ? picked.size.toLocaleString('en-NZ') : ''}</Button>
        </div>
      )}
      {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
      {!error && !loaded && <Loading />}

      {loaded && total === 0 && (
        <Alert tone="info" title="Nothing here yet" icon={<BookOpen size={18} />}>
          {canEdit ? 'Add an article or a part, or Import Word guides, a parts list, an asset list or past jobs.' : 'An admin or editor needs to add the first entries.'}
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
              {rows.slice(0, limit).map((r) => {
                const key = k + ':' + r.id
                return (
                  <li key={r.id} className={selecting ? 'kb-pickrow' + (picked.has(key) ? ' on' : '') : undefined}>
                    {selecting && <input type="checkbox" className="kb-pick" checked={picked.has(key)} onChange={() => toggle(key)} aria-label="Select this entry" />}
                    <Row kind={k} rec={r} re={re} onOpen={() => (selecting ? toggle(key) : openItem(k, r.id))} />
                  </li>
                )
              })}
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
        <Detail kind={open.kind} rec={found} lists={lists} canEdit={canEdit} re={re} onClose={closeItem} onOpen={openItem}
          onEdit={() => { setEditing({ kind: open.kind, record: found }); closeItem() }} onToast={toast} />
      )}
      {editing && <Editor kind={editing.kind} record={editing.record} categories={[...new Set((lists.article || []).map((a) => a.category).filter(Boolean))].sort()} by={by}
        onClose={() => setEditing(null)} onSaved={(kind, id, msg) => { setEditing(null); toast(msg); openItem(kind, id) }} />}
      {importing && <ImportDialog by={by} categories={[...new Set((lists.article || []).map((a) => a.category).filter(Boolean))].sort()} existing={new Set((lists.article || []).map((a) => a.id))} onClose={() => setImporting(false)} onDone={(msg) => { setImporting(false); toast(msg) }} />}
      {removing && <BulkRemove groups={pickedGroups} onClose={() => setRemoving(false)} onDone={(msg) => { setRemoving(false); setPicked(new Set()); toast(msg) }} />}
      <Toast message={toastMsg} />
    </div>
  )
}

/** One result: enough to recognise it; the rest is in its dialog. `re` marks the words that matched. */
function Row({ kind, rec, onOpen, re }) {
  const H = (text) => <Hl text={text} re={re} />
  const hit = (text) => splitHits(text, re).some((p) => p.hit)
  return (
    <button type="button" className="kb-row" onClick={onOpen}>
      {kind === 'article' && (<>
        <span className="kb-row-main"><b>{H(rec.title)}</b>{rec.category && <Badge tone="neutral">{rec.category}</Badge>}</span>
        <span className="kb-row-sub">{H(snippet(rec.body, 150, re))}</span>
      </>)}
      {kind === 'part' && (() => {
        const info = partInfo(rec.notes)
        const shown = [rec.aliases?.length ? 'Also: ' + rec.aliases.slice(0, 6).join(', ') : '', rec.fits?.length ? 'Fits: ' + rec.fits.join(', ') : ''].filter(Boolean).join(' · ')
        // a part found by a word in its note or faults, which the line above does not show, gets that bit
        const more = re && !hit(shown) ? snippet([info.note, info.rest].filter(Boolean).join(' · '), 110, re) : ''
        return (<>
          <span className="kb-row-main"><b className="kb-code">{H(rec.partNo)}</b><span>{H(rec.name)}</span>{info.status && !/^active/i.test(info.status) && <Badge tone={statusTone(info.status)}>{info.status}</Badge>}</span>
          <span className="kb-row-sub">{H([shown, more].filter(Boolean).join(' · ') || snippet(info.rest))}</span>
        </>)
      })()}
      {kind === 'device' && (<>
        <span className="kb-row-main"><b>{H(rec.model || rec.serial)}</b><span>{H([rec.site, rec.dept].filter(Boolean).join(' · '))}</span></span>
        <span className="kb-row-sub">{H([rec.serial && 'S/N ' + rec.serial, rec.version && 'v' + rec.version, ...Object.entries(rec.extra || {}).slice(0, 5).map(([k, v]) => `${k}: ${v}`)].filter(Boolean).join(' · '))}</span>
      </>)}
      {kind === 'job' && (<>
        <span className="kb-row-main"><b>{H(rec.jobNo ? `Job ${rec.jobNo}` : 'Job')}</b><span>{H(rec.title)}</span>{rec.date && <span className="kb-date">{rec.date}</span>}</span>
        <span className="kb-row-sub">{H([rec.site, snippet(rec.notes, 120, re)].filter(Boolean).join(' · '))}</span>
      </>)}
    </button>
  )
}
