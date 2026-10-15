/* The tracker's live data and every change to it, shared with the screens
   through React context.

   Everything is a live listener: when one project manager edits a job, the
   others see it within a second or so, in every view, without refreshing.
   Each change to a job is also written to its history (who, what, when). */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { getBackend } from './backend.js'
import {
  withDefaults, initialsOf, todayISO, addDays, fmt, dueForAutoArchive, COMPLETE, WAITING, mondayOf, rid,
} from './model.js'
import { summarise, effectivePool } from './feed.js'
import { readBackup, restorePlan } from './backup.js'
import { SAMPLE_JOBS, SAMPLE_ASSIGNMENTS, SAMPLE_COMMENTS, SAMPLE_STAFF, SAMPLE_POOL } from './sample.js'
import { TEAMS } from '../../schedule/src/utils/teams.js'

const Ctx = createContext(null)
export const useStore = () => useContext(Ctx)

const ONLINE_MS = 70 * 1000
const BEAT_MS = 25 * 1000
const FEED_EVERY_MS = 10 * 60 * 1000
// The last good read of the demo tracker, so the figures survive the feed
// being down (shown marked out of date). Trimmed to what the tracker uses.
const FEED_CACHE = 'projects_demo_feed'

function cachedFeed() {
  try {
    const c = JSON.parse(localStorage.getItem(FEED_CACHE) || 'null')
    if (c && c.raw && c.at) return c
  } catch { /* no cache */ }
  return null
}

export function StoreProvider({ children }) {
  const [be, setBe] = useState(null)
  const [user, setUser] = useState(undefined) // undefined = not known yet
  const [profile, setProfile] = useState(null)
  const [data, setData] = useState({ jobs: null, assignments: [], comments: [], history: [], presence: [] })
  const [settingsRaw, setSettingsRaw] = useState(undefined)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  const viewing = useRef(null)
  // The demo tracker feed. ok: the last read worked. at: when the figures in
  // raw were read. failedAt/error: the last attempt that didn't.
  const [feed, setFeed] = useState(() => {
    const c = cachedFeed()
    return { raw: c?.raw || null, at: c?.at || null, ok: false, loading: false, error: '', failedAt: null }
  })
  const feedBusy = useRef(false)

  // ── sign-in ──
  useEffect(() => {
    let unsub = () => {}
    getBackend().then((b) => {
      setBe(b)
      unsub = b.watchAuth(async (u) => {
        setUser(u)
        if (!u) return setProfile(null)
        try { setProfile(await b.profile(u.uid)) } catch { setProfile({}) }
      })
    }).catch((e) => setError('The tracker could not start: ' + (e.message || e)))
    return () => unsub()
  }, [])

  // ── live data ──
  useEffect(() => {
    if (!be || !user) return
    const fail = (what) => (e) => setError(e?.code === 'permission-denied'
      ? `Firestore refused to read the ${what}. The project tracker's security rules may not be published yet.`
      : `Could not load the ${what}: ${e?.message || e}`)
    const subs = ['jobs', 'assignments', 'comments', 'history', 'presence'].map((col) =>
      be.watch(col, (list) => setData((d) => ({ ...d, [col]: list })), fail(col === 'jobs' ? 'jobs' : col)))
    subs.push(be.watchSettings((s) => setSettingsRaw(s), fail('settings')))
    return () => subs.forEach((u) => u())
  }, [be, user])

  const settings = useMemo(() => withDefaults(settingsRaw), [settingsRaw])
  const today = todayISO()

  // ── demo tracker feed: read on opening and every 10 minutes, or on Refresh ──
  const refreshFeed = useCallback(async () => {
    if (!be?.demoFeed || feedBusy.current) return
    feedBusy.current = true
    setFeed((f) => ({ ...f, loading: true }))
    try {
      const raw = await be.demoFeed()
      const at = Date.now()
      try { localStorage.setItem(FEED_CACHE, JSON.stringify({ raw, at })) } catch { /* full or blocked: still use it */ }
      setFeed({ raw, at, ok: true, loading: false, error: '', failedAt: null })
    } catch (e) {
      setFeed((f) => ({ ...f, ok: false, loading: false, error: e?.message || String(e), failedAt: Date.now() }))
    } finally {
      feedBusy.current = false
    }
  }, [be])
  useEffect(() => {
    if (!be || !user) return
    refreshFeed()
    const t = setInterval(refreshFeed, FEED_EVERY_MS)
    return () => clearInterval(t)
  }, [be, user, refreshFeed])
  const feedSummary = useMemo(() => (feed.raw ? summarise(feed.raw, settings.pool, today) : null), [feed.raw, settings.pool, today])
  const pool = useMemo(() => effectivePool(settings.pool, feedSummary), [settings.pool, feedSummary])

  // Same test as canEditProjects() in firestore.rules: an admin, or anyone on a team.
  const canEdit = Boolean(profile && (profile.role === 'admin' || TEAMS.includes(profile.team)))

  // Built from plain values only, so a fresh copy of the settings (another
  // tab or person saving) doesn't make a "new" me and set off a heartbeat.
  const meName = user ? profile?.displayName || user.name : ''
  const meEmail = (user?.email || '').toLowerCase()
  const meStaffId = settings.staff.find((p) => (p.email && p.email.toLowerCase() === meEmail) || p.name === meName)?.id || null
  const meUid = user?.uid || null
  const me = useMemo(() => (meUid ? { uid: meUid, name: meName, initials: initialsOf(meName), staffId: meStaffId } : null), [meUid, meName, meStaffId])

  // ── presence: a heartbeat every 25 s while the tracker is open ──
  const beat = useCallback(() => {
    if (!be || !me) return
    be.set('presence', me.uid, { name: me.name, initials: me.initials, atMs: Date.now(), jobId: viewing.current || '' }).catch(() => {})
  }, [be, me])
  useEffect(() => {
    if (!be || !me) return
    beat()
    const t = setInterval(() => { beat(); setTick((n) => n + 1) }, BEAT_MS)
    const gone = () => be.update('presence', me.uid, { atMs: 0 }).catch(() => {})
    window.addEventListener('pagehide', gone)
    return () => { clearInterval(t); window.removeEventListener('pagehide', gone) }
  }, [be, me, beat])
  const setViewing = useCallback((jobId) => {
    if (viewing.current === jobId) return
    viewing.current = jobId
    beat()
  }, [beat])

  const online = useMemo(() => {
    const now = Date.now()
    return data.presence.filter((p) => p.atMs > now - ONLINE_MS).sort((a, b) => (a.id === me?.uid ? -1 : b.id === me?.uid ? 1 : a.name.localeCompare(b.name)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.presence, tick, me])

  const latest = useRef({ jobs: null, settings })
  latest.current = { jobs: data.jobs, settings }

  // ── changes ──
  const stamp =() => ({ updatedAtMs: Date.now(), updatedBy: me?.name || '' })
  const hist = useCallback((jobId, what) => be.set('history', be.newId('history'),
    { jobId, who: me.name, uid: me.uid, what, atMs: Date.now() }).catch(() => {}), [be, me])

  const actions = useMemo(() => {
    if (!be || !me) return {}
    const a = {
      async createJob(fields = {}) {
        const id = be.newId('jobs')
        const now = Date.now()
        await be.set('jobs', id, {
          name: 'New job', category: settings.categories[0]?.id || '', customer: '', region: '',
          status: 'Planning', waitingOn: '', priority: 'Medium', start: '', end: '',
          eng: [], apps: [], owner: me.name, lead: { name: '', contact: '' },
          freight: { tracking: '', eta: '', arrived: false },
          equipment: [], actions: [], notes: [], archived: false,
          ...fields,
          createdBy: me.uid, createdByName: me.name, createdAtMs: now, updatedAtMs: now, updatedBy: me.name,
        })
        hist(id, fields.fromTemplate ? `created this job from "${fields.fromTemplate}"` : 'created this job')
        return id
      },
      async updateJob(id, patch, what) {
        await be.update('jobs', id, { ...patch, ...stamp() })
        if (what) hist(id, what)
      },
      /** For lists inside a job (equipment, notes, action points): read-modify-write in one go. */
      async mutateJob(id, fn, what) {
        await be.mutate('jobs', id, (cur) => {
          const p = fn(cur)
          return p ? { ...p, ...stamp() } : null
        })
        if (what) hist(id, what)
      },
      async deleteJob(job) {
        const ops = [{ op: 'delete', col: 'jobs', id: job.id }]
        for (const x of data.assignments) if (x.jobId === job.id) ops.push({ op: 'delete', col: 'assignments', id: x.id })
        for (const x of data.comments) if (x.jobId === job.id) ops.push({ op: 'delete', col: 'comments', id: x.id })
        await be.batch(ops)
      },
      /** Returns true when the person should be asked whether to archive. */
      async setStatus(job, status) {
        if (job.status === status) return false
        const patch = { status }
        if (status === WAITING && job.status !== WAITING) patch.waitingSince = today
        if (status === COMPLETE) {
          patch.completedAt = today
          if (!settings.askOnComplete && settings.autoArchive) patch.autoArchiveOn = addDays(today, settings.autoArchiveDays)
        } else if (job.autoArchiveOn) {
          patch.autoArchiveOn = ''
        }
        await a.updateJob(job.id, patch, `changed Status from ${job.status} to ${status}`)
        return status === COMPLETE && settings.askOnComplete
      },
      archiveJob: (job, auto = false) => a.updateJob(job.id, { archived: true, archivedAt: today, autoArchiveOn: '' },
        auto ? 'archived this job (automatically, after Complete)' : 'archived this job'),
      scheduleArchive: (job, days) => a.updateJob(job.id, { autoArchiveOn: addDays(today, days) }, `set this job to archive on ${fmt(addDays(today, days))}`),
      keepActive: (job) => a.updateJob(job.id, { autoArchiveOn: '' }),
      restoreJob: (job) => a.updateJob(job.id, { archived: false, archivedAt: '', autoArchiveOn: '', status: 'Planning' }, 'restored this job to active (status Planning)'),

      async addAssignment(rec) {
        const id = be.newId('assignments')
        await be.set('assignments', id, { jobId: rec.jobId, staffId: rec.staffId, week: mondayOf(rec.week), activity: rec.activity, by: me.name, atMs: Date.now() })
        const p = settings.staff.find((s) => s.id === rec.staffId)
        hist(rec.jobId, `added ${p?.initials || 'someone'} (${rec.activity}) to the week of ${fmt(mondayOf(rec.week))}`)
      },
      async updateAssignment(rec, patch) {
        await be.update('assignments', rec.id, { ...patch, by: me.name, atMs: Date.now() })
        const p = settings.staff.find((s) => s.id === (patch.staffId || rec.staffId))
        hist(rec.jobId, `changed ${p?.initials || 'someone'} in the week of ${fmt(rec.week)} to ${patch.activity || rec.activity}`)
      },
      async removeAssignment(rec) {
        await be.remove('assignments', rec.id)
        const p = settings.staff.find((s) => s.id === rec.staffId)
        hist(rec.jobId, `removed ${p?.initials || 'someone'} (${rec.activity}) from the week of ${fmt(rec.week)}`)
      },
      /** Moves a job's dates by whole weeks, and the people booked on it with them. */
      async shiftJob(job, weeks) {
        if (!weeks) return
        const d = weeks * 7
        const start = job.start ? addDays(job.start, d) : ''
        const end = job.end ? addDays(job.end, d) : ''
        const ops = [{ op: 'update', col: 'jobs', id: job.id, data: { start, end, ...stamp() } }]
        for (const x of data.assignments) {
          if (x.jobId === job.id) ops.push({ op: 'update', col: 'assignments', id: x.id, data: { week: addDays(x.week, d) } })
        }
        await be.batch(ops)
        hist(job.id, `moved the job ${weeks > 0 ? 'later' : 'earlier'} by ${Math.abs(weeks)} week${Math.abs(weeks) === 1 ? '' : 's'} (${fmt(start)} – ${fmt(end)}), with its people`)
      },

      async addComment(jobId, text) {
        const id = be.newId('comments')
        const mentions = [...text.matchAll(/@([A-Za-zĀ-ž'-]+)/g)].map((m) => m[1])
        await be.set('comments', id, { jobId, text, mentions, uid: me.uid, byName: me.name, atMs: Date.now() })
      },
      removeComment: (c) => be.remove('comments', c.id),

      saveSettings: (patch) => be.saveSettings(patch),

      async loadSample() {
        const ops = []
        const now = Date.now()
        for (const j of SAMPLE_JOBS) ops.push({ op: 'set', col: 'jobs', id: j.id, data: { ...j, sample: true, archived: !!j.archived, createdBy: me.uid, createdByName: me.name, createdAtMs: now, updatedAtMs: now, updatedBy: me.name } })
        for (const x of SAMPLE_ASSIGNMENTS) ops.push({ op: 'set', col: 'assignments', id: x.id, data: x })
        for (const x of SAMPLE_COMMENTS) ops.push({ op: 'set', col: 'comments', id: x.id, data: { ...x, uid: me.uid } })
        await be.batch(ops)
        const have = new Set(settings.staff.map((p) => p.id))
        await be.saveSettings({
          staff: [...settings.staff, ...SAMPLE_STAFF.filter((p) => !have.has(p.id))],
          pool: settings.pool.map((p) => (p.total == null && SAMPLE_POOL[p.model] != null ? { ...p, total: SAMPLE_POOL[p.model], sampleTotal: true } : p)),
        })
      },
      async removeSample() {
        const ops = []
        for (const j of data.jobs || []) if (j.sample) ops.push({ op: 'delete', col: 'jobs', id: j.id })
        for (const x of data.assignments) if (x.sample || String(x.jobId).startsWith('sample-')) ops.push({ op: 'delete', col: 'assignments', id: x.id })
        for (const x of data.comments) if (x.sample || String(x.jobId).startsWith('sample-')) ops.push({ op: 'delete', col: 'comments', id: x.id })
        for (const x of data.history) if (String(x.jobId).startsWith('sample-')) ops.push({ op: 'delete', col: 'history', id: x.id })
        await be.batch(ops)
        await be.saveSettings({
          staff: settings.staff.filter((p) => !p.sample),
          pool: settings.pool.map((p) => (p.sampleTotal ? { ...p, total: null, sampleTotal: false } : p)),
        })
      },
      async importJobs(list) {
        const now = Date.now()
        const ops = list.map((j) => ({
          op: 'set', col: 'jobs', id: be.newId('jobs'),
          data: {
            category: settings.categories[0]?.id || '', status: 'Planning', priority: 'Medium', start: '', end: '',
            eng: [], apps: [], owner: me.name, lead: { name: '', contact: '' }, freight: { tracking: '', eta: '', arrived: false },
            equipment: [], actions: [], notes: [], archived: false, waitingOn: '',
            ...j, createdBy: me.uid, createdByName: me.name, createdAtMs: now, updatedAtMs: now, updatedBy: me.name, imported: true,
          },
        }))
        await be.batch(ops)
        return ops.length
      },
      /**
       * The project sheets, turned into one file: staff (matched to the list by
       * initials), activity types and colours, demo models, jobs, and who is
       * where each week. Safe to run twice: a job already imported is skipped.
       */
      async importBundle(b) {
        const now = Date.now()
        // The newest copy, not the one this function was made with: an import
        // run twice in a row must still see the first one's jobs.
        const { settings, jobs: current } = latest.current
        const staff = [...settings.staff]
        const staffMap = {}
        let staffAdded = 0
        for (const p of b.staff || []) {
          const hit = staff.find((x) => String(x.initials).toLowerCase() === String(p.initials).toLowerCase())
          if (hit) { staffMap[p.id] = hit.id; continue }
          const id = 'st-' + rid()
          staff.push({ id, name: p.name, initials: p.initials, role: p.role || 'Applications', email: '', leave: [] })
          staffMap[p.id] = id
          staffAdded++
        }
        const pool = [...settings.pool]
        for (const m of b.pool || []) if (!pool.some((x) => x.model === m.model)) pool.push({ model: m.model, family: m.family || 'Other', kind: m.kind || '', total: null })
        await be.saveSettings({ staff, pool, ...(b.activities?.length ? { activities: b.activities } : {}) })

        const have = new Set((current || []).map((j) => j.importRef).filter(Boolean))
        const jobIds = {}
        const ops = []
        let skipped = 0
        for (const j of b.jobs || []) {
          if (have.has(j.ref)) { skipped++; continue }
          const id = be.newId('jobs')
          jobIds[j.ref] = id
          const { ref, eng = [], apps = [], notes = [], ...rest } = j
          ops.push({ op: 'set', col: 'jobs', id, data: {
            category: settings.categories[0]?.id || '', status: 'Planning', waitingOn: '', statusNote: '', priority: 'Medium',
            start: '', end: '', customer: '', region: '', owner: '', lead: { name: '', contact: '' },
            freight: { tracking: '', eta: '', arrived: false }, equipment: [], actions: [], archived: false,
            ...rest,
            eng: eng.map((x) => staffMap[x]).filter(Boolean),
            apps: apps.map((x) => staffMap[x]).filter(Boolean),
            equipment: (rest.equipment || []).map((l) => ({ id: rid(), line: 'Requested', ...l })),
            notes: notes.map((n) => ({ id: rid(), at: n.at || today, by: n.by || me.name, text: n.text })),
            importRef: ref, createdBy: me.uid, createdByName: me.name, createdAtMs: now, updatedAtMs: now, updatedBy: me.name,
          } })
          ops.push({ op: 'set', col: 'history', id: be.newId('history'), data: { jobId: id, who: me.name, uid: me.uid, what: 'imported this job from the project sheets', atMs: now } })
        }
        let weeks = 0
        for (const a of b.assignments || []) {
          const jobId = jobIds[a.job]
          const staffId = staffMap[a.staff]
          if (!jobId || !staffId) continue
          ops.push({ op: 'set', col: 'assignments', id: be.newId('assignments'), data: { jobId, staffId, week: mondayOf(a.week), activity: a.activity, tentative: !!a.tentative, by: me.name, atMs: now } })
          weeks++
        }
        await be.batch(ops)
        latest.current = { ...latest.current, jobs: [...(current || []), ...ops.filter((o) => o.col === 'jobs').map((o) => ({ id: o.id, ...o.data }))] }
        return { jobs: Object.keys(jobIds).length, skipped, weeks, staffAdded }
      },
      /**
       * Puts a backup back (backup.js restorePlan for what 'merge' and 'exact'
       * do). Jobs, weeks and settings go first; then comments and history, a
       * batch at a time, because the rules only let an admin re-add other
       * people's. Resolves to the plan's summary plus how many of those could
       * not be put back.
       */
      async restoreBackup(file, mode) {
        const { main, append, summary } = restorePlan(readBackup(file), {
          jobs: data.jobs || [], assignments: data.assignments, comments: data.comments, history: data.history, settings: settingsRaw || null,
        }, mode)
        await be.batch(main)
        let notAppended = 0
        for (let i = 0; i < append.length; i += 400) {
          const part = append.slice(i, i + 400)
          try { await be.batch(part) } catch { notAppended += part.length }
        }
        return { ...summary, notAppended }
      },
      resetDev: be.reset ? () => be.reset() : null,
    }
    if (import.meta.env.DEV) window.__ptImport = a.importBundle // for trying import files in `npm run dev`
    return a
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [be, me, settings, settingsRaw, data.assignments, data.comments, data.jobs, data.history, hist, today])

  // ── auto-archive: whoever has the tracker open does it, once the day comes ──
  const archiving = useRef(new Set())
  useEffect(() => {
    if (!canEdit || !data.jobs || !actions.archiveJob) return
    for (const j of data.jobs) {
      if (dueForAutoArchive(j, today) && !archiving.current.has(j.id)) {
        archiving.current.add(j.id)
        actions.archiveJob(j, true).catch(() => archiving.current.delete(j.id))
      }
    }
  }, [data.jobs, canEdit, actions, today])

  const value = useMemo(() => {
    const jobs = data.jobs || []
    return {
      backendKind: be?.kind,
      user, profile, me, canEdit, error, setError, today,
      isAdmin: profile?.role === 'admin',
      ready: Boolean(user && data.jobs && settingsRaw !== undefined),
      jobs,
      active: jobs.filter((j) => !j.archived),
      archived: jobs.filter((j) => j.archived),
      jobById: new Map(jobs.map((j) => [j.id, j])),
      assignments: data.assignments,
      comments: data.comments,
      history: data.history,
      online,
      settings,
      // The settings document as stored (no defaults filled in): what a backup holds
      settingsStored: settingsRaw || null,
      // The demo pool with the feed's unit counts, and the feed's loans (null
      // until the demo tracker has been read at least once on this device).
      pool,
      loans: feedSummary ? feedSummary.loans : null,
      feed: { ...feed, summary: feedSummary, refresh: refreshFeed },
      staffById: new Map(settings.staff.map((p) => [p.id, p])),
      catById: new Map(settings.categories.map((c) => [c.id, c])),
      statusByName: new Map(settings.statuses.map((s) => [s.name, s])),
      activityByName: new Map(settings.activities.map((s) => [s.name, s])),
      signIn: () => be.signIn(),
      setViewing,
      ...actions,
    }
  }, [be, user, profile, me, canEdit, error, today, data, settingsRaw, online, settings, setViewing, actions, pool, feed, feedSummary, refreshFeed])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
