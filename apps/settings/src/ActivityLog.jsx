import { useEffect, useState } from 'react'
import { collection, getDocs, query, orderBy, limit, startAfter } from 'firebase/firestore'
import { ScrollText } from 'lucide-react'
import { db } from '../../schedule/src/firebase'
import { appLabel, entriesToCsv, filterEntries, peopleIn } from '../../../shared/activity-core.js'
import { Alert, Button, Loading } from '../../schedule/src/components/ui'

/*
 * The activity log, its own page of Settings (Admin → Activity log, /settings/activity). It was a tab of the staff
 * schedule's settings until 10 Nov 2026, but it is the whole hub's log, so it is not the schedule's. Admins, behind the
 * admin password (apps/settings/src/App.jsx). Old /settings/schedule#activity, /schedule/settings#activity and
 * /admin/#activity addresses forward here.
 */
// The hub's one log (shared/activity.js): every tool writes to it, only admins read it, and it is copied nightly to Drive.
const LOG_PAGE = 300

export default function ActivityLog() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [more, setMore] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [last, setLast] = useState(null)
  const [app, setApp] = useState('')
  const [who, setWho] = useState('')
  const [text, setText] = useState('')

  useEffect(() => { load(true) }, [])

  async function load(fresh) {
    setLoading(true)
    setBlocked(false)
    try {
      const q = query(collection(db, 'activity'), orderBy('at', 'desc'), ...(fresh || !last ? [] : [startAfter(last)]), limit(LOG_PAGE))
      const snap = await getDocs(q)
      const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setEntries(fresh ? rows : prev => [...prev, ...rows])
      setLast(snap.docs[snap.docs.length - 1] || null)
      setMore(snap.docs.length === LOG_PAGE)
    } catch (e) {
      console.error('Failed to load activity log:', e)
      if (e.code === 'permission-denied') setBlocked(true)
    } finally {
      setLoading(false)
    }
  }

  const shown = filterEntries(entries, { app, who, text })
  const tools = [...new Set(entries.map(e => e.app || 'schedule'))].sort((x, y) => appLabel(x).localeCompare(appLabel(y)))
  const people = peopleIn(entries)
  const filtered = Boolean(app || who || text.trim())

  function download() {
    const blob = new Blob([entriesToCsv(shown)], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `hub-activity-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  return (
    <div className="page admin-page activity-page">
      <p className="st-note activity-intro">
        Sign-ins, schedule and leave, on call, projects, equipment, asks, checklists, maintenance, service
        orders, news and people, most recent first. It's a record, not an undo button: nothing here can be
        edited or deleted. Every night it is also copied to Google Drive (folder “CMCHS Hub Activity Log Backups”).
      </p>
      <div className="activity-toolbar">
        <select className="input" value={app} onChange={e => setApp(e.target.value)} aria-label="Tool">
          <option value="">All tools</option>
          {tools.map(t => <option key={t} value={t}>{appLabel(t)}</option>)}
        </select>
        <select className="input" value={who} onChange={e => setWho(e.target.value)} aria-label="Person">
          <option value="">Everyone</option>
          {people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <input className="input activity-search" type="search" value={text} onChange={e => setText(e.target.value)} placeholder="Search the log" aria-label="Search the log" />
        <div className="activity-buttons">
          <Button variant="secondary" size="sm" onClick={() => load(true)} disabled={loading}>Refresh</Button>
          <Button variant="secondary" size="sm" onClick={download} disabled={!shown.length}>Download CSV</Button>
        </div>
      </div>
      {entries.length > 0 && (
        <p className="st-note activity-count">
          {filtered ? `${shown.length} of ${entries.length} loaded lines` : `${entries.length} most recent lines`}
        </p>
      )}

      <div className="activity-main">
        {blocked && (
          <Alert tone="warning" icon={<ScrollText size={20} />} title="Log not switched on yet">
            The database rules need updating before the activity log can be read — publish the
            latest <code>firestore.rules</code> in the Firebase Console (Firestore → Rules).
          </Alert>
        )}
        {loading && !entries.length ? <Loading /> : (
          <div className="card activity-list">
            {!shown.length && !blocked && (
              <p className="st-note" style={{ padding: 16 }}>
                {filtered ? `Nothing matches in the ${entries.length} lines loaded.` : 'Nothing logged yet.'}
              </p>
            )}
            {shown.map(e => (
              <div key={e.id} className="activity-row">
                <span className="activity-when">{formatWhen(e.at)}</span>
                <span className="activity-who">{e.name}</span>
                <span className="activity-app">{appLabel(e.app || 'schedule')}</span>
                <span className="activity-what">{e.summary}</span>
              </div>
            ))}
            {more && (
              <div style={{ padding: 12, textAlign: 'center' }}>
                <Button variant="ghost" size="sm" onClick={() => load(false)} disabled={loading}>{loading ? 'Loading…' : 'Load older'}</Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** "28 Sep, 3:45 pm" — in-progress writes (no server timestamp back yet) just say "Just now". */
function formatWhen(at) {
  const date = at?.toDate?.()
  if (!date) return 'Just now'
  return date.toLocaleString('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}
