/* Jobs for the one app's Ctrl+K (apps/hub/src/Palette.jsx). Loaded the first
   time the search opens, not with the tracker: the same live data the tracker
   reads, through the same backend, searched by the same searchJobs as the
   tracker's own job search (which, with its filters, is still its search
   button). A job opens in the tracker with its panel open. */
import { getBackend } from './backend.js'
import { fmtRange, fmtY, searchJobs, withDefaults } from './model.js'

/** Starts watching; calls onData with the latest whenever anything changes. Returns stop(). */
export function start(_user, onData) {
  let state = { jobs: [], comments: [], assignments: [], settings: withDefaults(null) }
  let stops = []
  let stopped = false
  // A section someone can't read (rules) just adds nothing to the search.
  const quiet = () => {}
  getBackend().then((be) => {
    if (stopped) return
    stops = ['jobs', 'assignments', 'comments'].map((col) =>
      be.watch(col, (list) => { state = { ...state, [col]: list }; onData(state) }, quiet))
    stops.push(be.watchSettings((s) => { state = { ...state, settings: withDefaults(s) }; onData(state) }, quiet))
  }).catch(quiet)
  return () => { stopped = true; stops.forEach((s) => s()) }
}

export function search(q, state) {
  if (!state?.jobs?.length) return []
  return searchJobs(q, state.jobs, { comments: state.comments, assignments: state.assignments, staff: state.settings.staff })
    .map((r) => ({
      key: 'job:' + r.job.id,
      group: 'jobs',
      title: r.job.name,
      parts: r.title,
      sub: [
        r.job.archived ? `Archived · completed ${fmtY(r.job.completedAt || r.job.archivedAt) || '?'}` : [r.job.status, fmtRange(r.job.start, r.job.end)].filter(Boolean).join(' · '),
        r.job.customer, r.job.region,
      ].filter(Boolean).join(' · '),
      detail: r.field ? { label: r.field, parts: r.preview } : null,
      href: `/projects/#/${r.job.archived ? 'archive' : 'table'}?job=${encodeURIComponent(r.job.id)}`,
      score: r.score,
    }))
}
