/* Admin settings — sign-in, then admins only.

   Uses the staff schedule's own sign-in (its AuthContext), so anyone already
   signed in at the hub lands straight in, and a first visit here sets up the
   same profile a first visit to the schedule would. What keeps non-admins out
   of the data is firestore.rules (in the chs-equipment repo): only an admin can
   change someone else's record, the locations or read the activity log. The
   checks below only stop them seeing screens that would fail. */

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { ShieldAlert } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Button, Loading, Spinner } from '../../schedule/src/components/ui'
import Admin from './Admin'

export default function App() {
  return (
    <AuthProvider>
      <Page />
    </AuthProvider>
  )
}

function Page() {
  const { user, profile, profileReady } = useAuth()

  if (user === undefined || (user && !profileReady)) return <div className="page"><Loading /></div>
  if (!user) return <SignIn />

  return (
    <>
      <Who name={profile?.displayName || user.displayName || user.email} />
      {profile?.role === 'admin' ? <Admin /> : <NotAdmin email={user.email} />}
    </>
  )
}

/** The signed-in name, top right beside the light/dark switch (index.html's #who). */
function Who({ name }) {
  const slot = document.getElementById('who')
  return slot ? createPortal(name, slot) : null
}

function SignIn() {
  const { signInWithMicrosoft } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function signIn() {
    setBusy(true)
    setError(null)
    try {
      await signInWithMicrosoft()
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') {
        console.error('Sign-in error:', e.code, e.message, e)
        setError(`Sign-in failed. ${e.message || 'Try again.'}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page page-narrow">
      <div className="card admin-gate">
        <p>Sign in with your Cass / CHS Microsoft account. Admin settings are for staff schedule admins.</p>
        {error && <p className="login-error">{error}</p>}
        <Button onClick={signIn} disabled={busy}>{busy ? <Spinner size={18} light /> : 'Sign in with Microsoft'}</Button>
      </div>
    </div>
  )
}

function NotAdmin({ email }) {
  return (
    <div className="page page-narrow">
      <div className="card admin-gate">
        <ShieldAlert size={28} aria-hidden="true" className="admin-lock-icon" />
        <p>
          Admin settings are for staff schedule admins, and {email} isn’t one. An existing admin can give
          you the admin role here.
        </p>
        <a className="btn btn-secondary btn-md" href="/">Back to the Internal Hub</a>
      </div>
    </div>
  )
}
