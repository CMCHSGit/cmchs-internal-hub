/* The test copy (npm run dev:emulators, README "Test copy") only: sign in as
   one of the made-up test staff. Loaded only there (SignIn.jsx). */
import { useState } from 'react'
import { signInAsTest } from '../../../shared/session.js'
import { TEST_ACCOUNTS, TEST_PASSWORD } from '../../../shared/test-accounts.js'

export default function TestSignIn({ onError }) {
  const [busy, setBusy] = useState('')
  async function go(a) {
    setBusy(a.email)
    onError(null)
    try { await signInAsTest(a.email, TEST_PASSWORD) } catch (e) { onError('Test sign-in failed: ' + (e?.code || e?.message || e) + '. Are the emulators running and seeded (npm run emulators)?') } finally { setBusy('') }
  }
  return (
    <div className="signin-test" role="group" aria-label="Test copy: sign in as">
      <span className="chs-overline">Test copy: sign in as</span>
      {TEST_ACCOUNTS.map(a => (
        <button key={a.uid} type="button" className="btn btn-secondary btn-block" onClick={() => go(a)} disabled={!!busy}>
          {busy === a.email ? 'Signing in…' : a.name} <span className="caption">{a.about}</span>
        </button>
      ))}
    </div>
  )
}
