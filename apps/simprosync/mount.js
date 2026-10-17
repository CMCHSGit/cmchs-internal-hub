/* SimproSync's start-up inside the hub's one app (src/section.jsx).

   The section has already checked who may use it (admins, plus anyone given
   Simpro access in Settings → People and access: the same rule the proxy
   applies to every call), so this only starts the tool on its page. app.js,
   which does the work, is unchanged from when SimproSync was a page of its
   own. Simpro calls go through the Apps Script proxy, authenticated with this
   person's Firebase ID token: the Simpro key never reaches the browser.

   A new version of the hub never reloads the page part-way through a run:
   app.js marks the page busy while it works (body.busy), and the shell's
   update reload waits for that (shared/register-sw.js). */
import { auth } from '../schedule/src/firebase.js'
import { startApp } from './app.js'

// Same Apps Script web app the equipment tracker uses (chs-equipment/index.html, SIMPRO_PROXY_URL).
import { PROXY_URL as SIMPRO_PROXY_URL } from '../../shared/proxy.js'

/** Starts SimproSync on its page, which must already be in the document. */
export function mountSimproSync({ user, profile }) {
  // Deleting assets stays admin-only (the proxy refuses DELETE from anyone
  // else), so there's no point showing it to them.
  document.getElementById('delCard').hidden = profile?.role !== 'admin'
  const name = profile?.displayName || user.displayName || user.email
  startApp({ transport: makeTransport(), who: `${name} <${user.email}>` })
}

// Batches concurrent call(method, path, body) requests made in the same tick
// (e.g. pool()'s Promise.all workers) into one POST to the proxy, each
// carrying up to 25 { method, path, body } entries plus one ID token - far
// fewer Apps Script round trips than one request per call.
function makeTransport() {
  let queue = []
  let flushScheduled = false

  function scheduleFlush() {
    if (flushScheduled) return
    flushScheduled = true
    setTimeout(flush, 0)
  }

  async function flush() {
    flushScheduled = false
    const batch = queue.splice(0, 25)
    if (!batch.length) return
    if (queue.length) scheduleFlush()

    // Logged permanently, not just for this one investigation - batch size
    // and round-trip time per proxy call is exactly what a future slowdown
    // report needs first (it's what found the last one: requests weren't
    // batching because nothing called this concurrently - see app.js).
    const t0 = performance.now()
    const tag = '[simproSync] batch of ' + batch.length

    let idToken
    try {
      idToken = await auth.currentUser.getIdToken()
    } catch (e) {
      console.warn(tag, '- could not get ID token', e)
      batch.forEach(b => b.reject(new Error('Could not get a sign-in token: ' + (e.message || e))))
      return
    }

    let res
    try {
      res = await fetch(SIMPRO_PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({
          action: 'simproSync',
          idToken,
          requests: batch.map(b => ({ method: b.method, path: b.path, body: b.body }))
        })
      })
    } catch (e) {
      console.warn(tag, '- network error after', Math.round(performance.now() - t0), 'ms', e)
      batch.forEach(b => b.reject(new Error('Network error reaching the proxy: ' + (e.message || e))))
      return
    }

    let json
    try { json = await res.json() }
    catch (e) {
      console.warn(tag, '- bad response (status ' + res.status + ') after', Math.round(performance.now() - t0), 'ms')
      batch.forEach(b => b.reject(new Error('Bad response from the proxy (' + res.status + ')')))
      return
    }

    if (!json.success) {
      console.warn(tag, '- proxy rejected after', Math.round(performance.now() - t0), 'ms:', json.error)
      const err = new Error(json.error || 'The proxy rejected the request')
      batch.forEach(b => b.reject(err))
      return
    }

    console.log(tag, '- ok in', Math.round(performance.now() - t0), 'ms')
    batch.forEach((b, i) => {
      const r = json.results[i]
      b.resolve(r ? { status: r.status, data: r.data } : { status: 0, data: 'No result from the proxy' })
    })
  }

  return (method, path, body) => new Promise((resolve, reject) => {
    queue.push({ method, path, body, resolve, reject })
    scheduleFlush()
  })
}
