/* Timeline: the weekly sheet. Rows are jobs, columns are weeks (Mondays).
   A bar runs from planned start to end: drag it to move the job (its people
   move with it), drag an end to change a date. Each week cell shows who is
   there and doing what; click one to change it. "By person" turns it round:
   one row per person, with double bookings and leave clashes picked out. */

import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, AlertTriangle } from 'lucide-react'
import { Alert, Button } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { ActivityChip, Avatar, StatusPill, Empty } from '../ui.jsx'
import { addDays, daysBetween, fmt, fmtRange, mondayOf, weeksFrom, clashes, leaveInWeek, isISO, pillStyle, MONTHS_LONG, toDate } from '../model.js'

const NAME_W = 290

export default function Timeline({ params }) {
  const s = useStore()
  const ui = useUi()
  const thisWeek = mondayOf(s.today)
  const [first, setFirst] = useState(() => addDays(thisWeek, -7))
  const [layout, setLayout] = useState('job')
  const [zoom, setZoom] = useState('week')
  const [pop, setPop] = useState(null) // { kind: 'job'|'person', id, week, rect }
  const count = zoom === 'week' ? 12 : 30
  const colW = zoom === 'week' ? 124 : 42
  const weeks = useMemo(() => weeksFrom(first, count), [first, count])
  const last = addDays(weeks[weeks.length - 1], 6)
  const activeIds = useMemo(() => new Set(s.active.map((j) => j.id)), [s.active])
  const clash = useMemo(() => clashes(s.assignments, s.settings.staff, activeIds), [s.assignments, s.settings.staff, activeIds])
  const template = `${NAME_W}px repeat(${count}, ${colW}px)`
  const todayLeft = NAME_W + (daysBetween(first, s.today) / 7) * colW
  const upcomingClashes = [...clash].filter(([k]) => { const w = k.split('|')[1]; return w >= thisWeek && w <= addDays(thisWeek, 56) })

  const months = []
  weeks.forEach((w, i) => {
    const m = w.slice(0, 7)
    if (!months.length || months[months.length - 1].m !== m) months.push({ m, from: i, n: 1 })
    else months[months.length - 1].n++
  })

  const openPop = (e, kind, id, week) => {
    if (!s.canEdit && kind === 'person') return
    setPop({ kind, id, week, rect: e.currentTarget.getBoundingClientRect() })
  }

  return (
    <div className="pt-page" onScroll={() => setPop(null)}>
      <div className="pt-pagehead">
        <h1 className="pt-h2">Timeline</h1>
        <span className="pt-spacer" />
        <div className="pt-seg" role="group" aria-label="Layout">
          {[['job', 'By job'], ['person', 'By person']].map(([v, l]) => <button key={v} type="button" className={layout === v ? 'on' : ''} aria-pressed={layout === v} onClick={() => setLayout(v)}>{l}</button>)}
        </div>
        <div className="pt-seg" role="group" aria-label="Zoom">
          {[['week', 'Week'], ['month', 'Month']].map(([v, l]) => <button key={v} type="button" className={zoom === v ? 'on' : ''} aria-pressed={zoom === v} onClick={() => setZoom(v)}>{l}</button>)}
        </div>
        <span className="pt-seg">
          <button type="button" aria-label="Earlier" onClick={() => setFirst(addDays(first, -28))}><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setFirst(addDays(thisWeek, -7))}>Today</button>
          <button type="button" aria-label="Later" onClick={() => setFirst(addDays(first, 28))}><ChevronRight size={16} /></button>
        </span>
      </div>

      <div className="pt-legend">
        <span className="overline">Activity</span>
        {s.settings.activities.map((a) => <ActivityChip key={a.name} activity={a.name} />)}
      </div>

      {layout === 'person' && upcomingClashes.length > 0 && (
        <Alert tone="warning" icon={<AlertTriangle size={18} />} title={`${upcomingClashes.length} clash${upcomingClashes.length === 1 ? '' : 'es'} in the next 8 weeks`}>
          {upcomingClashes.slice(0, 4).map(([k, why]) => {
            const [id, w] = k.split('|')
            const p = s.staffById.get(id)
            return <span key={k} className="pt-clash-line">{p?.initials} {why === 'leave' ? 'is on leave but booked' : 'is double-booked'} in the week of {fmt(w)}. </span>
          })}
        </Alert>
      )}

      <div className="pt-tl-wrap" onScroll={() => setPop(null)}>
        <div className="pt-tl" style={{ width: NAME_W + count * colW }}>
          <div className="pt-tl-row pt-tl-months" style={{ gridTemplateColumns: template }}>
            <div className="pt-tl-name pt-tl-headcell" />
            {months.map((m) => <div key={m.m} className="overline pt-tl-month" style={{ gridColumn: `${m.from + 2} / span ${m.n}` }}>{m.n * colW > 80 ? `${MONTHS_LONG[Number(m.m.slice(5)) - 1]} ${m.m.slice(0, 4)}` : MONTHS_LONG[Number(m.m.slice(5)) - 1].slice(0, 3)}</div>)}
          </div>
          <div className="pt-tl-row pt-tl-weeks" style={{ gridTemplateColumns: template }}>
            <div className="pt-tl-name pt-tl-headcell overline">{layout === 'job' ? 'Job' : 'Staff'}</div>
            {weeks.map((w) => <div key={w} className={`pt-tl-week${w === thisWeek ? ' now' : ''}`}>{zoom === 'week' ? fmt(w) : toDate(w).getDate()}</div>)}
          </div>

          {layout === 'job' && s.settings.categories.map((cat) => {
            const jobs = s.active.filter((j) => j.category === cat.id).sort((a, b) => String(a.start || '9').localeCompare(String(b.start || '9')))
            return (
              <div key={cat.id}>
                <div className="pt-tl-row pt-tl-group" style={{ gridTemplateColumns: template, borderTopColor: cat.color }}>
                  <div className="pt-tl-groupname"><span className="pt-swatch" style={{ background: cat.color }} /><b>{cat.name}</b><span className="text-sm text-muted">{jobs.length}</span></div>
                </div>
                {jobs.map((j) => (
                  <JobRow key={j.id} job={j} cat={cat} weeks={weeks} first={first} last={last} template={template} colW={colW} zoom={zoom}
                    highlight={params.job === j.id} onCell={(e, w) => openPop(e, 'job', j.id, w)} />
                ))}
                {!jobs.length && <div className="pt-tl-row" style={{ gridTemplateColumns: template }}><div className="pt-tl-name text-sm text-muted">No jobs.</div></div>}
              </div>
            )
          })}

          {layout === 'person' && s.settings.staff.map((p) => (
            <div key={p.id} className="pt-tl-row" style={{ gridTemplateColumns: template }}>
              <div className="pt-tl-name pt-row"><Avatar person={p} /><span className="pt-col"><b className="pt-strong">{p.name}</b><span className="text-sm text-muted">{p.role}</span></span></div>
              {weeks.map((w, i) => {
                const items = s.assignments.filter((a) => a.staffId === p.id && a.week === w && activeIds.has(a.jobId))
                const why = clash.get(`${p.id}|${w}`)
                const leave = leaveInWeek(p, w).length > 0
                return (
                  <button key={w} type="button" className={`pt-tl-cell${why ? ' clash' : ''}${leave ? ' leave' : ''}`} style={{ gridColumn: i + 2 }}
                    onClick={(e) => openPop(e, 'person', p.id, w)} aria-label={`${p.name}, week of ${fmt(w)}: ${items.length ? items.length + ' booked' : leave ? 'on leave' : 'free'}`}>
                    {items.map((a) => {
                      const job = s.jobById.get(a.jobId)
                      return zoom === 'week'
                        ? <span key={a.id} className="pt-act pt-act-job" style={pillStyle(s.activityByName.get(a.activity))} title={`${job?.name}: ${a.activity}${a.tentative ? ' (not confirmed)' : ''}`}>{a.tentative ? '? ' : ''}{job?.customer || job?.name}</span>
                        : <span key={a.id} className="pt-dot" style={pillStyle(s.activityByName.get(a.activity))} title={`${job?.name}: ${a.activity}`} />
                    })}
                    {zoom === 'week' && why && <span className="pt-flag">{why === 'leave' ? 'On leave, booked' : 'Double-booked'}</span>}
                    {zoom === 'week' && !why && leave && <span className="text-sm text-muted">On leave</span>}
                  </button>
                )
              })}
            </div>
          ))}
          {layout === 'person' && !s.settings.staff.length && <Empty>Add staff in Settings to see who is where.</Empty>}

          {s.today >= first && s.today <= last && (
            <>
              <div className="pt-today" style={{ left: todayLeft }} aria-hidden="true" />
              <div className="pt-today-label" style={{ left: todayLeft - 36 }}>Today {fmt(s.today)}</div>
            </>
          )}
        </div>
      </div>
      <p className="text-sm text-muted">Each week is saved as person, job, week and activity, ready to feed the staff schedule later. {s.canEdit && 'Drag a bar to move a job and its people; drag either end to change a date.'}</p>

      {pop && <CellPop pop={pop} onClose={() => setPop(null)} />}
    </div>
  )
}

function JobRow({ job, cat, weeks, first, last, template, colW, zoom, highlight, onCell }) {
  const s = useStore()
  const ui = useUi()
  const [drag, setDrag] = useState(null) // { mode, dx }
  const hasDates = isISO(job.start) || isISO(job.end)
  const start = isISO(job.start) ? job.start : job.end
  const end = isISO(job.end) ? job.end : job.start
  const visible = hasDates && start <= last && end >= first
  const delta = drag ? Math.round(drag.dx / colW) : 0
  let sIdx = 0, eIdx = 0
  if (visible) {
    sIdx = Math.floor(daysBetween(first, mondayOf(start)) / 7)
    eIdx = Math.floor(daysBetween(first, mondayOf(end)) / 7)
    if (drag?.mode !== 'end') sIdx += delta
    if (drag?.mode !== 'start') eIdx += delta
    if (sIdx > eIdx) [sIdx, eIdx] = drag?.mode === 'start' ? [eIdx, eIdx] : [sIdx, sIdx]
  }
  const cutL = sIdx < 0, cutR = eIdx > weeks.length - 1
  const tentative = s.statusByName.get(job.status)?.dashed

  function down(e, mode) {
    if (!s.canEdit) return
    e.preventDefault()
    e.stopPropagation()
    const x0 = e.clientX
    let dx = 0
    setDrag({ mode, dx: 0 })
    const move = (ev) => { dx = ev.clientX - x0; setDrag({ mode, dx }) }
    const up = async () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      const n = Math.round(dx / colW)
      setDrag(null)
      if (!n) return
      if (mode === 'move') return s.shiftJob(job, n)
      const field = mode === 'start' ? 'start' : 'end'
      let v = addDays(job[field] || (field === 'start' ? end : start), n * 7)
      if (field === 'start' && v > end) v = end
      if (field === 'end' && v < start) v = start
      s.updateJob(job.id, { [field]: v }, `changed Planned ${field} to ${fmt(v)} on the timeline`)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className={`pt-tl-row pt-tl-jobrow${highlight ? ' hl' : ''}`} style={{ gridTemplateColumns: template }}>
      <div className="pt-tl-name">
        <button type="button" className="pt-rowbtn" onClick={() => ui.openJob(job.id, 'timeline')}>{job.name}</button>
        <span className="pt-row"><StatusPill status={job.status} small /><span className="text-sm text-muted">{fmtRange(job.start, job.end)}</span></span>
      </div>
      {visible && (
        <div className={`pt-bar${drag ? ' dragging' : ''}${s.canEdit ? ' can' : ''}`} onPointerDown={(e) => down(e, 'move')}
          title={s.canEdit ? 'Drag to move the job and its people' : fmtRange(job.start, job.end)}
          style={{
            gridColumn: `${Math.max(0, sIdx) + 2} / ${Math.min(weeks.length - 1, eIdx) + 3}`,
            background: `color-mix(in srgb, ${cat.color} 18%, var(--surface-card))`,
            border: `1.5px ${tentative ? 'dashed' : 'solid'} ${cat.color}`,
            borderRadius: `${cutL ? 0 : 8}px ${cutR ? 0 : 8}px ${cutR ? 0 : 8}px ${cutL ? 0 : 8}px`,
            color: cat.color,
          }}>
          {!cutL && s.canEdit && <span className="pt-bar-end" onPointerDown={(e) => down(e, 'start')} title="Drag to change the start" />}
          <span className="pt-grow" />
          {!cutR && s.canEdit && <span className="pt-bar-end" onPointerDown={(e) => down(e, 'end')} title="Drag to change the end" />}
        </div>
      )}
      {weeks.map((w, i) => {
        const items = s.assignments.filter((a) => a.jobId === job.id && a.week === w)
        return (
          <button key={w} type="button" className="pt-tl-cell" style={{ gridColumn: i + 2 }} onClick={(e) => onCell(e, w)}
            aria-label={`${job.name}, week of ${fmt(w)}: ${items.map((a) => `${s.staffById.get(a.staffId)?.initials || '?'} ${a.activity}`).join(', ') || 'nobody'}`}>
            {items.map((a) => {
              const p = s.staffById.get(a.staffId)
              const q = a.tentative ? '?' : ''
              const title = `${p?.name || '?'}: ${a.activity}${a.tentative ? ' (not confirmed)' : ''}`
              return zoom === 'week'
                ? <ActivityChip key={a.id} activity={a.activity} who={q + (p?.initials || '?')} title={title} />
                : <span key={a.id} className="pt-mini" style={pillStyle(s.activityByName.get(a.activity))} title={title}>{q || p?.initials?.[0] || '?'}</span>
            })}
          </button>
        )
      })}
    </div>
  )
}

/** The little editor for one week cell, positioned over the page so the scroll box can't clip it. */
function CellPop({ pop, onClose }) {
  const s = useStore()
  const ref = useRef(null)
  const acts = s.settings.activities.map((a) => a.name)
  const [staffId, setStaffId] = useState(pop.kind === 'person' ? pop.id : '')
  const [jobId, setJobId] = useState(pop.kind === 'job' ? pop.id : '')
  const [activity, setActivity] = useState(acts[0] || 'Prep')
  const items = s.assignments.filter((a) => a.week === pop.week && (pop.kind === 'job' ? a.jobId === pop.id : a.staffId === pop.id))
  const title = pop.kind === 'job' ? s.jobById.get(pop.id)?.name : s.staffById.get(pop.id)?.name
  const w = 300
  const left = Math.min(Math.max(8, pop.rect.left + pop.rect.width / 2 - w / 2), window.innerWidth - w - 8)
  const below = pop.rect.bottom + 6
  const top = below + 280 > window.innerHeight ? Math.max(8, pop.rect.top - 286) : below

  async function add(e) {
    e.preventDefault()
    if (!staffId || !jobId) return
    await s.addAssignment({ jobId, staffId, week: pop.week, activity })
    if (pop.kind === 'job') setStaffId('')
  }
  return (
    <>
      <div className="pt-pop-catch" onMouseDown={onClose} />
      <div ref={ref} className="pt-pop pt-cellpop" role="dialog" aria-label={`Week of ${fmt(pop.week)}`} style={{ position: 'fixed', left, top, width: w }}
        onKeyDown={(e) => { if (e.key === 'Escape') onClose() }}>
        <div className="pt-row"><b className="pt-grow">Week of {fmt(pop.week)}</b><button type="button" className="icon-btn icon-btn-sm" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
        <div className="text-sm text-muted pt-ellipsis">{title}</div>
        {items.length === 0 && <p className="text-sm text-muted">No one booked this week.</p>}
        {items.map((a) => {
          const p = s.staffById.get(a.staffId)
          const j = s.jobById.get(a.jobId)
          return (
            <div key={a.id} className="pt-row">
              <span className="pt-grow pt-ellipsis text-sm"><b>{a.tentative ? '?' : ''}{pop.kind === 'job' ? p?.initials || '?' : j?.customer || j?.name}</b>{pop.kind === 'job' && p ? ` ${p.name.split(' ')[0]}` : ''}{a.tentative ? ' (not confirmed)' : ''}</span>
              {s.canEdit ? (
                <>
                  {a.tentative && <button type="button" className="link-btn" onClick={() => s.updateAssignment(a, { tentative: false })}>Confirm</button>}
                  <select className="pt-sel-sm" value={a.activity} aria-label="Activity" onChange={(e) => s.updateAssignment(a, { activity: e.target.value })}>
                    {[...new Set([a.activity, ...acts])].map((x) => <option key={x}>{x}</option>)}
                  </select>
                  <button type="button" className="icon-btn icon-btn-sm" aria-label="Remove" onClick={() => s.removeAssignment(a)}><X size={15} /></button>
                </>
              ) : <ActivityChip activity={a.activity} />}
            </div>
          )
        })}
        {s.canEdit && (
          <form className="pt-stack-sm pt-cellpop-add" onSubmit={add}>
            {pop.kind === 'job' ? (
              <select value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Staff member">
                <option value="">Add someone…</option>
                {s.settings.staff.map((p) => {
                  const busy = s.assignments.some((a) => a.staffId === p.id && a.week === pop.week && a.jobId !== pop.id && s.jobById.get(a.jobId) && !s.jobById.get(a.jobId).archived)
                  const leave = leaveInWeek(p, pop.week).length > 0
                  return <option key={p.id} value={p.id}>{p.initials} · {p.name}{leave ? ' (on leave)' : busy ? ' (booked elsewhere)' : ''}</option>
                })}
              </select>
            ) : (
              <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Job">
                <option value="">Add to a job…</option>
                {s.active.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            )}
            <div className="pt-row">
              <select className="pt-grow" value={activity} onChange={(e) => setActivity(e.target.value)} aria-label="Activity">
                {acts.map((x) => <option key={x}>{x}</option>)}
              </select>
              <Button size="sm" type="submit" disabled={!staffId || !jobId}>Add</Button>
            </div>
          </form>
        )}
      </div>
    </>
  )
}
