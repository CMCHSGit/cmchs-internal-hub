// The weekly team update email, brought in from Gmail by
// backend/apps-script/news-inbox: `newsInbox/{id}` = { subject, html, text,
// receivedAtMs, status: 'new' | 'used' | 'dismissed', doneAtMs }.
// Manage → News offers each new one; "Make drafts" opens it in Paste an email
// already split, and posting marks it used. Rules: anyone who may post news
// reads them and changes only status/doneAtMs; nobody else.
import { fs } from './news.js'
import { log } from './log.js'

const devMode = import.meta.env?.DEV && !import.meta.env?.VITE_FIREBASE_API_KEY
const local = new Map()
if (devMode) {
  local.set('gmail-dev', {
    subject: 'Next few weeks of places to be', receivedAtMs: Date.now() - 3600e3, status: 'new', text: '',
    html: '<p>Hi All,</p><p><b>The week that’s been</b></p><ul><li>Jack installed the new monitors at Waikato Hospital</li><li>Theresa ran training at Middlemore</li></ul><p><b>Next week</b></p><ul><li>Pat is in Christchurch for the Burwood demo</li></ul><p>Thanks,</p>',
  })
}

/** Emails not yet used or put away, newest first: the shape Manage shows. */
export function waitingEmails(docs) {
  return docs.filter(d => d.status === 'new' && (d.html || d.text)).sort((a, b) => (b.receivedAtMs || 0) - (a.receivedAtMs || 0))
}

/** "Thu 19 Nov, 4:05 pm" in the viewer's time. */
export function arrivedLabel(ms) {
  if (!ms) return ''
  return new Date(ms).toLocaleString('en-NZ', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
}

/** The waiting emails, or [] if they can't be read (rules not published, not allowed). */
export async function loadInbox() {
  if (devMode) return waitingEmails([...local].map(([id, d]) => ({ id, ...d })))
  try {
    const { f, db } = await fs()
    const snap = await f.getDocs(f.query(f.collection(db, 'newsInbox'), f.where('status', '==', 'new')))
    return waitingEmails(snap.docs.map(d => ({ id: d.id, ...d.data() })))
  } catch (e) {
    console.warn('Emailed team updates unavailable:', e.code || e)
    return []
  }
}

/** status: 'used' (drafts posted from it) or 'dismissed' (put away). Throws if refused. */
export async function markEmail(id, status) {
  const patch = { status, doneAtMs: Date.now() }
  if (devMode) { local.set(id, { ...local.get(id), ...patch }); return }
  const { f, db } = await fs()
  await f.updateDoc(f.doc(db, 'newsInbox', id), patch)
  log(status === 'used' ? 'Posted news from the emailed team update' : 'Put away an emailed team update')
}
