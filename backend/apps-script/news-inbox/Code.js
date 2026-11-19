/**
 * CMCHS Hub — News inbox
 * =====================================================
 * Brings the weekly team update email into the hub without anyone pasting it.
 *
 * The person who writes the email adds one extra address in Bcc: a "+hubnews"
 * address of the Google account this script runs as. Every 10 minutes this
 * script looks in that account's Gmail for new mail delivered to that address,
 * from a sender on the allowed list, and saves its body to the hub's Firestore
 * as `newsInbox/gmail-<message id>` with status 'new'. Manage → News then shows
 * "The team update email arrived" and splits it into drafts with the same code
 * as "Paste an email". A person still ticks, edits and posts: nothing here
 * puts anything on the home page by itself.
 *
 * A SEPARATE Apps Script project from ../proxy (the public web app) on
 * purpose: only this small timer-only script holds the permission to read the
 * mailbox, so no request to the proxy's /exec address ever runs with it.
 *
 * SETUP (once; the full walk-through is backend/README.md "News inbox"):
 *   Script Properties (Project settings → Script properties):
 *     NEWS_INBOX_TO     the +hubnews address mail is Bcc'd to
 *     NEWS_INBOX_FROM   who may send it: addresses, or @domain, comma-separated
 *     FIREBASE_SERVICE_ACCOUNT_KEY   the same JSON key the backup script has
 *     FIREBASE_SCHEDULE_PROJECT_ID   optional; defaults to cmchsstaffschedule
 *   Then run setupNewsInbox() once and approve the permissions, and
 *   checkNewsInbox() to see what it would pick up.
 *
 * Code changes: `npx clasp push --force` from this folder. It is not a web
 * app, so there is no deployment: the next run uses the new code.
 *
 * Logs give counts only, never subjects, senders or addresses.
 */

const SCHEDULE_PROJECT_ID_DEFAULT = 'cmchsstaffschedule';
const IMPORTED_LABEL = 'hub-imported';
const LOOK_BACK_DAYS = 14;
const MAX_PER_RUN = 10;
// Firestore documents are at most 1 MiB; leave room for the other fields.
const MAX_HTML_CHARS = 700000;
const MAX_TEXT_CHARS = 200000;
const MAX_SUBJECT_CHARS = 300;
const JOB_ID = 'news-inbox';

// ── Pure helpers (also checked by apps/hub/tests/news-inbox.test.mjs) ─────

// The Gmail search for mail not yet brought in.
function newsInboxQuery_(to, days) {
  return 'deliveredto:' + String(to).trim() + ' -label:' + IMPORTED_LABEL + ' newer_than:' + days + 'd';
}

function headerOf_(headers, name) {
  const want = name.toLowerCase();
  const h = (headers || []).filter(function(x) { return String(x.name).toLowerCase() === want; })[0];
  return h ? String(h.value) : '';
}

// "Pat Poster <pat@cass.co.nz>" → "pat@cass.co.nz"
function senderAddress_(from) {
  const m = String(from || '').match(/<([^<>\s]+@[^<>\s]+)>/) || String(from || '').match(/([^\s<>"]+@[^\s<>"]+)/);
  return m ? m[1].toLowerCase() : '';
}

// allowed: "pat@cass.co.nz, @chsnz.co.nz" — exact addresses or whole domains.
function senderAllowed_(address, allowed) {
  const a = String(address || '').toLowerCase();
  if (!a || a.indexOf('@') < 1) return false;
  return String(allowed || '').split(/[,;\s]+/).map(function(s) { return s.trim().toLowerCase(); }).filter(Boolean)
    .some(function(rule) { return rule.charAt(0) === '@' ? a.slice(-rule.length) === rule : a === rule; });
}

// Gmail marks mail that claims a sender it wasn't sent by (dmarc=fail). That
// mail is never brought in, even from an allowed address.
function failsDmarc_(authResults) {
  return /\bdmarc=fail\b/i.test(String(authResults || ''));
}

// The first text/html and text/plain parts of a Gmail message payload.
// decode(data) turns a part's base64url body into a string.
function bodiesOf_(payload, decode) {
  const out = { html: '', text: '' };
  (function walk(p) {
    if (!p) return;
    const type = String(p.mimeType || '').toLowerCase();
    const data = p.body && p.body.data;
    const attachment = p.filename || /attachment/i.test(headerOf_(p.headers, 'Content-Disposition'));
    if (data && !attachment) {
      if (type === 'text/html' && !out.html) out.html = decode(data);
      else if (type === 'text/plain' && !out.text) out.text = decode(data);
    }
    (p.parts || []).forEach(walk);
  })(payload);
  return out;
}

// What the hub needs of the HTML: the body, without scripts, styles, Outlook's
// conditional comments or pictures sent inside the email (those are what make
// it too big, and the splitter ignores them anyway).
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

function config_() {
  const p = props_();
  const to = (p.getProperty('NEWS_INBOX_TO') || '').trim();
  const from = (p.getProperty('NEWS_INBOX_FROM') || '').trim();
  if (!to || to.indexOf('@') < 1) throw new Error('Script Property NEWS_INBOX_TO is not set');
  if (!from) throw new Error('Script Property NEWS_INBOX_FROM is not set');
  return { to: to, from: from };
}

// An access token for the service account in FIREBASE_SERVICE_ACCOUNT_KEY
// (the same key as the backup script), cached for 50 minutes.
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

function importedLabelId_() {
  const labels = (Gmail.Users.Labels.list('me').labels || []);
  const found = labels.filter(function(l) { return l.name === IMPORTED_LABEL; })[0];
  if (found) return found.id;
  return Gmail.Users.Labels.create({ name: IMPORTED_LABEL, labelListVisibility: 'labelShow', messageListVisibility: 'show' }, 'me').id;
}

function decodeBody_(data) {
  return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8');
}

// Looks at what's waiting. With dryRun, says what it would do and changes nothing.
function scanInbox_(dryRun) {
  const cfg = config_();
  const list = Gmail.Users.Messages.list('me', { q: newsInboxQuery_(cfg.to, LOOK_BACK_DAYS), maxResults: MAX_PER_RUN });
  const ids = (list.messages || []).map(function(m) { return m.id; });
  const n = { found: ids.length, imported: 0, already: 0, wrongSender: 0, failedCheck: 0, empty: 0 };
  if (!ids.length) return n;
  const labelId = dryRun ? null : importedLabelId_();
  ids.forEach(function(id) {
    const msg = Gmail.Users.Messages.get('me', id, { format: 'full' });
    const headers = (msg.payload && msg.payload.headers) || [];
    let outcome;
    if (!senderAllowed_(senderAddress_(headerOf_(headers, 'From')), cfg.from)) outcome = 'wrongSender';
    else if (failsDmarc_(headerOf_(headers, 'Authentication-Results'))) outcome = 'failedCheck';
    else {
      const bodies = bodiesOf_(msg.payload, decodeBody_);
      if (!bodies.html && !bodies.text) outcome = 'empty';
      else if (dryRun) outcome = 'imported';
      else outcome = createInboxDoc_('gmail-' + id, inboxFields_(headerOf_(headers, 'Subject'), bodies, Number(msg.internalDate))) === 'created' ? 'imported' : 'already';
    }
    n[outcome]++;
    // Labelled whatever happened, so the next run doesn't look at it again.
    // Take the label off in Gmail to have it looked at once more.
    if (!dryRun) Gmail.Users.Messages.modify({ addLabelIds: [labelId] }, 'me', id);
  });
  return n;
}

function summary_(n) {
  return n.found + ' new, ' + n.imported + ' brought in' +
    (n.already ? ', ' + n.already + ' already there' : '') +
    (n.wrongSender ? ', ' + n.wrongSender + ' from a sender not on the list' : '') +
    (n.failedCheck ? ', ' + n.failedCheck + ' failed Gmail’s sender check' : '') +
    (n.empty ? ', ' + n.empty + ' with no body' : '');
}

// The timer runs this.
function importNewsEmails() {
  try {
    const n = scanInbox_(false);
    Logger.log(summary_(n));
    reportJob_(JOB_ID, true, n.imported ? 'Brought in ' + n.imported + ' email' + (n.imported === 1 ? '' : 's') : 'Ran');
  } catch (err) {
    Logger.log('News inbox failed: ' + ((err && err.message) || err));
    reportJob_(JOB_ID, false, (err && err.message) || err);
    throw err;
  }
}

// Run once from the editor: approves the permissions, makes the label and
// starts the 10-minute timer (replacing any earlier one).
function setupNewsInbox() {
  config_();
  firestoreToken_();
  importedLabelId_();
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'importNewsEmails'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('importNewsEmails').timeBased().everyMinutes(10).create();
  Logger.log('Ready: checks for the team update email every 10 minutes.');
}

// Run from the editor any time: what it would bring in now, changing nothing.
function checkNewsInbox() {
  firestoreToken_();
  Logger.log('Firestore key works. Waiting in Gmail: ' + summary_(scanInbox_(true)) + '.');
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
