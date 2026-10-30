/*
 * Settings → Background jobs (admins only): every timed job we run, and how its
 * last run went, so a failure shows here instead of being found by someone
 * noticing something stopped. The list is shared/jobs.js; each job writes its
 * own result to Firestore jobRuns/{id} when it finishes (shared/jobReport.mjs,
 * reportJob_ in Apps Script). Only counts and plain words are ever stored.
 */
import { useEffect, useMemo, useState } from 'react'
import { collection, onSnapshot } from 'firebase/firestore'
import { AlertTriangle, CheckCircle2, CircleHelp, Clock } from 'lucide-react'
import { db } from '../../schedule/src/firebase'
import { Loading } from '../../../shared/ui/index.jsx'
import { JOBS, JOB_GROUPS, ago, jobHealth } from '../../../shared/jobs.js'

const HEALTH = {
  failing: { label: 'Failed', Icon: AlertTriangle, rank: 0 },
  overdue: { label: 'Overdue', Icon: Clock,         rank: 1 },
  never:   { label: 'No report yet', Icon: CircleHelp, rank: 2 },
  ok:      { label: 'Working', Icon: CheckCircle2,  rank: 3 },
}

export default function Jobs() {
  const [runs, setRuns] = useState(null)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const stop = onSnapshot(collection(db, 'jobRuns'),
      snap => setRuns(Object.fromEntries(snap.docs.map(d => [d.id, d.data()]))),
      e => setError(e.code === 'permission-denied'
        ? 'The rules for this page are not published yet, or you are not an admin. Publish rules/firestore.rules in the Firebase console.'
        : 'Could not read the job reports: ' + (e.message || e.code)))
    const tick = setInterval(() => setNow(Date.now()), 30000) // "3 min ago" keeps counting
    return () => { stop(); clearInterval(tick) }
  }, [])

  const rows = useMemo(() => JOBS.map(job => ({ job, run: runs?.[job.id], health: jobHealth(job, runs?.[job.id], now) })), [runs, now])
  const counts = useMemo(() => {
    const c = { failing: 0, overdue: 0, never: 0, ok: 0 }
    for (const r of rows) c[r.health]++
    return c
  }, [rows])

  if (error) return <div className="page admin-page"><div className="card st-card"><p>{error}</p></div></div>
  if (!runs) return <div className="page admin-page"><Loading /></div>

  const bad = counts.failing + counts.overdue
  return (
    <div className="page admin-page">
      <div className={`card st-card jobs-summary ${bad ? 'bad' : 'good'}`} role="status">
        {bad
          ? <><AlertTriangle size={20} aria-hidden="true" /><span><b>{bad} {bad === 1 ? 'job needs' : 'jobs need'} a look.</b> {counts.failing > 0 && `${counts.failing} failed`}{counts.failing > 0 && counts.overdue > 0 && ', '}{counts.overdue > 0 && `${counts.overdue} overdue`}.</span></>
          : <><CheckCircle2 size={20} aria-hidden="true" /><span><b>Everything that has reported is working.</b>{counts.never > 0 && ` ${counts.never} ${counts.never === 1 ? 'job has' : 'jobs have'} not reported yet.`}</span></>}
      </div>

      {JOB_GROUPS.map(g => {
        const list = rows.filter(r => r.job.group === g.id).sort((a, b) => HEALTH[a.health].rank - HEALTH[b.health].rank)
        return (
          <section key={g.id} className="jobs-group">
            <h2 className="st-card-title">{g.label}</h2>
            <div className="card jobs-list">
              {list.map(({ job, run, health }) => {
                const H = HEALTH[health]
                return (
                  <div key={job.id} className={`jobs-row ${health}`}>
                    <span className="jobs-state"><H.Icon size={16} aria-hidden="true" /><span>{H.label}</span></span>
                    <div className="jobs-what">
                      <b>{job.name}</b>
                      <span className="jobs-does">{job.does} {job.when}.</span>
                    </div>
                    <div className="jobs-times">
                      <span>Last run: {ago(run?.lastRunMs, now)}</span>
                      <span>Last worked: {ago(run?.lastSuccessMs, now)}</span>
                      {run?.lastFailureMs ? <span>Last failed: {ago(run.lastFailureMs, now)}</span> : null}
                    </div>
                    {(health === 'failing' || health === 'overdue') && run?.lastMessage && (
                      <p className="jobs-msg">{health === 'failing' && run.failuresInARow > 1 ? `Failed ${run.failuresInARow} runs in a row. ` : ''}{run.lastMessage}</p>
                    )}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
      <p className="st-note">Overdue means a job has not run for about twice as long as it should. A job that has never reported either has not run since this page was added, or is not connected to it yet.</p>
    </div>
  )
}
