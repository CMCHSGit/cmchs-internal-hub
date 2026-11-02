import { useEffect, useRef } from 'react'
import { foldRosterCalls } from '../utils/scheduleStore'
import { logActivity } from '../utils/activityLog'

/**
 * Customer calls are typed into each person's own entry now. Weeks that still carry them the old way (cover on
 * the roster, or a day's own flag) are moved into the entries' text the first time an admin has them on screen
 * — see foldRosterCalls. Everyone else keeps seeing the old cover as before, and nothing is written for them.
 * Each week is tried once per visit, so a refused write doesn't loop.
 */
export default function useFoldRosterCalls({ enabled, user, weeks, loading, users, schedulesByWeek, oncallByWeek, patch, setOnCall }) {
  const tried = useRef(new Set())
  useEffect(() => {
    if (!enabled || loading || !user || !users.length) return
    for (const weekStart of weeks) {
      if (tried.current.has(weekStart)) continue
      tried.current.add(weekStart)
      foldRosterCalls({ weekStart, oncall: oncallByWeek[weekStart], schedules: schedulesByWeek[weekStart] || {}, users, editorUid: user.uid })
        .then(done => {
          if (!done) return
          for (const s of done.schedules) patch(weekStart, s.uid, s.saved)
          if (done.oncall) setOnCall(weekStart, done.oncall)
          logActivity(user, `Moved customer calls into the schedule entries for the week of ${weekStart}.`)
        })
        .catch(e => console.error('Could not move customer calls into the schedule:', e))
    }
  }, [enabled, loading, user, weeks, users, schedulesByWeek, oncallByWeek, patch, setOnCall])
}
