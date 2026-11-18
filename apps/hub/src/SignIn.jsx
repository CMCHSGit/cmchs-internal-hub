import { lazy, Suspense, useState } from 'react'
import { signIn } from '../../../shared/session.js'
import { signInError } from './signin-error.js'

// The test copy's "Sign in as" list (npm run dev:emulators). Written out in
// full, not via shared/firebase.js, so a real build sees `false` here and
// leaves the list, and its test password, out of the site altogether.
const TestSignIn = import.meta.env.DEV && import.meta.env.VITE_EMULATORS === 'true' ? lazy(() => import('./TestSignIn.jsx')) : null

export default function SignIn({ error: fixedError }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function onSignIn() {
    setBusy(true)
    setError(null)
    try {
      await signIn()
    } catch (e) {
      // The full message (Microsoft's or Firebase's reason) for whoever opens the browser's console.
      console.warn('[sign-in]', e?.code, e?.message)
      setError(signInError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="signin">
      <div className="signin-col">
        <div className="mini-stripes" aria-hidden="true"><span /><span /><span /></div>
        <img src="/brand/logo-full-colour.png" alt="Connected Healthcare Systems" width="180" className="signin-logo" />
        <div className="signin-copy">
          <span className="chs-overline">internal.chsnz.co.nz</span>
          <h2>CMCHS Internal Hub</h2>
          <p>Sign in with your Cass Medical Microsoft 365 account to open the demo tracker, staff schedule and service tools.</p>
        </div>
        {fixedError
          ? <div className="alert" role="alert">{fixedError}</div>
          : <button className="btn btn-primary btn-lg btn-block" onClick={onSignIn} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in with Microsoft'}
            </button>}
        {error && (
          <div className="alert" role="alert">
            {error.text}
            {error.code && <span className="signin-code">Error code: {error.code}</span>}
          </div>
        )}
        {TestSignIn && <Suspense fallback={null}><TestSignIn onError={text => setError(text && { text, code: null })} /></Suspense>}
        <span className="caption">Trouble signing in? Call the office on 0800 424 797.</span>
      </div>
    </main>
  )
}

