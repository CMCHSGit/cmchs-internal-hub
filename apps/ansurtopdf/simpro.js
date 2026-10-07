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

async function afterSignIn() {
  $('sp-signin').hidden = true
  $('sp-who').textContent = user.email || ''
  note('Checking access…')
  try {
    // The first call doubles as the access check — the proxy rejects anyone
    // without admin or simproAccess, with a message worth showing as-is.
    const r = await call('GET', '/companies/')
    if (!ok(r)) throw new Error('Could not read companies from Simpro')
    const companies = Array.isArray(r.data) ? r.data : []
    if (!companies.length) throw new Error('No Simpro companies are visible')
    companyId = companies[0].ID
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

  try {
    // A number is almost always the job number, so try that as an exact fetch
    // first — it's one call and it's what people will type most often.
    if (/^\d+$/.test(q)) {
      const r = await call('GET', `/companies/${companyId}/jobs/${q}`)
      if (ok(r) && r.data) return showResults([r.data])
    }
    // Otherwise search by customer name and by description, and merge. Simpro's
    // wildcard is "%", which has to reach the API percent-encoded.
    const term = encodeURIComponent(q) + '%25'
    const cols = 'columns=ID,Name,Description,Customer,Site,Stage,Status'
    const [byName, byCustomer] = await Promise.all([
      call('GET', `/companies/${companyId}/jobs/?Name=${term}&${cols}&pageSize=20`),
      call('GET', `/companies/${companyId}/jobs/?Customer.CompanyName=${term}&${cols}&pageSize=20`),
    ])
    const seen = new Map()
    for (const r of [byName, byCustomer]) {
      if (!ok(r) || !Array.isArray(r.data)) continue
      for (const j of r.data) seen.set(String(j.ID), j)
    }
    showResults([...seen.values()])
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
  try {
    for (const rep of list) {
      try {
        const r = await call('POST', `/companies/${companyId}/jobs/${job.ID}/attachments/files/`, {
          Filename: rep.name,
          Public: false,
          Base64Data: toBase64(rep.pdf),
        })
        if (!ok(r)) throw new Error(`Simpro returned ${r.status}`)
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
      if (!ok(r)) failed.push(`Notes: Simpro returned ${r.status}`)
      else job.Notes = existing ? `${existing}\n\n${notes}` : notes
      step('Updating notes…')
    }

    if (stage) {
      const r = await call('PATCH', `/companies/${companyId}/jobs/${job.ID}`, { Stage: stage })
      if (!ok(r)) failed.push(`Stage: Simpro returned ${r.status}`)
      step('Setting stage…')
    }

    if (statusId) {
      // Simpro accepts a bare ID on some builds and {ID} on others; SimproSync
      // hit the same thing, so try the second shape before calling it a failure.
      let r = await call('PATCH', `/companies/${companyId}/jobs/${job.ID}`, { Status: +statusId })
      if (!ok(r) && r.status >= 400 && r.status < 500) {
        r = await call('PATCH', `/companies/${companyId}/jobs/${job.ID}`, { Status: { ID: +statusId } })
      }
      if (!ok(r)) failed.push(`Status: Simpro returned ${r.status}`)
      step('Setting status…')
    }

    if (failed.length) {
      note(`${total - failed.length} of ${total} done. Failed: ${failed.join('; ')}`, 'warn')
    } else {
      note(`Done — ${list.length} report${list.length === 1 ? '' : 's'} attached to job #${job.ID}.`, 'ok')
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
// Checking localStorage directly rather than just calling onAuthStateChanged:
// that would mean importing the Firebase SDK on every page load, including for
// the many people who only ever convert a file and download the PDF. This is
// where Firebase persists its session, so its presence is a reliable "there is
// someone to restore" signal — and if the shape ever changes, the worst case is
// the sign-in button showing when it didn't need to.
const hasStoredSession = () => {
  try {
    const key = `firebase:authUser:${import.meta.env.VITE_FIREBASE_API_KEY}:[DEFAULT]`
    return !!localStorage.getItem(key)
  } catch {
    return false // private mode, blocked storage — fall back to the button
  }
}

if (hasStoredSession()) {
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
}
