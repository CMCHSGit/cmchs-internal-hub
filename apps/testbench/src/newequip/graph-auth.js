/* The Graph access token for the new-equipment page. People are already signed in to the hub with Microsoft (shared/firebase.js, which
   asks for no file access); this asks that same account, from a button the person pressed, to also allow READING files (graph.js,
   SCOPE). The token lives in memory only (about an hour; Microsoft's sign-in gives no way to renew it quietly), never stored. */
import { OAuthProvider, reauthenticateWithPopup } from 'firebase/auth'
import { auth, azureTenant } from '../../../../shared/firebase.js'
import { GraphError, SCOPE } from './graph.js'

let cached = null // { token, at }
const FRESH_MS = 50 * 60 * 1000

/** A token for Graph, asking the person (a pop-up) when there isn't a fresh one. Call it from a click. */
export async function graphToken({ force = false } = {}) {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached.token
  const user = auth?.currentUser
  if (!user) throw new GraphError('token', 'Sign in to the hub first.')
  const provider = new OAuthProvider('microsoft.com')
  provider.addScope(SCOPE)
  provider.setCustomParameters({ ...(azureTenant ? { tenant: azureTenant } : {}), ...(user.email ? { login_hint: user.email } : {}) })
  let result
  try {
    result = await reauthenticateWithPopup(user, provider)
  } catch (e) {
    const code = e?.code || ''
    if (code === 'auth/popup-blocked') throw new GraphError('token', 'The browser blocked the Microsoft pop-up. Allow pop-ups for this site and try again.')
    if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') throw new GraphError('token', 'The Microsoft window was closed before access was allowed. If it said an administrator must approve, that approval is still needed: use Choose a file… for now.')
    throw new GraphError('denied', 'Microsoft didn’t give access to your files' + (e?.message ? ` (${String(e.message).split('\n')[0].slice(0, 160)})` : '') + '. If it said an administrator must approve, that approval is the one IT request.')
  }
  const token = OAuthProvider.credentialFromResult(result)?.accessToken
  if (!token) throw new GraphError('denied', 'Microsoft didn’t give access to your files.')
  cached = { token, at: Date.now() }
  return token
}

/** Forget the token (it was refused): the next read asks again. */
export const forgetGraphToken = () => { cached = null }
