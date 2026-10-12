/* Find the Simpro job for a service order, by its serial number.

   Jobs are named with the serial on the end — "A9 FiCO2 Too High Alarm -
   FX7-53001202" — so a serial off a pasted service order is usually enough to
   identify the job without anyone going to look it up.

   Calls go through the same Apps Script proxy SimproSync and Ansur use: the
   browser sends this user's Firebase ID token, the proxy checks it and relays
   an allowlisted request. The Simpro key never reaches the page. */

import { auth } from '../schedule/src/firebase.js'

const PROXY_URL = 'https://script.google.com/macros/s/AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw/exec'

// Same preference SimproSync writes. One origin, so whichever company you last
// synced against is the one searched here.
const COMPANY_KEY = 'simproSync.company'
const DEFAULT_COMPANY = 3

const companyId = () => {
  try { return Number(localStorage.getItem(COMPANY_KEY)) || DEFAULT_COMPANY } catch { return DEFAULT_COMPANY }
}

async function call(method, path) {
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'simproSync', idToken, requests: [{ method, path }] }),
  })
  const json = await res.json().catch(() => null)
  if (!json) throw new Error(`Bad response from the proxy (${res.status})`)
  if (!json.success) throw new Error(json.error || 'The proxy rejected the request')
  return json.results[0] || { status: 0, data: null }
}

const ok = (r) => r.status >= 200 && r.status < 300

/** Serials are quoted with and without punctuation, so compare them stripped. */
const squash = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

/**
 * Jobs whose name or description contains this serial.
 *
 * Returns { jobs, error }. A failure is never thrown at the caller: not being
 * allowed to query Simpro is normal here — editing service orders is open to
 * Engineers and Management, while the proxy wants an admin or someone granted
 * simproAccess — and that must not get in the way of saving a service order.
 */
export async function findJobsBySerial(sn) {
  const serial = String(sn || '').trim()
  if (serial.length < 4) return { jobs: [], error: null }

  const cid = companyId()
  // "%" is Simpro's wildcard and has to arrive percent-encoded. Wrapped both
  // ends because the serial sits at the END of the job name, so a starts-with
  // search — which is what the API examples show — would never match.
  const term = '%25' + encodeURIComponent(serial) + '%25'
  const cols = 'columns=ID,Name,Description,Customer,Site,Stage,Status'
  const tries = [
    `/companies/${cid}/jobs/?Name=${term}&${cols}&pageSize=20`,
    `/companies/${cid}/jobs/?Description=${term}&${cols}&pageSize=20`,
  ]

  let results
  try {
    // Separately, so a field Simpro will not filter on doesn't take the other
    // one down with it.
    results = await Promise.all(tries.map((p) => call('GET', p).catch((e) => ({ status: 0, data: String(e) }))))
  } catch (e) {
    return { jobs: [], error: e.message || String(e) }
  }

  const byId = new Map()
  let anyOk = false
  for (const r of results) {
    if (!ok(r) || !Array.isArray(r.data)) continue
    anyOk = true
    for (const j of r.data) byId.set(String(j.ID), j)
  }
  if (!anyOk) {
    const why = results.map((r) => r.status).join('/')
    return { jobs: [], error: `Simpro would not search for it (${why})` }
  }

  // Simpro's wildcard can be looser than it looks, so confirm the serial really
  // is in the text rather than trusting the filter.
  const want = squash(serial)
  const jobs = [...byId.values()].filter((j) =>
    squash(j.Name).includes(want) || squash(j.Description).includes(want))

  return { jobs, error: null }
}

export const jobLabel = (j) =>
  `${j.ID}${j.Name ? ' — ' + j.Name : ''}${j.Stage ? ' (' + j.Stage + ')' : ''}`
