/* Ctrl+K: one search over active and archived jobs together. Results come
   up as you type, grouped and labelled Active or Archived, with the matching
   words highlighted and a line showing where they matched. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from './store.jsx'
import { useUi } from './App.jsx'
import { Modal, Highlight, StatusPill } from './ui.jsx'
import { searchJobs, overlaps, fmtRange, fmtY, tokens } from './model.js'

export default function SearchPalette({ onClose, scope: initialScope = 'all' }) {
  const s = useStore()
  const ui = useUi()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState(initialScope)
  const [f, setF] = useState({ category: '', status: '', staff: '', region: '', model: '', from: '', to: '' })
  const [cursor, setCursor] = useState(0)
  const [showFilters, setShowFilters] = useState(false)
  const input = useRef(null)
  useEffect(() => { input.current?.focus() }, [])

  const regions = useMemo(() => [...new Set(s.jobs.map((j) => j.region).filter(Boolean))].sort(), [s.jobs])
  const results = useMemo(() => {
    const pool = s.jobs.filter((j) => (!f.category || j.category === f.category) && (!f.status || j.status === f.status) &&
      (!f.region || j.region === f.region) && (!f.model || (j.equipment || []).some((l) => l.model === f.model)) &&
      (!f.staff || (j.eng || []).includes(f.staff) || (j.apps || []).includes(f.staff) || s.assignments.some((a) => a.jobId === j.id && a.staffId === f.staff)) &&
      ((!f.from && !f.to) || overlaps(j.start, j.end, f.from || '0000-01-01', f.to || '9999-12-31')))
    const filtered = Object.values(f).some(Boolean)
    const r = tokens(q).length
      ? searchJobs(q, pool, { comments: s.comments, assignments: s.assignments, staff: s.settings.staff })
      : filtered ? pool.map((job) => ({ job, score: 0, all: false, field: '', preview: [], title: [{ t: job.name, hit: false }], people: [] })) : []
    return r
  }, [q, f, s.jobs, s.comments, s.assignments, s.settings.staff])
  const counts = { all: results.length, active: results.filter((r) => !r.job.archived).length, archived: results.filter((r) => r.job.archived).length }
  const inScope = results.filter((r) => scope === 'all' || (scope === 'archived') === !!r.job.archived)
  const best = inScope[0]?.all && tokens(q).length > 1 ? inScope[0] : null
  const rest = inScope.filter((r) => r !== best)
  const groups = [['Active', rest.filter((r) => !r.job.archived)], ['Archived', rest.filter((r) => r.job.archived)]].filter(([, l]) => l.length)
  const flat = [...(best ? [best] : []), ...groups.flatMap(([, l]) => l)]
  useEffect(() => setCursor(0), [q, scope, f])

  const open = (r) => { onClose(); ui.openJob(r.job.id, r.job.archived ? 'archive' : (ui.route.view === 'archive' || ui.route.view === 'settings' ? 'table' : ui.route.view)) }
  const key = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)) }
    if (e.key === 'Enter' && flat[cursor]) { e.preventDefault(); open(flat[cursor]) }
  }
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const nFilters = Object.values(f).filter(Boolean).length

  const Result = ({ r, bestMatch }) => {
    const i = flat.indexOf(r)
    const people = r.people.length ? r.people : []
    return (
      <button type="button" className={`pt-res${i === cursor ? ' on' : ''}${bestMatch ? ' best' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => open(r)} id={`pt-res-${i}`} role="option" aria-selected={i === cursor}>
        <span className="pt-row">
          <span className="pt-res-title"><Highlight parts={r.title} /></span>
          <span className={`pt-where ${r.job.archived ? 'arch' : ''}`}>{r.job.archived ? 'Archived' : 'Active'}</span>
        </span>
        <span className="text-sm text-muted">
          {[r.job.customer, r.job.region].filter(Boolean).join(' · ')}
          {' · '}{r.job.archived ? `completed ${fmtY(r.job.completedAt || r.job.archivedAt) || '?'}` : fmtRange(r.job.start, r.job.end)}
          {!r.job.archived && <> · <StatusPill status={r.job.status} small /></>}
        </span>
        {bestMatch && people.length > 0 && (
          <span className="text-sm pt-strong">{r.job.archived && r.job.start ? `${fmtY(r.job.start)} – ${fmtY(r.job.end)}` : fmtRange(r.job.start, r.job.end)}. {people.map((p) => `${p.initials} ${p.name}`).join(', ')} went{(r.job.equipment || []).length ? `, with ${(r.job.equipment || []).map((l) => `${l.qty}x ${l.model}`).join(', ')}` : ''}.</span>
        )}
        {r.field && (
          <span className="text-sm"><b className="pt-strong">{r.field}: </b><Highlight parts={r.preview} /></span>
        )}
      </button>
    )
  }

  return (
    <Modal title="Search" description="Active and archived jobs. Ctrl K from any page." onClose={onClose} width={760} className="pt-search">
      <input ref={input} className="input pt-search-input" type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key}
        placeholder="Job, hospital, staff name or initials, device model, tracking number, notes" aria-label="Search all jobs"
        role="combobox" aria-expanded={flat.length > 0} aria-controls="pt-results" aria-activedescendant={flat.length ? `pt-res-${cursor}` : undefined} />
      <div className="pt-row pt-wrap">
        <div className="pt-seg" role="group" aria-label="Show">
          {[['all', 'All'], ['active', 'Active'], ['archived', 'Archived']].map(([v, l]) => (
            <button key={v} type="button" className={scope === v ? 'on' : ''} aria-pressed={scope === v} onClick={() => setScope(v)}>{l}{(q || nFilters) ? ` ${counts[v]}` : ''}</button>
          ))}
        </div>
        <button type="button" className={`tag${nFilters ? ' tag-selected' : ''}`} aria-expanded={showFilters} onClick={() => setShowFilters((x) => !x)}>Filters{nFilters ? ` (${nFilters})` : ''}</button>
        {nFilters > 0 && <button type="button" className="link-btn" onClick={() => setF({ category: '', status: '', staff: '', region: '', model: '', from: '', to: '' })}>Clear filters</button>}
      </div>
      {showFilters && (
        <div className="pt-filters pt-search-filters">
          <select value={f.category} onChange={set('category')} aria-label="Category"><option value="">Any category</option>{s.settings.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select value={f.status} onChange={set('status')} aria-label="Status"><option value="">Any status</option>{s.settings.statuses.map((x) => <option key={x.name}>{x.name}</option>)}</select>
          <select value={f.staff} onChange={set('staff')} aria-label="Staff member"><option value="">Anyone</option>{s.settings.staff.map((p) => <option key={p.id} value={p.id}>{p.initials} · {p.name}</option>)}</select>
          <select value={f.region} onChange={set('region')} aria-label="Region"><option value="">Any region</option>{regions.map((x) => <option key={x}>{x}</option>)}</select>
          <select value={f.model} onChange={set('model')} aria-label="Device model"><option value="">Any device</option>{s.settings.pool.map((p) => <option key={p.model}>{p.model}</option>)}</select>
          <label className="pt-f-date"><span className="text-sm text-muted">From</span><input className="input" type="date" value={f.from} onChange={set('from')} /></label>
          <label className="pt-f-date"><span className="text-sm text-muted">To</span><input className="input" type="date" value={f.to} onChange={set('to')} /></label>
        </div>
      )}
      <div className="pt-results" id="pt-results" role="listbox" aria-label="Results">
        {!q && !nFilters && <p className="text-sm text-muted pt-hint">Try "A9 Whanganui" to find when we last trialled A9s there and who went, or a tracking number, a person's initials, or a word from a note.</p>}
        {best && <><div className="overline pt-res-group">Best match</div><Result r={best} bestMatch /></>}
        {groups.map(([name, list]) => (
          <div key={name}>
            <div className="overline pt-res-group">{name} <span className="text-muted">· {list.length}</span></div>
            {list.map((r) => <Result key={r.job.id} r={r} />)}
          </div>
        ))}
        {(q || nFilters > 0) && !flat.length && <p className="text-sm text-muted pt-hint">No jobs match that search.</p>}
      </div>
      <div className="pt-res-foot text-sm text-muted">
        <span>{(q || nFilters) ? `${flat.length} result${flat.length === 1 ? '' : 's'}` : ''}</span>
        <span className="pt-grow" />
        <span><kbd>Up</kbd> <kbd>Down</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span>
      </div>
    </Modal>
  )
}
