/* Timeline: the weekly sheet. Rows are jobs, columns are weeks (Mondays).
   A bar runs from planned start to end: drag it to move the job (its people
   move with it), drag an end to change a date. Each week cell shows who is
   there and doing what; click one to change it. "By person" turns it round:
   one row per person, with double bookings and leave clashes picked out.
   "Leave" lists only who is away in the weeks on screen. Leave is read from
   the staff schedule (and any typed in Settings); By job shows it as an
   "On leave" row on top, and someone away all week can't be added that week.
   Compact (the default) keeps each row to one line, sizes the weeks to fill
   the screen and shows people as initials in their activity's colour; jobs
   with nothing in the weeks on screen can be hidden. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X, AlertTriangle } from 'lucide-react'
import { Alert, Button } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { ActivityChip, Avatar, StatusPill, Empty, DensityToggle, useDense, usePref, useFitHeight } from '../ui.jsx'
import { addDays, daysBetween, fmt, fmtRange, mondayOf, weeksFrom, clashes, isISO, weekColourOf, weekNoteOf, peopleText, pillStyle, MONTHS_LONG, toDate, inMainViews } from '../model.js'

const NAME_W = 290
const NAME_W_DENSE = 230

export default function Timeline({ params }) {
  const s = useStore()
  const ui = useUi()
  const thisWeek = mondayOf(s.today)
  const [first, setFirst] = useState(() => addDays(thisWeek, -7))
  const [layout, setLayout] = useState('job')
  const [zoom, setZoom] = useState('week')
  const [pop, setPop] = useState(null) // { kind: 'job'|'person', id, week, rect }
  const [dense] = useDense()
  const page = useFitHeight(dense)
  const [hideIdle, setHideIdle] = usePref('projects_tl_hide_idle', true)
  const wrap = useRef(null)
  const [wrapW, setWrapW] = useState(0)
  useEffect(() => {
    if (!wrap.current || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([e]) => setWrapW(Math.floor(e.contentRect.width)))
    ro.observe(wrap.current)
    return () => ro.disconnect()
  }, [])
  const nameW = dense ? NAME_W_DENSE : NAME_W
  const count = zoom === 'week' ? (dense ? 16 : 12) : 30
  // Compact: the weeks share the screen's width, never narrower than a chip or two
  const colW = dense ? Math.max(zoom === 'week' ? 58 : 30, Math.floor((wrapW - nameW - 2) / count)) : zoom === 'week' ? 124 : 42
  const weeks = useMemo(() => weeksFrom(first, count), [first, count])
  const last = addDays(weeks[weeks.length - 1], 6)
  const activeIds = useMemo(() => new Set(s.active.map((j) => j.id)), [s.active])
  const { awayOf, needLeave } = s
  // The weeks on screen and the next 8 (the clash warning looks that far), read again on coming back to the tab
  useEffect(() => {
    const want = [...new Set([...weeks, ...weeksFrom(thisWeek, 9)])]
    needLeave(want)
    const again = () => { if (document.visibilityState === 'visible') needLeave(want) }
    document.addEventListener('visibilitychange', again)
    return () => document.removeEventListener('visibilitychange', again)
  }, [weeks, thisWeek, needLeave])
  const clash = useMemo(() => clashes(s.assignments, s.settings.staff, activeIds, awayOf), [s.assignments, s.settings.staff, activeIds, awayOf])
  const awayRows = useMemo(() => s.settings.staff.map((p) => ({ p, weeks: weeks.map((w) => awayOf(p, w)) })), [s.settings.staff, weeks, awayOf])
  const awayShown = awayRows.filter((r) => r.weeks.some(Boolean))
  const unlinked = s.leave.fromSchedule && s.leave.loaded ? s.settings.staff.filter((p) => !s.leave.linked.has(p.id)) : []
  const template = `${nameW}px repeat(${count}, ${colW}px)`
  const todayLeft = nameW + (daysBetween(first, s.today) / 7) * colW
  // A job is idle on screen when its bar is outside these weeks and nobody is booked in them
  const busy = (j) => {
    const a = isISO(j.start) ? j.start : j.end
    const b = isISO(j.end) ? j.end : j.start
    return (a && a <= last && b >= first) || s.assignments.some((x) => x.jobId === j.id && x.week >= first && x.week <= weeks[weeks.length - 1])
  }
  // Conferences only when ticked in Conferences (model.js inMainViews)
  const mainJobs = s.active.filter((j) => inMainViews(j, s.catById, s.assignments))
  const idle = layout === 'job' ? mainJobs.filter((j) => !busy(j)).length : 0
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
    <div ref={page} className={`pt-page${dense ? ' pt-dense' : ''}`} onScroll={() => setPop(null)}>
      <div className="pt-pagehead">
        <h1 className="pt-h2">Timeline</h1>
        {layout === 'job' && (
          <label className="pt-check text-sm">
            <input type="checkbox" checked={hideIdle} onChange={(e) => setHideIdle(e.target.checked)} />
            <span>Hide jobs with nothing in these weeks{hideIdle && idle ? ` (${idle} hidden)` : ''}</span>
          </label>
        )}
        <span className="pt-spacer" />
        <DensityToggle />
        <div className="pt-seg" role="group" aria-label="Layout">
          {[['job', 'By job'], ['person', 'By person'], ['leave', 'Leave']].map(([v, l]) => <button key={v} type="button" className={layout === v ? 'on' : ''} aria-pressed={layout === v} onClick={() => setLayout(v)}>{l}</button>)}
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
        <span className="overline" title="The colour a job's week is shown in, as in the planning workbook">Week colours</span>
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

      <div ref={wrap} className="pt-tl-wrap" onScroll={() => setPop(null)}>
        <div className="pt-tl" style={{ width: nameW + count * colW }}>
          <div className="pt-tl-row pt-tl-months" style={{ gridTemplateColumns: template }}>
            <div className="pt-tl-name pt-tl-headcell" />
            {months.map((m) => <div key={m.m} className="overline pt-tl-month" style={{ gridColumn: `${m.from + 2} / span ${m.n}` }}>{m.n * colW > 80 ? `${MONTHS_LONG[Number(m.m.slice(5)) - 1]} ${m.m.slice(0, 4)}` : MONTHS_LONG[Number(m.m.slice(5)) - 1].slice(0, 3)}</div>)}
          </div>
          <div className="pt-tl-row pt-tl-weeks" style={{ gridTemplateColumns: template }}>
            <div className="pt-tl-name pt-tl-headcell overline">{layout === 'job' ? 'Job' : layout === 'leave' ? 'On leave' : 'Staff'}</div>
            {weeks.map((w) => <div key={w} className={`pt-tl-week${w === thisWeek ? ' now' : ''}`}>{zoom === 'week' && colW >= 52 ? fmt(w) : toDate(w).getDate()}</div>)}
          </div>

          {layout === 'job' && (
            <div className="pt-tl-row pt-tl-leaverow" style={{ gridTemplateColumns: template }}>
              <div className="pt-tl-name pt-row"><b className="pt-strong pt-grow">On leave</b><button type="button" className="link-btn text-sm" onClick={() => setLayout('leave')}>See all</button></div>
              {weeks.map((w, i) => {
                const away = awayRows.map((r) => ({ p: r.p, a: r.weeks[i] })).filter((x) => x.a)
                return (
                  <div key={w} className="pt-tl-cell pt-tl-static" style={{ gridColumn: i + 2 }}
                    aria-label={`Week of ${fmt(w)}: ${away.length ? away.map((x) => `${x.p.name} ${x.a.full ? 'away all week' : x.a.label}`).join(', ') : 'nobody on leave'}`}>
                    {zoom === 'week'
                      ? away.map(({ p, a }) => <span key={p.id} className={`pt-act pt-act-mini pt-away${a.full ? ' full' : ''}`} title={`${p.name}: on leave ${a.label}`}>{p.initials}</span>)
                      : away.length > 0 && <span className="pt-mini pt-away full" title={away.map((x) => `${x.p.name}: ${x.a.label}`).join('\n')}>{away.length}</span>}
                  </div>
                )
              })}
            </div>
          )}

          {layout === 'leave' && awayShown.map(({ p, weeks: aw }) => (
            <div key={p.id} className="pt-tl-row" style={{ gridTemplateColumns: template }}>
              <div className="pt-tl-name pt-row">{dense
                ? <><Avatar person={p} size={20} /><span className="pt-ellipsis" title={`${p.name} · ${p.role}`}><b className="pt-strong">{p.name}</b> <span className="text-muted">{p.role}</span></span></>
                : <><Avatar person={p} /><span className="pt-col"><b className="pt-strong">{p.name}</b><span className="text-sm text-muted">{p.role}</span></span></>}</div>
              {weeks.map((w, i) => {
                const a = aw[i]
                return (
                  <div key={w} className={`pt-tl-cell pt-tl-static${a ? ` pt-away${a.full ? ' full' : ''}` : ''}`} style={{ gridColumn: i + 2 }}
                    title={a ? `${p.name}: on leave ${a.label}` : undefined} aria-label={`${p.name}, week of ${fmt(w)}: ${a ? 'on leave ' + a.label : 'working'}`}>
                    {a && zoom === 'week' && <span className="pt-away-label">{a.full ? (dense ? 'Away' : 'Away all week') : a.label}</span>}
                  </div>
                )
              })}
            </div>
          ))}
          {layout === 'leave' && !awayShown.length && <Empty>Nobody is on leave in these weeks.</Empty>}

          {layout === 'job' && s.settings.categories.map((cat) => {
            const jobs = mainJobs.filter((j) => j.category === cat.id && (layout !== 'job' || !hideIdle || busy(j))).sort((a, b) => String(a.start || '9').localeCompare(String(b.start || '9')))
            return (
              <div key={cat.id}>
                <div className="pt-tl-row pt-tl-group" style={{ gridTemplateColumns: template, borderTopColor: cat.color }}>
                  <div className="pt-tl-groupname"><span className="pt-swatch" style={{ background: cat.color }} /><b>{cat.name}</b><span className="text-sm text-muted">{jobs.length}</span></div>
                </div>
                {jobs.map((j) => (
                  <JobRow key={j.id} job={j} cat={cat} weeks={weeks} first={first} last={last} template={template} colW={colW} zoom={zoom} dense={dense}
                    highlight={params.job === j.id} onCell={(e, w) => openPop(e, 'job', j.id, w)} />
                ))}
                {!jobs.length && <div className="pt-tl-row" style={{ gridTemplateColumns: template }}><div className="pt-tl-name text-sm text-muted">{hideIdle ? 'Nothing in these weeks.' : 'No jobs.'}</div></div>}
              </div>
            )
          })}

          {layout === 'person' && s.settings.staff.map((p) => (
            <div key={p.id} className="pt-tl-row" style={{ gridTemplateColumns: template }}>
              <div className="pt-tl-name pt-row">{dense
                ? <><Avatar person={p} size={20} /><span className="pt-ellipsis" title={`${p.name} · ${p.role}`}><b className="pt-strong">{p.name}</b> <span className="text-muted">{p.role}</span></span></>
                : <><Avatar person={p} /><span className="pt-col"><b className="pt-strong">{p.name}</b><span className="text-sm text-muted">{p.role}</span></span></>}</div>
              {weeks.map((w, i) => {
                const items = s.assignments.filter((a) => a.staffId === p.id && a.week === w && activeIds.has(a.jobId))
                const why = clash.get(`${p.id}|${w}`)
                const away = awayOf(p, w)
                const leave = !!away?.full
                return (
                  <button key={w} type="button" className={`pt-tl-cell${why ? ' clash' : ''}${leave ? ' leave' : ''}`} style={{ gridColumn: i + 2 }}
                    onClick={(e) => openPop(e, 'person', p.id, w)} aria-label={`${p.name}, week of ${fmt(w)}: ${items.length ? items.length + ' booked' : leave ? 'on leave' : 'free'}${away && !leave ? `, on leave ${away.label}` : ''}`}>
                    {items.map((a) => {
                      const job = s.jobById.get(a.jobId)
                      return zoom === 'week'
                        ? <span key={a.id} className="pt-act pt-act-job" style={pillStyle(weekEntry(s, job, w))} title={`${job?.name}${weekColourOf(job, w, s.assignments) ? ': ' + weekColourOf(job, w, s.assignments) : ''}${a.tentative ? ' (not confirmed)' : ''}`}>{a.tentative ? '? ' : ''}{job?.customer || job?.name}</span>
                        : <span key={a.id} className="pt-dot" style={pillStyle(weekEntry(s, job, w))} title={`${job?.name}: ${weekColourOf(job, w, s.assignments) || 'booked'}`} />
                    })}
                    {zoom === 'week' && why && <span className="pt-flag" title={why === 'leave' ? 'On leave, booked' : 'Double-booked'}>{dense ? (why === 'leave' ? 'Leave!' : 'Double') : why === 'leave' ? 'On leave, booked' : 'Double-booked'}</span>}
                    {zoom === 'week' && !why && leave && <span className="text-sm text-muted">{dense ? 'Leave' : 'On leave'}</span>}
                    {zoom === 'week' && away && !leave && <span className="text-sm text-muted" title={`On leave ${away.label}`}>Leave {away.label}</span>}
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
      {layout === 'leave' && (
        <p className="text-sm text-muted pt-hint">
          Leave comes from the staff schedule (book it on its Leave calendar), plus any typed against someone in Settings. Someone away all week can't be added to a job that week.
          {unlinked.length > 0 && ` Not matched to anyone in the staff schedule, so their leave there doesn't show: ${unlinked.map((p) => p.name).join(', ')}. Give them the same email in Settings.`}
        </p>
      )}
      <p className="text-sm text-muted pt-hint">Each week is saved as person, job, week and activity, ready to feed the staff schedule later. {s.canEdit && 'Drag a bar to move a job and its people; drag either end to change a date.'}</p>

      {pop && <CellPop pop={pop} onClose={() => setPop(null)} />}
    </div>
  )
}

function JobRow({ job, cat, weeks, first, last, template, colW, zoom, dense, highlight, onCell }) {
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
      {dense ? (
        <div className="pt-tl-name pt-row" title={`${job.name}\n${job.status} · ${fmtRange(job.start, job.end)}`}>
          <StatusDot status={job.status} />
          <button type="button" className="pt-rowbtn pt-ellipsis" onClick={() => ui.openJob(job.id, 'timeline')}>{job.name}</button>
        </div>
      ) : (
        <div className="pt-tl-name">
          <button type="button" className="pt-rowbtn" onClick={() => ui.openJob(job.id, 'timeline')}>{job.name}</button>
          <span className="pt-row"><StatusPill status={job.status} small /><span className="text-sm text-muted">{fmtRange(job.start, job.end)}</span></span>
        </div>
      )}
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
        const colour = weekColourOf(job, w, s.assignments)
        const entry = colour ? s.activityByName.get(colour) : null
        const note = weekNoteOf(job, w)
        const text = [peopleText(items, s.staffById), note].filter(Boolean).join(' ')
        const names = items.map((a) => `${s.staffById.get(a.staffId)?.name || '?'}${a.tentative ? ' (not confirmed)' : ''}`).join(', ')
        return (
          <button key={w} type="button" className={`pt-tl-cell pt-cellwk${entry ? ' painted' : ''}`}
            style={{ gridColumn: i + 2, ...(entry ? pillStyle({ ...entry, outline: false }) : {}) }} onClick={(e) => onCell(e, w)}
            title={[colour, note, names].filter(Boolean).join('\n') || undefined}
            aria-label={`${job.name}, week of ${fmt(w)}${colour ? `, ${colour}` : ''}: ${text || 'nobody'}`}>
            {zoom === 'week' && text && <span className="pt-cellwk-text">{text}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** The settings entry (solid) for the colour a job's week is shown in. */
function weekEntry(s, job, week) {
  const e = s.activityByName.get(weekColourOf(job, week, s.assignments))
  return e && { ...e, outline: false }
}

/** A job's status as a small dot in its colour; the name is in the tooltip. */
function StatusDot({ status }) {
  const s = useStore()
  const e = s.statusByName.get(status)
  const c = e?.color || 'var(--border-strong)'
  return <span className="pt-sdot" title={status} style={e?.outline ? { boxShadow: `inset 0 0 0 2px ${c}` } : { background: c }} />
}

/** The little editor for one week cell, positioned over the page so the scroll box can't clip it. */
function CellPop({ pop, onClose }) {
  const s = useStore()
  const ref = useRef(null)
  const acts = s.settings.activities.map((a) => a.name)
  const job = pop.kind === 'job' ? s.jobById.get(pop.id) : null
  const [staffId, setStaffId] = useState(pop.kind === 'person' ? pop.id : '')
  const [jobId, setJobId] = useState(pop.kind === 'job' ? pop.id : '')
  const [note, setNote] = useState(weekNoteOf(job, pop.week))
  const items = s.assignments.filter((a) => a.week === pop.week && (pop.kind === 'job' ? a.jobId === pop.id : a.staffId === pop.id))
  const title = pop.kind === 'job' ? job?.name : s.staffById.get(pop.id)?.name
  const colour = job ? weekColourOf(job, pop.week, s.assignments) : ''
  const away = staffId ? s.awayOf(s.staffById.get(staffId), pop.week) : null
  const w = 340
  const left = Math.min(Math.max(8, pop.rect.left + pop.rect.width / 2 - w / 2), window.innerWidth - w - 8)
  const below = pop.rect.bottom + 6
  const top = below + 280 > window.innerHeight ? Math.max(8, pop.rect.top - 286) : below
  const saveNote = () => { if (job && s.canEdit && note.trim() !== weekNoteOf(job, pop.week)) s.setWeekNote(job, pop.week, note.trim()) }

  async function add(e) {
    e.preventDefault()
    if (!staffId || !jobId || away?.full) return
    await s.addAssignment({ jobId, staffId, week: pop.week, activity: '' })
    if (pop.kind === 'job') setStaffId('')
  }
  return (
    <>
      <div className="pt-pop-catch" onMouseDown={() => { saveNote(); onClose() }} />
      <div ref={ref} className="pt-pop pt-cellpop" role="dialog" aria-label={`Week of ${fmt(pop.week)}`} style={{ position: 'fixed', left, top, width: w }}
        onKeyDown={(e) => { if (e.key === 'Escape') { saveNote(); onClose() } }}>
        <div className="pt-row"><b className="pt-grow">Week of {fmt(pop.week)}</b><button type="button" className="icon-btn icon-btn-sm" aria-label="Close" onClick={() => { saveNote(); onClose() }}><X size={16} /></button></div>
        <div className="text-sm text-muted pt-ellipsis">{title}</div>
        {job && (s.canEdit ? (
          <>
            <label className="pt-row pt-stagerow" title="What this week is for the job, in the planning workbook's colours.">
              <span className="text-sm">This week</span>
              <select className="pt-grow" value={colour} aria-label="Colour of the job's week" onChange={(e) => s.setWeekColour(job, pop.week, e.target.value)}>
                <option value="">No colour</option>
                {(!colour || acts.includes(colour) ? acts : [colour, ...acts]).map((x) => <option key={x}>{x}</option>)}
              </select>
            </label>
            <label className="pt-row pt-stagerow" title="A few words for the week, like 'Superuser' or 'Wifi survey'.">
              <span className="text-sm">Note</span>
              <input className="input pt-grow" value={note} placeholder="e.g. Superuser, Wifi survey" aria-label="Note for the week" onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveNote() } }} />
            </label>
          </>
        ) : (colour || note) && <div className="pt-row">{colour && <ActivityChip activity={colour} />}{note && <span className="text-sm">{note}</span>}</div>)}
        {pop.kind === 'person' && away && <p className="text-sm text-muted">{away.full ? 'On leave all week, so can\u2019t be added to a job.' : `On leave ${away.label}.`}</p>}
        {items.length === 0 && <p className="text-sm text-muted">No one booked this week.</p>}
        {items.map((a) => {
          const p = s.staffById.get(a.staffId)
          const j = s.jobById.get(a.jobId)
          return (
            <div key={a.id} className="pt-row">
              <span className="pt-grow pt-ellipsis text-sm"><b>{a.tentative ? '?' : ''}{pop.kind === 'job' ? p?.initials || '?' : j?.customer || j?.name}</b>{pop.kind === 'job' && p ? ` ${p.name.split(' ')[0]}` : ''}{a.tentative ? ' (not confirmed)' : ''}</span>
              {s.canEdit && (
                <>
                  <button type="button" className="link-btn" onClick={() => s.updateAssignment(a, { tentative: !a.tentative })}>{a.tentative ? 'Confirm' : 'Not sure'}</button>
                  <button type="button" className="icon-btn icon-btn-sm" aria-label="Remove" onClick={() => s.removeAssignment(a)}><X size={15} /></button>
                </>
              )}
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
                  const away = s.awayOf(p, pop.week)
                  // Away all week: shown, greyed out and not pickable
                  const note = away?.full ? 'on leave' : [away && `leave ${away.label}`, busy && 'booked elsewhere'].filter(Boolean).join(', ')
                  return <option key={p.id} value={p.id} disabled={!!away?.full}>{p.initials} · {p.name}{note ? ` (${note})` : ''}</option>
                })}
              </select>
            ) : (
              <select value={jobId} onChange={(e) => setJobId(e.target.value)} aria-label="Job">
                <option value="">Add to a job…</option>
                {s.active.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            )}
            <Button size="sm" type="submit" disabled={!staffId || !jobId || !!away?.full}>Add</Button>
          </form>
        )}
      </div>
    </>
  )
}
