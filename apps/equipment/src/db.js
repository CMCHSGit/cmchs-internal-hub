/* The demo tracker's Realtime Database (chs-equipment project), as the old
   tracker reaches it: the hub sign-in is traded for a database pass from the
   Simpro proxy (action rtdbToken), and the pass is used on the database's REST
   API. The database's rules let any staff pass read and write everything
   (rules/database.rules.json).

   One pass for the whole app: Settings → People and access and the project
   tracker's demo feed use this too (apps/admin/src/tracker.js).

   `npm run dev` without a .env has no sign-in: the same calls then go to a
   made-up database kept in this browser (db-local.js). */
import { auth } from '../../schedule/src/firebase.js'
import { PROXY_URL } from '../../../shared/proxy.js'
import * as devDb from './db-local.js'

export const DB_URL = 'https://chs-equipment-default-rtdb.asia-southeast1.firebasedatabase.app'
// chs-equipment's public web API key (not a secret: it's in the tracker's page too).
const CHS_KEY = 'AIzaSyB-A5wIEoqD9SBQPJnc6bs_qjHytZFDaBA'

const local = import.meta.env.DEV && !auth ? devDb : null
export const isLocal = !!local

/*
 * The pass is kept in this browser between visits, under the same key and in
 * the same shape as the old tracker keeps it (chs_db_pass: { uid, idToken,
 * refreshToken, exp }). /demo/ and this are on the same address, so whichever
 * was opened last leaves a pass the other can use straight away. One that
 * has run out is renewed with its refresh token, one quick call to Google;
 * only with no pass at all, or someone else's, is a new one asked of the
 * proxy, which is the slow part (Apps Script, often seconds).
 */
const PASS_KEY = 'chs_db_pass'
const readPass = () => { try { const p = JSON.parse(localStorage.getItem(PASS_KEY) || 'null'); return p && p.idToken ? p : null } catch { return null } }
const savePass = (p) => { try { p ? localStorage.setItem(PASS_KEY, JSON.stringify(p)) : localStorage.removeItem(PASS_KEY) } catch { /* private mode: kept in memory only */ } pass = p }
let pass = readPass()
let pending = null  // one pass request at a time, however many reads want one

async function mintPass(uid) {
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
  }).then((res) => res.json())
  if (!ex.idToken) throw new Error('Demo tracker pass exchange failed: ' + (ex.error?.message || 'unknown'))
  savePass({ uid, idToken: ex.idToken, refreshToken: ex.refreshToken, exp: Date.now() + Number(ex.expiresIn) * 1000 })
}

async function refreshPass() {
  const r = await fetch('https://securetoken.googleapis.com/v1/token?key=' + CHS_KEY, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(pass.refreshToken),
  }).then((res) => res.json())
  if (!r.id_token) throw new Error('Could not renew the database pass')
  savePass({ uid: pass.uid, idToken: r.id_token, refreshToken: r.refresh_token, exp: Date.now() + Number(r.expires_in) * 1000 })
}

/** A database pass: the one kept here while it has five minutes left, else renewed, else a new one. */
export async function dbToken({ force = false } = {}) {
  const uid = auth.currentUser?.uid
  if (pass && pass.uid !== uid) savePass(null) // someone else signed in on this browser
  if (!force && pass && pass.exp - Date.now() > 5 * 60 * 1000) return pass.idToken
  if (!pending) {
    pending = (async () => {
      if (pass?.refreshToken && !force) { try { await refreshPass(); return } catch { /* fall through to a new one */ } }
      await mintPass(uid)
    })().finally(() => { pending = null })
  }
  await pending
  return pass.idToken
}

function url(path, params = {}, token) {
  const q = new URLSearchParams({ ...params, auth: token })
  return `${DB_URL}/${path}.json?${q}`
}

/** A refused pass gets one fresh try, as the old tracker's fbFetch does. */
async function fetchDb(path, params, init = {}) {
  let res = await fetch(url(path, params, await dbToken()), init)
  if (res.status === 401 || res.status === 403) res = await fetch(url(path, params, await dbToken({ force: true })), init)
  return res
}

/**
 * Reads a path. With `etag`, also returns the ETag the database gave it, for
 * a guarded write. `params` are REST query parameters (orderBy, limitToLast,
 * shallow…, JSON-quoted as the API wants).
 */
export async function read(path, { etag = false, params = {} } = {}) {
  if (local) return local.read(path, { etag })
  const res = await fetchDb(path, params, etag ? { headers: { 'X-Firebase-ETag': 'true' } } : {})
  if (!res.ok) throw new Error(`Could not read the demo tracker's ${path} (${res.status})`)
  return { data: await res.json(), etag: res.headers.get('ETag') }
}

/**
 * Writes a path (PUT, PATCH or DELETE). With `etag`, only if nothing has
 * changed since that read: resolves { ok: false, conflict: true } if it has
 * (412), so the caller can merge and try again.
 */
export async function write(path, value, { method = 'PUT', etag = null } = {}) {
  if (local) return local.write(path, value, { method, etag })
  const headers = { 'Content-Type': 'application/json' }
  if (etag) headers['if-match'] = etag
  const res = await fetchDb(path, {}, { method, headers, body: method === 'DELETE' ? undefined : JSON.stringify(value) })
  if (res.status === 412) return { ok: false, conflict: true }
  if (!res.ok) throw new Error(`Could not save to the demo tracker's ${path} (${res.status})`)
  return { ok: true }
}

/**
 * Calls onChange(value) with a path's value now and whenever it changes,
 * over the database's event stream, as the old tracker watches data/_v. The
 * stream is reopened with a fresh pass when the old one runs out; if streams
 * don't work at all, it checks every 15 seconds instead. Returns stop().
 */
export function watch(path, onChange) {
  if (local) return local.watch(path, onChange)
  let es = null, timer = null, stopped = false, last
  const tell = (v) => { const s = JSON.stringify(v); if (s !== last) { last = s; onChange(v) } }
  const poll = () => {
    if (stopped) return
    read(path).then(({ data }) => tell(data)).catch(() => {}).finally(() => { if (!stopped) timer = setTimeout(poll, 15000) })
  }
  const open = async () => {
    if (stopped) return
    try {
      es = new EventSource(url(path, { accept: 'text/event-stream' }, await dbToken()))
      es.addEventListener('put', (e) => { try { const p = JSON.parse(e.data); if (p.path === '/') tell(p.data) } catch { /* ignore */ } })
      es.addEventListener('auth_revoked', () => { es.close(); es = null; setTimeout(open, 500) })
      es.onerror = () => { if (es && es.readyState === EventSource.CLOSED) { es = null; poll() } }
    } catch { poll() }
  }
  open()
  return () => { stopped = true; es?.close(); clearTimeout(timer) }
}
