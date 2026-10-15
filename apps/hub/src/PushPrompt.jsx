// "Turn on notifications?" — shown on the hub home, on a phone only, until that
// phone has notifications on. Each device registers separately, so a PC that's
// on doesn't stop a phone being asked. It's the same opt-in as the schedule's
// own card: one tap, the phone asks, and it's added to users/{uid}.fcmTokens.
//
// Never on a PC (notifications there only arrive while the browser is open).
// Also left out when it can't help: an iPhone that hasn't added the hub to its
// Home Screen (iOS only offers push there), notifications already blocked for
// the site, or this phone already on. "Not now" hides it on this phone for a
// week.
//
// One phone registration covers every tool: the staff schedule's reminders,
// and the demo tracker's, which the Simpro proxy sends to these same phones
// (chs-equipment .gas-proxy, "HUB PUSH"). Admin's switches decide which of
// them a person actually gets.
import { useEffect, useState } from 'react'
import Icon from './Icon.jsx'

const SNOOZE_KEY = 'hub:push_prompt_snoozed'
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000
// The schedule's "on for this device" flag (apps/schedule/src/utils/push.js).
// Its checks are repeated here, not imported: that file brings the schedule's
// whole Firebase setup with it, which the hub's first load doesn't need.
const ENABLED_KEY = 'schedule:push_enabled'

// iPads report themselves as Macs; the touch screen gives them away.
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
const isPhone = () => isIOS() || /android/i.test(navigator.userAgent)

function canUsePush() {
  if (!isPhone() || !('Notification' in window) || !('serviceWorker' in navigator)) return false
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  return !(isIOS() && !standalone) // iOS: Home Screen only
}

// On here already, whether turned on from this prompt or the schedule's card.
function pushEnabledOnThisDevice() {
  try { return Notification.permission === 'granted' && localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
}

function snoozed() {
  try { return Date.now() - Number(localStorage.getItem(SNOOZE_KEY) || 0) < SNOOZE_MS } catch { return false }
}

function snooze() {
  try { localStorage.setItem(SNOOZE_KEY, String(Date.now())) } catch { /* shows again next visit */ }
}

// Firestore and messaging are loaded on demand, like today.js, and only for
// someone the cheap checks above haven't already ruled out.
async function firebaseParts() {
  const [{ getApp }, fs, msg] = await Promise.all([import('firebase/app'), import('firebase/firestore'), import('firebase/messaging')])
  const app = getApp() // the one shared/session.js signed in with
  return { app, fs, msg, db: fs.getFirestore(app) }
}

async function shouldAsk(uid) {
  if (!canUsePush() || Notification.permission === 'denied' || pushEnabledOnThisDevice() || snoozed()) return false
  const { fs, db } = await firebaseParts()
  const snap = await fs.getDoc(fs.doc(db, 'users', uid))
  return snap.exists()
}

// Same steps as the schedule's enablePush(), against the hub's Firebase app.
async function enable(uid) {
  const { app, fs, msg, db } = await firebaseParts()
  if (!(await msg.isSupported())) throw new Error('This browser can’t show notifications.')
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications weren’t allowed.')
  const token = await msg.getToken(msg.getMessaging(app), {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: await navigator.serviceWorker.ready,
  })
  if (!token) throw new Error('Couldn’t register this device.')
  await fs.updateDoc(fs.doc(db, 'users', uid), { fcmTokens: fs.arrayUnion(token) })
  try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* the schedule's card may show once more */ }
}

export default function PushPrompt({ user }) {
  const [state, setState] = useState('hidden') // hidden | ask | busy | done | error
  const [error, setError] = useState('')

  useEffect(() => {
    if (!user?.uid || user.uid === 'dev') return
    let live = true
    shouldAsk(user.uid)
      .then(ask => { if (live && ask) setState('ask') })
      .catch(e => console.warn('[hub] notification prompt skipped', e))
    return () => { live = false }
  }, [user?.uid])

  useEffect(() => {
    if (state !== 'done') return
    const t = setTimeout(() => setState('hidden'), 3000)
    return () => clearTimeout(t)
  }, [state])

  if (state === 'hidden') return null

  async function turnOn() {
    setState('busy')
    try {
      await enable(user.uid)
      setState('done')
    } catch (e) {
      console.error(e)
      setError(e.message || 'Couldn’t turn notifications on.')
      setState('error')
    }
  }

  function notNow() {
    snooze()
    setState('hidden')
  }

  return (
    <div className="push-prompt" role="status">
      <Icon name="bell" size={20} />
      <div className="push-prompt-text">
        {state === 'done' ? <strong>Notifications are on for this device.</strong>
          : state === 'error' ? <><strong>Notifications aren’t on</strong><span>{error}</span></>
          : <><strong>Turn on notifications?</strong><span>So your reminders reach you on this device.</span></>}
      </div>
      {state !== 'done' && (
        <div className="push-prompt-actions">
          {state !== 'error' && <button className="btn btn-primary" onClick={turnOn} disabled={state === 'busy'}>{state === 'busy' ? 'Turning on…' : 'Turn on'}</button>}
          <button className="btn-ghost-sm" onClick={notNow}>{state === 'error' ? 'Close' : 'Not now'}</button>
        </div>
      )}
    </div>
  )
}
