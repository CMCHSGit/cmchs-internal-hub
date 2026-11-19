/**
 * CMCHS Hub — News inbox
 * =====================================================
 * Brings the weekly team update email into the hub without anyone pasting it.
 *
 * A Power Automate flow in the receiver's own Outlook ("When a new email
 * arrives" from the writer, with the usual subject → Google Drive "Create
 * file") saves each one's body as an .html file in a Google Drive folder of
 * the account this script runs as. Nothing is forwarded, so Exchange's block
 * on automatic forwarding doesn't apply, and no admin is needed.
 *
 * Every 10 minutes this script takes each new .html (or .txt) file in that
 * folder, saves it to the hub's Firestore as `newsInbox/drive-<file id>` with
 * status 'new', and moves the file into the folder's "Imported" subfolder.
 * Manage → News then shows "The team update email arrived" and splits it into
 * drafts with the same code as "Paste an email". A person still ticks, edits
 * and posts: nothing here puts anything on the home page by itself.
 *
 * Who can put a file in the folder is who can send it: keep the folder
 * private to this account (the flow writes as this account).
 *
 * A SEPARATE Apps Script project from ../proxy (the public web app) on
 * purpose: only this small timer-only script reads the folder.
 *
 * SETUP (once; the full walk-through is backend/README.md "News inbox"):
 *   Script Properties (Project settings → Script properties):
 *     NEWS_INBOX_FOLDER_ID  the Drive folder's id (from its address, after /folders/)
 *     FIREBASE_SERVICE_ACCOUNT_KEY   the same JSON key as the proxy's FCM_SERVICE_ACCOUNT_KEY
 *     FIREBASE_SCHEDULE_PROJECT_ID   optional; defaults to cmchsstaffschedule
 *   Then run setupNewsInbox() once and approve the permissions, and
 *   checkNewsInbox() to see what it would pick up.
 *
 * Code changes: `npx clasp push --force` from this folder (or paste Code.js
 * into the editor). It is not a web app, so there is no deployment: the next
 * run uses the new code.
 *
 * Logs give counts only, never subjects or names.
 */

const SCHEDULE_PROJECT_ID_DEFAULT = 'cmchsstaffschedule';
const IMPORTED_FOLDER = 'Imported';
const MAX_PER_RUN = 10;
// Bigger than any real team update; a file over this is skipped, not read.
const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Firestore documents are at most 1 MiB; leave room for the other fields.
const MAX_HTML_CHARS = 700000;
const MAX_TEXT_CHARS = 200000;
const MAX_SUBJECT_CHARS = 300;
const JOB_ID = 'news-inbox';

// ── Pure helpers (also checked by apps/hub/tests/news-inbox.test.mjs) ─────

// 'html', 'text', or null for a file this script doesn't bring in.
function fileKind_(name, mimeType) {
  const n = String(name || '').toLowerCase();
  const t = String(mimeType || '').toLowerCase();
  if (/\.html?$/.test(n) || t === 'text/html') return 'html';
  if (/\.txt$/.test(n) || t === 'text/plain') return 'text';
  return null;
}

// "Next few weeks of places to be.html" → "Next few weeks of places to be"
function subjectFromName_(name) {
  return String(name || '').replace(/\.(html?|txt)$/i, '').replace(/\s+/g, ' ').trim();
}

// What the hub needs of the HTML: the body, without scripts, styles, Outlook's
// conditional comments or pictures (the splitter ignores them anyway).
function cleanEmailHtml_(html) {
  let s = String(html || '');
  const body = s.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (body) s = body[1];
  return s
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|title|xml)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/<o:p>\s*<\/o:p>/gi, '')
    .trim();
}

// The newsInbox document, as Firestore REST fields.
function inboxFields_(subject, bodies, receivedMs) {
  let html = cleanEmailHtml_(bodies.html);
  let text = String(bodies.text || '');
  if (html.length > MAX_HTML_CHARS) html = '';
  if (text.length > MAX_TEXT_CHARS) text = text.slice(0, MAX_TEXT_CHARS);
  return {
    subject: { stringValue: String(subject || '(no subject)').slice(0, MAX_SUBJECT_CHARS) },
    html: { stringValue: html },
    text: { stringValue: text },
    receivedAtMs: { integerValue: String(Math.round(receivedMs) || Date.now()) },
    status: { stringValue: 'new' },
  };
}

// ── Runs ──────────────────────────────────────────────────────────────────

function props_() { return PropertiesService.getScriptProperties(); }

function scheduleProjectId_() {
  return props_().getProperty('FIREBASE_SCHEDULE_PROJECT_ID') || SCHEDULE_PROJECT_ID_DEFAULT;
}

function inboxFolder_() {
  const id = (props_().getProperty('NEWS_INBOX_FOLDER_ID') || '').trim();
  if (!id) throw new Error('Script Property NEWS_INBOX_FOLDER_ID is not set');
  try { return DriveApp.getFolderById(id); } catch (err) { throw new Error('The folder in NEWS_INBOX_FOLDER_ID can’t be opened by this account'); }
}

function importedFolder_(folder) {
  const it = folder.getFoldersByName(IMPORTED_FOLDER);
  return it.hasNext() ? it.next() : folder.createFolder(IMPORTED_FOLDER);
}

// An access token for the service account in FIREBASE_SERVICE_ACCOUNT_KEY,
// cached for 50 minutes.
function firestoreToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('newsInboxToken');
  if (hit) return hit;
  const raw = props_().getProperty('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!raw) throw new Error('Script Property FIREBASE_SERVICE_ACCOUNT_KEY is not set');
  let key;
  try { key = JSON.parse(raw); } catch (err) { throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON'); }
  const b64url = function(obj) { return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, ''); };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, key.private_key)).replace(/=+$/, '');
  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + signature },
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (!json.access_token) throw new Error('Service account token exchange failed (' + resp.getResponseCode() + ')');
  cache.put('newsInboxToken', json.access_token, 50 * 60);
  return json.access_token;
}

function docsUrl_() {
  return 'https://firestore.googleapis.com/v1/projects/' + scheduleProjectId_() + '/databases/(default)/documents/';
}

// Creates newsInbox/<id>. 'created', or 'exists' if an earlier run already
// made it (so a person's "used"/"put away" is never overwritten).
function createInboxDoc_(id, fields) {
  const r = UrlFetchApp.fetch(docsUrl_() + 'newsInbox?documentId=' + encodeURIComponent(id), {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + firestoreToken_() },
    payload: JSON.stringify({ fields: fields })
  });
  const code = r.getResponseCode();
  if (code === 200) return 'created';
  if (code === 409) return 'exists';
  throw new Error('Firestore refused the email (' + code + ')');
}

// Looks at the folder. With dryRun, says what it would do and changes nothing.
function scanFolder_(dryRun) {
  const folder = inboxFolder_();
  const n = { found: 0, imported: 0, already: 0, skipped: 0 };
  const files = [];
  const it = folder.getFiles();
  while (it.hasNext() && files.length < MAX_PER_RUN) files.push(it.next());
  n.found = files.length;
  if (!files.length) return n;
  const done = dryRun ? null : importedFolder_(folder);
  files.forEach(function(file) {
    const kind = fileKind_(file.getName(), file.getMimeType());
    let outcome;
    if (!kind || file.getSize() > MAX_FILE_BYTES) outcome = 'skipped';
    else if (dryRun) outcome = 'imported';
    else {
      const body = file.getBlob().getDataAsString('UTF-8');
      const bodies = kind === 'html' ? { html: body, text: '' } : { html: '', text: body };
      outcome = createInboxDoc_('drive-' + file.getId(), inboxFields_(subjectFromName_(file.getName()), bodies, file.getDateCreated().getTime())) === 'created' ? 'imported' : 'already';
    }
    n[outcome]++;
    // Moved whatever happened, so the next run doesn't look at it again.
    // Move it back out of "Imported" to have it looked at once more.
    if (!dryRun) file.moveTo(done);
  });
  return n;
}

function summary_(n) {
  return n.found + ' new file' + (n.found === 1 ? '' : 's') + ', ' + n.imported + ' brought in' +
    (n.already ? ', ' + n.already + ' already there' : '') +
    (n.skipped ? ', ' + n.skipped + ' skipped (not .html or .txt, or too big)' : '');
}

// The timer runs this.
function importNewsEmails() {
  try {
    const n = scanFolder_(false);
    Logger.log(summary_(n));
    reportJob_(JOB_ID, true, n.imported ? 'Brought in ' + n.imported + ' email' + (n.imported === 1 ? '' : 's') : 'Ran');
  } catch (err) {
    Logger.log('News inbox failed: ' + ((err && err.message) || err));
    reportJob_(JOB_ID, false, (err && err.message) || err);
    throw err;
  }
}

// Run once from the editor: approves the permissions, makes the Imported
// folder and starts the 10-minute timer (replacing any earlier one).
function setupNewsInbox() {
  importedFolder_(inboxFolder_());
  firestoreToken_();
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'importNewsEmails'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importNewsEmails').timeBased().everyMinutes(10).create();
  Logger.log('Ready: checks the folder for the team update email every 10 minutes.');
}

// Run from the editor any time: what it would bring in now, changing nothing.
function checkNewsInbox() {
  firestoreToken_();
  Logger.log('Firestore key works. Waiting in the folder: ' + summary_(scanFolder_(true)) + '.');
  const timers = ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'importNewsEmails'; }).length;
  Logger.log(timers ? 'The 10-minute timer is on.' : 'No timer yet: run setupNewsInbox().');
}

// Settings → Background jobs (shared/jobs.js): one jobRuns document per job.
function reportJob_(id, ok, message) {
  try {
    const url = docsUrl_() + 'jobRuns/' + encodeURIComponent(id);
    const headers = { Authorization: 'Bearer ' + firestoreToken_() };
    const now = String(Date.now());
    const text = String(message || '').slice(0, 300);
    const fields = { id: { stringValue: id }, lastRunMs: { integerValue: now }, lastOk: { booleanValue: !!ok }, lastMessage: { stringValue: text } };
    if (ok) {
      fields.lastSuccessMs = { integerValue: now };
      fields.failuresInARow = { integerValue: '0' };
    } else {
      let streak = 0;
      const r = UrlFetchApp.fetch(url, { headers: headers, muteHttpExceptions: true });
      if (r.getResponseCode() === 200) streak = Number((((JSON.parse(r.getContentText()).fields || {}).failuresInARow) || {}).integerValue || 0);
      fields.lastFailureMs = { integerValue: now };
      fields.lastFailureMessage = { stringValue: text };
      fields.failuresInARow = { integerValue: String(streak + 1) };
    }
    const mask = Object.keys(fields).map(function(k) { return 'updateMask.fieldPaths=' + k; }).join('&');
    UrlFetchApp.fetch(url + '?' + mask, { method: 'patch', contentType: 'application/json', headers: headers, payload: JSON.stringify({ fields: fields }), muteHttpExceptions: true });
  } catch (err) {
    Logger.log('Could not report the job run: ' + err);
  }
}
