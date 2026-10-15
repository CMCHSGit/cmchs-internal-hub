/* Table: the job register as a spreadsheet. Grouped by category, edit any
   cell in place, drag column edges to resize, the Job column stays put when
   scrolling sideways. Filters and saved views across the top; clicking a
   job's name opens its side panel. Compact (the default) keeps each job to
   one short line and the Job column takes up whatever width is spare, so
   the whole register fits across one screen. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight, X, ClipboardList } from 'lucide-react'
import { Button, Tag } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { StatusPill, Priority, AvatarStack, StaffPicker, Empty, DensityToggle, useDense, useFitHeight } from '../ui.jsx'
import { BUILTIN_VIEWS, PRIORITIES, filterJobs, fmt, fmtRange, inMainViews, isConferenceCategory, linesNeedingLoan } from '../model.js'

const LS_VIEWS = 'projects_views'
const LS_WIDTHS = 'projects_colw'
const LS_WIDTHS_DENSE = 'projects_colw_dense'
const LS_COLLAPSED = 'projects_collapsed'
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode */ } }

// w: Roomy widths; d: Compact widths. The Job column grows into any spare width.
const COLS = [
  { key: 'name', label: 'Job', w: 300, d: 240 },
  { key: 'status', label: 'Status', w: 160, d: 112 },
  { key: 'priority', label: 'Priority', w: 112, d: 72, short: 'Prio' },
  { key: 'customer', label: 'Customer / hospital', w: 210, d: 160, short: 'Customer' },
  { key: 'region', label: 'Region', w: 130, d: 96 },
  { key: 'start', label: 'Start', w: 122, d: 64 },
  { key: 'end', label: 'End', w: 122, d: 64 },
  { key: 'eng', label: 'Engineering', w: 132, d: 84, short: 'Eng' },
  { key: 'apps', label: 'Apps / sales', w: 132, d: 104, short: 'Apps / sales' },
  { key: 'freight', label: 'Freight', w: 200, d: 120 },
  { key: 'owner', label: 'Project manager', w: 150, d: 104, short: 'PM' },
  { key: 'updated', label: 'Last edit', w: 150, d: 96 },
]

export default function TableView({ params }) {
  const s = useStore()
  const ui = useUi()
  const [custom, setCustom] = useState(() => read(LS_VIEWS, []))
  const views = [...BUILTIN_VIEWS, ...custom]
  const viewId = params.view || 'all'
  const base = views.find((v) => v.id === viewId)?.f || {}
  const [f, setF] = useState(base)
  useEffect(() => { setF(views.find((v) => v.id === viewId)?.f || {}) }, [viewId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [sort, setSort] = useState({ key: 'start', dir: 1 })
  const [dense] = useDense()
  const page = useFitHeight(dense)
  const wKey = dense ? LS_WIDTHS_DENSE : LS_WIDTHS
  const defaults = () => ({ ...Object.fromEntries(COLS.map((c) => [c.key, dense ? c.d : c.w])), ...read(wKey, {}) })
  const [widths, setWidths] = useState(defaults)
  useEffect(() => setWidths(defaults()), [dense]) // eslint-disable-line react-hooks/exhaustive-deps
  // The grid's own width, so the Job column can take whatever is spare
  const wrap = useRef(null)
  const [wrapW, setWrapW] = useState(0)
  useEffect(() => {
    if (!wrap.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWrapW(Math.floor(e.contentRect.width)))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  const [collapsed, setCollapsed] = useState(() => read(LS_COLLAPSED, {}))
  const [editing, setEditing] = useState(null) // { id, key }

  const regions = useMemo(() => [...new Set(s.active.map((j) => j.region).filter(Boolean))].sort(), [s.active])
  const ctx = { me: s.me, today: s.today, assignments: s.assignments }
  const shown = useMemo(() => {
    // Conferences only when ticked in Conferences (model.js inMainViews)
    const list = filterJobs(s.active.filter((j) => inMainViews(j, s.catById, s.assignments)), f, ctx)
    const val = (j) => {
      if (sort.key === 'updated') return j.updatedAtMs || 0
      if (sort.key === 'priority') return { High: 0, Medium: 1, Low: 2 }[j.priority] ?? 3
      if (sort.key === 'freight') return j.freight?.eta || ''
      if (sort.key === 'status') return s.settings.statuses.findIndex((x) => x.name === j.status)
      if (sort.key === 'eng' || sort.key === 'apps') return (j[sort.key] || []).length
      return String(j[sort.key] ?? '').toLowerCase()
    }
    return [...list].sort((a, b) => {
      const x = val(a), y = val(b)
      if (x === '' || y === '') return x === y ? 0 : x === '' ? 1 : -1 // blanks last either way
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir
    })
  }, [s.active, f, sort, s.me, s.today, s.assignments, s.settings.statuses, s.catById]) // eslint-disable-line react-hooks/exhaustive-deps

  const others = COLS.slice(1).reduce((t, c) => t + widths[c.key], 0)
  const nameW = Math.max(widths.name, wrapW - others - 2)
  const template = COLS.map((c) => `${c.key === 'name' ? nameW : widths[c.key]}px`).join(' ')
  const viewersOf = (id) => s.online.filter((p) => p.jobId === id && p.id !== s.me.uid)
  const active = Object.values(f).some(Boolean) && viewId === 'all'

  function startResize(e, key) {
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    const w0 = widths[key]
    const move = (ev) => setWidths((w) => ({ ...w, [key]: Math.max(70, w0 + ev.clientX - x0) }))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setWidths((w) => { write(wKey, w); return w })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  function saveView() {
    const name = window.prompt('Name this view, e.g. "Auckland installs"')
    if (!name) return
    const v = { id: 'v' + Date.now().toString(36), name, f }
    const next = [...custom, v]
    setCustom(next); write(LS_VIEWS, next)
    ui.go('table', { view: v.id })
  }
  function deleteView(id) {
    const next = custom.filter((v) => v.id !== id)
    setCustom(next); write(LS_VIEWS, next)
    ui.go('table', {})
  }
  const toggle = (id) => setCollapsed((c) => { const n = { ...c, [id]: !c[id] }; write(LS_COLLAPSED, n); return n })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const viewTabs = (
    <div className="pt-views" role="tablist" aria-label="Saved views">
      {views.map((v) => (
        <span key={v.id} className="pt-viewtab-wrap">
          <a role="tab" aria-selected={viewId === v.id} className={`pt-viewtab${viewId === v.id ? ' on' : ''}`} href={`#/table${v.id === 'all' ? '' : '?view=' + v.id}`}>{v.name}</a>
          {v.id.startsWith('v') && viewId === v.id && <button type="button" className="icon-btn icon-btn-sm" aria-label={`Delete view ${v.name}`} title="Delete this view" onClick={() => deleteView(v.id)}><X size={14} /></button>}
        </span>
      ))}
    </div>
  )

  return (
    <div ref={page} className={`pt-page${dense ? ' pt-dense' : ''}`}>
      <div className="pt-pagehead">
        <h1 className="pt-h2">Table</h1>
        <span className="text-sm text-muted">{shown.length} of {s.active.length} active jobs</span>
        {dense && viewTabs}
        <span className="pt-spacer" />
        <DensityToggle />
      </div>

      {!dense && viewTabs}

      <div className="pt-filters">
        <input className="input pt-f-q" type="search" placeholder="Filter by name, customer, tracking…" value={f.q || ''} onChange={set('q')} aria-label="Filter text" />
        <select value={f.status || ''} onChange={set('status')} aria-label="Status"><option value="">Any status</option>{s.settings.statuses.map((x) => <option key={x.name}>{x.name}</option>)}</select>
        <select value={f.priority || ''} onChange={set('priority')} aria-label="Priority"><option value="">Any priority</option>{PRIORITIES.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.region || ''} onChange={set('region')} aria-label="Region"><option value="">Any region</option>{regions.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.staff || ''} onChange={set('staff')} aria-label="Staff member"><option value="">Anyone</option>{s.settings.staff.map((p) => <option key={p.id} value={p.id}>{p.initials} · {p.name}</option>)}</select>
        <label className="pt-f-date"><span className="text-sm text-muted">From</span><input className="input" type="date" value={f.from || ''} onChange={set('from')} /></label>
        <label className="pt-f-date"><span className="text-sm text-muted">To</span><input className="input" type="date" value={f.to || ''} onChange={set('to')} /></label>
        {Object.values(f).some(Boolean) && <Button size="sm" variant="ghost" onClick={() => setF({})}>Clear</Button>}
        {active && <Button size="sm" variant="secondary" onClick={saveView}>Save view</Button>}
      </div>

      <div ref={wrap} className="pt-grid-wrap" role="grid" aria-label="Active jobs" aria-rowcount={shown.length + 1}>
        <div className="pt-grow-row pt-grid-head" role="row" style={{ gridTemplateColumns: template }}>
          {COLS.map((c, i) => (
            <div key={c.key} role="columnheader" className={`pt-hcell${i === 0 ? ' pt-frz' : ''}`} aria-sort={sort.key === c.key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
              <button type="button" className="pt-hbtn" onClick={() => setSort((x) => ({ key: c.key, dir: x.key === c.key ? -x.dir : 1 }))}>
                {dense && c.short ? <span title={c.label}>{c.short}</span> : c.label}{sort.key === c.key && <span aria-hidden="true">{sort.dir > 0 ? ' ↑' : ' ↓'}</span>}
              </button>
              <span className="pt-grip" onPointerDown={(e) => startResize(e, c.key)} title="Drag to resize" aria-hidden="true" />
            </div>
          ))}
        </div>
        {s.settings.categories.map((cat) => {
          const jobs = shown.filter((j) => j.category === cat.id)
          if (!jobs.length && Object.values(f).some(Boolean)) return null
          const open = !collapsed[cat.id]
          return (
            <div key={cat.id} role="rowgroup">
              <div className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}>
                <div className="pt-group" role="cell" style={{ borderTopColor: cat.color }}>
                  <button type="button" className="pt-group-btn" aria-expanded={open} onClick={() => toggle(cat.id)}>
                    <ChevronRight size={16} style={{ transform: `rotate(${open ? 90 : 0}deg)`, transition: 'transform 150ms' }} />
                    <span className="pt-swatch" style={{ background: cat.color }} />
                    <b>{cat.name}</b>
                    <span className="pt-count">{jobs.length}</span>
                  </button>
                  {isConferenceCategory(cat) && (() => {
                    const hidden = s.active.filter((j) => j.category === cat.id && !inMainViews(j, s.catById, s.assignments)).length
                    return hidden > 0 && <a className="text-sm" href="#/conferences">{hidden} more in Conferences</a>
                  })()}
                  {s.canEdit && <button type="button" className="link-btn" onClick={() => ui.newJob({ category: cat.id })}>+ Add job</button>}
                </div>
              </div>
              {open && jobs.map((j) => (
                <Row key={j.id} job={j} template={template} dense={dense} editing={editing?.id === j.id ? editing.key : null}
                  setEditing={(key) => setEditing(key ? { id: j.id, key } : null)} viewers={viewersOf(j.id)} selected={params.job === j.id} />
              ))}
              {open && !jobs.length && <div className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}><div className="pt-cell pt-frz text-muted text-sm" role="cell">No jobs.</div></div>}
            </div>
          )
        })}
        {s.active.length === 0 && <Empty>No active jobs. Press N or use New job to add one.</Empty>}
      </div>
      <p className="text-sm text-muted pt-hint">Click a cell to edit it. Drag the edge of a column heading to resize it. Click a job's name for everything else.</p>
    </div>
  )
}

function Row({ job, template, editing, setEditing, viewers, selected, dense }) {
  const s = useStore()
  const ui = useUi()
  const can = s.canEdit
  const cell = (key, content, extra = '') => (
    <div role="gridcell" className={`pt-cell ${extra}${can && key ? ' pt-editable' : ''}`}
      onClick={can && key && editing !== key ? () => setEditing(key) : undefined}
      onKeyDown={can && key ? (e) => { if (e.key === 'Enter' && editing !== key) setEditing(key) } : undefined}
      tabIndex={can && key ? 0 : undefined}>
      {key && editing === key ? <CellEditor job={job} field={key} done={() => setEditing(null)} /> : content}
    </div>
  )
  const f = job.freight || {}
  const first = selected ? ' pt-selected' : viewers.length ? ' pt-watched' : ''
  return (
    <div className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}>
      <div role="rowheader" className={`pt-cell pt-frz${first}`}>
        <button type="button" className="pt-rowbtn" onClick={() => ui.openJob(job.id, 'table')}>{job.name}</button>
        {linesNeedingLoan(job).length > 0 && (
          <button type="button" className="pt-loanflag" title="Equipment without a demo loan form yet" aria-label={`${job.name}: equipment without a demo loan form yet`} onClick={() => ui.openJob(job.id, 'table')}><ClipboardList size={14} /></button>
        )}
        {viewers.length > 0 && <span className="pt-viewer" title={`${viewers.map((v) => v.name).join(', ')} ${viewers.length === 1 ? 'has' : 'have'} this job open`}>{viewers.map((v) => v.initials).join(' ')}</span>}
      </div>
      {cell('status', dense ? (
        <span className="pt-ellipsis" title={[job.status, job.status === 'Waiting' && job.waitingOn ? 'on ' + job.waitingOn : '', job.statusNote].filter(Boolean).join(' · ')}>
          <StatusPill status={job.status} small />
        </span>
      ) : (
        <span className="pt-col">
          <StatusPill status={job.status} small />
          {job.status === 'Waiting' && job.waitingOn && <span className="text-sm pt-warn pt-ellipsis">on {job.waitingOn}</span>}
          {job.statusNote && <span className="text-sm text-muted pt-ellipsis" title={job.statusNote}>{job.statusNote}</span>}
        </span>
      ))}
      {cell('priority', <Priority value={job.priority} bare={dense} />)}
      {cell('customer', <span className="pt-strong pt-ellipsis">{job.customer || '—'}</span>)}
      {cell('region', <span className="pt-ellipsis" title={job.region}>{job.region || '—'}</span>)}
      {cell('start', <span className="pt-num">{fmt(job.start) || '—'}</span>)}
      {cell('end', <span className="pt-num">{fmt(job.end) || '—'}</span>)}
      {cell('eng', <AvatarStack ids={job.eng || []} size={dense ? 18 : 28} max={dense ? 3 : 4} />)}
      {cell('apps', <AvatarStack ids={job.apps || []} size={dense ? 18 : 28} max={4} />)}
      {cell('freight', f.tracking && dense ? <span className="pt-ellipsis pt-mono" title={`${f.tracking} · ${f.state || 'Not shipped'}${f.eta ? ` · ETA ${fmt(f.eta)}` : ''}`}>{f.tracking}</span>
        : f.tracking ? <span className="pt-col"><span className="pt-mono pt-strong">{f.tracking}</span><span className="text-sm text-muted">{f.state || 'Not shipped'}{f.eta ? ` · ETA ${fmt(f.eta)}` : ''}</span></span> : <span className="text-muted">—</span>)}
      {cell('owner', <span className="pt-ellipsis" title={job.owner}>{job.owner || '—'}</span>)}
      {cell(null, <span className="text-sm text-muted pt-ellipsis">{job.updatedBy ? `${job.updatedBy.split(' ')[0]} · ${ago(job.updatedAtMs)}` : '—'}</span>)}
    </div>
  )
}

function ago(ms) {
  if (!ms) return ''
  const m = Math.round((Date.now() - ms) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  return fmt(new Date(ms).toISOString().slice(0, 10))
}

/** The editor for one cell. Saves on Enter or leaving it; Escape cancels. */
function CellEditor({ job, field, done }) {
  const s = useStore()
  const ui = useUi()
  const ref = useRef(null)
  const initial = field === 'freight' ? job.freight?.tracking || '' : job[field] ?? ''
  const [v, setV] = useState(initial)
  useEffect(() => { ref.current?.focus(); ref.current?.select?.() }, [])
  const labels = { status: 'Status', priority: 'Priority', customer: 'Customer', region: 'Region', start: 'Planned start', end: 'Planned end', owner: 'Project manager', freight: 'Freight tracking' }
  async function commit(val = v) {
    done()
    if (val === initial) return
    if (field === 'status') {
      const ask = await s.setStatus(job, val)
      if (ask) ui.askArchive(job)
      return
    }
    if (field === 'freight') return s.updateJob(job.id, { freight: { ...(job.freight || {}), tracking: val } }, `set Freight tracking to ${val || 'blank'}`)
    const shown = field === 'start' || field === 'end' ? (val ? fmt(val) : 'blank') : `"${val}"`
    s.updateJob(job.id, { [field]: val }, `changed ${labels[field]} to ${shown}`)
  }
  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); done() }
    if (e.key === 'Enter') { e.preventDefault(); commit() }
  }
  if (field === 'eng' || field === 'apps') {
    return (
      <span className="pt-grow" onClick={(e) => e.stopPropagation()}>
        <StaffPicker compact startOpen onClose={done} value={job[field] || []} roles={field === 'eng' ? ['Engineering'] : ['Applications', 'Sales']}
          onChange={(ids) => s.updateJob(job.id, { [field]: ids }, `changed the ${field === 'eng' ? 'Engineering' : 'Applications / sales'} team`)} />
      </span>
    )
  }
  if (field === 'status' || field === 'priority') {
    const opts = field === 'status' ? s.settings.statuses.map((x) => x.name) : PRIORITIES
    return (
      <select ref={ref} className="pt-cell-input" value={v} onChange={(e) => commit(e.target.value)} onBlur={done} onKeyDown={key} aria-label={labels[field]}>
        {opts.map((o) => <option key={o}>{o}</option>)}
      </select>
    )
  }
  return (
    <input ref={ref} className="pt-cell-input" type={field === 'start' || field === 'end' ? 'date' : 'text'} value={v} aria-label={labels[field]}
      onChange={(e) => setV(e.target.value)} onBlur={() => commit()} onKeyDown={key} onClick={(e) => e.stopPropagation()} />
  )
}
