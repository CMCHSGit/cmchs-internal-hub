/* Home: this week and next at a glance, and the things that need chasing. */

import { useMemo } from 'react'
import { Badge } from '../../../schedule/src/components/ui'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { Avatar, ActivityChip, StatusPill, Empty } from '../ui.jsx'
import {
  WAITING, addDays, fmt, mondayOf, weeksFrom, shortfalls, overdueReturns, daysBetween, MONTHS_LONG, toDate,
} from '../model.js'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function Home() {
  const s = useStore()
  const ui = useUi()
  const today = s.today
  const thisWeek = mondayOf(today)
  const activeIds = useMemo(() => new Set(s.active.map((j) => j.id)), [s.active])

  const week = (monday) => {
    const rows = s.assignments.filter((a) => a.week === monday && activeIds.has(a.jobId))
      .map((a) => ({ a, job: s.jobById.get(a.jobId), p: s.staffById.get(a.staffId) }))
      .sort((x, y) => (x.p?.name || '').localeCompare(y.p?.name || ''))
    const busy = new Set(rows.map((r) => r.a.staffId))
    const free = s.settings.staff.filter((p) => !busy.has(p.id)).map((p) => p.initials)
    return { rows, free }
  }
  const weeks = [['This week', thisWeek, 'purple'], ['Next week', addDays(thisWeek, 7), 'stripes']].map(([t, m, accent]) => ({ title: `${t} · ${fmt(m)}`, accent, ...week(m) }))

  const overdue = s.active.flatMap((j) => (j.actions || []).filter((a) => !a.done && a.due && a.due < today).map((a) => ({ a, j })))
    .sort((x, y) => x.a.due.localeCompare(y.a.due))
  const waiting = s.active.filter((j) => j.status === WAITING)
  const freight = s.active.filter((j) => j.freight?.tracking && !j.freight?.arrived && j.freight?.state !== 'At office' && j.freight?.state !== 'Delivered to site')
    .sort((a, b) => String(a.freight.eta || '9').localeCompare(String(b.freight.eta || '9')))
  const golives = useMemo(() => {
    const seen = new Map()
    for (const a of s.assignments) {
      if (a.activity !== 'Go-live' || a.week < thisWeek || !activeIds.has(a.jobId)) continue
      const cur = seen.get(a.jobId)
      if (!cur || a.week < cur.week) seen.set(a.jobId, { week: a.week, people: new Set() })
    }
    for (const a of s.assignments) if (a.activity === 'Go-live' && seen.get(a.jobId)?.week === a.week) seen.get(a.jobId).people.add(a.staffId)
    for (const j of s.active) if (j.status === 'Go-live' && !seen.has(j.id)) seen.set(j.id, { week: j.start || thisWeek, people: new Set() })
    return [...seen].map(([id, v]) => ({ job: s.jobById.get(id), ...v })).filter((x) => x.job).sort((a, b) => a.week.localeCompare(b.week)).slice(0, 5)
  }, [s.assignments, s.active, s.jobById, thisWeek, activeIds])
  const shorts = useMemo(() => shortfalls(s.jobs, s.settings.pool, weeksFrom(thisWeek, 6), today), [s.jobs, s.settings.pool, thisWeek, today])
  const returns = useMemo(() => overdueReturns(s.jobs, today), [s.jobs, today])
  const d = toDate(today)

  const open = (j) => ui.openJob(j.id, j.archived ? 'archive' : 'home')
  const JobLink = ({ j }) => <button type="button" className="pt-joblink" onClick={() => open(j)}>{j.name}</button>

  return (
    <div className="pt-page pt-home">
      <div className="pt-pagehead">
        <div>
          <div className="overline">{DAYS[d.getDay()]} {fmt(today)}</div>
          <h1 className="pt-h1">Home</h1>
        </div>
        <div className="pt-stats">
          <a className="pt-stat" href="#/table"><b>{s.active.length}</b> active jobs</a>
          <a className="pt-stat" href="#/table?view=waiting"><b className="pt-warn">{waiting.length}</b> waiting on something</a>
          <span className="pt-stat"><b className={overdue.length ? 'pt-bad' : ''}>{overdue.length}</b> overdue actions</span>
        </div>
      </div>

      {s.active.length === 0 && <FirstRun />}

      <div className="pt-cards pt-cards-2">
        {weeks.map((w) => (
          <section key={w.title} className={`card pt-card cap-${w.accent}`}>
            <div className="pt-card-head"><h2 className="pt-h3">{w.title}</h2><a href="#/timeline" className="link-btn">Open timeline</a></div>
            {w.rows.length === 0 && <Empty>No one booked.</Empty>}
            <ul className="pt-list">
              {w.rows.map(({ a, job, p }) => (
                <li key={a.id} className="pt-row">
                  <Avatar person={p} />
                  <span className="pt-grow pt-col">
                    <JobLink j={job} />
                    <span className="text-sm text-muted">{[(a.tentative ? '? ' : '') + (p?.name || '?'), job.customer || job.region].filter(Boolean).join(' · ')}{a.tentative ? ' (not confirmed)' : ''}</span>
                  </span>
                  <ActivityChip activity={a.activity} />
                </li>
              ))}
            </ul>
            {s.settings.staff.length > 0 && <p className="text-sm text-muted pt-free">{w.free.length ? `Not booked: ${w.free.join(', ')}` : 'Everyone is booked.'}</p>}
          </section>
        ))}
      </div>

      <div className="pt-cards pt-cards-3">
        <section className="card pt-card">
          <div className="pt-card-head"><h2 className="pt-h4">Overdue action points</h2>{overdue.length > 0 && <Badge tone="critical">{overdue.length} overdue</Badge>}</div>
          {overdue.length === 0 && <Empty>Nothing overdue.</Empty>}
          <ul className="pt-list">
            {overdue.slice(0, 8).map(({ a, j }) => (
              <li key={j.id + a.id} className="pt-col pt-row-top">
                <ActionTick job={j} action={a} />
                <span className="text-sm text-muted pt-indent"><JobLink j={j} /> · {a.owner || 'no owner'} · <span className="pt-bad">due {fmt(a.due)}</span></span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card pt-card">
          <div className="pt-card-head"><h2 className="pt-h4">Waiting on something</h2><StatusPill status={WAITING} small /></div>
          {waiting.length === 0 && <Empty>Nothing is waiting.</Empty>}
          <ul className="pt-list">
            {waiting.map((j) => (
              <li key={j.id} className="pt-col pt-row-top">
                <JobLink j={j} />
                <span className="text-sm"><span className="text-muted">Waiting on</span> <b>{j.waitingOn || 'not said'}</b>{j.waitingSince && <span className="text-muted"> · since {fmt(j.waitingSince)} ({daysBetween(j.waitingSince, today)} days)</span>}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card pt-card">
          <div className="pt-card-head"><h2 className="pt-h4">Freight on the way</h2></div>
          {freight.length === 0 && <Empty>No freight being tracked.</Empty>}
          <ul className="pt-list">
            {freight.slice(0, 6).map((j) => {
              const late = j.freight.eta && j.freight.eta < today
              return (
                <li key={j.id} className="pt-col pt-row-top">
                  <span className="pt-row"><span className="pt-grow"><JobLink j={j} /></span><Badge tone={late ? 'critical' : j.freight.state === 'Arrived in NZ' ? 'green' : 'purple'}>{late ? 'Late' : j.freight.state || 'Not shipped'}</Badge></span>
                  <span className="text-sm text-muted"><span className="pt-mono">{j.freight.tracking}</span>{j.freight.eta && <> · ETA {fmt(j.freight.eta)}</>}</span>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <div className="pt-cards pt-cards-2">
        <section className="card pt-card cap-green">
          <div className="pt-card-head"><h2 className="pt-h4">Upcoming go-lives</h2></div>
          {golives.length === 0 && <Empty>No go-lives booked.</Empty>}
          <ul className="pt-list">
            {golives.map((g) => {
              const gd = toDate(g.week)
              return (
                <li key={g.job.id} className="pt-row">
                  <span className="pt-datebox"><b>{String(gd.getDate()).padStart(2, '0')}</b><span>{MONTHS_LONG[gd.getMonth()].slice(0, 3)}</span></span>
                  <span className="pt-grow pt-col">
                    <JobLink j={g.job} />
                    <span className="text-sm text-muted">{g.job.customer ? `${g.job.customer} · ` : ''}week of {fmt(g.week)}{g.people.size > 0 && ' · ' + [...g.people].map((id) => s.staffById.get(id)?.initials).filter(Boolean).join(', ')}</span>
                  </span>
                  <StatusPill status={g.job.status} small />
                </li>
              )
            })}
          </ul>
        </section>

        <section className="card pt-card">
          <div className="pt-card-head"><h2 className="pt-h4">Demo equipment, next 6 weeks</h2><a href="#/equipment" className="link-btn">Equipment view</a></div>
          {shorts.length === 0 && <Empty>{s.settings.pool.some((p) => p.total != null) ? 'No shortfalls.' : 'Set pool sizes in Settings to check for shortfalls.'}</Empty>}
          <ul className="pt-list">
            {shorts.map((x) => (
              <li key={x.model} className="pt-row">
                <span className={`pt-ratio ${x.level}`}>{x.booked}/{x.owned}</span>
                <span className="pt-grow pt-col">
                  <span><b className="pt-mono">{x.model}</b> · week of {fmt(x.week)}</span>
                  <span className="text-sm text-muted">{x.level === 'short' ? `Short by ${x.booked - x.owned}` : 'Fully booked'} · {[...new Set(x.entries.map((e) => e.job.name))].join(', ')}</span>
                </span>
              </li>
            ))}
          </ul>
          <div className="overline pt-sub">Overdue for return</div>
          {returns.length === 0 && <Empty>Nothing overdue.</Empty>}
          <ul className="pt-list">
            {returns.map((r) => (
              <li key={r.job.id + r.line.id} className="pt-row">
                <span className="pt-grow pt-col">
                  <span><b className="pt-mono">{r.qty}x {r.model}</b>{r.line.note && <span className="pt-mono"> {r.line.note}</span>} at {r.job.customer || r.job.name}</span>
                  <span className="text-sm text-muted">From <JobLink j={r.job} />{r.job.archived && ' (archived)'} · due back {fmt(r.due)}</span>
                </span>
                <Badge tone="critical">{r.days} {r.days === 1 ? 'day' : 'days'}</Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function ActionTick({ job, action }) {
  const s = useStore()
  return (
    <label className="pt-check">
      <input type="checkbox" disabled={!s.canEdit} onChange={(e) => s.mutateJob(job.id, (cur) => ({ actions: (cur.actions || []).map((x) => (x.id === action.id ? { ...x, done: e.target.checked, doneBy: s.me.name, doneAt: s.today } : x)) }), `ticked off "${action.text}"`)} />
      <span>{action.text}</span>
    </label>
  )
}

function FirstRun() {
  const s = useStore()
  const ui = useUi()
  return (
    <section className="card pt-card cap-stripes">
      <h2 className="pt-h3">No jobs yet</h2>
      <p className="text-sm">Import the project sheets (an import file, Excel or CSV), add the first job, or load the sample jobs to try the tracker out. Sample jobs can be removed again from Settings in one go.</p>
      {s.canEdit && (
        <div className="pt-addrow">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => ui.openImport()}>Import from a file</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => ui.newJob()}>New job</button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => s.loadSample().then(() => ui.toast('Sample jobs loaded'))}>Load sample jobs</button>
        </div>
      )}
    </section>
  )
}
