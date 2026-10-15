/* Backups: one JSON file with everything the tracker keeps, exactly as
   stored, so it can be put back. The nightly backup writes this same format
   to Google Drive (chs-equipment/.gas-backup/Code.js, readProjectTracker_());
   Settings → Backups can download one now and restore from either.

   {
     kind: 'project-tracker-backup', version: 1,
     takenAt: ISO time, source: 'nightly' | 'download' | 'before-restore',
     collections: {
       projectJobs: { [id]: job }, projectAssignments: { [id]: week },
       projectComments: { [id]: comment }, projectHistory: { [id]: entry },
       projectSettings: { main: settings },
     },
   }

   Who-is-online (projectPresence) is left out: it is only ever current.
   Plain functions, so tests/backup.test.mjs runs them under node --test. */

export const BACKUP_KIND = 'project-tracker-backup'

// Backend collection name (backend.js) -> Firestore collection in the file
const COLS = { jobs: 'projectJobs', assignments: 'projectAssignments', comments: 'projectComments', history: 'projectHistory' }

const byId = (list) => Object.fromEntries((list || []).map(({ id, ...rest }) => [id, rest]))

/** A backup of what the tracker holds now. `settings` is the stored settings document, not the defaults-filled copy. */
export function makeBackup({ jobs, assignments, comments, history, settings }, { source = 'download', takenAt = new Date().toISOString() } = {}) {
  return {
    kind: BACKUP_KIND,
    version: 1,
    takenAt,
    source,
    collections: {
      projectJobs: byId(jobs),
      projectAssignments: byId(assignments),
      projectComments: byId(comments),
      projectHistory: byId(history),
      projectSettings: settings ? { main: settings } : {},
    },
  }
}

export const backupFileName = (b) => `Project-Tracker-${String(b.takenAt).slice(0, 10)}${b.source === 'before-restore' ? '-before-restore' : ''}.json`

/** Checks a parsed file is a tracker backup; throws a message a person can act on if not. */
export function readBackup(obj) {
  if (obj?.kind === 'project-tracker-import') throw new Error('This is an import file, not a backup. Use Import from a file for it.')
  if (obj?.kind !== BACKUP_KIND || !obj.collections || typeof obj.collections !== 'object') {
    throw new Error('This is not a project tracker backup. Backups are the Project-Tracker-….json files in the "CMCHS Project Tracker Backups" folder in Google Drive.')
  }
  if (Number(obj.version) > 1) throw new Error('This backup was made by a newer version of the tracker. Reload the page and try again.')
  const c = obj.collections
  const map = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {})
  return {
    takenAt: obj.takenAt || '',
    source: obj.source || '',
    collections: {
      projectJobs: map(c.projectJobs),
      projectAssignments: map(c.projectAssignments),
      projectComments: map(c.projectComments),
      projectHistory: map(c.projectHistory),
      projectSettings: map(c.projectSettings),
    },
  }
}

/** JSON with keys in a fixed order, so two copies of the same record compare equal. */
export function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  }
  return JSON.stringify(v ?? null)
}

/**
 * What putting a backup back would do, against what the tracker holds now.
 *   mode 'merge': put back every job, week and setting as it was in the
 *     backup; anything added since stays.
 *   mode 'exact': the same, and jobs and weeks added since are removed.
 * Comments and history are a record of what happened: missing ones are put
 * back, nothing newer is ever removed, and existing ones are never changed
 * (the security rules don't allow either).
 *
 * Returns { main, append, summary }: `main` and `append` are backend batch
 * operations ({ op, col, id, data }); `append` is the comments and history,
 * kept apart because the rules only let an admin re-add someone else's.
 */
export function restorePlan(backup, current, mode = 'merge') {
  const main = []
  const append = []
  const summary = {}
  for (const [col, name] of Object.entries(COLS)) {
    const saved = backup.collections[name]
    const now = new Map((current[col] || []).map(({ id, ...rest }) => [id, rest]))
    const s = { inBackup: Object.keys(saved).length, missing: 0, changed: 0, added: 0, removed: 0 }
    const appendOnly = col === 'comments' || col === 'history'
    for (const [id, data] of Object.entries(saved)) {
      if (!now.has(id)) {
        s.missing++
        ;(appendOnly ? append : main).push({ op: 'set', col, id, data })
      } else if (!appendOnly && stable(now.get(id)) !== stable(data)) {
        s.changed++
        main.push({ op: 'set', col, id, data })
      }
    }
    for (const id of now.keys()) {
      if (id in saved) continue
      s.added++
      if (mode === 'exact' && !appendOnly) { s.removed++; main.push({ op: 'delete', col, id }) }
    }
    summary[col] = s
  }
  const savedSettings = backup.collections.projectSettings.main
  summary.settingsChanged = Boolean(savedSettings) && stable(savedSettings) !== stable(current.settings || null)
  if (summary.settingsChanged) main.push({ op: 'set', col: 'settings', id: 'main', data: savedSettings })
  summary.changes = main.length + append.length
  return { main, append, summary }
}
