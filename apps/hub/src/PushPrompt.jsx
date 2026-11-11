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
// (backend/apps-script/proxy, "HUB PUSH"). Admin's switches decide which of
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

// On here already, whether turned on from this prompt, Settings or the schedule's card.
export function pushEnabledOnThisDevice() {
  try { return Notification.permission === 'granted' && localStorage.getItem(ENABLED_KEY) === '1' } catch { return false }
}

/**
 * This device and notifications, for Settings: 'on', 'off' (can be turned on),
 * 'install' (an iPhone that hasn't added the hub to its Home Screen),
 * 'blocked' (turned off for the site) or 'computer' (they're for phones).
 */
export function pushStatus() {
  if (!isPhone() || !('Notification' in window) || !('serviceWorker' in navigator)) return 'computer'
  if (!canUsePush()) return 'install'
  if (Notification.permission === 'denied') return 'blocked'
  return pushEnabledOnThisDevice() ? 'on' : 'off'
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
  return { app, fs, msg, db: (await import('../../../shared/firestore.js')).firestore(app) }
}

async function shouldAsk(uid) {
  if (!canUsePush() || Notification.permission === 'denied' || pushEnabledOnThisDevice() || snoozed()) return false
  const { fs, db } = await firebaseParts()
  const snap = await fs.getDoc(fs.doc(db, 'users', uid))
  return snap.exists()
}

// Same steps as the schedule's enablePush(), against the hub's Firebase app.
// A step that never answers shows as an error naming it, not "Turning on…" forever.
function within(ms, step, promise) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`Timed out ${step}. Try again.`)), ms))])
}

/**
 * The app's service worker, once it is running. Just after the app is installed (or reinstalled: deleting the app
 * from a phone deletes its worker too) the worker is still downloading the app, about 1 MB, which on mobile data can
 * take well over the 15 s this used to wait, and the person saw "Timed out… Try again." So: make sure it has been
 * asked to install (shared/register-sw.js only does that once the page has finished loading; registering it again is
 * a no-op), then give it a minute.
 */
async function appWorker(onStep) {
  const sw = navigator.serviceWorker
  if (import.meta.env.PROD && !(await sw.getRegistration('/'))) sw.register('/sw.js', { scope: '/' }).catch(() => {})
  const slow = setTimeout(() => onStep('installing'), 3000)
  try { return await within(60000, 'waiting for the app to finish installing', sw.ready) }
  finally { clearTimeout(slow) }
}

/**
 * This phone's registration. The first one on a newly installed app can be slow to come back, so a request that
 * times out is asked once more, for longer, before giving up.
 */
async function phoneToken(msg, app, registration, onStep) {
  const ask = (ms) => within(ms, 'registering this phone', msg.getToken(msg.getMessaging(app), {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  }))
  try { return await ask(20000) }
  catch (e) {
    if (!/^Timed out/.test(e?.message || '')) throw e
    onStep('registering')
    return ask(40000)
  }
}

// What the steps that can take a while say, for the prompt and Settings (onStep).
export const ENABLE_STEPS = {
  installing: 'Still setting up the app on this phone…',
  registering: 'Still registering this phone…',
}

// The permission question comes FIRST, before anything is awaited: iOS only
// shows it while the tap still counts, and loading Firebase first used it up,
// so the question never appeared and this waited forever.
// onStep(id) says when it is taking a while (ENABLE_STEPS), so it doesn't just sit on "Turning on…".
export async function enable(uid, onStep = () => {}) {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notifications weren’t allowed. They can be turned on in the phone’s Settings for this app.')
  const { app, fs, msg, db } = await within(30000, 'loading', firebaseParts())
  if (!(await msg.isSupported())) throw new Error('This browser can’t show notifications.')
  const registration = await appWorker(onStep)
  const token = await phoneToken(msg, app, registration, onStep)
  if (!token) throw new Error('Couldn’t register this device.')
  await within(15000, 'saving', fs.updateDoc(fs.doc(db, 'users', uid), { fcmTokens: fs.arrayUnion(token) }))
  try { localStorage.setItem(ENABLED_KEY, '1') } catch { /* the schedule's card may show once more */ }
}

/**
 * A phone that turned notifications on keeps saying so (this device's own flag), so it is never asked again, but its
 * registration can be missing from the person's record: removed as dead, or lost when the record was rewritten. Then
 * nothing is ever sent to that phone and nobody can tell why. So once a visit, a phone that is on gets its current
 * registration put back; adding one that is already there changes nothing.
 */
async function restoreRegistration(uid) {
  if (!pushEnabledOnThisDevice() || !canUsePush()) return
  try { if (sessionStorage.getItem('hub:push_restored') === uid) return; sessionStorage.setItem('hub:push_restored', uid) } catch { /* private mode: once per load */ }
  const { app, fs, msg, db } = await firebaseParts()
  if (!(await msg.isSupported())) return
  const registration = await within(15000, 'waiting for the app', navigator.serviceWorker.ready)
  const token = await within(20000, 'checking this phone', msg.getToken(msg.getMessaging(app), {
    vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
    serviceWorkerRegistration: registration,
  }))
  if (token) await fs.updateDoc(fs.doc(db, 'users', uid), { fcmTokens: fs.arrayUnion(token) })
}

export default function PushPrompt({ user }) {
  const [state, setState] = useState('hidden') // hidden | ask | busy | done | error
  const [error, setError] = useState('')
  const [step, setStep] = useState('')

  useEffect(() => {
    if (!user?.uid || user.uid === 'dev') return
    let live = true
    restoreRegistration(user.uid).catch(e => console.warn('[hub] could not re-check this phone for notifications', e))
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
    setStep('')
    try {
      await enable(user.uid, setStep)
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
          : state === 'busy' && step ? <><strong>Turning on notifications</strong><span>{ENABLE_STEPS[step]} This can take a minute just after installing.</span></>
          : <><strong>Turn on notifications?</strong><span>So your reminders reach you on this device.</span></>}
      </div>
      {state !== 'done' && (
        <div className="push-prompt-actions">
          <button className="btn btn-primary" onClick={turnOn} disabled={state === 'busy'}>{state === 'busy' ? 'Turning on…' : state === 'error' ? 'Try again' : 'Turn on'}</button>
          <button className="btn-ghost-sm" onClick={notNow}>{state === 'error' ? 'Close' : 'Not now'}</button>
        </div>
      )}
    </div>
  )
}
