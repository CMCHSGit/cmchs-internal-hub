import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  collection, getDocs, addDoc, deleteDoc, doc, updateDoc,
  query, orderBy, limit, serverTimestamp
} from 'firebase/firestore'
import { ScrollText, ShieldAlert } from 'lucide-react'
import { db } from '../firebase'
import { useAuth } from '../contexts/AuthContext'
import Toast from '../components/Toast'
import AdminLock, { isUnlocked } from '../components/AdminLock'
import { logActivity } from '../utils/activityLog'
import { Alert, Badge, Button, Loading } from '../components/ui'
import '../settings.css'

// Loaded on opening the tab: the Excel reader is big and only admins use it.
const ExcelImport = lazy(() => import('../components/ExcelImport'))

/**
 * /schedule/settings — the staff schedule's own settings, for schedule admins:
 * the location suggestions, the import from the company Excel file, and the
 * activity log. People (teams, roles, Simpro access) and everyone's
 * notifications are set in the Internal Hub's Admin (/admin/), which covers
 * every tool, not just this one.
 */
const TABS = [['locations', 'Locations'], ['excel', 'Excel'], ['activity', 'Activity log']]

export default function Settings() {
  const { user, profile } = useAuth()
  const { hash } = useLocation()
  const navigate = useNavigate()
  const [unlocked, setUnlocked] = useState(isUnlocked)
  const tab = TABS.some(([id]) => id === hash.slice(1)) ? hash.slice(1) : 'locations'

  if (profile?.role !== 'admin') {
    return (
      <div className="page page-narrow">
        <div className="card admin-gate">
          <ShieldAlert size={28} aria-hidden="true" className="admin-lock-icon" />
          <p>Schedule settings are for staff schedule admins, and {user?.email} isn’t one.</p>
        </div>
      </div>
    )
  }
  if (!unlocked) return <AdminLock title="Unlock schedule settings" onUnlock={() => setUnlocked(true)} />

  return (
    <div className="page admin-page">
      <div className="settings-head">
        <div className="tabs" role="tablist">
          {TABS.map(([t, label]) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`}
                    onClick={() => navigate({ hash: t === 'locations' ? '' : t }, { replace: true })}>
              {label}
            </button>
          ))}
        </div>
        <a className="settings-elsewhere text-sm" href="/admin/">People and notifications are in the Internal Hub’s Admin</a>
      </div>

      {tab === 'locations' && <LocationsTab />}
      {tab === 'excel'     && <Suspense fallback={<Loading />}><ExcelImport /></Suspense>}
      {tab === 'activity'  && <ActivityTab />}
    </div>
  )
}

/* ── Locations tab ── */
function LocationsTab() {
  const { user } = useAuth()
  const [locations, setLocations] = useState([])
  const [newName,   setNewName]   = useState('')
  const [loading,   setLoading]   = useState(true)
  const [toast,     setToast]     = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    const q = query(collection(db, 'locations'), orderBy('order'))
    const snap = await getDocs(q)
    setLocations(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    setLoading(false)
  }

  async function addLocation() {
    const name = newName.trim()
    if (!name) return
    await addDoc(collection(db, 'locations'), {
      name,
      order: locations.length,
      active: true,
      createdAt: serverTimestamp(),
    })
    setNewName('')
    showToast(`Added "${name}"`)
    logActivity(user, `Added location "${name}" in schedule settings.`)
    load()
  }

  async function toggleActive(loc) {
    await updateDoc(doc(db, 'locations', loc.id), { active: !loc.active })
    showToast(loc.active ? `Hidden "${loc.name}"` : `Restored "${loc.name}"`)
    logActivity(user, `${loc.active ? 'Hid' : 'Restored'} location "${loc.name}" in schedule settings.`)
    load()
  }

  async function removeLocation(loc) {
    if (!confirm(`Delete "${loc.name}"? This won't affect existing schedules.`)) return
    await deleteDoc(doc(db, 'locations', loc.id))
    showToast(`Deleted "${loc.name}"`)
    logActivity(user, `Deleted location "${loc.name}" in schedule settings.`)
    load()
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="admin-layout">
      <div className="admin-side">
      <h2 className="admin-side-title">Add a location</h2>
      <p className="text-sm text-muted">
        The suggestions people see when filling in their schedule. Anything typed that isn’t
        here gets added automatically. Hiding a location won’t change schedules already saved.
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          className="input"
          placeholder="New location name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addLocation()}
          style={{ flex: 1 }}
        />
        <Button onClick={addLocation}>Add</Button>
      </div>
      </div>

      <div className="admin-main">
      {loading ? <Loading /> : (
        <div className="card admin-list admin-list-grid">
          {locations.length === 0 && <p className="text-sm text-muted" style={{ padding: 16 }}>No locations yet.</p>}
          {locations.map(loc => (
            <div key={loc.id} className="admin-item" style={{ opacity: loc.active ? 1 : 0.5 }}>
              <span className="admin-item-name">
                {loc.name}
                {!loc.active && <Badge tone="neutral">Hidden</Badge>}
              </span>
              <div className="admin-controls">
                <Button variant="secondary" size="sm" onClick={() => toggleActive(loc)}>{loc.active ? 'Hide' : 'Show'}</Button>
                <Button variant="ghost" size="sm" style={{ color: 'var(--status-critical)' }} onClick={() => removeLocation(loc)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}
      </div>

      <Toast message={toast} />
    </div>
  )
}

/* ── Activity log tab ── */
const LOG_LIMIT = 300

function ActivityTab() {
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setBlocked(false)
    try {
      const q = query(collection(db, 'activity'), orderBy('at', 'desc'), limit(LOG_LIMIT))
      const snap = await getDocs(q)
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    } catch (e) {
      console.error('Failed to load activity log:', e)
      if (e.code === 'permission-denied') setBlocked(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="admin-layout">
      <div className="admin-side">
        <h2 className="admin-side-title">Activity log</h2>
        <p className="text-sm text-muted">
          Who changed what, most recent first — schedule edits, leave booked or removed, the
          on-call roster, changes made here, and people and notification changes made in the
          Internal Hub’s Admin. The last {LOG_LIMIT} actions. It's a record, not an undo button:
          nothing here can be edited or deleted.
        </p>
        <Button variant="secondary" size="sm" onClick={load} disabled={loading}>Refresh</Button>
      </div>

      <div className="admin-main">
        {blocked && (
          <Alert tone="warning" icon={<ScrollText size={20} />} title="Log not switched on yet">
            The database rules need updating before the activity log can be read — publish the
            latest <code>firestore.rules</code> in the Firebase Console (Firestore → Rules).
          </Alert>
        )}
        {loading ? <Loading /> : (
          <div className="card admin-list activity-list">
            {!entries.length && !blocked && (
              <p className="text-sm text-muted" style={{ padding: 16 }}>Nothing logged yet.</p>
            )}
            {entries.map(e => (
              <div key={e.id} className="activity-row">
                <span className="activity-when">{formatWhen(e.at)}</span>
                <span className="activity-who">{e.name}</span>
                <span className="activity-what">{e.summary}</span>
              </div>
            ))}
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
