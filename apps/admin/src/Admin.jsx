import { useState, useEffect } from 'react'
import {
  collection, getDocs, addDoc, deleteDoc, doc, setDoc, updateDoc,
  query, orderBy, limit, serverTimestamp
} from 'firebase/firestore'
import { db } from '../../schedule/src/firebase'
import { useAuth } from '../../schedule/src/contexts/AuthContext'
import { Bell, Lock, ScrollText } from 'lucide-react'
import Toast from '../../schedule/src/components/Toast'
import { TEAMS, teamLabel } from '../../schedule/src/utils/teams'
import { logActivity } from '../../schedule/src/utils/activityLog'
import { Alert, Badge, Button, Loading, Switch } from '../../schedule/src/components/ui'
import ExcelImport from './ExcelImport'

/**
 * Admin also asks for a password — a second step on top of the admin role,
 * useful on an admin's unlocked phone or computer. Only its SHA-256 is kept
 * here (this repo is public), but this is a lock on the door, not a safe:
 * it runs in the browser. What actually protects admin actions is the role
 * check plus firestore.rules. Stays unlocked until the tab/app is closed.
 */
const ADMIN_PASSWORD_SHA256 = '8c1d16397760afa8d5301e4461e28f5f48f7e8ba20de33e32a259e9bedd7fecb'
const UNLOCK_KEY = 'css_admin_unlocked'

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

function isUnlocked() {
  try { return sessionStorage.getItem(UNLOCK_KEY) === ADMIN_PASSWORD_SHA256 } catch { return false }
}

function AdminLock({ onUnlock }) {
  const [password, setPassword] = useState('')
  const [wrong, setWrong] = useState(false)
  const [checking, setChecking] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setChecking(true)
    const hash = await sha256(password)
    setChecking(false)
    if (hash !== ADMIN_PASSWORD_SHA256) { setWrong(true); setPassword(''); return }
    try { sessionStorage.setItem(UNLOCK_KEY, hash) } catch { /* private mode — unlocked for this visit only */ }
    onUnlock()
  }

  return (
    <div className="page page-narrow">
      <form className="card admin-lock" onSubmit={submit}>
        <Lock size={28} aria-hidden="true" className="admin-lock-icon" />
        <h2 className="page-title">Unlock admin settings</h2>
        <p className="text-sm text-muted">Enter the admin password to continue.</p>
        <input
          className="input"
          type="password"
          autoFocus
          autoComplete="current-password"
          placeholder="Password"
          aria-label="Admin password"
          value={password}
          onChange={e => { setPassword(e.target.value); setWrong(false) }}
        />
        {wrong && <p className="login-error">That password isn’t right — try again.</p>}
        <Button type="submit" block disabled={!password || checking}>Unlock</Button>
      </form>
    </div>
  )
}

const TABS = [['users', 'People'], ['locations', 'Locations'], ['excel', 'Excel'], ['activity', 'Activity log']]

/** The open tab lives in the address (/admin/#locations), so a link or a reload lands on it. */
function tabFromHash() {
  const t = location.hash.slice(1)
  return TABS.some(([id]) => id === t) ? t : 'users'
}

/** Only rendered for admins — App.jsx turns everyone else away first. */
export default function Admin() {
  const [tab, setTabState] = useState(tabFromHash)
  const [unlocked, setUnlocked] = useState(isUnlocked)

  function setTab(t) {
    setTabState(t)
    history.replaceState(null, '', t === 'users' ? location.pathname : `#${t}`)
  }

  if (!unlocked) return <AdminLock onUnlock={() => setUnlocked(true)} />

  return (
    <div className="page admin-page">
      <div className="tabs" role="tablist">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'locations' && <LocationsTab />}
      {tab === 'users'     && <UsersTab />}
      {tab === 'excel'     && <ExcelImport />}
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
    logActivity(user, `Added location "${name}" in Admin.`)
    load()
  }

  async function toggleActive(loc) {
    await updateDoc(doc(db, 'locations', loc.id), { active: !loc.active })
    showToast(loc.active ? `Hidden "${loc.name}"` : `Restored "${loc.name}"`)
    logActivity(user, `${loc.active ? 'Hid' : 'Restored'} location "${loc.name}" in Admin.`)
    load()
  }

  async function removeLocation(loc) {
    if (!confirm(`Delete "${loc.name}"? This won't affect existing schedules.`)) return
    await deleteDoc(doc(db, 'locations', loc.id))
    showToast(`Deleted "${loc.name}"`)
    logActivity(user, `Deleted location "${loc.name}" in Admin.`)
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

/* ── Users tab ── */
function UsersTab() {
  const { user } = useAuth()
  const [users,      setUsers]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [toast,      setToast]      = useState(null)
  const [newName,    setNewName]    = useState('')
  const [newTeam,    setNewTeam]    = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    const snap = await getDocs(collection(db, 'users'))
    setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() })))
    setLoading(false)
  }

  async function updateUser(uid, field, value) {
    const person = users.find(u => u.uid === uid)
    const name = person?.displayName || uid
    try {
      await updateDoc(doc(db, 'users', uid), { [field]: value })
    } catch (e) {
      console.error(e)
      return showToast('Could not save that — try again.')
    }
    setUsers(prev => prev.map(u => u.uid === uid ? { ...u, [field]: value } : u))
    showToast('Saved.')
    if (field === 'simproAccess') {
      logActivity(user, value ? `Gave ${name} Simpro access in Admin.` : `Took away ${name}'s Simpro access in Admin.`)
      return
    }
    const fieldLabel = field === 'team' ? 'team' : 'role'
    const valueLabel = field === 'team' ? (teamLabel(value) || 'No team') : value
    logActivity(user, `Set ${name}'s ${fieldLabel} to ${valueLabel} in Admin.`)
  }

  /**
   * Adds someone who hasn't signed in yet, so they can be scheduled (and
   * show up in Team week) straight away. It's a placeholder: the first time
   * they sign in, AuthContext.jsx adopts it — matching their email against
   * first.last@ guessed from the full name, else an unambiguous first name —
   * and carries over their team and any weeks already filled in for them.
   */
  async function addPerson() {
    const name = newName.trim().replace(/\s+/g, ' ')
    if (!name) return
    if (!newTeam) return showToast('Pick a team for them too.')
    if (users.some(u => (u.displayName || '').trim().toLowerCase() === name.toLowerCase())) {
      return showToast(`${name} is already on the list.`)
    }
    const id = 'pending-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-+|-+$)/g, '')
    const person = { displayName: name, team: newTeam, role: 'user', pending: true, createdAt: serverTimestamp() }
    try {
      await setDoc(doc(db, 'users', id), person)
      setUsers(prev => [...prev, { uid: id, ...person }])
      setNewName('')
      showToast(`Added ${name}.`)
      logActivity(user, `Added ${name} (${teamLabel(newTeam)}) in Admin.`)
    } catch (e) {
      console.error(e)
      showToast('Could not add them — try again.')
    }
  }

  /** Only for people who haven't signed in yet — e.g. a typo when adding them. */
  async function removePerson(u) {
    if (!confirm(`Remove ${u.displayName}? They haven't signed in yet, so this only removes the placeholder.`)) return
    await deleteDoc(doc(db, 'users', u.uid))
    setUsers(prev => prev.filter(x => x.uid !== u.uid))
    showToast(`Removed ${u.displayName}.`)
    logActivity(user, `Removed ${u.displayName} in Admin.`)
  }

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  return (
    <div className="admin-layout">
      <div className="admin-side">
      <h2 className="admin-side-title">People</h2>
      <p className="text-sm text-muted">
        Assign teams and roles. Most people pick their team on first sign-in; change it here if needed.
        Admins can update anyone’s schedule from Team week and run the on-call roster.
      </p>

      <h2 className="admin-side-title">Simpro access</h2>
      <p className="text-sm text-muted">
        Lets someone use the tools that read or write Simpro: SimproSync, the Ansur report upload and the
        Service Orders job lookup. Admins always have it. Deleting assets in Simpro stays admins only.
      </p>

      <h2 className="admin-side-title">Add a person</h2>
      <p className="text-sm text-muted">
        For someone who hasn’t signed in yet, so they can be scheduled now. Use their full name —
        it links to their account automatically when they first sign in.
      </p>
      <input
        className="input"
        placeholder="Full name…"
        value={newName}
        onChange={e => setNewName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && addPerson()}
        aria-label="New person's full name"
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <select value={newTeam} onChange={e => setNewTeam(e.target.value)} aria-label="New person's team" style={{ flex: 1 }}>
          <option value="">Team…</option>
          {TEAMS.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
        </select>
        <Button onClick={addPerson}>Add</Button>
      </div>

      </div>

      <div className="admin-main">
      {loading ? <Loading /> : (
        <div className="card admin-list admin-people">
          <div className="admin-item admin-people-head" aria-hidden="true">
            <span>Name</span><span>Team</span><span>Role</span><span>Simpro</span>
          </div>
          {users.map(u => (
            <div key={u.uid} className="admin-item">
              <div style={{ flex: 1, minWidth: 180 }}>
                <div className="admin-item-name">
                  {u.displayName || '(no name)'}
                  {u.fcmTokens?.length > 0 && (
                    <Bell size={15} color="var(--chs-green)" aria-label="Push reminders on" />
                  )}
                </div>
                <div className="text-sm text-muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {u.pending ? <Badge tone="neutral">Not signed in yet</Badge> : u.email}
                </div>
              </div>
              <div className="admin-controls">
                <select
                  value={u.team || ''}
                  onChange={e => updateUser(u.uid, 'team', e.target.value || null)}
                  style={{ width: 150 }}
                  aria-label="Team"
                >
                  <option value="">No team</option>
                  {TEAMS.map(t => <option key={t} value={t}>{teamLabel(t)}</option>)}
                </select>
                <select
                  value={u.role || 'user'}
                  onChange={e => updateUser(u.uid, 'role', e.target.value)}
                  style={{ width: 110 }}
                  aria-label="Role"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
                <SimproAccess person={u} onChange={on => updateUser(u.uid, 'simproAccess', on)} />
                {u.pending && (
                  <Button variant="ghost" size="sm" className="admin-remove" style={{ color: 'var(--status-critical)' }} onClick={() => removePerson(u)}>Remove</Button>
                )}
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

/**
 * users/{uid}.simproAccess. The Apps Script proxy that relays Simpro calls
 * lets through admins always, and anyone else only with this set to true, so
 * an admin's switch is shown on and fixed rather than one that does nothing.
 * Not offered for a "not signed in yet" placeholder: that record is replaced
 * by a fresh one on their first sign-in, which wouldn't carry it over.
 */
function SimproAccess({ person, onChange }) {
  // "Simpro:" is for phones, where there is no column heading to say so.
  if (person.role === 'admin') {
    return <span className="admin-simpro text-sm text-muted" title="Admins always have Simpro access"><span className="admin-simpro-key">Simpro: </span>Always (admin)</span>
  }
  if (person.pending) {
    return <span className="admin-simpro text-sm text-muted"><span className="admin-simpro-key">Simpro: </span>After they sign in</span>
  }
  return <Switch className="admin-simpro" checked={person.simproAccess === true} onChange={onChange} label="Simpro access" />
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
          on-call roster, and changes made here in Admin. The last {LOG_LIMIT} actions. It's a
          record, not an undo button: nothing here can be edited or deleted.
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
