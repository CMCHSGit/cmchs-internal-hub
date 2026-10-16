/* The demo tracker's team list, read and changed from Admin.

   The tracker keeps its own list of who's on the team (accountManagers in its
   Realtime Database, in the chs-equipment Firebase project): each person's
   tracker role ('am' = account manager, 'service' = Service & Projects), the
   phones they've turned notifications on for (fcmTokens), and, new here,
   `notify: false` for someone switched off demo reminders. The Apps Script
   reminder senders skip anyone with notify false.

   That database doesn't accept the hub's sign-in, so this does exactly what
   the tracker does (chs-equipment index.html, "Staff sign-in"): trade the
   sign-in for a database pass from the Simpro proxy, then use the pass on
   the database's REST API.

   Writes are read-modify-write of the whole list, because that's how the
   tracker itself saves it — guarded by Firebase's ETag, so a change made in
   the tracker at the same moment is never silently overwritten (same fix as
   the tracker's saveBin()). */
import { auth } from '../../schedule/src/firebase'

import { PROXY_URL } from '../../../shared/proxy.js'
const DB_URL = 'https://chs-equipment-default-rtdb.asia-southeast1.firebasedatabase.app'
// chs-equipment's public web API key (not a secret; it's in the tracker's page too).
const CHS_KEY = 'AIzaSyB-A5wIEoqD9SBQPJnc6bs_qjHytZFDaBA'
const TEAM = DB_URL + '/accountManagers.json'

export const TRACKER_ROLES = [
  { id: 'am', label: 'Account manager' },
  { id: 'service', label: 'Service & Projects' },
]
export const trackerRoleLabel = id => TRACKER_ROLES.find(r => r.id === id)?.label || 'Account manager'

let pass = null // { idToken, exp }

async function dbToken() {
  if (pass && pass.exp - Date.now() > 5 * 60 * 1000) return pass.idToken
  const idToken = await auth.currentUser.getIdToken()
  const r = await fetch(PROXY_URL, {
    method: 'POST', headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'rtdbToken', idToken }),
  })
  const j = await r.json()
  if (!j.success) throw new Error(j.error || 'No database pass for the demo tracker')
  const ex = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + CHS_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: j.customToken, returnSecureToken: true }),
  }).then(res => res.json())
  if (!ex.idToken) throw new Error('Demo tracker pass exchange failed: ' + (ex.error?.message || 'unknown'))
  pass = { idToken: ex.idToken, exp: Date.now() + Number(ex.expiresIn) * 1000 }
  return pass.idToken
}

/** Reads one path of the tracker's database (e.g. 'upcomingLoans'). Read-only: the project tracker's demo feed uses it. */
export async function readTracker(path) {
  const res = await fetch(DB_URL + '/' + path + '.json?auth=' + encodeURIComponent(await dbToken()))
  if (!res.ok) throw new Error('Could not read the demo tracker (' + res.status + ')')
  return res.json()
}

async function readTeam() {
  const res = await fetch(TEAM + '?auth=' + encodeURIComponent(await dbToken()), { headers: { 'X-Firebase-ETag': 'true' } })
  if (!res.ok) throw new Error('Could not read the demo tracker team (' + res.status + ')')
  const list = await res.json()
  return { list: Array.isArray(list) ? list.filter(Boolean) : [], etag: res.headers.get('ETag') }
}

/** The tracker's team list, sorted by name. */
export async function loadTeam() {
  return (await readTeam()).list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

/**
 * Changes the list: `change` gets a fresh copy and edits it in place. Retried
 * on a clash with a save from the tracker, so the other edit is kept too.
 * Resolves to the saved list.
 */
export async function updateTeam(change) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { list, etag } = await readTeam()
    change(list)
    list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    const res = await fetch(TEAM + '?auth=' + encodeURIComponent(await dbToken()), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...(etag ? { 'if-match': etag } : {}) },
      body: JSON.stringify(list),
    })
    if (res.ok) return list
    if (res.status !== 412) throw new Error('Could not save to the demo tracker (' + res.status + ')')
  }
  throw new Error('The demo tracker team kept changing while saving — try again.')
}

const norm = s => (s || '').trim().toLowerCase()

/** This person's entry in the tracker's list: by email, else by exact name. */
export function findMember(list, person) {
  const email = norm(person.email)
  return (email && list.find(m => norm(m.email) === email))
    || list.find(m => norm(m.name) && norm(m.name) === norm(person.displayName))
    || null
}

