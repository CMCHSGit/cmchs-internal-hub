/* Attach the generated PVT reports to a Simpro job, set its notes, stage and
   status.

   Everything else on this page runs offline and sends nothing anywhere. This
   panel is the one exception, and it stays inert until someone chooses to sign
   in — the Firebase SDK is a dynamic import below, so a person who only wants a
   PDF never downloads it.

   Simpro calls go through the same Apps Script proxy SimproSync uses: the
   browser sends this user's Firebase ID token, the proxy checks they're an
   admin (or have simproAccess granted) and relays an allowlisted request. The
   Simpro key never reaches the page. */

const PROXY_URL = 'https://script.google.com/macros/s/AKfycbzKLt_IP3GPRiNQkYkCep-_Yee06rDwc3uJGnQQuzjVuCSJOImJnaqDgU-3W3q9Y4OHUw/exec'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

// Simpro's four job stages. Status codes are per-company and fetched instead.
const STAGES = ['Pending', 'Progress', 'Complete', 'Archived']

let auth = null
let user = null
let companyId = null
let job = null          // the chosen job, as Simpro returns it
let statusCodes = []

// ── proxy transport ───────────────────────────────────────────────────────
// One request per call rather than SimproSync's batching: the heavy calls here
// are base64 PDFs, which the proxy requires be sent one at a time anyway.
async function call(method, path, body) {
  const idToken = await auth.currentUser.getIdToken()
  const res = await fetch(PROXY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'simproSync', idToken, requests: [{ method, path, body }] }),
  })
  const json = await res.json().catch(() => null)
  if (!json) throw new Error(`Bad response from the proxy (${res.status})`)
  if (!json.success) throw new Error(json.error || 'The proxy rejected the request')
  const r = json.results[0]
  if (!r) throw new Error('No result from the proxy')
  return r
}

const ok = (r) => r.status >= 200 && r.status < 300

// Simpro explains a 4xx in the body — a 422 is { errors: [{ path, message }] }.
// The bare status said nothing about why a job update was refused, so show
// what Simpro actually said alongside it.
function simproErr(r) {
  const d = r.data
  // Simpro is not consistent about casing across routes, so accept either, and
  // a bare array of errors as well as one nested under errors/Errors.
  const pair = (e) => [e.path ?? e.Field, e.message ?? e.Message].filter(Boolean).join(': ')
  const errs = [d, d?.errors, d?.Errors].find((x) => Array.isArray(x) && x.length) || []
  const why = errs.length
    ? errs.map(pair).filter(Boolean).join(', ')
    : (typeof d === 'string' ? d : d?.message || d?.Message || '').slice(0, 200)
  // Fall back to the raw body rather than saying nothing — a shape neither of
  // us predicted is still far more use than the status code alone.
  const detail = why || (d && typeof d === 'object' ? JSON.stringify(d).slice(0, 200) : '')
  return `Simpro returned ${r.status}${detail ? ` (${detail})` : ''}`
}

function note(msg, kind = '') {
  const el = $('sp-msg')
  el.textContent = msg
  el.className = 'msg' + (kind ? ' ' + kind : '')
}

// ── sign in ───────────────────────────────────────────────────────────────
// A popup has to be opened in the same turn as the click that asked for it.
// Awaiting the dynamic import first spends that user gesture, and the browser
// blocks the window — so the SDK is fetched ahead of the click, on the first
// sign of intent, and the handler below opens the popup without awaiting
// anything. This is the whole reason for the dance: the lazy import is worth
// keeping (nobody converting a file offline should pay 350 KB for it), but it
// cannot sit between the click and the popup.
let fb = null          // { auth, microsoftProvider, signInWithPopup, … } once loaded
let fbLoading = null

function loadFirebase() {
  if (!fbLoading) {
    fbLoading = Promise.all([
      import('../schedule/src/firebase.js'),
      import('firebase/auth'),
    ]).then(([app, authMod]) => {
      fb = { ...app, ...authMod }
      auth = app.auth
      return fb
    })
  }
  return fbLoading
}

function openPopup() {
  note('Signing in…')
  fb.signInWithPopup(fb.auth, fb.microsoftProvider)
    .then(() => { user = fb.auth.currentUser; return afterSignIn() })
    .catch((e) => {
      if (e?.code === 'auth/popup-blocked') {
        // Only reachable when the SDK wasn't ready in time. It is now, so the
        // next click opens the popup in the same turn and works.
        return note('Your browser blocked the sign-in window. Click “Sign in” again.', 'warn')
      }
      if (e?.code === 'auth/cancelled-popup-request' || e?.code === 'auth/popup-closed-by-user') {
        return note('')
      }
      note('Sign-in did not complete: ' + (e.message || e), 'warn')
    })
}

function signIn() {
  if (fb) return openPopup()   // ready — no await, so the gesture survives
  note('Loading sign-in…')
  loadFirebase().then(openPopup).catch((e) => note('Could not load sign-in: ' + (e.message || e), 'warn'))
}

// Shared with SimproSync, which stores the same preference under the same key.
// Both tools are on this one origin now, so whichever company you last synced
// against is the company this opens on.
const COMPANY_KEY = 'simproSync.company'
const DEFAULT_COMPANY = 3

async function afterSignIn() {
  $('sp-signin').hidden = true
  $('sp-who').textContent = user.email || ''
  note('Checking access…')
  try {
    // The first call doubles as the access check — the proxy rejects anyone
    // without admin or simproAccess, with a message worth showing as-is.
    const r = await call('GET', '/companies/')
    if (!ok(r)) throw new Error('Could not read companies from Simpro')
    const companies = (Array.isArray(r.data) ? r.data : []).filter((c) => !/do not use/i.test(c.Name || ''))
    if (!companies.length) throw new Error('No Simpro companies are visible')

    let saved = DEFAULT_COMPANY
    try { saved = +(localStorage.getItem(COMPANY_KEY) || DEFAULT_COMPANY) } catch { /* blocked storage */ }
    companyId = companies.some((c) => c.ID === saved) ? saved : companies[0].ID

    $('sp-company').innerHTML = companies
      .map((c) => `<option value="${esc(c.ID)}"${c.ID === companyId ? ' selected' : ''}>${esc(c.Name)}</option>`)
      .join('')
    $('sp-body').hidden = false
    note('')
  } catch (e) {
    note(e.message || String(e), 'warn')
  }
}

// ── find the job ──────────────────────────────────────────────────────────
async function search() {
  const q = $('sp-q').value.trim()
  if (!q) return note('Type a job number, customer or description to search for.', 'warn')
  $('sp-results').innerHTML = ''
  note('Searching…')

  const company = $('sp-company').selectedOptions[0]?.textContent || companyId
  try {
    // A number is almost always the job number, so try that as an exact fetch
    // first — it's one call and it's what people will type most often.
    if (/^\d+$/.test(q)) {
      const r = await call('GET', `/companies/${companyId}/jobs/${q}`)
      if (ok(r) && r.data) return showResults([r.data])
      // Don't fall through silently on anything but "no such job in this
      // company" — reporting a 403 as "no jobs matched" sent me looking in
      // entirely the wrong place.
      if (r.status !== 404) {
        return note(`Job ${q} in ${company}: ${simproErr(r)}`, 'warn')
      }
    }

    // Then search. Each filter is tried on its own because a field Simpro
    // won't filter on makes the whole request fail, and one unsupported
    // field shouldn't take the others down with it.
    const term = encodeURIComponent(q) + '%25'
    const cols = 'columns=ID,Name,Description,Customer,Site,Stage,Status'
    const tries = [
      ['Name', `/companies/${companyId}/jobs/?Name=${term}&${cols}&pageSize=20`],
      ['Description', `/companies/${companyId}/jobs/?Description=${term}&${cols}&pageSize=20`],
      ['Customer', `/companies/${companyId}/jobs/?Customer.CompanyName=${term}&${cols}&pageSize=20`],
    ]
    const settled = await Promise.all(tries.map(([, path]) => call('GET', path).catch((e) => ({ status: 0, data: String(e) }))))

    const seen = new Map()
    const rejected = []
    settled.forEach((r, i) => {
      if (ok(r) && Array.isArray(r.data)) { for (const j of r.data) seen.set(String(j.ID), j); return }
      rejected.push(`${tries[i][0]} (${r.status})`)
    })

    if (seen.size) return showResults([...seen.values()])
    if (rejected.length === tries.length) {
      return note(`Search failed in ${company} — ${rejected.join(', ')}. Try the exact job number.`, 'warn')
    }
    note(`Nothing matched “${q}” in ${company}. Check the company above, or try the job number.`, 'warn')
  } catch (e) {
    note(e.message || String(e), 'warn')
  }
}

const customerOf = (j) => j.Customer?.CompanyName || [j.Customer?.GivenName, j.Customer?.FamilyName].filter(Boolean).join(' ') || ''
const siteOf = (j) => j.Site?.Name || ''

function showResults(jobs) {
  if (!jobs.length) return note('No jobs matched. Try the job number, or part of the customer name.', 'warn')
  note(`${jobs.length} job${jobs.length === 1 ? '' : 's'} found.`)
  $('sp-results').innerHTML = jobs.map((j) => `
    <button type="button" class="sp-hit" data-id="${esc(j.ID)}">
      <strong>#${esc(j.ID)}</strong> ${esc(customerOf(j))}
      <span>${esc([siteOf(j), j.Name || j.Description || ''].filter(Boolean).join(' · '))}</span>
    </button>`).join('')
  for (const b of $('sp-results').querySelectorAll('.sp-hit')) {
    b.addEventListener('click', () => choose(b.dataset.id))
  }
}

async function choose(id) {
  note('Loading job…')
  try {
    const r = await call('GET', `/companies/${companyId}/jobs/${id}`)
    if (!ok(r) || !r.data) throw new Error(`Could not load job ${id}`)
    job = r.data
    $('sp-results').innerHTML = ''
    $('sp-q').value = ''
    $('sp-chosen').hidden = false
    $('sp-find').hidden = true
    $('sp-chosen-text').innerHTML =
      `<strong>Job #${esc(job.ID)}</strong> ${esc(customerOf(job))}` +
      `<span>${esc([siteOf(job), job.Name || job.Description || ''].filter(Boolean).join(' · '))}</span>` +
      `<span>Currently ${esc(job.Stage || '—')}${job.Status?.Name ? ' · ' + esc(job.Status.Name) : ''}</span>`

    // Pre-select the job's current stage and status, so leaving them alone is
    // genuinely "no change" rather than silently setting them to a default.
    $('sp-stage').value = STAGES.includes(job.Stage) ? job.Stage : ''
    await loadStatusCodes()
    $('sp-status').value = job.Status?.ID != null ? String(job.Status.ID) : ''
    refreshAttachCount()
    note('')
  } catch (e) {
    note(e.message || String(e), 'warn')
  }
}

async function loadStatusCodes() {
  if (statusCodes.length) return
  const r = await call('GET', `/companies/${companyId}/setup/statusCodes/projects/`)
  statusCodes = ok(r) && Array.isArray(r.data) ? r.data : []
  $('sp-status').innerHTML = '<option value="">Leave unchanged</option>' +
    statusCodes.map((s) => `<option value="${esc(s.ID)}">${esc(s.Name)}</option>`).join('')
}

// ── what we'd attach ──────────────────────────────────────────────────────
const reports = () => (window.ansurPvt?.reports() || [])

function refreshAttachCount() {
  const n = reports().length
  $('sp-go').disabled = !job || !n
  $('sp-count').textContent = n
    ? `${n} report${n === 1 ? '' : 's'} ready to attach`
    : 'No reports yet — add some .mtr files above'
}

const toBase64 = (bytes) => {
  let s = ''
  const chunk = 0x8000 // argument limits make one big apply() unsafe
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(s)
}

// ── do it ─────────────────────────────────────────────────────────────────
async function run() {
  const list = reports()
  if (!job || !list.length) return

  const stage = $('sp-stage').value
  const statusId = $('sp-status').value
  const notes = $('sp-notes').value.trim()
  const total = list.length + (notes ? 1 : 0) + (stage ? 1 : 0) + (statusId ? 1 : 0)
  let done = 0
  const step = (msg) => note(`${msg} (${++done} of ${total})`)

  $('sp-go').disabled = true
  const failed = []
  const skipped = []
  try {
    for (const rep of list) {
      try {
        const r = await call('POST', `/companies/${companyId}/jobs/${job.ID}/attachments/files/`, {
          Filename: rep.name,
          Public: false,
          Base64Data: toBase64(rep.pdf),
        })
        // Simpro refuses a file whose name is already attached to the job.
        // Report names carry the serial and test date, so that's this same
        // report from an earlier run — skip it rather than failing, so a
        // rerun (say, after closing the job in Simpro) can still do the rest.
        if (!ok(r) && (r.status === 409 || r.status === 422) && /already|exist|duplicate|unique/i.test(simproErr(r))) {
          skipped.push(rep.name)
        } else if (!ok(r)) throw new Error(simproErr(r))
      } catch (e) {
        failed.push(`${rep.name}: ${e.message || e}`)
      }
      step('Attaching reports…')
    }

    if (notes) {
      // Append rather than replace — a job's notes are not ours to clear.
      const existing = String(job.Notes || '').trim()
      const r = await call('PATCH', `/companies/${companyId}/jobs/${job.ID}`, {
        Notes: existing ? `${existing}\n\n${notes}` : notes,
      })
      if (!ok(r)) { console.warn('[ansur] Notes PATCH rejected', r); failed.push(`Notes: ${simproErr(r)}`) }
      else job.Notes = existing ? `${existing}\n\n${notes}` : notes
      step('Updating notes…')
    }

    if (stage) {
      const r = await call('PATCH', `/companies/${companyId}/jobs/${job.ID}`, { Stage: stage })
      if (!ok(r)) { console.warn('[ansur] Stage PATCH rejected', r); failed.push(`Stage: ${simproErr(r)}`) }
      step('Setting stage…')
    }

    if (statusId) {
      // This used to retry as { Status: { ID: n } } when the bare integer was
      // refused, copied from SimproSync. That was wrong twice over: this build
      // answers "/Status: Must be an integer", so the object shape can never
      // succeed — and because the retry's result replaced the first one, its
      // error was all you ever saw, hiding whatever actually went wrong.
      const id = Number(statusId)
      if (!Number.isFinite(id)) {
        failed.push(`Status: "${statusId}" is not a numeric status id`)
      } else {
        const body = { Status: id }
        const r = await call('PATCH', `/companies/${companyId}/jobs/${job.ID}`, body)
        if (!ok(r)) {
          console.warn('[ansur] Status PATCH rejected — sent:', body, 'got:', r)
          failed.push(`Status: ${simproErr(r)}`)
        }
      }
      step('Setting status…')
    }

    const already = skipped.length
      ? ` Already on the job, skipped: ${skipped.join(', ')}.`
      : ''
    // An open job is locked in Simpro, and every edit to it comes back 422.
    const locked = failed.some((f) => / 422\b/.test(f) && !/already|exist|duplicate|unique/i.test(f))
      ? ' If the job is open in Simpro, close it and try again.'
      : ''
    if (failed.length) {
      note(`${total - failed.length} of ${total} done. Failed: ${failed.join('; ')}.${already}${locked}`, 'warn')
    } else {
      const attached = list.length - skipped.length
      note(`Done — ${attached} report${attached === 1 ? '' : 's'} attached to job #${job.ID}.${already}`, 'ok')
      $('sp-notes').value = ''
    }
  } catch (e) {
    note(e.message || String(e), 'warn')
  } finally {
    $('sp-go').disabled = false
  }
}

// ── wire up ───────────────────────────────────────────────────────────────
$('sp-stage').innerHTML = '<option value="">Leave unchanged</option>' +
  STAGES.map((s) => `<option value="${s}">${s}</option>`).join('')

$('sp-company').addEventListener('change', () => {
  companyId = +$('sp-company').value
  try { localStorage.setItem(COMPANY_KEY, String(companyId)) } catch { /* blocked storage */ }
  $('sp-results').innerHTML = ''
  statusCodes = []            // per-company list — don't carry the old one over
  $('sp-status').innerHTML = '<option value="">Leave unchanged</option>'
  note('')
})

$('sp-signin').addEventListener('click', signIn)
// Begin fetching the SDK at the first hint someone is heading for the button,
// so it is in hand by the time they click and the popup can open immediately.
// pointerdown in particular fires before click, which is usually enough on its
// own; the others just widen the head start.
for (const ev of ['pointerenter', 'pointerdown', 'focus', 'touchstart']) {
  $('sp-signin').addEventListener(ev, () => { loadFirebase().catch(() => {}) }, { once: true, passive: true })
}
$('sp-search').addEventListener('click', search)
$('sp-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); search() } })
$('sp-change').addEventListener('click', () => {
  job = null
  $('sp-chosen').hidden = true
  $('sp-find').hidden = false
  refreshAttachCount()
})
$('sp-go').addEventListener('click', run)

// The report list changes as files are added or cleared; the page tells us.
window.addEventListener('ansur:reports', refreshAttachCount)
refreshAttachCount()

// Already signed in from the hub or another tool on this origin? Pick that up
// without making them click.
//
// Peeking at Firebase's own storage rather than just calling
// onAuthStateChanged: that would mean importing the Firebase SDK on every page
// load, including for the many people who only ever convert a file and
// download the PDF. Its presence is a reliable "there is someone to restore"
// signal — and if the shape ever changes, the worst case is the sign-in button
// showing when it didn't need to.
//
// getAuth() in the browser persists to IndexedDB only, never localStorage.
// This used to check localStorage, so it never found anything and everyone
// had to sign in again on every visit.
const SESSION_KEY = `firebase:authUser:${import.meta.env.VITE_FIREBASE_API_KEY}:[DEFAULT]`

async function hasStoredSession() {
  try {
    if (localStorage.getItem(SESSION_KEY)) return true // older SDKs, or a fallback
  } catch { /* blocked storage */ }
  try {
    // Don't create Firebase's database just by looking for it.
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases()
      if (!dbs.some((d) => d.name === 'firebaseLocalStorageDb')) return false
    }
    return await new Promise((resolve) => {
      const req = indexedDB.open('firebaseLocalStorageDb')
      req.onerror = () => resolve(false)
      req.onsuccess = () => {
        const db = req.result
        try {
          const get = db.transaction('firebaseLocalStorage', 'readonly')
            .objectStore('firebaseLocalStorage').get(SESSION_KEY)
          get.onsuccess = () => { db.close(); resolve(!!get.result) }
          get.onerror = () => { db.close(); resolve(false) }
        } catch {
          db.close()
          resolve(false) // store not there yet
        }
      }
    })
  } catch {
    return false // private mode, blocked storage — fall back to the button
  }
}

hasStoredSession().then((stored) => {
  if (!stored) return
  note('Restoring sign-in…')
  loadFirebase()
    .then(({ onAuthStateChanged, auth: a }) => {
      onAuthStateChanged(a, (u) => {
        if (!u || user) { if (!u) note('') ; return }
        user = u
        afterSignIn()
      })
    })
    .catch(() => note(''))
})
