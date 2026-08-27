/**
 * CHS Simpro Integration - Google Apps Script Web App
 * =====================================================
 * Receives loan data from the CMCHS tracker (demo.chsnz.co.nz)
 * and creates or updates jobs in Simpro.
 *
 * DEPLOYMENT SETTINGS (critical):
 *   Execute as:    Me  (NOT "User accessing the web app")
 *   Who has access: Anyone  (NOT "Anyone with a Google Account")
 *
 * HOW TO DEPLOY:
 *   1. Paste this code into script.google.com
 *   2. Click Deploy → New deployment → Web app
 *   3. Set the two settings above
 *   4. Click Deploy, authorise when prompted
 *   5. Copy the Web App URL into the tracker's SIMPRO_PROXY_URL constant
 *   6. After any code change: Deploy → Manage deployments → Edit → New version → Deploy
 *
 * DEMO REMINDER SETUP (one-off, run manually from the Apps Script editor):
 *   Run the installDemoReminderTrigger() function once to install a daily
 *   time-driven trigger. It emails an .ics calendar invite (Outlook/Gmail/
 *   Apple Calendar all recognise it) to DEMO_REMINDER_RECIPIENTS as soon as
 *   a Demo-type loan enters its 2-business-day notice window — mirrors the
 *   tracker's own isStartingSoon() so a Monday start notifies Friday, not
 *   mid-weekend.
 *
 * STUCK-LOAN REMINDER SETUP (one-off, run manually from the Apps Script editor):
 *   Run the installStuckLoanReminderTrigger() function once to install a
 *   trigger that runs every 4 hours. It emails the responsible Account
 *   Manager directly whenever their upcoming booking's start date has
 *   arrived but the equipment it needs is still checked out on another
 *   loan — with a link that opens the tracker straight into the Reassign
 *   modal for that booking. This is the AM-driven replacement for the old
 *   same-batch auto-transfer (which used to move equipment automatically,
 *   client-side, with no server component at all).
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const SIMPRO_BASE_URL = 'https://cass.simprosuite.com/api/v1.0';
const SIMPRO_API_KEY  = '6d8d1fb9a7ae1d802e17bf52c50c9f97ab7bd678';
const SIMPRO_COMPANY  = 3;
const SIMPRO_SITE_ID  = 2377;
const SIMPRO_CUSTOMER = 2027;
const SIMPRO_COST_CTR = 15;

const DEMO_REMINDER_RECIPIENTS = ['jonathan@cass.co.nz', 'peter@cass.co.nz'];

const SIMPRO_CUSTOM_FIELDS_STATIC = [
  [8, 'Standard'],
  [4, 'Internal']
];
const SIMPRO_JOB_TYPE_FIELD   = 44;
const SIMPRO_JOB_TYPE_DEFAULT = 'Demo';

const FIREBASE_BASE = 'https://chs-equipment-default-rtdb.asia-southeast1.firebasedatabase.app';

const API_HEADERS = {
  'Authorization': 'Bearer ' + SIMPRO_API_KEY,
  'Content-Type':  'application/json',
  'Accept':        'application/json'
};

// ── POST handler — called by the tracker ──────────────────────────────────────
function doPost(e) {
  try {
    const raw = (e.postData && e.postData.contents) ? e.postData.contents : '';
    if (!raw) {
      Logger.log('doPost: empty body');
      return respond({ success: false, error: 'Empty body' });
    }
    Logger.log('doPost received: ' + raw.substring(0, 200));
    const payload = JSON.parse(raw);
    return handlePayload(payload);
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return respond({ success: false, error: err.toString() });
  }
}

// ── GET handler — for manual browser testing only ─────────────────────────────
function doGet(e) {
  try {
    if (!e || !e.parameter || !e.parameter.data) {
      return respond({ status: 'CHS Simpro Proxy is live' });
    }
    const payload = JSON.parse(e.parameter.data);
    return handlePayload(payload);
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return respond({ success: false, error: err.toString() });
  }
}

// ── Core logic ────────────────────────────────────────────────────────────────
function handlePayload(payload) {
  // jobId may be a pending-placeholder object { status:'pending', ts:... }
  // from the tracker's duplicate guard — treat that the same as no jobId
  const rawId = payload.jobId;
  const jobId = (rawId && typeof rawId === 'object') ? null : (rawId || null);

  Logger.log('handlePayload: jobId=' + jobId + ' pdfKey=' + payload.pdfKey + ' loanTo=' + payload.loanTo);

  if (jobId && payload.close) {
    // ── Close completed loan ─────────────────────────────────────────────────
    closeJob(jobId);
    Logger.log('Job closed: ' + jobId);
    return respond({ success: true, action: 'closed', jobId: jobId });
  } else if (jobId) {
    // ── Update existing job ──────────────────────────────────────────────────
    updateJob(jobId, payload);
    Logger.log('Job updated: ' + jobId);
    return respond({ success: true, action: 'updated', jobId: jobId });
  } else {
    // ── Create new job ───────────────────────────────────────────────────────
    const newId = createJob(payload);
    Logger.log('Job created: ' + newId);
    if (newId && payload.pdfKey) {
      writeJobIdToFirebase(payload.pdfKey, newId);
    }
    return respond({ success: true, action: 'created', jobId: newId });
  }
}

// ── Create a full Simpro job ──────────────────────────────────────────────────
function createJob(data) {
  const description = buildDescription(data);

  // Step 1 — create the job
  const jobResp = simproFetch(
    '/companies/' + SIMPRO_COMPANY + '/jobs/',
    'post',
    {
      Type:        'Service',
      Site:        SIMPRO_SITE_ID,
      Customer:    SIMPRO_CUSTOMER,
      Name:        'Demo Loan - ' + (data.loanTo || 'Unknown'),
      DateIssued:  data.startDate || today(),
      DueDate:     data.endDate || data.startDate || today(),
      Stage:       'Pending',
      Description: description
    }
  );
  if (!jobResp.ok) throw new Error('Job creation failed (' + jobResp.code + '): ' + jobResp.body);
  const jobId = jobResp.json.ID;

  // Step 2 — add a section
  const secResp = simproFetch('/companies/' + SIMPRO_COMPANY + '/jobs/' + jobId + '/sections/', 'post', {});
  if (!secResp.ok) throw new Error('Section creation failed (' + secResp.code + '): ' + secResp.body);
  const sectionId = secResp.json.ID;

  // Step 3 — add cost centre
  simproFetch(
    '/companies/' + SIMPRO_COMPANY + '/jobs/' + jobId + '/sections/' + sectionId + '/costCenters/',
    'post',
    { CostCenter: SIMPRO_COST_CTR }
  );

  // Step 4 — set static custom fields
  SIMPRO_CUSTOM_FIELDS_STATIC.forEach(function(cf) {
    simproFetch(
      '/companies/' + SIMPRO_COMPANY + '/jobs/' + jobId + '/customFields/' + cf[0],
      'patch',
      { Value: cf[1] }
    );
  });

  // Step 5 — set job type field (field 44), default to 'Demo'
  var jobType = (data.jobType && data.jobType.trim()) ? data.jobType.trim() : SIMPRO_JOB_TYPE_DEFAULT;
  simproFetch(
    '/companies/' + SIMPRO_COMPANY + '/jobs/' + jobId + '/customFields/' + SIMPRO_JOB_TYPE_FIELD,
    'patch',
    { Value: jobType }
  );

  return jobId;
}

// ── Close a completed Simpro job ──────────────────────────────────────────────
function closeJob(jobId) {
  const resp = simproFetch(
    '/companies/' + SIMPRO_COMPANY + '/jobs/' + jobId,
    'patch',
    { Stage: 'Complete' }
  );
  Logger.log('Job close (' + jobId + '): ' + resp.code + ' ' + resp.body);
  if (!resp.ok) Logger.log('Job close failed (' + resp.code + '): ' + resp.body);
}

// ── Update an existing Simpro job ─────────────────────────────────────────────
function updateJob(jobId, data) {
  const resp = simproFetch(
    '/companies/' + SIMPRO_COMPANY + '/jobs/' + jobId,
    'patch',
    {
      Name:        'Demo Loan - ' + (data.loanTo || 'Unknown'),
      DueDate:     data.endDate || data.startDate || today(),
      Description: buildDescription(data)
    }
  );
  if (!resp.ok) Logger.log('Job update failed (' + resp.code + '): ' + resp.body);
}

// ── Demo reminder — daily check + .ics calendar invite ─────────────────────────
// Run installDemoReminderTrigger() once (from the Apps Script editor) to schedule this.
function installDemoReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendDemoReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendDemoReminders')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('Pacific/Auckland')
    .create();
  Logger.log('Daily demo reminder trigger installed (8am NZ time).');
}

function sendDemoReminders() {
  const todayStr = today();
  // NOTE: equipment lives under /data/equipment, not /equipment — this was
  // originally querying a path that has never existed, so this function has
  // never actually found any items or sent a single reminder since it was
  // written. Fixed 2026-08-14.
  const raw = fetchFirebaseJson('/data/equipment.json') || {};
  const items = Array.isArray(raw) ? raw : Object.values(raw);

  const groups = {};
  items.filter(function(e) {
    return e && e.OnLoanTo && e.Returned !== 'Yes' && e.LoanStartDate &&
      isStartingSoonBusinessDays(todayStr, e.LoanStartDate);
  }).forEach(function(e) {
    const key = e.OnLoanTo + '|||' + e.LoanStartDate;
    if (!groups[key]) groups[key] = { loanTo: e.OnLoanTo, startDate: e.LoanStartDate, batchId: e.BatchID || null, items: [] };
    groups[key].items.push(e);
  });

  Object.keys(groups).forEach(function(key) {
    const g = groups[key];
    try {
      if (fetchFirebaseJson('/demoReminders/' + encodeURIComponent(key) + '.json')) {
        Logger.log('Demo reminder already sent for ' + key);
        return;
      }
      const loanDoc = g.batchId ? (fetchFirebaseJson('/loanDocs/' + encodeURIComponent(g.batchId) + '.json') || {}) : {};
      const jobType = (loanDoc.jobType && loanDoc.jobType.trim()) ? loanDoc.jobType.trim() : SIMPRO_JOB_TYPE_DEFAULT;
      if (jobType !== 'Demo') {
        Logger.log('Skipping non-demo job for ' + key + ' (' + jobType + ')');
        return;
      }
      sendDemoReminderInvite(g, loanDoc);
      putFirebaseJson('/demoReminders/' + encodeURIComponent(key) + '.json', { sentAt: new Date().toISOString() });
      Logger.log('Demo reminder sent for ' + g.loanTo + ' starting ' + g.startDate);
    } catch (err) {
      Logger.log('Demo reminder failed for ' + key + ': ' + err);
    }
  });
}

function sendDemoReminderInvite(g, loanDoc) {
  const itemLines = g.items.map(function(i) {
    return '- ' + (i.Model || i.Description || i.CHSAssetNo || '');
  });
  const descLines = ['Demo equipment loan starting for ' + g.loanTo];
  if (loanDoc.accountManager) descLines.push('Account Manager: ' + loanDoc.accountManager);
  if (loanDoc.location) descLines.push('Location: ' + loanDoc.location);
  if (itemLines.length) descLines.push('', 'Items:', itemLines.join('\n'));
  const description = descLines.join('\n');

  const uid = 'demo-' + g.loanTo.replace(/[^a-zA-Z0-9]/g, '') + '-' + g.startDate + '@chsnz.co.nz';
  const ics = buildDemoICS({
    uid: uid,
    summary: 'Demo starting: ' + g.loanTo,
    description: description,
    location: loanDoc.location || '',
    dateStr: g.startDate,
    attendees: DEMO_REMINDER_RECIPIENTS,
    organizerEmail: Session.getEffectiveUser().getEmail()
  });
  const icsBlob = Utilities.newBlob(ics, 'text/calendar; charset=UTF-8; method=REQUEST', 'invite.ics');

  MailApp.sendEmail({
    to: DEMO_REMINDER_RECIPIENTS.join(','),
    subject: 'Upcoming Demo: ' + g.loanTo + ' — starts ' + fmtDate(g.startDate),
    body: description,
    attachments: [icsBlob]
  });
}

function buildDemoICS(o) {
  const dt = o.dateStr.replace(/-/g, '');
  const dtEnd = addDaysICS(dt, 1);
  const now = Utilities.formatDate(new Date(), 'Etc/UTC', "yyyyMMdd'T'HHmmss'Z'");
  const attendeeLines = (o.attendees || []).map(function(email) {
    return 'ATTENDEE;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE;CN=' + email + ':mailto:' + email;
  });

  return [
    'BEGIN:VCALENDAR',
    'PRODID:-//CHS Equipment Tracker//Demo Reminders//EN',
    'VERSION:2.0',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:' + o.uid,
    'DTSTAMP:' + now,
    'DTSTART;VALUE=DATE:' + dt,
    'DTEND;VALUE=DATE:' + dtEnd,
    'SUMMARY:' + icsEscape(o.summary),
    'DESCRIPTION:' + icsEscape(o.description),
    o.location ? 'LOCATION:' + icsEscape(o.location) : null,
    'ORGANIZER;CN=CHS Equipment Tracker:mailto:' + o.organizerEmail
  ].concat(attendeeLines).concat([
    'STATUS:CONFIRMED',
    'SEQUENCE:0',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:Demo reminder',
    'TRIGGER:-P2D',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ]).filter(Boolean).join('\r\n');
}

function icsEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

// ── Stuck-loan reminder — periodic check + email to the responsible AM ────────
// Replaces the same-batch auto-transfer that used to run client-side: rather
// than the system silently moving equipment off a loan that was never
// returned, the AM gets emailed and reassigns it themselves via a link
// straight into the app's Reassign modal (see index.html's handleReturnLink,
// ?reassign=<upcomingId>). Run installStuckLoanReminderTrigger() once (from
// the Apps Script editor) to schedule this. Runs every few hours — a stuck
// loan is an active problem, not a heads-up for something days away — but
// only emails once per AM per booking per day, so re-running the check
// doesn't spam the same day's inbox.
const TRACKER_URL = 'https://demo.chsnz.co.nz/';

function installStuckLoanReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendStuckLoanReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendStuckLoanReminders')
    .timeBased()
    .everyHours(4)
    .create();
  Logger.log('Stuck-loan reminder trigger installed (every 4 hours).');
}

function sendStuckLoanReminders() {
  const todayStr = today();
  const upcomingRaw = fetchFirebaseJson('/upcomingLoans.json') || {};
  const upcoming = Object.keys(upcomingRaw).map(function(k) {
    const v = upcomingRaw[k];
    if (v && !v.id) v.id = k;
    return v;
  });
  const equipRaw = fetchFirebaseJson('/data/equipment.json') || [];
  const equipment = Array.isArray(equipRaw) ? equipRaw : Object.values(equipRaw);
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw);

  upcoming.filter(function(u) {
    return u && u.startDate && u.startDate <= todayStr && u.items && u.items.length;
  }).forEach(function(u) {
    try {
      processStuckLoan(u, equipment, ams, todayStr);
    } catch (err) {
      Logger.log('Stuck-loan reminder failed for ' + u.id + ': ' + err);
    }
  });
}

// Mirrors the tracker's client-side isBlocked check in _tryActivateUpcomingLoan().
function processStuckLoan(u, equipment, ams, todayStr) {
  const blocked = [];
  (u.items || []).forEach(function(uItem) {
    const eq = equipment.find(function(e) {
      return e && (e.id === uItem.id || e.CHSAssetNo === uItem.CHSAssetNo);
    });
    if (eq && eq.OnLoanTo && eq.OnLoanTo !== u.loanTo && eq.Returned !== 'Yes') {
      blocked.push({ assetNo: eq.CHSAssetNo, model: eq.Model || '', blockingLoanTo: eq.OnLoanTo });
    }
  });
  if (!blocked.length) return; // not actually stuck — either free already or not found yet

  if (!u.accountManager) { Logger.log('Stuck loan ' + u.id + ' (' + u.loanTo + ') has no AM set — skipping'); return; }
  const am = ams.find(function(a) { return a && a.name === u.accountManager; });
  if (!am || !am.email) { Logger.log('No email on file for AM ' + u.accountManager + ' — skipping ' + u.id); return; }

  const dedupPath = '/stuckLoanReminders/' + encodeURIComponent(u.id) + '_' + todayStr + '.json';
  if (fetchFirebaseJson(dedupPath)) {
    Logger.log('Stuck-loan reminder already sent today for ' + u.id);
    return;
  }

  sendStuckLoanEmail(u, blocked, am);
  putFirebaseJson(dedupPath, { sentAt: new Date().toISOString(), blockedCount: blocked.length });
  Logger.log('Stuck-loan reminder sent to ' + am.email + ' for ' + u.loanTo);
}

function sendStuckLoanEmail(u, blocked, am) {
  const itemLines = blocked.map(function(b) {
    return '- ' + b.assetNo + (b.model ? ' (' + b.model + ')' : '') + ' — still on loan to ' + b.blockingLoanTo;
  });
  const link = TRACKER_URL + '?reassign=' + encodeURIComponent(u.id);
  const body = [
    'Hi ' + (am.name || '') + ',',
    '',
    'Your booking for ' + u.loanTo + ' (started ' + fmtDate(u.startDate) + ') is waiting on equipment that\'s still checked out on another loan:',
    '',
    itemLines.join('\n'),
    '',
    'Tap below to reassign it directly:',
    link,
    '',
    '— CHS Equipment Tracker'
  ].join('\n');

  MailApp.sendEmail({
    to: am.email,
    cc: 'demo@chsnz.co.nz',
    subject: 'Action needed: ' + u.loanTo + ' is waiting on equipment',
    body: body
  });
}

// Mirrors the tracker's client-side isStartingSoon(): counts weekdays
// between today and startDate (inclusive of startDate) so a Monday start
// enters the notice window on the preceding Friday, not over the weekend.
// Ported here to keep the two in lockstep — see index.html's isStartingSoon().
function isStartingSoonBusinessDays(todayStr, startDateStr) {
  if (!startDateStr || startDateStr <= todayStr) return false; // no advance notice for same-day/past starts
  let businessDays = 0;
  let cur = todayStr;
  while (cur < startDateStr) {
    const p = cur.split('-').map(Number);
    const next = new Date(Date.UTC(p[0], p[1] - 1, p[2] + 1));
    cur = Utilities.formatDate(next, 'Etc/UTC', 'yyyy-MM-dd');
    const dow = next.getUTCDay();
    if (dow !== 0 && dow !== 6) businessDays++;
  }
  return businessDays <= 2;
}

function addDaysICS(yyyymmdd, days) {
  const y = +yyyymmdd.slice(0, 4), m = +yyyymmdd.slice(4, 6) - 1, d = +yyyymmdd.slice(6, 8);
  const dt = new Date(Date.UTC(y, m, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return Utilities.formatDate(dt, 'Etc/UTC', 'yyyyMMdd');
}

function fetchFirebaseJson(path) {
  try {
    const resp = UrlFetchApp.fetch(FIREBASE_BASE + path, { muteHttpExceptions: true });
    if (resp.getResponseCode() >= 300) return null;
    return JSON.parse(resp.getContentText());
  } catch (err) {
    Logger.log('fetchFirebaseJson failed for ' + path + ': ' + err);
    return null;
  }
}

function putFirebaseJson(path, obj) {
  UrlFetchApp.fetch(FIREBASE_BASE + path, {
    method: 'put',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(obj),
    muteHttpExceptions: true
  });
}

// ── Write job ID back to Firebase so the tracker can reference it ─────────────
function writeJobIdToFirebase(pdfKey, jobId) {
  try {
    const url = FIREBASE_BASE + '/loanDocs/' + encodeURIComponent(pdfKey) + '/simproJobId.json';
    UrlFetchApp.fetch(url, {
      method: 'put',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(jobId),
      muteHttpExceptions: true
    });
    Logger.log('Firebase write: ' + pdfKey + ' = ' + jobId);
  } catch (err) {
    Logger.log('Firebase write failed: ' + err);
  }
}

// ── Simpro API helper ─────────────────────────────────────────────────────────
function simproFetch(path, method, body) {
  var options = {
    method: method,
    headers: API_HEADERS,
    muteHttpExceptions: true
  };
  if (method !== 'get') options.payload = JSON.stringify(body);
  const resp = UrlFetchApp.fetch(SIMPRO_BASE_URL + path, options);
  const code = resp.getResponseCode();
  const text = resp.getContentText();
  var json = null;
  try { json = JSON.parse(text); } catch(e) {}
  return { ok: code < 300, code: code, body: text, json: json };
}

// ── Build job description HTML ────────────────────────────────────────────────
function buildDescription(data) {
  const rows = (data.items || []).map(function(i) {
    return '<tr><td>' + x(i.CHSAssetNo) + '</td><td>' + x(i.Description || i.Model) + '</td><td>' + x(i.SerialNo || i.PartNo) + '</td></tr>';
  }).join('');

  return '<h3>CMCHS Demo Equipment Loan Form</h3>' +
    '<p>' +
      '<strong>Customer:</strong> ' + x(data.loanTo) + '<br>' +
      '<strong>Address:</strong> ' + x(data.location) + '<br>' +
      '<strong>Loan Date:</strong> ' + fmtDate(data.startDate) + ' &nbsp; <strong>Loan Ends:</strong> ' + fmtDate(data.endDate) + '<br>' +
      '<strong>Account Manager:</strong> ' + x(data.accountManager) +
      (data.contactNumber ? '<br><strong>Contact:</strong> ' + x(data.contactNumber) : '') +
    '</p>' +
    '<table>' +
      '<tr><th>CHS Asset #</th><th>Description</th><th>Serial/Part #</th></tr>' +
      rows +
    '</table>' +
    (data.notes ? '<p><strong>Notes:</strong><br>' + x(data.notes).replace(/\n/g, '<br>') + '</p>' : '') +
    (data.shippingDetails ? '<p><strong>Shipping Details:</strong><br>' + x(data.shippingDetails).replace(/\n/g, '<br>') + '</p>' : '');
}

// ── Response helper ───────────────────────────────────────────────────────────
function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function x(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function fmtDate(d) {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    var p = d.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  }
  return d;
}

function today() {
  return Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM-dd');
}