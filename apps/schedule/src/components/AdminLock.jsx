import { useState } from 'react'
import { Lock } from 'lucide-react'
import { Button } from './ui'
const emulators = typeof import.meta.env !== 'undefined' && import.meta.env.DEV === true && import.meta.env.VITE_EMULATORS === 'true' // the test copy (npm run dev:emulators)

/**
 * The admin password — a second step on top of the admin role, useful on an
 * admin's unlocked phone or computer. Asked by the admin pages of Settings
 * (/settings/people, /settings/notifications, /settings/schedule); one origin,
 * one sessionStorage, so unlocking one unlocks all until the tab/app is closed.
 *
 * Only its SHA-256 is kept here (this repo is public), but this is a lock on
 * the door, not a safe: it runs in the browser. What actually protects admin
 * actions is the role check plus firestore.rules.
 */
const ADMIN_PASSWORD_SHA256 = '8c1d16397760afa8d5301e4461e28f5f48f7e8ba20de33e32a259e9bedd7fecb'
const UNLOCK_KEY = 'css_admin_unlocked'

async function sha256(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('')
}

export function isUnlocked() {
  // The test copy (npm run dev:emulators): its made-up admin is already an admin by role, and the real password stays out of it.
  if (emulators) return true
  try { return sessionStorage.getItem(UNLOCK_KEY) === ADMIN_PASSWORD_SHA256 } catch { return false }
}

export default function AdminLock({ onUnlock, title = 'Unlock admin settings' }) {
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
        <h2 className="page-title">{title}</h2>
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
