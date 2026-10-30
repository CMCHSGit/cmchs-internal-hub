// Every background job we run, for Settings → Background jobs (admins only).
// Each job reports how its runs went to Firestore `jobRuns/{id}`
// (shared/jobReport.mjs from Node and the PC, reportJob_ in Apps Script); this
// list says what each one is, where it runs and how long a silence is too long.
//
// `staleMin` is how many minutes may pass since its last run before the page
// calls it overdue: about twice the gap between runs, more over a weekend.

const DAY = 24 * 60

export const JOB_GROUPS = [
  { id: 'github', label: 'GitHub (the hub repo)' },
  { id: 'script', label: 'Google Apps Script' },
  { id: 'pc',     label: 'Jonathan’s PC' },
]

export const JOBS = [
  { id: 'deploy',        group: 'github', name: 'Site deploy',                does: 'Builds the hub and publishes it to internal.chsnz.co.nz.',        when: 'Every hour, and on every change', staleMin: 3 * 60 },
  { id: 'asks-summary',  group: 'github', name: 'Asks morning summary',       does: 'Tells people how many asks are waiting for them.',                when: '08:30 on weekdays',               staleMin: 4 * DAY },
  { id: 'remind',        group: 'github', name: 'Thursday schedule reminder', does: 'Reminds people to fill in next week’s schedule.',                 when: 'Thursday 08:00',                  staleMin: 8 * DAY },
  { id: 'prune-devices', group: 'github', name: 'Device clean-up',            does: 'Removes notification devices that no longer exist.',              when: 'Monday 07:00',                    staleMin: 8 * DAY },
  { id: 'tile-sync',     group: 'github', name: 'Tile location sync',         does: 'Copies where each Tile tracker is into the demo tracker.',        when: 'Every day 07:00',                 staleMin: 2 * DAY },

  { id: 'backup-equipment', group: 'script', name: 'Backup: demo tracker spreadsheet', does: 'Writes a dated spreadsheet of the demo tracker to Drive.',       when: 'Every day 03:00', staleMin: 2 * DAY },
  { id: 'backup-tracker',   group: 'script', name: 'Backup: demo tracker JSON',        does: 'Keeps a full copy of the demo tracker’s data in Drive.',         when: 'Every day 03:00', staleMin: 2 * DAY },
  { id: 'backup-projects',  group: 'script', name: 'Backup: project tracker',          does: 'Keeps a full copy of the project tracker in Drive.',             when: 'Every day 03:00', staleMin: 2 * DAY },
  { id: 'backup-asks',      group: 'script', name: 'Backup: asks',                     does: 'Keeps a full copy of the asks and their conversations in Drive.', when: 'Every day 03:00', staleMin: 2 * DAY },
  { id: 'backup-activity',  group: 'script', name: 'Backup: activity log',             does: 'Adds the day’s activity log lines to the monthly files in Drive.', when: 'Every day 03:00', staleMin: 2 * DAY },
  { id: 'demo-reminders',   group: 'script', name: 'Demo reminders',                   does: 'Sends the loans-starting-today reminders and calendar invites.', when: 'Every day 08:00', staleMin: 2 * DAY },
  { id: 'return-reminders', group: 'script', name: 'Return reminders',                 does: 'Sends the due-soon and overdue loan reminders.',                 when: 'Every day 08:00', staleMin: 2 * DAY },
  { id: 'stuck-loans',      group: 'script', name: 'Stuck loan reminders',             does: 'Chases loans stuck waiting on a test or a booking.',             when: 'Every 4 hours',   staleMin: 12 * 60 },
  { id: 'ask-sweep',        group: 'script', name: 'Ask sweep',                        does: 'Sends the push messages for new and changed asks.',              when: 'Every 5 minutes', staleMin: 30 },

  { id: 'excel-import',    group: 'pc', name: 'Excel → schedule', does: 'Brings changes made in the Excel schedule into the app.',    when: 'Every 5 minutes', staleMin: 30 },
  { id: 'excel-writeback', group: 'pc', name: 'Schedule → Excel', does: 'Writes what people put in the app into the Excel schedule.', when: 'Every 5 minutes', staleMin: 30 },
]

export const jobById = id => JOBS.find(j => j.id === id)

/**
 * How one job looks, from its jobRuns document (or none).
 *   never   it has never reported
 *   failing its last run failed
 *   overdue its last run is older than staleMin
 *   ok      its last run worked and is recent
 */
export function jobHealth(job, run, now = Date.now()) {
  if (!run || !run.lastRunMs) return 'never'
  if (run.lastOk === false) return 'failing'
  if (now - run.lastRunMs > job.staleMin * 60000) return 'overdue'
  return 'ok'
}

/** "3 min ago", "2 h ago", "4 days ago". */
export function ago(ms, now = Date.now()) {
  if (!ms) return 'never'
  const m = Math.max(0, Math.round((now - ms) / 60000))
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 48 * 60) return `${Math.round(m / 60)} h ago`
  return `${Math.round(m / (24 * 60))} days ago`
}
