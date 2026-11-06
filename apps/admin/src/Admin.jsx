import { useState, useEffect } from 'react'
import { collection, getDocs, deleteDoc, doc, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../../schedule/src/firebase'
import { useAuth } from '../../schedule/src/contexts/AuthContext'
import { Bell } from 'lucide-react'
import Toast from '../../schedule/src/components/Toast'
import { TEAMS, teamLabel } from '../../schedule/src/utils/teams'
import { logActivity } from '../../schedule/src/utils/activityLog'
import { Badge, Button, Loading, Switch } from '../../schedule/src/components/ui'
import { TRACKER_ROLES, setMemberRole, trackerRoleLabel } from './tracker'

/*
 * People and access, and everyone's notifications: two pages of the one
 * app's Settings (apps/settings), which shows them to admins behind the admin
 * password. They were the two tabs of Admin settings at /admin/; that address
 * now forwards to them (apps/hub/src/router.js).
 */

/* ── People and access ── */
export function UsersTab() {
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

  /**
   * Their role in the demo tracker, on their hub record (users.trackerRole): setting
   * one puts them on the tracker's team. The same change as the tracker's Manage,
   * Team (tracker.js), so the two places never disagree.
   */
  async function setTrackerRole(person, role) {
    const name = person.displayName || person.email
    try {
      await setMemberRole({ uid: person.uid, name, email: person.email || '' }, role)
      setUsers(all => all.map(u => (u.uid === person.uid ? { ...u, trackerRole: role } : u)))
    } catch (e) {
      console.error(e)
      return showToast(e.message || 'Could not save the role — try again.')
    }
    showToast('Saved.')
    logActivity(user, `Set ${name}'s demo tracker role to ${trackerRoleLabel(role)} in Settings.`)
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
    if (field === 'kbEditor') {
      logActivity(user, value ? `Made ${name} a knowledge base editor in Settings.` : `Took away ${name}'s knowledge base editor switch in Settings.`)
      return
    }
    if (field === 'simproAccess') {
      logActivity(user, value ? `Gave ${name} Simpro access in Settings.` : `Took away ${name}'s Simpro access in Settings.`)
      return
    }
    const fieldLabel = field === 'team' ? 'team' : 'role'
    const valueLabel = field === 'team' ? (teamLabel(value) || 'No team') : value
    logActivity(user, `Set ${name}'s ${fieldLabel} to ${valueLabel} in Settings.`)
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
      logActivity(user, `Added ${name} (${teamLabel(newTeam)}) in Settings.`)
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
    logActivity(user, `Removed ${u.displayName} in Settings.`)
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
        Assign teams and roles. People can’t choose their own team: set it here (or HR does, on People) after their first sign-in.
        Admins can update anyone’s schedule from Team week and run the on-call roster.
      </p>

      <h2 className="admin-side-title">Simpro access</h2>
      <p className="text-sm text-muted">
        Lets someone use the tools that read or write Simpro: SimproSync, the Ansur report upload and the
        Service Orders job lookup. Admins always have it. Deleting assets in Simpro stays admins only.
      </p>

      <h2 className="admin-side-title">Demo tracker role</h2>
      <p className="text-sm text-muted">
        Account managers get reminders for their own loans; Service &amp; Projects get the ones they handle.
        Picking a role adds them to the tracker’s team; their name and email are the ones on their sign-in. Who gets which
        notifications is on the Notifications tab. The same roles, and taking someone off the team, are also in the demo
        tracker: <a href="/equipment/#/manage?part=team">Manage, Team</a>.
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
            <span>Name</span><span>Team</span><span>Role</span><span>Simpro</span><span>Knowledge</span><span>Demo tracker</span>
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
                <KbEditor person={u} onChange={on => updateUser(u.uid, 'kbEditor', on)} />
                <TrackerRole person={u} onChange={role => setTrackerRole(u, role)} />
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
 * users/{uid}.kbEditor: may add, change, import and remove in the knowledge base (admins always may). Only an admin can set it
 * (rules/firestore.rules). Not offered for a placeholder, for the same reason as Simpro access.
 */
function KbEditor({ person, onChange }) {
  if (person.role === 'admin') {
    return <span className="admin-simpro text-sm text-muted" title="Admins can always edit the knowledge base"><span className="admin-simpro-key">Knowledge: </span>Always (admin)</span>
  }
  if (person.pending) {
    return <span className="admin-simpro text-sm text-muted"><span className="admin-simpro-key">Knowledge: </span>After they sign in</span>
  }
  return <Switch className="admin-simpro" checked={person.kbEditor === true} onChange={onChange} label="Knowledge base editor" />
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

/**
 * users/{uid}.trackerRole, the demo tracker role. "Not in the tracker" only shows
 * while they have none: taking someone off the team is in the tracker's Manage,
 * Team (the same tracker.js changes as here), where their loans are.
 */
function TrackerRole({ person, onChange }) {
  if (person.pending) {
    return <span className="admin-tracker text-sm text-muted"><span className="admin-simpro-key">Demo tracker: </span>After they sign in</span>
  }
  const role = person.trackerRole === 'service' || person.trackerRole === 'am' ? person.trackerRole : ''
  // "Demo tracker:" is for phones, where there is no column heading to say so.
  return (
    <label className="admin-tracker">
      <span className="admin-simpro-key">Demo tracker: </span>
      <select
        value={role}
        onChange={e => e.target.value && onChange(e.target.value)}
        aria-label="Demo tracker role"
      >
        {!role && <option value="">Not in the tracker</option>}
        {TRACKER_ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
      </select>
    </label>
  )
}

/* ── Notifications tab ── */
/**
 * One place to say who gets which notifications, across the tools:
 *  - Staff schedule: the Thursday "fill in next week" reminder.
 *    users/{uid}.notifications.scheduleReminder; scripts/remind.mjs (in the
 *    cmchs-staff-schedule repo) skips anyone with it false.
 *  - Demo tracker: loan reminders (starting soon, due back, overdue, action
 *    needed). users/{uid}.notifications.demoReminders (the person's own switch too); the Apps
 *    Script senders (backend/apps-script/proxy) skip anyone with it false.
 *  - Asks: the 8:30am weekday "you have N open asks" summary.
 *    users/{uid}.notifications.asksSummary; apps/asks/scripts/summary.mjs
 *    skips anyone with it false. (Pushes about a single ask always go.)
 * Missing means on, so nobody's reminders changed when this arrived.
 *
 * A switch can only stop notifications. Getting them at all still needs the
 * person to turn notifications on, on their own phone, which browsers
 * require; the device counts show who has.
 */
export function NotificationsTab() {
  const { user } = useAuth()
  const [users, setUsers] = useState(null)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    getDocs(collection(db, 'users'))
      .then(snap => setUsers(snap.docs.map(d => ({ uid: d.id, ...d.data() }))
        .sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''))))
      .catch(e => { console.error(e); setUsers([]) })
  }, [])

  function showToast(msg) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function setUserNotification(person, key, label, on) {
    const name = person.displayName || person.email
    try {
      await updateDoc(doc(db, 'users', person.uid), { ['notifications.' + key]: on })
    } catch (e) {
      console.error(e)
      return showToast('Could not save that — try again.')
    }
    setUsers(prev => prev.map(u => u.uid === person.uid ? { ...u, notifications: { ...u.notifications, [key]: on } } : u))
    showToast('Saved.')
    logActivity(user, `${on ? 'Turned on' : 'Turned off'} ${name}'s ${label} in Settings.`)
  }
  const setScheduleReminder = (person, on) => setUserNotification(person, 'scheduleReminder', 'staff schedule reminder', on)
  const setAsksSummary = (person, on) => setUserNotification(person, 'asksSummary', 'Asks morning summary', on)

  const setDemoReminders = (person, on) => setUserNotification(person, 'demoReminders', 'demo tracker reminders', on)

  // Devices, not phones: a PC browser that turned notifications on counts too.
  // Ones that no longer exist are removed weekly (apps/schedule/scripts/prune-devices.mjs).
  const devices = n => (n ? `${n} device${n === 1 ? '' : 's'}` : 'No device yet')

  return (
    <div className="admin-layout">
      <div className="admin-side">
        <h2 className="admin-side-title">Notifications</h2>
        <p className="text-sm text-muted">
          Who gets which notifications, for every tool. Everyone is on unless you switch them off here.
        </p>
        <h2 className="admin-side-title">Staff schedule</h2>
        <p className="text-sm text-muted">The Thursday reminder to fill in next week, for anyone who hasn’t yet.</p>
        <h2 className="admin-side-title">Demo tracker</h2>
        <p className="text-sm text-muted">
          Loan reminders: starting soon, due back, overdue and action needed. Account managers get their own loans’;
          Service &amp; Projects get the ones they handle. Set the role on the People tab.
        </p>
        <h2 className="admin-side-title">Asks</h2>
        <p className="text-sm text-muted">The 8:30am weekday summary of open asks, for anyone who has some. Pushes about a single ask always go to the people involved.</p>
        <h2 className="admin-side-title">Devices</h2>
        <p className="text-sm text-muted">
          A switch can only stop notifications. To get them at all, the person opens the Internal Hub on their phone
          and taps “Turn on” when it asks — once covers every tool. The count is every phone or browser they’ve turned
          notifications on for; ones deleted or cleared since are removed each Monday.
        </p>
      </div>

      <div className="admin-main">
        {users === null ? <Loading /> : (
          <div className="card admin-list admin-notify">
            <div className="admin-item admin-notify-head" aria-hidden="true">
              <span>Name</span><span>Staff schedule reminder</span><span>Demo tracker reminders</span><span>Asks summary</span>
            </div>
            {users.map(u => {
              const onTeam = !u.pending && (u.trackerRole === 'am' || u.trackerRole === 'service')
              return (
                <div key={u.uid} className="admin-item">
                  <div className="admin-notify-who">
                    <div className="admin-item-name">{u.displayName || '(no name)'}</div>
                    <div className="text-sm text-muted admin-ellipsis">{u.pending ? <Badge tone="neutral">Not signed in yet</Badge> : u.email}</div>
                  </div>
                  <div className="admin-notify-cell">
                    <span className="admin-notify-key">Staff schedule</span>
                    {u.pending
                      ? <span className="text-sm text-muted">After they sign in</span>
                      : <>
                          <Switch checked={u.notifications?.scheduleReminder !== false} onChange={on => setScheduleReminder(u, on)} label="Staff schedule reminder" />
                          <span className="text-sm text-muted">{devices(u.fcmTokens?.length || 0)}</span>
                        </>}
                  </div>
                  <div className="admin-notify-cell">
                    <span className="admin-notify-key">Demo tracker</span>
                    {onTeam ? <>
                          <Switch checked={u.notifications?.demoReminders !== false} onChange={on => setDemoReminders(u, on)} label="Demo tracker reminders" />
                          <span className="text-sm text-muted">{devices(u.fcmTokens?.length || 0)}</span>
                        </>
                      : <span className="text-sm text-muted">{u.pending ? 'After they sign in' : 'Not on its team'}</span>}
                  </div>
                  <div className="admin-notify-cell">
                    <span className="admin-notify-key">Asks summary</span>
                    {u.pending
                      ? <span className="text-sm text-muted">After they sign in</span>
                      : <Switch checked={u.notifications?.asksSummary !== false} onChange={on => setAsksSummary(u, on)} label="Asks morning summary" />}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <Toast message={toast} />
    </div>
  )
}
