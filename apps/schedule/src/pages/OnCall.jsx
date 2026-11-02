import { useMemo } from 'react'
import { ShieldAlert } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { weekStartOf, addDaysISO, dayMonth } from '../utils/week'
import { shortNames } from '../utils/names'
import { weekConflicts } from '../utils/weekInsights'
import { writeOnCall } from '../utils/scheduleStore'
import { logActivity } from '../utils/activityLog'
import { useUsers, useSchedules, useOnCall } from '../hooks/useScheduleData'
import useFoldRosterCalls from '../hooks/useFoldRosterCalls'
import Toast, { useToast } from '../components/Toast'
import { Alert, Badge, Loading } from '../components/ui'

const WEEKS_SHOWN = 8

export default function OnCall() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const thisWeek = weekStartOf(new Date()) // on call runs Monday to Sunday: a weekend is still this week
  const weeks = useMemo(() => Array.from({ length: WEEKS_SHOWN }, (_, i) => addDaysISO(thisWeek, i * 7)), [thisWeek])

  const { users, loading: usersLoading } = useUsers()
  const { byWeek, loading: schedLoading, patch } = useSchedules(weeks)
  const { byWeek: oncall, blocked, loading: oncallLoading, set } = useOnCall(weeks)
  const [toast, showToast] = useToast()

  // Customer calls are typed into the schedule now; any still kept here the old way move across (admins only).
  useFoldRosterCalls({
    enabled: isAdmin, user, weeks, users, loading: usersLoading || schedLoading || oncallLoading,
    schedulesByWeek: byWeek, oncallByWeek: oncall, patch, setOnCall: set,
  })

  const names = useMemo(() => shortNames(users), [users])
  const engineers = useMemo(
    () => users.filter(u => u.team === 'Engineers').sort((a, b) => names.get(a.uid).localeCompare(names.get(b.uid))),
    [users, names]
  )

  const rows = weeks.map(w => {
    const schedules = byWeek[w] || {}
    const current = oncall[w]
    const issue = weekConflicts({ weekStart: w, users, schedules, oncall: current, names }).find(c => c.type === 'oncall')
    return {
      week: w,
      range: `${dayMonth(w)} – ${dayMonth(addDaysISO(w, 4))}`,
      current,
      name: current?.uid ? names.get(current.uid) || current.displayName : '',
      status: issue ? issue.short : 'Covered',
      tone: issue ? 'critical' : 'green',
    }
  })

  async function assign(week, uid) {
    const person = uid ? users.find(u => u.uid === uid) : null
    try {
      const saved = await writeOnCall(week, person, user.uid, oncall[week])
      set(week, saved)
      showToast(person ? `${names.get(uid)} is on call for the week starting ${dayMonth(week)}.` : `On call cleared for ${dayMonth(week)}.`)
      logActivity(user, person
        ? `Set ${names.get(uid)} on call for week of ${dayMonth(week)}.`
        : `Cleared on call for week of ${dayMonth(week)}.`)
    } catch (e) {
      console.error(e)
      showToast(e.code === 'permission-denied' ? 'Not allowed yet — the updated database rules need publishing.' : 'Could not save — try again.')
    }
  }

  const who = r => isAdmin ? (
    <select value={r.current?.uid || ''} onChange={e => assign(r.week, e.target.value)} aria-label={`On call, week starting ${dayMonth(r.week)}`}>
      <option value="">Unassigned</option>
      {engineers.map(u => <option key={u.uid} value={u.uid}>{names.get(u.uid)}</option>)}
    </select>
  ) : (r.name ? `${r.name} - OnCall` : 'Unassigned')

  const loading = usersLoading || schedLoading

  return (
    <div className="page">
      <div className="page-head-text">
        <h1 className="page-title">On-call roster</h1>
        <span className="page-sub">
          {isAdmin
            ? 'One engineer on call per week, set here. Customer calls are typed into the schedule — “Customer Calls” turns the cell yellow.'
            : 'One engineer on call per week. Customer calls are in the schedule, in yellow.'}
        </span>
      </div>

      {blocked && isAdmin && (
        <Alert tone="warning" icon={<ShieldAlert size={20} />} title="Roster not switched on yet">
          The database rules need updating before on-call can be saved — publish the latest <code>firestore.rules</code> in the Firebase Console (Firestore → Rules).
        </Alert>
      )}

      {loading ? <Loading /> : (
        <>
          <div className="oc-table">
            <div className="oc-cols oc-headrow">
              <div>Week starting</div>
              <div>On call</div>
              <div>Status</div>
            </div>
            {rows.map(r => (
              <div key={r.week} className={`oc-cols oc-row${r.week === thisWeek ? ' current' : ''}`}>
                <div className="oc-week">
                  <span className="oc-week-label">{dayMonth(r.week)}</span>
                  <span className="oc-week-range">{r.range}</span>
                </div>
                <div className={`oc-who${r.current?.uid ? ' assigned' : ''}`}>{who(r)}</div>
                <div className="oc-status"><Badge tone={r.tone}>{r.status}</Badge></div>
              </div>
            ))}
          </div>

          <div className="oc-cards">
            {rows.map(r => (
              <div key={r.week} className={`oc-card${r.week === thisWeek ? ' current' : ''}`}>
                <div className="oc-card-head">
                  <div className="oc-week">
                    <span className="oc-week-label">{dayMonth(r.week)}{r.week === thisWeek ? ' · this week' : ''}</span>
                    <span className="oc-week-range">{r.range}</span>
                  </div>
                  <Badge tone={r.tone}>{r.status}</Badge>
                </div>
                <div className={`oc-card-body${r.current?.uid ? ' assigned' : ''}`}>{who(r)}</div>
              </div>
            ))}
          </div>
        </>
      )}

      <Toast message={toast} />
    </div>
  )
}
