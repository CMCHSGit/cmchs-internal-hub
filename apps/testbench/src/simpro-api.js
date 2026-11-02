/* Simpro for the Test Bench: find a job, attach a file to it. Calls go through the same Apps Script proxy as
   SimproSync and Ansur (shared/proxy.js): the browser sends this person's Firebase ID token, the proxy checks they
   are an admin or have Simpro access, and relays an allowlisted request. The Simpro key never reaches the page.
   No React and no Firebase here, so the tests run it as it is. */

export const COMPANY_KEY = 'simproSync.company' // shared with SimproSync and Ansur: the company you last used
export const DEFAULT_COMPANY = 3

/** A failed send. `retry`: worth trying again later (no connection, Simpro or the proxy down); otherwise it won't work until someone changes something. */
export class SendError extends Error {
  constructor(message, retry) { super(message); this.name = 'SendError'; this.retry = retry }
}

export const ok = (r) => r.status >= 200 && r.status < 300

export function toBase64(bytes) {
  let s = ''
  const chunk = 0x8000 // argument limits make one big apply() unsafe
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

/** What Simpro said about a refusal. It isn't consistent about casing, nor about where it puts the errors. */
export function simproErr(r) {
  const d = r.data
  const pair = (e) => [e.path ?? e.Field, e.message ?? e.Message].filter(Boolean).join(': ')
  const errs = [d, d?.errors, d?.Errors].find((x) => Array.isArray(x) && x.length) || []
  const why = errs.map(pair).filter(Boolean).join('; ')
  return `Simpro said ${r.status}${why ? ' — ' + why : ''}`
}

/**
 * The proxy's transport: one allowlisted Simpro request per call. `getToken` gives a fresh Firebase ID token.
 * Throws SendError: retry for a lost connection or a 5xx, not for the proxy refusing the person.
 */
export function makeCall({ getToken, proxyUrl, fetchFn = fetch }) {
  return async function call(method, path, body) {
    let res
    try {
      const idToken = await getToken()
      res = await fetchFn(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' }, // a simple request: Apps Script can't answer a CORS preflight
        body: JSON.stringify({ action: 'simproSync', idToken, requests: [{ method, path, body }] }),
      })
    } catch (e) {
      throw new SendError('No connection to the hub’s Simpro service (' + (e?.message || e) + ')', true)
    }
    const json = await res.json().catch(() => null)
    if (!json) throw new SendError(`The hub’s Simpro service gave no answer (${res.status})`, true)
    if (!json.success) throw new SendError(json.error || 'The hub’s Simpro service refused the request', false)
    const r = json.results?.[0]
    if (!r) throw new SendError('No result from the hub’s Simpro service', true)
    return r
  }
}

export const customerOf = (j) => j.Customer?.CompanyName || [j.Customer?.GivenName, j.Customer?.FamilyName].filter(Boolean).join(' ') || ''

/** "#12345 Customer · Site · Name": how a job reads in the Test Bench. */
export const jobLabel = (j) => `#${j.ID}${customerOf(j) ? ' ' + customerOf(j) : ''}${[j.Site?.Name, j.Name || j.Description].filter(Boolean).length ? ' · ' + [j.Site?.Name, j.Name || j.Description].filter(Boolean).join(' · ') : ''}`

/** Companies the person can see, minus the ones marked do-not-use. The first call is also the access check. */
export async function listCompanies(call) {
  const r = await call('GET', '/companies/')
  if (!ok(r)) throw new SendError('Could not read companies from Simpro: ' + simproErr(r), r.status >= 500)
  return (Array.isArray(r.data) ? r.data : []).filter((c) => !/do not use/i.test(c.Name || ''))
}

/**
 * Jobs matching what was typed: a number is tried as the job number first (one call, and what people type most),
 * then name, description and customer, each on its own because a field Simpro won't filter on fails the whole request.
 */
export async function findJobs(call, companyId, q) {
  const text = String(q || '').trim()
  if (!text) return []
  if (/^\d+$/.test(text)) {
    const r = await call('GET', `/companies/${companyId}/jobs/${text}`)
    if (ok(r) && r.data) return [r.data]
    if (r.status !== 404) throw new SendError(`Job ${text}: ${simproErr(r)}`, r.status >= 500)
  }
  const term = encodeURIComponent(text) + '%25'
  const cols = 'columns=ID,Name,Description,Customer,Site,Stage,Status'
  const tries = ['Name', 'Description', 'Customer.CompanyName'].map((f) => `/companies/${companyId}/jobs/?${f}=${term}&${cols}&pageSize=20`)
  const settled = await Promise.all(tries.map((p) => call('GET', p).catch((e) => ({ status: 0, data: String(e) }))))
  const seen = new Map()
  for (const r of settled) if (ok(r) && Array.isArray(r.data)) for (const j of r.data) seen.set(String(j.ID), j)
  if (!seen.size && settled.every((r) => !ok(r))) throw new SendError(`Search failed (${settled.map((r) => r.status).join(', ')}). Try the exact job number.`, settled.some((r) => r.status === 0 || r.status >= 500))
  return [...seen.values()]
}

/**
 * Attaches one file to a job (private, as Ansur does). Returns 'sent', or 'duplicate' when Simpro already has a file of that
 * name on the job (the same report sent twice, so the earlier one stands). Throws SendError otherwise.
 */
export async function attachFile(call, { companyId, jobId, name, bytes }) {
  const r = await call('POST', `/companies/${companyId}/jobs/${jobId}/attachments/files/`, { Filename: name, Public: false, Base64Data: toBase64(bytes) })
  if (ok(r)) return 'sent'
  if ((r.status === 409 || r.status === 422) && /already|exist|duplicate|unique/i.test(simproErr(r))) return 'duplicate'
  // A missing job or a refused name won't get better by waiting; a server error might.
  throw new SendError(r.status === 404 ? `Job ${jobId} was not found in Simpro` : simproErr(r), r.status >= 500 || r.status === 429)
}
