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
 *   time-driven trigger. It pushes to every Service & Projects team member's
 *   phone as soon as a Demo-type loan enters its notice window — North
 *   Island gets 3 business days, South Island a full business week (5), to
 *   cover the extra inter-island freight time (see
 *   isStartingSoonBusinessDays()). Mirrors the tracker's own
 *   isStartingSoon() so a Monday start notifies Wednesday (North) or the
 *   preceding Monday (South), not mid-weekend. (The matching email and .ics
 *   calendar invite were removed 2026-10-05 along with every other email
 *   this project sent — cassserverroom@gmail.com, the account this script
 *   runs as, was quarantined under company IT security policy, and mobile
 *   push had already fully replaced email as the real notification channel.)
 *
 * STUCK-LOAN REMINDER SETUP (one-off, run manually from the Apps Script editor):
 *   Run the installStuckLoanReminderTrigger() function once to install a
 *   trigger that runs every 4 hours. It pushes the responsible Account
 *   Manager directly whenever their upcoming booking's start date has
 *   arrived but the equipment it needs is still checked out on another
 *   loan — with a link that opens the tracker straight into the Reassign
 *   modal for that booking. This is the AM-driven replacement for the old
 *   same-batch auto-transfer (which used to move equipment automatically,
 *   client-side, with no server component at all). (The matching email was
 *   removed 2026-10-05 — see the note under DEMO REMINDER SETUP above.)
 *
 * RETURN REMINDER SETUP (one-off, run manually from the Apps Script editor):
 *   Run the installReturnReminderTrigger() function once to install a daily
 *   time-driven trigger covering the OTHER end of a loan — its due-back
 *   date. It pushes the responsible Account Manager (and pushes Service &
 *   Projects) once a loan enters the same island-aware notice window as the
 *   outbound demo reminder — South Island gear needs just as much runway to
 *   ship BACK in time. Repeating overdue pushes (fired daily, every 7 days
 *   once past the due date) were removed 2026-09-23. The due-back .ics
 *   calendar invite that briefly replaced it (sent once, at loan creation)
 *   was itself removed 2026-10-05 — see the note under DEMO REMINDER SETUP
 *   above — so a loan's due date now relies solely on this push reminder.
 *
 * PUSH NOTIFICATIONS SETUP (one-off, required before sendPushToPerson_()
 * does anything — see getFcmAccessToken_() below for why a service account
 * is needed instead of the simpler Web Push VAPID approach):
 *   1. Firebase Console → Project settings → Service accounts →
 *      "Generate new private key" — downloads a JSON file. Keep it private.
 *   2. In THIS Apps Script project: Project Settings (gear icon, left
 *      sidebar) → Script Properties → Add script property.
 *        Name:  FCM_SERVICE_ACCOUNT_KEY
 *        Value: the entire contents of that downloaded JSON file, pasted
 *               as-is (one line is fine, Apps Script doesn't care).
 *      Never paste that key into this source file — it's a private
 *      credential and this file lives in a shared git repo.
 *
 * SIMPRO JOB CREATION WIND-DOWN:
 *   New jobs are no longer created by default — see the /simproConfig.json
 *   read in handlePayload()'s create branch below. The tracker's Settings →
 *   Simpro Job Health toggle writes {createJobs, windDownFrom, changedBy,
 *   changedAt} to that path; this proxy reads it live on every create
 *   request rather than trusting a client-side flag, so an already-open tab
 *   or installed PWA running old JS is refused too, not just fresh page
 *   loads. Updating and closing existing jobs are untouched — those are
 *   separate branches above and must keep working until every outstanding
 *   job has been closed out.
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const SIMPRO_BASE_URL = 'https://cass.simprosuite.com/api/v1.0';
const SIMPRO_COMPANY  = 3;
const SIMPRO_SITE_ID  = 2377;
const SIMPRO_CUSTOMER = 2027;
const SIMPRO_COST_CTR = 15;

const SIMPRO_CUSTOM_FIELDS_STATIC = [
  [8, 'Standard'],
  [4, 'Internal']
];
const SIMPRO_JOB_TYPE_FIELD   = 44;
const SIMPRO_JOB_TYPE_DEFAULT = 'Demo';

const FIREBASE_BASE = 'https://chs-equipment-default-rtdb.asia-southeast1.firebasedatabase.app';

// Script Properties (Apps Script → Project Settings → Script Properties),
// not committed constants — this repo is public, and these values previously
// sat in plain text here. SIMPRO_API_KEY is the same key the tracker already
// uses. FIREBASE_SCHEDULE_PROJECT_ID is cmchs-staff-schedule's own Firebase
// project id (Firebase console → Project settings, or the GitHub Actions
// secret VITE_FIREBASE_PROJECT_ID) — a different, unrelated Firebase project
// from this tracker's own RTDB — used only to check SimproSync callers' ID
// tokens were really issued by that project, not to access any of its data.
function simproKey_() {
  const k = PropertiesService.getScriptProperties().getProperty('SIMPRO_API_KEY');
  if (!k) throw new Error('SIMPRO_API_KEY script property is not set');
  return k;
}

function scheduleFirebaseProjectId_() {
  const id = PropertiesService.getScriptProperties().getProperty('FIREBASE_SCHEDULE_PROJECT_ID');
  if (!id) throw new Error('FIREBASE_SCHEDULE_PROJECT_ID script property is not set');
  return id;
}

function apiHeaders_() {
  return {
    'Authorization': 'Bearer ' + simproKey_(),
    'Content-Type':  'application/json',
    'Accept':        'application/json'
  };
}

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
  // Test-notification panel (desktop Settings / mobile More → Test
  // notifications) isn't a Simpro job action at all, so it's dispatched
  // before anything below ever looks at jobId.
  if (payload.action === 'testPush') return sendTestPush_(payload);

  // SimproSync (schedule.chsnz.co.nz/simprosync/) relaying Simpro calls
  // through this proxy instead of holding the Simpro key itself — see
  // simproSyncProxy_() below.
  if (payload.action === 'simproSync') return simproSyncProxy_(payload);

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
    // Job creation is being wound down (see SIMPRO_CFG in index.html — the
    // client gates this too, but a tab or installed PWA that was already
    // open keeps running whatever JS it loaded, for days, without
    // re-fetching, so it can still send a create request long after the
    // client-side gate shipped. This is the backstop for that case.
    //
    // allowCreate is sent only by the tracker's manual "Create Job" button
    // (Settings → Simpro Job Health) — the deliberate exception kept for the
    // wind-down. An older cached client never sends it, so it's refused here
    // even though its own gate is missing.
    const simproCfg = fetchFirebaseJson('/simproConfig.json');
    const createJobsEnabled = !!(simproCfg && simproCfg.createJobs === true);
    if (!createJobsEnabled && payload.allowCreate !== true) {
      Logger.log('Job creation disabled — refused create for pdfKey=' + payload.pdfKey + ' loanTo=' + payload.loanTo);
      // An old client writes a {status:'pending'} placeholder before POSTing
      // and then polls for a real ID; clear it so the loan reads as "no job"
      // rather than stuck pending forever, which would hide it from both the
      // Job # badge and Missing Simpro Jobs.
      if (payload.pdfKey) {
        putFirebaseJson('/loanDocs/' + encodeURIComponent(payload.pdfKey) + '/simproJobId.json', null);
      }
      return respond({ success: false, action: 'creation-disabled' });
    }
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
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw);
  const serviceTeam = ams.filter(function(a) { return a && amEffectiveRole_(a) === 'service'; });

  // NOTE: the notice window now depends on shipping island (see
  // isStartingSoonBusinessDays()), and island lives on the loan's loanDoc,
  // not on the equipment record — so the businessDays check can't happen
  // here any more. Group first by future-dated on-loan equipment only
  // (todayStr < LoanStartDate), then check each group's actual window once
  // its loanDoc (and island) has been fetched below.
  const groups = {};
  items.filter(function(e) {
    return e && e.OnLoanTo && e.Returned !== 'Yes' && e.LoanStartDate && e.LoanStartDate > todayStr;
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
      // Long-term loans are an indefinite equipment hold, not a scheduled
      // demo — this fires on LoanStartDate (unlike the due-back reminder
      // below, which already excludes them simply by their blank
      // LoanEndDate), so it needs its own explicit check. loanDoc is already
      // fetched above for jobType/island, so this is a one-line check with
      // no extra round-trip.
      if (loanDoc.longTerm) {
        Logger.log('Skipping long-term loan for ' + key);
        return;
      }
      if (!isStartingSoonBusinessDays(todayStr, g.startDate, loanDoc.island)) {
        return; // not yet within this loan's notice window
      }
      sendDemoReminderPush(g, loanDoc, serviceTeam);
      putFirebaseJson('/demoReminders/' + encodeURIComponent(key) + '.json', { sentAt: new Date().toISOString() });
      Logger.log('Demo reminder sent for ' + g.loanTo + ' starting ' + g.startDate);
    } catch (err) {
      Logger.log('Demo reminder failed for ' + key + ': ' + err);
    }
  });
}

// Mirrors index.html's SERVICE_TEAM_OPERATORS/amEffectiveRole() so "who
// counts as Service & Projects" is the same list on both sides — a
// person's role is an explicit field on their accountManagers record (set
// via the mobile app's "Manage team roles" sheet), falling back to this
// hardcoded list for anyone who hasn't had a role set yet.
const SERVICE_TEAM_OPERATORS = ['Peter Lin', 'Jonathan Nasrun'];
function amEffectiveRole_(am) {
  return am.role || (SERVICE_TEAM_OPERATORS.includes(am.name) ? 'service' : 'am');
}

// Push notification for a demo loan entering its notice window — to the
// Service & Projects team's phones, since they're the ones actually
// testing/dispatching the gear. (Used to have an emailed .ics calendar
// invite twin too — removed 2026-10-05, see the note at the top of this
// file under DEMO REMINDER SETUP.)
function sendDemoReminderPush(g, loanDoc, serviceTeam) {
  if (!serviceTeam || !serviceTeam.length) return;
  const islandNote = loanDoc.island ? (loanDoc.island === 'North' ? ' (North Island)' : ' (South Island)') : '';
  const title = 'Upcoming demo: ' + g.loanTo;
  const body = 'Starts ' + fmtDate(g.startDate) + islandNote + (loanDoc.location ? ' — ' + loanDoc.location : '') +
    ' — ' + g.items.length + ' item' + (g.items.length !== 1 ? 's' : '');
  serviceTeam.forEach(function(am) {
    try { sendPushToPerson_(am, title, body, TRACKER_URL + '?mobile=1'); }
    catch (err) { Logger.log('Demo reminder push failed for ' + am.name + ': ' + err); }
  });
}

// ── Stuck-loan reminder — periodic check + push to the responsible AM ──────────
// Replaces the same-batch auto-transfer that used to run client-side: rather
// than the system silently moving equipment off a loan that was never
// returned, the AM gets notified and reassigns it themselves via a link
// straight into the app's Reassign modal (see index.html's handleReturnLink,
// ?reassign=<upcomingId>). Run installStuckLoanReminderTrigger() once (from
// the Apps Script editor) to schedule this. Runs every few hours — a stuck
// loan is an active problem, not a heads-up for something days away — but
// only notifies once per AM per booking per day, so re-running the check
// doesn't spam the same day's notifications. (Used to also email — removed
// 2026-10-05, see the note at the top of this file under DEMO REMINDER SETUP.)
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
      // A long-term loan is a known, deliberate state — not something to
      // chase daily. Without this, a booking blocked by long-term gear would
      // otherwise email + push its AM every morning indefinitely (the dedup
      // below is per-day, with no cap on how many days it repeats).
      const blockingLoanDoc = eq.BatchID ? (fetchFirebaseJson('/loanDocs/' + encodeURIComponent(eq.BatchID) + '.json') || {}) : {};
      if (blockingLoanDoc.longTerm) return;
      blocked.push({ assetNo: eq.CHSAssetNo, model: eq.Model || '', blockingLoanTo: eq.OnLoanTo });
    }
  });
  if (!blocked.length) return; // not actually stuck — either free already, long-term, or not found yet

  if (!u.accountManager) { Logger.log('Stuck loan ' + u.id + ' (' + u.loanTo + ') has no AM set — skipping'); return; }
  const am = ams.find(function(a) { return a && a.name === u.accountManager; });
  if (!am) { Logger.log('No account manager record found for ' + u.accountManager + ' — skipping ' + u.id); return; }

  const dedupPath = '/stuckLoanReminders/' + encodeURIComponent(u.id) + '_' + todayStr + '.json';
  if (fetchFirebaseJson(dedupPath)) {
    Logger.log('Stuck-loan reminder already sent today for ' + u.id);
    return;
  }

  sendPushToPerson_(am, 'Action needed: ' + u.loanTo, blocked.length + ' item' + (blocked.length !== 1 ? 's are' : ' is') + ' still on another loan — tap to reassign.', TRACKER_URL + '?reassign=' + encodeURIComponent(u.id));
  putFirebaseJson(dedupPath, { sentAt: new Date().toISOString(), blockedCount: blocked.length });
  Logger.log('Stuck-loan reminder sent to ' + am.email + ' for ' + u.loanTo);
}

// ── Return reminders — due-soon, keyed off a loan's END date ───────────────────
// Reuses the exact same island-aware business-day window as
// sendDemoReminders() (see isStartingSoonBusinessDays()), just applied to
// LoanEndDate instead of LoanStartDate — South Island equipment needs just
// as much runway to ship BACK in time as it does to ship out. Applies to
// every loan (not just Demo jobs — getting gear back matters regardless of
// what it went out for), and fires once per loan/end-date.
//
// This used to also repeat an "overdue" email/push every 7 days once a loan
// passed its due date (replacing index.html's old client-side
// checkOverdueNotifications()) — removed 2026-09-23 in favour of a due-back
// .ics calendar invite every new loan got at creation time instead, which
// put a standing reminder on the AM's own calendar. That invite was itself
// removed 2026-10-05 along with every other email this project sent — see
// the note at the top of this file under DEMO REMINDER SETUP.
function installReturnReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sendReturnReminders') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendReturnReminders')
    .timeBased()
    .everyDays(1)
    .atHour(8)
    .inTimezone('Pacific/Auckland')
    .create();
  Logger.log('Daily return-reminder trigger installed (8am NZ time).');
}

function sendReturnReminders() {
  const todayStr = today();
  const raw = fetchFirebaseJson('/data/equipment.json') || {};
  const items = Array.isArray(raw) ? raw : Object.values(raw);
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw);
  const serviceTeam = ams.filter(function(a) { return a && amEffectiveRole_(a) === 'service'; });

  // Test loans (BatchID prefixed "testbatch_" — see index.html's
  // isTestBatch()) never get real reminders, same as the tracker itself
  // hides them from view outside test mode.
  const groups = {};
  items.filter(function(e) {
    return e && e.OnLoanTo && e.Returned !== 'Yes' && e.LoanEndDate &&
      !(e.BatchID && e.BatchID.indexOf('testbatch_') === 0);
  }).forEach(function(e) {
    const key = e.OnLoanTo + '|||' + e.LoanEndDate;
    if (!groups[key]) groups[key] = { loanTo: e.OnLoanTo, endDate: e.LoanEndDate, batchId: e.BatchID || null, items: [] };
    groups[key].items.push(e);
  });

  Object.keys(groups).forEach(function(key) {
    const g = groups[key];
    try {
      if (g.endDate < todayStr) return; // overdue emails removed — see the comment above installReturnReminderTrigger()
      const loanDoc = g.batchId ? (fetchFirebaseJson('/loanDocs/' + encodeURIComponent(g.batchId) + '.json') || {}) : {};
      // Belt-and-braces — the truthy LoanEndDate filter above already
      // excludes long-term loans (blank by design), but check the flag too
      // in case an end date is ever left on one through a path this didn't
      // anticipate.
      if (loanDoc.longTerm) return;
      const am = loanDoc.accountManager ? ams.find(function(a) { return a && a.name === loanDoc.accountManager; }) : null;
      sendReturnDueSoonReminder_(g, loanDoc, am, serviceTeam, todayStr, key);
    } catch (err) {
      Logger.log('Return reminder failed for ' + key + ': ' + err);
    }
  });
}

function sendReturnDueSoonReminder_(g, loanDoc, am, serviceTeam, todayStr, key) {
  if (!isStartingSoonBusinessDays(todayStr, g.endDate, loanDoc.island)) return; // not in the window yet
  const dedupPath = '/returnDueSoonReminders/' + encodeURIComponent(key) + '.json';
  if (fetchFirebaseJson(dedupPath)) return; // already sent once for this loan/end-date

  const islandNote = loanDoc.island ? (loanDoc.island === 'North' ? ' (North Island)' : ' (South Island)') : '';
  const link = TRACKER_URL + '?return=' + loanReturnToken_(g.loanTo, g.endDate);

  if (am) {
    try { sendPushToPerson_(am, 'Due back soon: ' + g.loanTo, g.items.length + ' item' + (g.items.length !== 1 ? 's' : '') + ' due ' + fmtDate(g.endDate) + islandNote, link); }
    catch (err) { Logger.log('Return-due-soon push failed for ' + am.name + ': ' + err); }
  } else {
    Logger.log('Return-due-soon: no AM record found for ' + g.loanTo + ' — still notifying service team');
  }
  serviceTeam.forEach(function(svcAm) {
    try {
      sendPushToPerson_(svcAm, 'Return due soon: ' + g.loanTo,
        'Due ' + fmtDate(g.endDate) + islandNote + (loanDoc.location ? ' — ' + loanDoc.location : '') + ' — ' + g.items.length + ' item' + (g.items.length !== 1 ? 's' : ''),
        TRACKER_URL + '?mobile=1');
    } catch (err) { Logger.log('Return-due-soon push failed for ' + svcAm.name + ': ' + err); }
  });
  putFirebaseJson(dedupPath, { sentAt: new Date().toISOString() });
  Logger.log('Return-due-soon reminder sent for ' + g.loanTo + ' due ' + g.endDate);
}

// Mirrors index.html's client-side loanReturnToken() (both are plain
// base64 of the same ASCII-safe encodeURIComponent string) so a link
// emailed/pushed from here opens the tracker into the exact same
// return/extend deep link handleReturnLink() already knows how to read.
function loanReturnToken_(loanTo, endDate) {
  return Utilities.base64Encode(encodeURIComponent(loanTo + '|||' + endDate)).replace(/=/g, '');
}

// ── Push notifications (Firebase Cloud Messaging) ───────────────────────
// The sole notification channel for the three reminder types above (demo,
// stuck-loan, return due-soon) since the matching emails were removed
// 2026-10-05 — see the note at the top of this file under DEMO REMINDER
// SETUP. Only reaches a device registered via the mobile app's "Enable push
// notifications" toggle (see index.html's mpEnablePush(), which stores
// tokens under accountManagers[].fcmTokens) — an AM who has never tapped
// that toggle gets nothing from any of these three, with no email fallback
// any more.
//
// Raw Web Push needs VAPID (ES256/ECDSA) JWT signing, which Apps Script
// has no native support for. A Google service-account JWT (RS256/RSA,
// signed with Utilities.computeRsaSha256Signature — a standard, documented
// Apps Script pattern) can authenticate to FCM's HTTP v1 API instead,
// which then handles the actual per-browser push delivery itself. See the
// PUSH NOTIFICATIONS SETUP note at the top of this file for the one-off
// Script Properties setup this depends on.
function getFcmAccessToken_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT_KEY');
  if (!raw) { Logger.log('FCM_SERVICE_ACCOUNT_KEY script property is not set — push notifications are not configured yet.'); return null; }
  let key;
  try { key = JSON.parse(raw); } catch (err) { Logger.log('FCM_SERVICE_ACCOUNT_KEY is not valid JSON: ' + err); return null; }

  const b64url = function(obj) { return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, ''); };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, key.private_key)).replace(/=+$/, '');
  const jwt = unsigned + '.' + signature;

  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt },
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (!json.access_token) { Logger.log('FCM OAuth2 token exchange failed: ' + resp.getContentText()); return null; }
  return { accessToken: json.access_token, projectId: key.project_id };
}

// am.fcmTokens is an array (one person can have more than one device).
// url is delivered via the FCM message's "data" field, not
// webpush.fcm_options.link — the latter is only honoured by Firebase's own
// default background-message handler, which this app doesn't use (sw.js
// has its own push/notificationclick listeners instead), so it would
// silently do nothing here. Returns a per-token result array — every real
// reminder caller ignores it (same as when this returned nothing), but
// sendTestPush_() surfaces it in its response so a test send can show
// exactly which of a person's devices actually accepted the push, without
// needing Cloud Logging wired up to read the alternative (Logger.log).
function sendPushToPerson_(am, title, body, url) {
  if (!am || !Array.isArray(am.fcmTokens) || !am.fcmTokens.length) return [];
  const auth = getFcmAccessToken_();
  if (!auth) return [];
  const deadTokens = [];
  const results = am.fcmTokens.map(function(token) {
    try {
      const resp = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + auth.projectId + '/messages:send', {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + auth.accessToken },
        payload: JSON.stringify({ message: { token: token, notification: { title: title, body: body }, data: { url: url } } }),
        muteHttpExceptions: true
      });
      const ok = resp.getResponseCode() < 300;
      const detail = ok ? null : resp.getContentText();
      if (ok) {
        Logger.log('FCM send OK for token ' + token.slice(0, 12) + '...');
      } else {
        Logger.log('FCM send failed for token ' + token.slice(0, 12) + '...: ' + detail);
        // FCM reports this for a token whose push subscription no longer
        // exists at all (uninstalled, site data cleared, or — the common
        // case here — a token registered under an origin that no longer
        // exists, e.g. the pre-HTTPS http:// tokens). It will never
        // succeed again, so prune it rather than retrying it forever.
        if (detail.indexOf('UNREGISTERED') !== -1 || detail.indexOf('NotRegistered') !== -1) deadTokens.push(token);
      }
      return { token: token.slice(0, 12) + '...', ok: ok, detail: detail };
    } catch (err) {
      Logger.log('FCM send error: ' + err);
      return { token: token.slice(0, 12) + '...', ok: false, detail: String(err) };
    }
  });
  if (deadTokens.length) pruneDeadTokens_(am.name, deadTokens);
  return results;
}

// fcmTokens only ever grows client-side (mpEnablePush() appends, never
// removes — see index.html), so a dead token would otherwise sit there
// forever, retried on every future reminder. Re-fetches accountManagers
// fresh rather than trusting whatever the caller already had in memory
// (which may be minutes stale inside a long-running trigger run), and
// writes back only this person's fcmTokens path so a concurrent edit
// elsewhere in accountManagers.json isn't clobbered.
function pruneDeadTokens_(amName, deadTokens) {
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw);
  const idx = ams.findIndex(function(a) { return a && a.name === amName; });
  if (idx === -1) return;
  const current = Array.isArray(ams[idx].fcmTokens) ? ams[idx].fcmTokens : [];
  const pruned = current.filter(function(t) { return deadTokens.indexOf(t) === -1; });
  if (pruned.length === current.length) return;
  putFirebaseJson('/accountManagers/' + idx + '/fcmTokens.json', pruned);
  Logger.log('Pruned ' + (current.length - pruned.length) + ' dead FCM token(s) for ' + amName);
}

// ── Manual test push ─────────────────────────────────────────────────────
// Desktop Settings' and mobile More's "Test notifications" panel — visible
// only to Service & Projects — calls this (via the same proxy every Simpro
// job request already uses, with action:'testPush' instead of a jobId) so
// someone can confirm delivery/wording/tap-through on a real device without
// waiting for a real trigger to fire or faking loan data. Re-checks that the
// sender is actually Service & Projects against Firebase itself (by
// requesterName — currentOperator/_mp.name on the client, whichever person
// is signed in on that device) rather than trusting the client's own role
// check — the client's check only decides whether to show the panel; this
// is what actually stops anyone who finds this proxy URL from pushing to
// someone else's phone. The client fetches this proxy with mode:'no-cors'
// (same as every other call here), so this response body is never actually
// read — it only shows up in the Executions log.
function sendTestPush_(payload) {
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw);
  const requester = ams.find(function(a) { return a && a.name === payload.requesterName; });
  if (!requester || amEffectiveRole_(requester) !== 'service') {
    Logger.log('sendTestPush_: rejected — requester is not Service & Projects: ' + payload.requesterName);
    return respond({ success: false, error: 'Only Service & Projects can send test notifications.' });
  }
  const am = ams.find(function(a) { return a && a.name === payload.amName; });
  if (!am) return respond({ success: false, error: 'Account manager not found: ' + payload.amName });
  if (!Array.isArray(am.fcmTokens) || !am.fcmTokens.length) {
    return respond({ success: false, error: am.name + ' has no registered device — they need to tap "Enable push notifications" first.' });
  }
  const results = sendPushToPerson_(am, payload.title || 'Test notification', payload.body || '', TRACKER_URL + '?mobile=1');
  Logger.log('Test push sent to ' + am.name + ' (' + am.fcmTokens.length + ' device(s)), requested by ' + requester.name);
  return respond({ success: true, sentTo: am.name, deviceCount: am.fcmTokens.length, results: results });
}

// TEMPORARY TEST HELPER — run manually from the Apps Script editor (select
// this function in the dropdown next to Run, then Run) to verify push
// delivery in isolation, without sendStuckLoanReminders()'s full pipeline:
// no email, no Simpro job, no fake loan data needed — sendPushToPerson_()
// is the only thing this calls. Prerequisite: open the mobile app on your
// phone and tap "Enable push notifications" (More screen) first, so some
// accountManagers record actually has a token for this to find. Check the
// Apps Script execution log (View → Logs, or the Executions panel) for
// the outcome. Safe to delete once push notifications are confirmed working.
function testSendPushOnly() {
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw);
  const am = ams.find(function(a) { return a && Array.isArray(a.fcmTokens) && a.fcmTokens.length; });
  if (!am) {
    Logger.log('No account manager has a registered push token yet. Open the mobile app, sign in, and tap "Enable push notifications" on the More screen first, then run this again.');
    return;
  }
  Logger.log('Sending test push to ' + am.name + ' (' + am.fcmTokens.length + ' registered device(s))...');
  sendPushToPerson_(am, 'Test notification', 'This is a test push from the CHS Equipment Tracker — no email or Simpro job was touched.', TRACKER_URL + '?mobile=1');
}

// Mirrors the tracker's client-side isStartingSoon(): counts weekdays
// between today and startDate (inclusive of startDate) so a Monday start
// enters the notice window on the preceding Wednesday (North Island) or the
// preceding Monday (South Island), not over the weekend. Ported here to
// keep the two in lockstep — see index.html's isStartingSoon().
//
// North Island ships in 3 business days; South Island needs a full business
// week (5 days) for the extra inter-island freight time, so shipping isn't
// caught out. Missing/unrecognized island (a loan created before this field
// existed) defaults to the longer, safer South Island window rather than
// risk under-notifying.
function isStartingSoonBusinessDays(todayStr, startDateStr, island) {
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
  const maxBusinessDays = island === 'North' ? 3 : 5;
  return businessDays <= maxBusinessDays;
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

// ── SimproSync proxy ──────────────────────────────────────────────────────────
// Lets the SimproSync tool (schedule.chsnz.co.nz/simprosync/) relay calls to
// the Simpro API without the browser ever holding the Simpro key. The caller
// sends its own Firebase ID token (from the staff-schedule's Firebase
// project — unrelated to this tracker's RTDB) instead of a shared secret;
// this checks that token really came from that project and that Firestore
// says that user is an admin, then runs an allowlisted batch of requests.
//
// Payload: { action:'simproSync', idToken, requests:[{method, path, body}] }

const FIREBASE_ISSUER_PREFIX = 'https://securetoken.google.com/';

// Only these Simpro method+path shapes may be relayed — this does not widen
// what an authorised SimproSync admin could already do with their own Simpro
// login, it just stops the proxy becoming an open "call anything on Simpro"
// tunnel. Query string, if present, is restricted to pageSize/page/display.
// Default query policy: pageSize/page/display style values only. Deliberately
// narrow — most of these routes need nothing else.
const SIMPRO_QUERY_PLAIN = /^[A-Za-z0-9=&]*$/;
// Job search needs more: "%" for Simpro's wildcard, "+"/"%20" for spaces, and
// ",()" for filters like Stage=in(Complete,Archived). Still no "#", "?", "/" or
// "\", so a query can never restructure the URL the path regex already fixed.
const SIMPRO_QUERY_SEARCH = /^[A-Za-z0-9=&%+,.()\-_: ]*$/;

const SIMPRO_SYNC_ALLOWLIST = [
  [['get'],        /^\/companies\/$/],
  [['get'],        /^\/companies\/\d+\/setup\/assetTypes\/(\d+\/customFields\/(\d+)?)?$/],
  [['get'],        /^\/companies\/\d+\/setup\/statusCodes\/projects\/$/],
  [['get'],        /^\/companies\/\d+\/sites\/$/],
  [['get','post'], /^\/companies\/\d+\/sites\/\d+\/assets\/$/],
  // SimproSync's "Delete assets by type". Admins only — see SIMPRO_SYNC_ADMIN_ONLY.
  [['delete'],     /^\/companies\/\d+\/sites\/\d+\/assets\/\d+$/],
  [['get'],        /^\/companies\/\d+\/sites\/\d+\/assets\/\d+\/customFields\/$/],
  [['patch'],      /^\/companies\/\d+\/sites\/\d+\/assets\/\d+\/customFields\/\d+$/],
  // Job search, for the Ansur report builder's "find the job" box. Read-only,
  // and the looser query policy above applies only here.
  [['get'],        /^\/companies\/\d+\/jobs\/$/, SIMPRO_QUERY_SEARCH],
  [['get','patch'],/^\/companies\/\d+\/jobs\/\d+$/],
  [['get'],        /^\/companies\/\d+\/jobs\/\d+\/sections\/$/],
  [['get'],        /^\/companies\/\d+\/jobs\/\d+\/sections\/\d+\/costCenters\/$/],
  [['get','post'], /^\/companies\/\d+\/jobs\/\d+\/sections\/\d+\/costCenters\/\d+\/assets\/$/],
  // Attach a generated PDF to a job (Ansur PVT reports).
  [['post'],       /^\/companies\/\d+\/jobs\/\d+\/attachments\/files\/$/]
];
// Methods only a role:'admin' user may relay. A simproAccess grant (below)
// covers reading and syncing, never deleting.
const SIMPRO_SYNC_ADMIN_ONLY = ['delete'];
const SIMPRO_SYNC_JOB_PATCH_FIELDS = ['Stage', 'Status', 'Notes'];
const SIMPRO_SYNC_ATTACHMENT_FIELDS = ['Filename', 'Public', 'Base64Data', 'Folder'];
// One attachment per batch, and a ceiling on each. Base64 is ~4/3 of the file,
// so this is roughly a 15 MB PDF — far above a PVT report, far below the point
// where Apps Script's own request limits start failing in confusing ways.
const SIMPRO_SYNC_MAX_BASE64 = 20 * 1024 * 1024;

function simproSyncAllowed_(method, pathWithQuery) {
  const m = String(method || '').toLowerCase();
  const qIdx = String(pathWithQuery || '').indexOf('?');
  const path = qIdx === -1 ? pathWithQuery : pathWithQuery.slice(0, qIdx);
  const query = qIdx === -1 ? '' : pathWithQuery.slice(qIdx + 1);
  return SIMPRO_SYNC_ALLOWLIST.some(function (rule) {
    if (rule[0].indexOf(m) === -1 || !rule[1].test(path)) return false;
    return !query || (rule[2] || SIMPRO_QUERY_PLAIN).test(query);
  });
}

function decodeFirebaseIdToken_(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed ID token');
  const json = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[1])).getDataAsString();
  return JSON.parse(json);
}

// Cheap pre-filter only (aud/iss/exp) — the real signature check happens
// when the Firestore request below is made using this same token: Firestore
// itself rejects an invalid, expired, or wrong-project token.
function verifyScheduleIdTokenShape_(idToken) {
  const claims = decodeFirebaseIdToken_(idToken);
  const projectId = scheduleFirebaseProjectId_();
  if (claims.aud !== projectId) throw new Error('Token is not for the expected Firebase project');
  if (claims.iss !== FIREBASE_ISSUER_PREFIX + projectId) throw new Error('Token issuer mismatch');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('Token expired');
  const uid = claims.user_id || claims.sub;
  if (!uid) throw new Error('Token has no user id');
  return { uid: uid, email: claims.email || '', exp: claims.exp };
}

function simproSyncVerifyAdmin_(idToken) {
  const decoded = verifyScheduleIdTokenShape_(idToken);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'simproSyncAdmin_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken)
  );
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const projectId = scheduleFirebaseProjectId_();
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
    '/databases/(default)/documents/users/' + encodeURIComponent(decoded.uid);
  const resp = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + idToken },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) {
    throw new Error('Could not verify sign-in with Firestore (' + resp.getResponseCode() + ')');
  }
  const doc = JSON.parse(resp.getContentText());
  const fields = doc.fields || {};
  const role = fields.role && fields.role.stringValue;
  // Admins always; anyone else needs simproAccess granted on their user record
  // (set from the hub's people admin). Nobody has that flag until it's granted,
  // so this is admin-only until someone deliberately widens it.
  const granted = fields.simproAccess && fields.simproAccess.booleanValue === true;
  if (role !== 'admin' && !granted) {
    throw new Error((decoded.email || decoded.uid) + ' does not have Simpro access');
  }

  const result = { uid: decoded.uid, email: decoded.email, admin: role === 'admin' };
  const ttlSeconds = Math.max(1, Math.min(600, decoded.exp - Math.floor(Date.now() / 1000)));
  cache.put(cacheKey, JSON.stringify(result), ttlSeconds);
  return result;
}

function simproSyncProxy_(payload) {
  var who;
  try {
    who = simproSyncVerifyAdmin_(payload.idToken);
  } catch (err) {
    Logger.log('simproSync: auth rejected — ' + err);
    return respond({ success: false, error: 'Not authorised: ' + err.message });
  }

  const requests = Array.isArray(payload.requests) ? payload.requests.slice(0, 25) : [];
  if (!requests.length) return respond({ success: false, error: 'No requests' });

  const fetchRequests = [];
  for (var i = 0; i < requests.length; i++) {
    const r = requests[i] || {};
    const method = String(r.method || 'get').toLowerCase();
    const path = String(r.path || '');
    if (!simproSyncAllowed_(method, path)) {
      return respond({ success: false, error: 'Request ' + i + ' (' + method.toUpperCase() + ' ' + path + ') is not allowed' });
    }
    // who.admin is absent on a check cached before this flag existed, which
    // denies — harmless, the cache entry expires within 10 minutes.
    if (SIMPRO_SYNC_ADMIN_ONLY.indexOf(method) !== -1 && who.admin !== true) {
      return respond({ success: false, error: 'Request ' + i + ' (' + method.toUpperCase() + ') needs the admin role' });
    }
    if (method === 'patch' && /^\/companies\/\d+\/jobs\/\d+$/.test(path.split('?')[0])) {
      const keys = Object.keys(r.body || {});
      if (keys.some(function (k) { return SIMPRO_SYNC_JOB_PATCH_FIELDS.indexOf(k) === -1; })) {
        return respond({ success: false, error: 'Request ' + i + ' updates a field that is not allowed' });
      }
    }
    if (/^\/companies\/\d+\/jobs\/\d+\/attachments\/files\/$/.test(path.split('?')[0])) {
      const body = r.body || {};
      if (Object.keys(body).some(function (k) { return SIMPRO_SYNC_ATTACHMENT_FIELDS.indexOf(k) === -1; })) {
        return respond({ success: false, error: 'Request ' + i + ' sets an attachment field that is not allowed' });
      }
      if (!body.Filename || !/^[\w .()\-]{1,120}\.[A-Za-z0-9]{1,8}$/.test(String(body.Filename))) {
        return respond({ success: false, error: 'Request ' + i + ' has an unusable attachment filename' });
      }
      if (String(body.Base64Data || '').length > SIMPRO_SYNC_MAX_BASE64) {
        return respond({ success: false, error: 'Request ' + i + ' attachment is too large' });
      }
      // One at a time: 25 base64 PDFs in a single call would be a very large
      // POST, and a partial failure mid-batch is far harder to report usefully.
      if (requests.length > 1) {
        return respond({ success: false, error: 'Attachments must be sent one request at a time' });
      }
    }
    const opts = { method: method, headers: apiHeaders_(), muteHttpExceptions: true };
    if (r.body !== undefined && method !== 'get') opts.payload = JSON.stringify(r.body);
    fetchRequests.push(Object.assign({ url: SIMPRO_BASE_URL + path }, opts));
  }

  Logger.log('simproSync: ' + (who.email || who.uid) + ' — ' +
    requests.map(function (r) { return String(r.method || 'GET').toUpperCase() + ' ' + r.path; }).join(', '));

  const responses = UrlFetchApp.fetchAll(fetchRequests);
  const results = responses.map(function (resp) {
    const text = resp.getContentText();
    var data = text;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    return { status: resp.getResponseCode(), data: data };
  });
  return respond({ success: true, results: results });
}

// ── Simpro API helper ─────────────────────────────────────────────────────────
function simproFetch(path, method, body) {
  var options = {
    method: method,
    headers: apiHeaders_(),
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