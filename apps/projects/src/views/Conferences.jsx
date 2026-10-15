/* Conferences: every job in the conferences category, laid out like the
   team's old Conferences sheet: status, type, where, when, registration,
   pack in and out, reps, stand, booth, equipment, sponsorship. Click a cell
   to edit it, the name for the full job. The tick on the left says whether a
   conference also shows in the main Table and Timeline (model.js
   inMainViews), so they stay about the work being staffed. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { StatusPill, AvatarStack, StaffPicker, Empty, DensityToggle, useDense, useFitHeight } from '../ui.jsx'
import { CONF_FIELDS, confOf, inMainViews, isConferenceCategory, fmt, isISO } from '../model.js'

const confLabel = Object.fromEntries(CONF_FIELDS.map((f) => [f.key, f.label]))
// w: Roomy, d: Compact. kind: where the value lives and how it is edited.
const COLS = [
  { key: 'show', label: 'Table', w: 64, d: 52, kind: 'show' },
  { key: 'name', label: 'Conference', w: 280, d: 230, kind: 'job' },
  { key: 'status', label: 'Status', w: 130, d: 108, kind: 'status' },
  { key: 'type', w: 120, d: 100, kind: 'conf' },
  { key: 'modality', w: 120, d: 100, kind: 'conf' },
  { key: 'region', label: 'City', w: 130, d: 104, kind: 'job' },
  { key: 'customer', label: 'Venue', w: 190, d: 160, kind: 'job' },
  { key: 'start', label: 'First day', w: 104, d: 78, kind: 'date' },
  { key: 'end', label: 'Last day', w: 104, d: 78, kind: 'date' },
  { key: 'regBy', w: 120, d: 96, kind: 'conf' },
  { key: 'people', label: 'Reps', w: 130, d: 104, kind: 'people' },
  { key: 'reps', w: 170, d: 140, kind: 'conf' },
  { key: 'stand', w: 140, d: 110, kind: 'conf' },
  { key: 'booth', w: 90, d: 70, kind: 'conf' },
  { key: 'packIn', w: 130, d: 104, kind: 'conf' },
  { key: 'packOut', w: 130, d: 104, kind: 'conf' },
  { key: 'gear', w: 180, d: 150, kind: 'conf' },
  { key: 'delivery', w: 180, d: 150, kind: 'conf' },
  { key: 'sponsorship', w: 130, d: 110, kind: 'conf' },
  { key: 'website', w: 180, d: 150, kind: 'conf' },
  { key: 'comments', w: 200, d: 170, kind: 'conf' },
  { key: 'remarks', w: 200, d: 170, kind: 'conf' },
].map((c) => ({ ...c, label: c.label || confLabel[c.key] }))

const FILTERS = [['upcoming', 'Upcoming'], ['year', 'This year'], ['all', 'Everything']]
const yearOf = (j) => (isISO(j.start) ? j.start : isISO(j.end) ? j.end : '').slice(0, 4) || 'No dates yet'

export default function Conferences() {
  const s = useStore()
  const ui = useUi()
  const [dense] = useDense()
  const page = useFitHeight(dense)
  const [filter, setFilter] = useState('upcoming')
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // { id, key }

  const cats = s.settings.categories.filter(isConferenceCategory)
  const catIds = new Set(cats.map((c) => c.id))
  const year = s.today.slice(0, 4)
  const all = useMemo(() => s.jobs.filter((j) => catIds.has(j.category)), [s.jobs, cats.map((c) => c.id).join()]) // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return all.filter((j) => {
      const last = (isISO(j.end) ? j.end : j.start) || ''
      if (filter === 'upcoming' && (j.archived || (isISO(last) && last < s.today))) return false
      if (filter === 'year' && yearOf(j) !== year && !(!j.archived && yearOf(j) === 'No dates yet')) return false
      if (!words.length) return true
      const c = confOf(j)
      const hay = [j.name, j.customer, j.region, j.status, ...Object.values(c)].join(' ').toLowerCase()
      return words.every((w) => hay.includes(w))
    }).sort((a, b) => String(a.start || a.end || '9999').localeCompare(String(b.start || b.end || '9999')) || a.name.localeCompare(b.name))
  }, [all, filter, q, s.today, year])
  const groups = useMemo(() => {
    const m = new Map()
    for (const j of shown) {
      const y = yearOf(j)
      if (!m.has(y)) m.set(y, [])
      m.get(y).push(j)
    }
    return [...m].sort(([a], [b]) => (a === 'No dates yet' ? 1 : b === 'No dates yet' ? -1 : a.localeCompare(b)))
  }, [shown])

  const widths = COLS.map((c) => (dense ? c.d : c.w))
  const template = widths.map((w) => `${w}px`).join(' ')
  const nameLeft = widths[0]
  const inMain = all.filter((j) => !j.archived && inMainViews(j, s.catById, s.assignments)).length
  const active = all.filter((j) => !j.archived).length

  async function addConference() {
    const id = await s.createJob({ category: cats[0].id, name: 'New conference', status: 'Tentative', showInMain: false })
    ui.openJob(id, 'conferences')
  }

  if (!cats.length) {
    return <div className="pt-page"><h1 className="pt-h2">Conferences</h1><Empty>There's no conferences category. Add one in Settings (a name with "Conference" in it) and its jobs show here.</Empty></div>
  }

  return (
    <div ref={page} className={`pt-page${dense ? ' pt-dense' : ''}`}>
      <div className="pt-pagehead">
        <h1 className="pt-h2">Conferences</h1>
        <span className="text-sm text-muted">{active} active, {inMain} shown in the main Table and Timeline</span>
        <span className="pt-spacer" />
        <DensityToggle />
        {s.canEdit && <Button size="sm" iconLeft={<Plus size={15} />} onClick={addConference}>Add conference</Button>}
      </div>
      <div className="pt-filters">
        <span className="pt-seg" role="group" aria-label="Which conferences">
          {FILTERS.map(([v, l]) => <button key={v} type="button" className={filter === v ? 'on' : ''} aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>)}
        </span>
        <input className="input pt-f-q" type="search" placeholder="Filter by name, city, type, rep…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter conferences" />
        <span className="text-sm text-muted">Tick <b>Table</b> to show a conference in the main Table and Timeline too.</span>
      </div>

      <div className="pt-grid-wrap" role="grid" aria-label="Conferences" aria-rowcount={shown.length + 1}>
        <div className="pt-grow-row pt-grid-head" role="row" style={{ gridTemplateColumns: template }}>
          {COLS.map((c, i) => (
            <div key={c.key} role="columnheader" title={c.key === 'show' ? 'Show in the main Table and Timeline' : undefined}
              className={`pt-hcell${i < 2 ? ' pt-frz' : ''}`} style={i === 1 ? { left: nameLeft } : undefined}>{c.label}</div>
          ))}
        </div>
        {groups.map(([y, jobs]) => (
          <div key={y} role="rowgroup">
            <div className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}>
              <div className="pt-group" role="cell"><b>{y}</b><span className="pt-count">{jobs.length}</span></div>
            </div>
            {jobs.map((j) => (
              <ConfRow key={j.id} job={j} template={template} nameLeft={nameLeft} selected={ui.route.params.job === j.id}
                editing={editing?.id === j.id ? editing.key : null} setEditing={(key) => setEditing(key ? { id: j.id, key } : null)} />
            ))}
          </div>
        ))}
        {!shown.length && <Empty>{all.length ? 'No conferences match.' : 'No conferences yet.'}</Empty>}
      </div>
      <p className="text-sm text-muted pt-hint">Click a cell to edit it, or a conference's name for everything else (notes, equipment, comments, history).</p>
    </div>
  )
}

function ConfRow({ job, template, nameLeft, selected, editing, setEditing }) {
  const s = useStore()
  const ui = useUi()
  const can = s.canEdit && !job.archived
  const c = confOf(job)
  const ticked = inMainViews(job, s.catById, s.assignments)
  const chosen = typeof job.showInMain === 'boolean'
  const cell = (col, content, extra = '') => {
    const editable = can && col.kind !== 'show'
    return (
      <div key={col.key} role="gridcell" className={`pt-cell ${extra}${editable ? ' pt-editable' : ''}`}
        onClick={editable && editing !== col.key ? () => setEditing(col.key) : undefined}
        onKeyDown={editable ? (e) => { if (e.key === 'Enter' && editing !== col.key) setEditing(col.key) } : undefined}
        tabIndex={editable ? 0 : undefined}>
        {editing === col.key ? <Editor job={job} col={col} done={() => setEditing(null)} /> : content}
      </div>
    )
  }
  return (
    <div className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}>
      {COLS.map((col) => {
        if (col.key === 'show') {
          return (
            <div key="show" role="gridcell" className="pt-cell pt-frz pt-conf-show">
              <input type="checkbox" checked={ticked} disabled={!can}
                title={job.archived ? 'Archived: not in the main Table either way' : chosen ? (ticked ? 'Shown in the main Table and Timeline' : 'Not shown in the main Table and Timeline')
                  : `Nobody has chosen yet: ${ticked ? 'shown, because someone is on it' : 'not shown, because nobody is on it'}`}
                aria-label={`Show ${job.name} in the main Table and Timeline`}
                onChange={(e) => s.updateJob(job.id, { showInMain: e.target.checked }, e.target.checked ? 'showed this conference in the main Table and Timeline' : 'hid this conference from the main Table and Timeline')} />
            </div>
          )
        }
        if (col.key === 'name') {
          return (
            <div key="name" role="rowheader" className={`pt-cell pt-frz${selected ? ' pt-selected' : ''}`} style={{ left: nameLeft }}>
              <button type="button" className="pt-rowbtn" title={job.name} onClick={() => ui.openJob(job.id, 'conferences')}>{job.name}{job.archived ? ' (archived)' : ''}</button>
            </div>
          )
        }
        if (col.key === 'status') return cell(col, <StatusPill status={job.status} small />)
        if (col.kind === 'date') return cell(col, <span className="pt-num">{fmt(job[col.key]) || '—'}</span>)
        if (col.key === 'people') return cell(col, <AvatarStack ids={[...(job.eng || []), ...(job.apps || [])]} size={18} max={4} />)
        const v = col.kind === 'conf' ? c[col.key] : job[col.key]
        if (col.key === 'website' && /^https?:\/\//.test(v || '')) {
          return cell(col, <a className="pt-ellipsis" href={v} target="_blank" rel="noreferrer" title={v} onClick={(e) => e.stopPropagation()}>{v.replace(/^https?:\/\/(www\.)?/, '')}</a>)
        }
        return cell(col, <span className="pt-ellipsis" title={v || ''}>{v || <span className="text-muted">—</span>}</span>)
      })}
    </div>
  )
}

/** The editor for one cell: saves on Enter or leaving it; Escape cancels. */
function Editor({ job, col, done }) {
  const s = useStore()
  const ui = useUi()
  const ref = useRef(null)
  const initial = col.kind === 'conf' ? confOf(job)[col.key] || '' : job[col.key] ?? ''
  const [v, setV] = useState(initial)
  useEffect(() => { ref.current?.focus(); ref.current?.select?.() }, [])

  async function commit(val = v) {
    done()
    if (val === initial) return
    if (col.kind === 'status') {
      if (await s.setStatus(job, val)) ui.askArchive(job)
      return
    }
    const shown = col.kind === 'date' ? (val ? fmt(val) : 'blank') : `"${val}"`
    if (col.kind === 'conf') {
      // The whole set, so the first edit of an imported conference keeps the others
      return s.mutateJob(job.id, (cur) => ({ conf: { ...confOf(cur), [col.key]: val } }), `changed ${col.label} to ${shown}`)
    }
    return s.updateJob(job.id, { [col.key]: val }, `changed ${col.label} to ${shown}`)
  }
  const key = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); done() }
    if (e.key === 'Enter') { e.preventDefault(); commit() }
  }

  if (col.kind === 'people') {
    const ids = [...(job.eng || []), ...(job.apps || [])]
    return (
      <span className="pt-grow" onClick={(e) => e.stopPropagation()}>
        <StaffPicker compact startOpen onClose={done} value={ids} onChange={(next) => {
          const eng = next.filter((id) => s.staffById.get(id)?.role === 'Engineering')
          s.updateJob(job.id, { eng, apps: next.filter((id) => !eng.includes(id)) }, 'changed the reps')
        }} />
      </span>
    )
  }
  if (col.kind === 'status') {
    return (
      <select ref={ref} className="pt-cell-input" value={v} onChange={(e) => commit(e.target.value)} onBlur={done} onKeyDown={key} aria-label="Status">
        {s.settings.statuses.map((x) => <option key={x.name}>{x.name}</option>)}
      </select>
    )
  }
  return (
    <input ref={ref} className="pt-cell-input" type={col.kind === 'date' ? 'date' : 'text'} value={v} aria-label={col.label}
      onChange={(e) => setV(e.target.value)} onBlur={() => commit()} onKeyDown={key} onClick={(e) => e.stopPropagation()} />
  )
}
