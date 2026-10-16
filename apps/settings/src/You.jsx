/* Settings → You: what anyone sets for themselves. */
import { useEffect, useState } from 'react'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { db } from '../../schedule/src/firebase'
import { useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Button, Loading, Switch, Toast, useToast } from '../../../shared/ui/index.jsx'
import { setTheme } from '../../../shared/tool-chrome.js'
import { START_KEY, START_PAGES } from '../../hub/src/router.js'
import { enable, pushStatus } from '../../hub/src/PushPrompt.jsx'

const THEME_KEY = 'css_theme' // shared/tool-chrome.js, and the boot script in index.html
const read = (k) => { try { return localStorage.getItem(k) || '' } catch { return '' } }

/* ── Appearance ── */
export function Appearance() {
  const [theme, setChoice] = useState(() => read(THEME_KEY) || 'device')
  const [start, setStart] = useState(() => read(START_KEY))
  const [toastMsg, toast] = useToast()

  function chooseTheme(t) {
    setChoice(t)
    if (t === 'device') {
      // Back to following the device: forget the choice, show what it is now.
      try { localStorage.removeItem(THEME_KEY) } catch { /* private mode */ }
      document.documentElement.dataset.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    } else setTheme(t)
    toast('Saved for this device')
  }
  function chooseStart(href) {
    setStart(href)
    try { href ? localStorage.setItem(START_KEY, href) : localStorage.removeItem(START_KEY) } catch { /* private mode */ }
    toast('Saved for this device')
  }

  return (
    <div className="st-body">
      <section className="card st-card">
        <h2 className="st-card-title">Light or dark</h2>
        <div className="st-choices" role="radiogroup" aria-label="Light or dark">
          {[['light', 'Light'], ['dark', 'Dark'], ['device', 'Match this device']].map(([id, label]) => (
            <label key={id} className={`st-choice${theme === id ? ' on' : ''}`}>
              <input type="radio" name="theme" checked={theme === id} onChange={() => chooseTheme(id)} />{label}
            </label>
          ))}
        </div>
        <p className="st-note">The moon and sun in the header switch it too.</p>
      </section>
      <section className="card st-card">
        <h2 className="st-card-title">Open the hub on</h2>
        <select className="input st-select" value={start} onChange={e => chooseStart(e.target.value)} aria-label="Open the hub on">
          {START_PAGES.map(([href, label]) => <option key={href} value={href}>{label}</option>)}
        </select>
        <p className="st-note">Where this device lands when you open the hub from its icon or a bookmark. The Home tab is always there.</p>
      </section>
      <Toast message={toastMsg} />
    </div>
  )
}

/* ── Your notifications ── */
const STATUS_TEXT = {
  on: 'On for this phone.',
  off: 'Off for this phone.',
  install: 'On an iPhone, add the hub to your Home Screen first (Share, then Add to Home Screen), then turn them on from there.',
  blocked: 'Blocked for this site. Turn them on in your phone’s settings for this app, then come back here.',
  computer: 'Notifications come to phones: open this page on your phone to turn them on there.',
}

// users/{uid}.notifications: missing means on (as in Everyone's notifications).
const MINE = [
  ['scheduleReminder', 'Staff schedule reminder', 'Thursday’s reminder to fill in next week, if you haven’t yet.'],
  ['asksSummary', 'Asks morning summary', 'At 8:30 on weekdays, if you have asks waiting. Pushes about a single ask always come.'],
]

export function MyNotifications() {
  const { user } = useAuth()
  const [status, setStatus] = useState(pushStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [prefs, setPrefs] = useState(null)
  const [toastMsg, toast] = useToast()

  useEffect(() => {
    if (!db || !user?.uid) return setPrefs({})
    getDoc(doc(db, 'users', user.uid))
      .then(s => setPrefs(s.data()?.notifications || {}))
      .catch(() => setPrefs({}))
  }, [user?.uid])

  async function turnOn() {
    setBusy(true); setError('')
    try { await enable(user.uid); setStatus(pushStatus()); toast('Notifications are on for this phone') }
    catch (e) { setError(e.message || 'Couldn’t turn notifications on.') }
    finally { setBusy(false) }
  }

  async function setMine(key, on) {
    const before = prefs
    setPrefs({ ...prefs, [key]: on })
    try {
      await updateDoc(doc(db, 'users', user.uid), { ['notifications.' + key]: on })
      toast(on ? 'Turned on' : 'Turned off')
    } catch (e) {
      setPrefs(before)
      toast(e?.code === 'permission-denied'
        ? 'Not saved: this needs a rules change that isn’t published yet. An admin can change it in Everyone’s notifications.'
        : 'Not saved: ' + (e?.message || 'try again'))
    }
  }

  return (
    <div className="st-body">
      <section className="card st-card">
        <h2 className="st-card-title">This phone</h2>
        <p className="st-status">{STATUS_TEXT[status]}</p>
        {status === 'off' && <div><Button onClick={turnOn} disabled={busy}>{busy ? 'Turning on…' : 'Turn on notifications'}</Button></div>}
        {error && <Alert tone="critical" title="Not turned on">{error}</Alert>}
        <p className="st-note">One phone covers every tool: the staff schedule, Asks and the demo tracker. Each phone is turned on separately.</p>
      </section>
      <section className="card st-card">
        <h2 className="st-card-title">What you get</h2>
        {prefs === null ? <Loading /> : (
          <div className="st-rows">
            {MINE.map(([key, label, hint]) => (
              <div key={key} className="st-row">
                <div className="st-row-text"><span className="st-row-label">{label}</span><span className="st-note">{hint}</span></div>
                <Switch checked={prefs[key] !== false} onChange={on => setMine(key, on)} label={label} />
              </div>
            ))}
            <div className="st-row">
              <div className="st-row-text">
                <span className="st-row-label">Demo tracker reminders</span>
                <span className="st-note">Loans starting, due back, overdue or needing action. An admin sets these in Everyone’s notifications.</span>
              </div>
            </div>
          </div>
        )}
      </section>
      <Toast message={toastMsg} />
    </div>
  )
}
