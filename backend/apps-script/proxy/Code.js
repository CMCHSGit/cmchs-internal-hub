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
 *   this project sent — the Gmail account this script runs as was quarantined under company IT security policy, and mobile
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
    const payload = JSON.parse(raw);
    // The action only: the body carries the sign-in token and loan details.
    Logger.log('doPost: ' + (payload.action || (payload.close ? 'close' : payload.jobId ? 'update' : 'create')));
    return handlePayload(payload);
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return respond({ success: false, error: err.toString() });
  }
}

// ── GET handler — a health check, nothing more ──────────────────────────────
// This used to run any payload passed as ?data=, which made every action the
// POST handler takes — closing or updating a Simpro job — something a plain
// link could do: pasted in a chat, prefetched by a mail scanner, or opened
// by a crawler. Nothing used it (the tracker and the tools all POST), so it
// now only answers whether the proxy is up.
function doGet() {
  return respond({ status: 'CHS Simpro Proxy is live' });
}

// ── Core logic ────────────────────────────────────────────────────────────────
function handlePayload(payload) {
  // Test-notification panel (desktop Settings / mobile More → Test
  // notifications) isn't a Simpro job action at all, so it's dispatched
  // before anything below ever looks at jobId.
  // The demo tracker trades a hub (staff schedule) sign-in for a pass to its
  // own database — see rtdbTokenProxy_.
  if (payload.action === 'rtdbToken') return rtdbTokenProxy_(payload);

  // SimproSync checks its own (stricter) access below. Everything else needs a
  // hub sign-in that has finished signing up — always: every caller (the
  // tracker, Asks, news, Manage, the tools) sends one, and the old tracker
  // that didn't has been retired. (This used to be soft until the Script
  // Property REQUIRE_TRACKER_SIGNIN was set; that setting no longer matters.)
  let caller = null;
  if (payload.action !== 'simproSync') {
    caller = tryVerifyStaff_(payload.idToken);
    if (!caller) {
      Logger.log('Refused a request without a valid sign-in (' + (payload.action || (payload.close ? 'close' : payload.jobId ? 'update' : 'create')) + ').');
      return respond({ success: false, error: 'Sign in to use this.' });
    }
  }

  if (payload.action === 'testPush') return sendTestPush_(payload, caller);

  // The hub's Manage → Tool requests / Feedback: tell the engineering team.
  if (payload.action === 'notifyHubRequest') return notifyHubRequest_(payload);

  // Someone signed in with no team: match them to the entry an admin made for them, if there's one.
  if (payload.action === 'claimPlaceholder') return claimPlaceholder_(caller);

  // Someone signed in to the hub for the first time: tell the admins (Settings → People and access).
  if (payload.action === 'notifyNewUser') return notifyNewUser_(payload, caller);

  // The hub's Asks: tell the people an ask's latest change concerns.
  if (payload.action === 'notifyAsk') return notifyAsk_(payload);

  // The hub's company news: a new post to everyone, a comment to the thread.
  if (payload.action === 'notifyNews') return notifyNews_(payload);

  // SimproSync (schedule.chsnz.co.nz/simprosync/) relaying Simpro calls
  // through this proxy instead of holding the Simpro key itself — see
  // simproSyncProxy_() below.
  if (payload.action === 'simproSync') return simproSyncProxy_(payload);

  // Anything else is the demo tracker's own Simpro job: close, update or create.
  if (payload.action) return respond({ success: false, error: 'Unknown action' });

  // jobId may be a pending-placeholder object { status:'pending', ts:... }
  // from the tracker's duplicate guard — treat that the same as no jobId
  const rawId = payload.jobId;
  const jobId = (rawId && typeof rawId === 'object') ? null : (rawId || null);
  if (jobId !== null && !/^\d{1,10}$/.test(String(jobId))) return respond({ success: false, error: 'Bad job number' });
  // pdfKey names a loan in the tracker's database (a path segment there).
  if (payload.pdfKey != null && !/^[A-Za-z0-9_.:-]{1,200}$/.test(String(payload.pdfKey))) return respond({ success: false, error: 'Bad loan key' });

  Logger.log('handlePayload: ' + (jobId ? (payload.close ? 'close' : 'update') + ' job ' + jobId : 'create'));

  // Closing and updating: any staff member does these as they return or edit
  // a loan, but only on the tracker's own demo jobs, never any other Simpro job.
  if (jobId && !isDemoJob_(jobId)) {
    Logger.log('Refused: job ' + jobId + ' is not a demo loan job.');
    return respond({ success: false, error: 'Job ' + jobId + ' is not a demo loan job' });
  }

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
    //
    // The manual button is in the tracker's Manage, for admins: allowCreate is
    // only honoured from a hub admin, so it can't be used to make jobs at will.
    const simproCfg = fetchFirebaseJson('/simproConfig.json');
    const createJobsEnabled = !!(simproCfg && simproCfg.createJobs === true);
    const manualCreate = payload.allowCreate === true && caller && caller.admin;
    if (!createJobsEnabled && !manualCreate) {
      Logger.log('Job creation disabled — refused create' + (payload.allowCreate === true ? ' (manual, not an admin)' : '') + '.');
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

// Whether a Simpro job is one of the tracker's demo loan jobs: made by
// createJob above (the internal customer, named "Demo Loan - …"). Remembered
// for six hours either way, so a return doesn't cost an extra Simpro call each time.
function isDemoJob_(jobId) {
  const cache = CacheService.getScriptCache();
  const key = 'demojob:' + jobId;
  const hit = cache.get(key);
  if (hit) return hit === '1';
  const resp = simproFetch('/companies/' + SIMPRO_COMPANY + '/jobs/' + jobId, 'get');
  if (!resp.ok) { Logger.log('isDemoJob_: could not read job ' + jobId + ' (' + resp.code + ')'); return false; }
  const job = resp.json || {};
  const ok = /^Demo Loan - /.test(String(job.Name || '')) && Number(job.Customer && job.Customer.ID) === SIMPRO_CUSTOMER;
  cache.put(key, ok ? '1' : '0', 21600);
  return ok;
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
  // here any more. Group first by on-loan equipment starting today or later
  // (todayStr <= LoanStartDate), then check each group's actual window once
  // its loanDoc (and island) has been fetched below — a same-day start skips
  // that window check entirely (see below) rather than being excluded here,
  // since silence isn't the right call for something starting today.
  const groups = {};
  items.filter(function(e) {
    return e && e.OnLoanTo && e.Returned !== 'Yes' && e.LoanStartDate && e.LoanStartDate >= todayStr;
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
      // isStartingSoonBusinessDays() treats "starts today" as past the point
      // of needing advance notice and returns false — right for every other
      // day, wrong for today: a same-day booking still deserves an immediate
      // heads-up instead of silently never being mentioned at all.
      const startsToday = g.startDate === todayStr;
      if (!startsToday && !isStartingSoonBusinessDays(todayStr, g.startDate, loanDoc.island)) {
        return; // not yet within this loan's notice window
      }
      sendDemoReminderPush(g, loanDoc, serviceTeam, startsToday);
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
// file under DEMO REMINDER SETUP.) startsToday says this with more urgency
// ("Starting TODAY" rather than a date that happens to be today, easy to
// read past in a notification) — see the comment above its caller.
function sendDemoReminderPush(g, loanDoc, serviceTeam, startsToday) {
  if (!serviceTeam || !serviceTeam.length) return;
  const islandNote = loanDoc.island ? (loanDoc.island === 'North' ? ' (North Island)' : ' (South Island)') : '';
  const title = (startsToday ? 'Demo starting TODAY: ' : 'Upcoming demo: ') + g.loanTo;
  const body = (startsToday ? 'Starts today' : 'Starts ' + fmtDate(g.startDate)) + islandNote +
    (loanDoc.location ? ' — ' + loanDoc.location : '') + ' — ' + g.items.length + ' item' + (g.items.length !== 1 ? 's' : '');
  serviceTeam.forEach(function(am) {
    // Opens that loan in the tracker (?open=<BatchID>; the list for a loan from before BatchIDs).
    try { sendPushToPerson_(am, title, body, TRACKER_URL + (g.batchId ? '?open=' + encodeURIComponent(g.batchId) : '?mobile=1')); }
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
  // hides them from view outside test mode. OnLoanTo/LoanEndDate get set
  // on the equipment record the moment a booking is created — not when it's
  // actually picked up — so a short Scheduled loan can have its due date
  // fall inside the notice window before it's even started. Found live:
  // a 1-day booking (19–20 Oct) got a "due back soon" push on the 15th,
  // four days before the gear was due to leave the building. Require
  // LoanStartDate to have actually arrived, same as every other check in
  // this file that distinguishes Active from merely Scheduled.
  const groups = {};
  items.filter(function(e) {
    return e && e.OnLoanTo && e.Returned !== 'Yes' && e.LoanEndDate &&
      e.LoanStartDate && e.LoanStartDate <= todayStr &&
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
        TRACKER_URL + (g.batchId ? '?open=' + encodeURIComponent(g.batchId) : '?mobile=1'));
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
// The chs-equipment service account (Script Property FCM_SERVICE_ACCOUNT_KEY,
// downloaded from Firebase console → Project settings → Service accounts).
// Named for push because that is what it was first added for; it now also
// signs this script's database requests.
function serviceAccountKey_() {
  const raw = PropertiesService.getScriptProperties().getProperty('FCM_SERVICE_ACCOUNT_KEY');
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (err) { Logger.log('FCM_SERVICE_ACCOUNT_KEY is not valid JSON: ' + err); return null; }
}

// An OAuth access token for the service account with the given scopes.
function serviceAccountAccessToken_(key, scope) {
  const b64url = function(obj) { return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, ''); };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({
    iss: key.client_email,
    scope: scope,
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
  if (!json.access_token) { Logger.log('Service account token exchange failed (' + scope + '): ' + resp.getContentText()); return null; }
  return json.access_token;
}

function getFcmAccessToken_() {
  const key = serviceAccountKey_();
  if (!key) { Logger.log('FCM_SERVICE_ACCOUNT_KEY script property is not set — push notifications are not configured yet.'); return null; }
  const token = serviceAccountAccessToken_(key, 'https://www.googleapis.com/auth/firebase.messaging');
  return token ? { accessToken: token, projectId: key.project_id } : null;
}

// Database access for this script. The tracker's Realtime Database used to be
// open to anyone; it is being locked so only signed-in staff and these
// back-office jobs can read or write it. This token is the jobs' way in — an
// admin service account, so security rules do not apply to it.
//
// Cached for 50 of its 60 minutes: the reminder triggers make dozens of calls
// per run and should not each sign a JWT.
//
// If the key is missing or the exchange fails this returns null and callers
// carry on unauthenticated. That keeps everything working while the database
// is still open, and fails loudly in the log rather than silently once it is
// locked.
function firebaseDbToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('rtdbAccessToken');
  if (hit) return hit;
  const key = serviceAccountKey_();
  if (!key) { Logger.log('No service account key — database calls are unauthenticated.'); return null; }
  const token = serviceAccountAccessToken_(key,
    'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email');
  if (token) cache.put('rtdbAccessToken', token, 50 * 60);
  return token;
}

// The one place this script talks to the database, so no call can be left
// unsigned.
//
// If the signed request is refused (401/403) it is retried unsigned and the
// refusal logged. While the database is still open that keeps every reminder
// working even if the service account turned out to lack database rights;
// once the database is locked the unsigned retry fails too, which is correct.
// checkDatabaseAuth() below is the way to confirm signing works BEFORE the lock.
function firebaseFetch_(path, opts) {
  opts = Object.assign({ muteHttpExceptions: true }, opts || {});
  const url = FIREBASE_BASE + path;
  const token = firebaseDbToken_();
  if (token) {
    const signed = UrlFetchApp.fetch(url + (url.indexOf('?') === -1 ? '?' : '&') + 'access_token=' + encodeURIComponent(token), opts);
    const code = signed.getResponseCode();
    if (code !== 401 && code !== 403) return signed;
    Logger.log('Database refused the service account token (' + code + ') for ' + path + ' — retrying unsigned.');
    CacheService.getScriptCache().remove('rtdbAccessToken');
  }
  return UrlFetchApp.fetch(url, opts);
}

// Run this from the Apps Script editor before the database is locked. It reads
// one small path signed and unsigned and says whether the lock is safe.
function checkDatabaseAuth() {
  CacheService.getScriptCache().remove('rtdbAccessToken');
  const token = firebaseDbToken_();
  if (!token) { Logger.log('NOT READY — no service account token. Check FCM_SERVICE_ACCOUNT_KEY.'); return; }
  const url = FIREBASE_BASE + '/simproConfig.json';
  const signed = UrlFetchApp.fetch(url + '?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true }).getResponseCode();
  const unsigned = UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getResponseCode();
  Logger.log('Signed read: ' + signed + '   Unsigned read: ' + unsigned);
  Logger.log(signed === 200
    ? (unsigned === 200 ? 'READY — signing works. The database is still open (unsigned 200), so it is safe to lock.'
                        : 'LOCKED and working — signed reads succeed, unsigned are refused.')
    : 'NOT READY — the service account cannot read the database. Do not lock it.');
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
//
// am.notify === false: an admin switched this person off demo reminders on
// the Internal Hub's Admin settings → Notifications, so every reminder skips
// them. Missing means on. `force` is for the test sends only, which an admin
// uses to check someone's phone works whatever their reminders are set to.
function sendPushToPerson_(am, title, body, url, force) {
  if (!am) return [];
  if (am.notify === false && !force) { Logger.log('Push skipped for ' + am.name + ': reminders switched off in Admin'); return []; }
  if (!force && hubDemoOff_(am)) { Logger.log('Push skipped: someone switched their demo reminders off in Settings'); return []; }
  const auth = getFcmAccessToken_();
  if (!auth) return [];

  // Phones turned on at internal.chsnz.co.nz come first: that is where demo
  // reminders now live (see HUB PUSH below). Only if the person has none
  // there, or every one failed, do the phones registered on
  // demo.chsnz.co.nz get it — so nobody misses one during the switch-over,
  // and nobody gets the same reminder twice.
  const hubTokens = hubTokensFor_(am);
  if (hubTokens.length) {
    const hubResults = sendHubPush_(hubTokens, title, body, hubDemoUrl_(url));
    if (hubResults.some(function(r) { return r.ok; })) return hubResults;
    Logger.log('Hub push failed on all ' + hubTokens.length + ' device(s) — falling back to demo.chsnz.co.nz devices.');
  }

  if (!Array.isArray(am.fcmTokens) || !am.fcmTokens.length) return [];
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

// ── HUB PUSH ──────────────────────────────────────────────────────────────
// Demo reminders go to the phones people turned notifications on for at
// internal.chsnz.co.nz (the hub's "Turn on notifications?" prompt, or the
// staff schedule's own card). Those phones are registered with the staff
// schedule's Firebase project, not this one: users/{uid}.fcmTokens in its
// Firestore. So this reads that list and sends through that project.
//
// It uses the same chs-equipment service account as everything else here. That
// works once the account is granted, in the STAFF SCHEDULE's Google Cloud
// project → IAM:
//   - Firebase Cloud Messaging API Admin  (to send)
//   - Cloud Datastore Viewer              (to read users/{uid}.fcmTokens)
// Until then the read fails, hubTokensFor_ returns nothing, and every reminder
// goes to the demo.chsnz.co.nz phones exactly as before. checkHubPush() below
// says whether both roles are in place.
//
// A person is matched to their hub profile the way the hub's Admin matches
// them (apps/admin/src/tracker.js findMember): by email, then by name.

// The demo tracker in the hub. /equipment/ since the switch on 19 Oct 2026; it
// reads the old links (?return=, ?extend=, ?reassign=). Phones still registered
// on demo.chsnz.co.nz get TRACKER_URL links, which that site forwards here.
const HUB_DEMO_URL = 'https://internal.chsnz.co.nz/equipment/';
let hubUsers_ = null; // once per execution: a reminder run sends many pushes

// The same link, on the hub's tracker.
function hubDemoUrl_(url) {
  url = String(url || '');
  return url.indexOf(TRACKER_URL) === 0 ? HUB_DEMO_URL + url.slice(TRACKER_URL.length) : HUB_DEMO_URL;
}

function hubAccessToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('hubAccessToken');
  if (hit) return hit;
  const key = serviceAccountKey_();
  if (!key) return null;
  const token = serviceAccountAccessToken_(key,
    'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging');
  if (token) cache.put('hubAccessToken', token, 50 * 60);
  return token;
}

// Everyone on the hub with at least one phone: [{ email, name, tokens }].
// Throws if the staff schedule's Firestore can't be read.
function loadHubUsers_() {
  const token = hubAccessToken_();
  if (!token) throw new Error('no service account token');
  const base = 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents/users' +
    '?pageSize=300&mask.fieldPaths=email&mask.fieldPaths=displayName&mask.fieldPaths=fcmTokens&mask.fieldPaths=pending&mask.fieldPaths=notifications';
  const users = [];
  let pageToken = '';
  do {
    const resp = UrlFetchApp.fetch(base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) throw new Error('Firestore read refused (' + resp.getResponseCode() + ')');
    const json = JSON.parse(resp.getContentText());
    (json.documents || []).forEach(function(d) {
      const f = d.fields || {};
      if (f.pending && f.pending.booleanValue === true) return;
      const tokens = ((f.fcmTokens && f.fcmTokens.arrayValue && f.fcmTokens.arrayValue.values) || [])
        .map(function(v) { return v.stringValue; }).filter(Boolean);
      if (!tokens.length) return;
      users.push({
        email: ((f.email && f.email.stringValue) || '').trim().toLowerCase(),
        name: ((f.displayName && f.displayName.stringValue) || '').trim().toLowerCase(),
        tokens: tokens,
        // Settings → Your notifications: their own demo reminders switch (step 5D). Missing means on.
        demoOff: !!(f.notifications && f.notifications.mapValue && f.notifications.mapValue.fields && f.notifications.mapValue.fields.demoReminders &&
          f.notifications.mapValue.fields.demoReminders.booleanValue === false)
      });
    });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return users;
}

// This person's hub phones, or [] (none, no match, or hub push not set up yet).
// Whether this person switched their demo reminders off themselves (Settings → Your notifications).
function hubDemoOff_(am) {
  hubTokensFor_(am); // loads hubUsers_ once
  const email = String(am.email || '').trim().toLowerCase(), name = String(am.name || '').trim().toLowerCase();
  const u = (email && hubUsers_.find(function(x) { return x.email === email; })) || (name && hubUsers_.find(function(x) { return x.name === name; }));
  return !!(u && u.demoOff);
}

function hubTokensFor_(am) {
  if (hubUsers_ === null) {
    try { hubUsers_ = loadHubUsers_(); }
    catch (err) { Logger.log('Hub push unavailable, using demo.chsnz.co.nz devices: ' + err.message); hubUsers_ = []; }
  }
  const email = String(am.email || '').trim().toLowerCase();
  const name = String(am.name || '').trim().toLowerCase();
  const u = (email && hubUsers_.find(function(x) { return x.email === email; }))
    || (name && hubUsers_.find(function(x) { return x.name === name; }));
  return u ? u.tokens : [];
}

// Dead hub tokens are left for the staff schedule's own sender to prune: this
// account can only read that project's Firestore, not write it.
// The Firebase SDK shows hub pushes itself (apps/hub/src/sw.js), so the icon
// has to come with the message; without it Android shows a grey letter.
const HUB_PUSH_ICON = 'https://internal.chsnz.co.nz/icons/icon-192.png';

function sendHubPush_(tokens, title, body, url) {
  const accessToken = hubAccessToken_();
  if (!accessToken) return [];
  const endpoint = 'https://fcm.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/messages:send';
  return tokens.map(function(token) {
    try {
      const resp = UrlFetchApp.fetch(endpoint, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + accessToken },
        payload: JSON.stringify({ message: { token: token, notification: { title: title, body: body }, data: { url: url },
          webpush: { notification: { icon: HUB_PUSH_ICON, badge: HUB_PUSH_ICON } } } }),
        muteHttpExceptions: true
      });
      const ok = resp.getResponseCode() < 300;
      const detail = ok ? null : resp.getContentText();
      if (!ok) Logger.log('Hub FCM send failed for token ' + token.slice(0, 12) + '...: ' + detail);
      return { token: token.slice(0, 12) + '...', ok: ok, detail: detail, via: 'hub' };
    } catch (err) {
      Logger.log('Hub FCM send error: ' + err);
      return { token: token.slice(0, 12) + '...', ok: false, detail: String(err), via: 'hub' };
    }
  });
}

// ── Hub tool requests and feedback ───────────────────────────────────────
// internal.chsnz.co.nz → Manage: someone asks for a tool or rates one, and the
// engineering team (the Engineers team, plus admins) gets a push. The browser
// sends only the new request's id. This reads the request back from the
// staff schedule's Firestore and checks the caller made it, in the last ten
// minutes, and that it hasn't been announced already, so nobody can use the
// proxy to push their own text to the team. Logs counts only.
function notifyHubRequest_(payload) {
  const caller = tryVerifyStaff_(payload.idToken);
  if (!caller) return respond({ success: false, error: 'Sign in to use this.' });
  const id = String(payload.id || '');
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return respond({ success: false, error: 'Bad request id' });
  const cache = CacheService.getScriptCache();
  if (cache.get('hubreq:' + id)) return respond({ success: true, already: true });
  const token = hubAccessToken_();
  if (!token) return respond({ success: false, error: 'Hub push is not set up' });

  const base = 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents/';
  const resp = UrlFetchApp.fetch(base + 'hubRequests/' + id, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return respond({ success: false, error: 'Request not found' });
  const f = JSON.parse(resp.getContentText()).fields || {};
  const str = function(k) { return (f[k] && f[k].stringValue) || ''; };
  const created = f.createdAt && f.createdAt.timestampValue ? Date.parse(f.createdAt.timestampValue) : 0;
  if (str('uid') !== caller.uid || !created || Date.now() - created > 10 * 60 * 1000) {
    Logger.log('notifyHubRequest_: refused (not the caller’s, or not new).');
    return respond({ success: false, error: 'Not a new request of yours' });
  }
  cache.put('hubreq:' + id, '1', 21600);

  // The engineering team's phones, minus the requester's own
  const list = UrlFetchApp.fetch(base + 'users?pageSize=300&mask.fieldPaths=team&mask.fieldPaths=role&mask.fieldPaths=fcmTokens&mask.fieldPaths=pending',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (list.getResponseCode() !== 200) return respond({ success: false, error: 'Could not read the team' });
  let tokens = [];
  (JSON.parse(list.getContentText()).documents || []).forEach(function(d) {
    const u = d.fields || {};
    const uid = d.name.split('/').pop();
    if (uid === caller.uid || (u.pending && u.pending.booleanValue)) return;
    const team = u.team && u.team.stringValue;
    const role = u.role && u.role.stringValue;
    if (team !== 'Engineers' && role !== 'admin') return;
    ((u.fcmTokens && u.fcmTokens.arrayValue && u.fcmTokens.arrayValue.values) || []).forEach(function(v) { if (v.stringValue) tokens.push(v.stringValue); });
  });
  tokens = tokens.filter(function(t, i) { return tokens.indexOf(t) === i; });

  const name = String(str('name') || 'Someone').split(/\s+/)[0];
  const kind = str('kind');
  const title = kind === 'tool' ? 'New tool request' : 'New feedback';
  const body = kind === 'tool'
    ? name + ': ' + str('title').slice(0, 120)
    : name + ' rated a tool ' + ((f.rating && (f.rating.integerValue || f.rating.doubleValue)) || '?') + '/5';
  const url = 'https://internal.chsnz.co.nz/#/manage/' + (kind === 'tool' ? 'requests' : 'feedback');
  const results = sendHubPush_(tokens, title, body, url);
  const sent = results.filter(function(r) { return r.ok; }).length;
  Logger.log('notifyHubRequest_: ' + kind + ', push ' + sent + ' sent/' + (results.length - sent) + ' failed.');
  return respond({ success: true, sent: sent });
}

// ── Matching a new sign-in to the entry an admin made for them ──────────
// Settings → People and access (and People → Add employee) make "pending" placeholders for
// staff who haven't signed in yet, with their team. A first sign-in adopts one in the browser
// when the work email matches (apps/schedule/src/profile.js); this is the rest: a Microsoft
// account whose name differs from the entry's ("Jessica Broughan" for "Jess Broughan"). The
// browser can't be trusted to hand itself a team, so it asks here and the proxy, which
// reads both records itself, does the merge: the person's record takes the entry's team,
// excelName and work mobile, the weeks already filled in for the entry move across, and the
// entry is removed, as an email claim does. Only a person with no team yet, and only a
// confident match: the same last name, a first name that is the same, shortens to it
// ("Jess" for "Jessica") or is a common nickname, and exactly one entry like that.
const NICKNAMES_ = { bob: 'robert', rob: 'robert', bill: 'william', will: 'william', jim: 'james', jimmy: 'james', jack: 'john', johnny: 'john', jon: 'jonathan', liz: 'elizabeth', beth: 'elizabeth', kate: 'katherine', katie: 'katherine', cathy: 'catherine', dick: 'richard', rick: 'richard', ricky: 'richard', ted: 'edward', ed: 'edward', meg: 'margaret', maggie: 'margaret', mike: 'michael', matt: 'matthew', chris: 'christopher', dan: 'daniel', ben: 'benjamin', sam: 'samuel', alex: 'alexander', nick: 'nicholas', tom: 'thomas', andy: 'andrew', tony: 'anthony', steve: 'stephen', pete: 'peter', joe: 'joseph', greg: 'gregory', jess: 'jessica', jenny: 'jennifer', becky: 'rebecca', sue: 'susan', vicky: 'victoria' };

function nameParts_(name) {
  return String(name || '').toLowerCase().replace(/['’-]/g, '').replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean);
}

/** Whether two first names can be the same person's: equal, one starting the other (3+ letters), or a nickname. */
function firstNamesAlike_(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) >= 3 && (a.indexOf(b) === 0 || b.indexOf(a) === 0)) return true;
  return NICKNAMES_[a] === b || NICKNAMES_[b] === a || (!!NICKNAMES_[a] && NICKNAMES_[a] === NICKNAMES_[b]);
}

/** The one placeholder that is this person, or null. person: { email, displayName }; placeholders: [{ email, displayName, ... }]. */
function placeholderFor_(person, placeholders) {
  const email = String(person.email || '').trim().toLowerCase();
  if (email) {
    const exact = placeholders.filter(function(x) { return String(x.email || '').trim().toLowerCase() === email; });
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return null;
  }
  const me = nameParts_(person.displayName);
  if (me.length < 2) return null;
  const alike = placeholders.filter(function(x) {
    const them = nameParts_(x.displayName);
    return them.length >= 2 && them[them.length - 1] === me[me.length - 1] && firstNamesAlike_(me[0], them[0]);
  });
  return alike.length === 1 ? alike[0] : null;
}

/** Copies the weeks saved under a placeholder's made-up id to the real uid. Never overwrites a week the person already has. Returns the count. */
function copyPlaceholderSchedules_(placeholderId, uid) {
  const q = UrlFetchApp.fetch(fsBase_() + ':runQuery', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: fsAuth_(),
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'schedules' }],
      where: { fieldFilter: { field: { fieldPath: 'uid' }, op: 'EQUAL', value: { stringValue: placeholderId } } } } })
  });
  if (q.getResponseCode() !== 200) throw new Error('Could not read the entry\'s schedules (' + q.getResponseCode() + ')');
  let copied = 0;
  JSON.parse(q.getContentText()).forEach(function(r) {
    if (!r.document) return;
    const oldId = r.document.name.split('/').pop();
    const fields = JSON.parse(JSON.stringify(r.document.fields || {}));
    fields.uid = { stringValue: uid };
    const put = UrlFetchApp.fetch(fsBase_() + 'schedules/' + encodeURIComponent(oldId.replace(placeholderId, uid)) + '?currentDocument.exists=false', {
      method: 'patch', contentType: 'application/json', muteHttpExceptions: true, headers: fsAuth_(),
      payload: JSON.stringify({ fields: fields })
    });
    if (put.getResponseCode() < 300) copied++;
  });
  return copied;
}

function claimPlaceholder_(caller) {
  const me = fsGetDoc_('users/' + caller.uid);
  if (!me) return respond({ success: true, claimed: false });
  if (me.pending === true || String(me.team || '').trim()) return respond({ success: true, claimed: false });
  const placeholders = fsList_('users', ['displayName', 'email', 'team', 'pending', 'excelName', 'workMobile'])
    .filter(function(u) { return u.pending === true && String(u.team || '').trim(); });
  const hit = placeholderFor_({ email: me.email, displayName: me.displayName }, placeholders);
  if (!hit) return respond({ success: true, claimed: false });

  // Weeks first, the record next, the entry last: stopped part-way, the next sign-in finishes it.
  const weeks = copyPlaceholderSchedules_(hit.__id, caller.uid);
  const patch = { team: hit.team, claimedFrom: hit.__id };
  if (hit.excelName) patch.excelName = hit.excelName;
  if (hit.workMobile && !me.workMobile) patch.workMobile = hit.workMobile;
  fsPatch_('users/' + caller.uid, patch, true);
  UrlFetchApp.fetch(fsBase_() + 'users/' + encodeURIComponent(hit.__id), { method: 'delete', headers: fsAuth_(), muteHttpExceptions: true });
  Logger.log('claimPlaceholder_: matched an entry by name; ' + weeks + ' week(s) moved across.');
  return respond({ success: true, claimed: true, team: hit.team });
}

// ── New sign-ins ─────────────────────────────────────────────────────────
// A person's first sign-in makes their users record (apps/schedule/src/profile.js), and the
// browser then asks here to tell the admins, so someone can give them a team. The browser
// sends only its sign-in. This reads the record back from the staff schedule's Firestore and
// checks it is the caller's and under ten minutes old, and announces each person once, so the
// proxy can't be used to push anything else. The admins are the users whose role is admin (the
// ones Settings → People and access lists), minus the new person. Logs counts only.
function notifyNewUser_(payload, caller) {
  const cache = CacheService.getScriptCache();
  if (cache.get('newuser:' + caller.uid)) return respond({ success: true, already: true });
  const token = hubAccessToken_();
  if (!token) return respond({ success: false, error: 'Hub push is not set up' });

  const base = 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents/';
  const resp = UrlFetchApp.fetch(base + 'users/' + encodeURIComponent(caller.uid), { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return respond({ success: false, error: 'No record yet' });
  const f = JSON.parse(resp.getContentText()).fields || {};
  const str = function(k) { return (f[k] && f[k].stringValue) || ''; };
  const created = f.createdAt && f.createdAt.timestampValue ? Date.parse(f.createdAt.timestampValue) : 0;
  if (!created || Date.now() - created > 10 * 60 * 1000) {
    Logger.log('notifyNewUser_: refused (not new).');
    return respond({ success: false, error: 'Not a new sign-in' });
  }
  cache.put('newuser:' + caller.uid, '1', 21600);

  const list = UrlFetchApp.fetch(base + 'users?pageSize=300&mask.fieldPaths=role&mask.fieldPaths=fcmTokens&mask.fieldPaths=pending',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (list.getResponseCode() !== 200) return respond({ success: false, error: 'Could not read the admins' });
  let tokens = [];
  (JSON.parse(list.getContentText()).documents || []).forEach(function(d) {
    const u = d.fields || {};
    if (d.name.split('/').pop() === caller.uid || (u.pending && u.pending.booleanValue)) return;
    if ((u.role && u.role.stringValue) !== 'admin') return;
    ((u.fcmTokens && u.fcmTokens.arrayValue && u.fcmTokens.arrayValue.values) || []).forEach(function(v) { if (v.stringValue) tokens.push(v.stringValue); });
  });
  tokens = tokens.filter(function(t, i) { return tokens.indexOf(t) === i; });

  const name = String(str('displayName') || str('email') || 'Someone').slice(0, 80);
  const body = name + ' signed in to the hub for the first time' + (str('team') ? ' and joined the ' + str('team') + ' team.' : '. They need a team.');
  const results = sendHubPush_(tokens, 'New person signed in', body, 'https://internal.chsnz.co.nz/settings/people');
  const sent = results.filter(function(r) { return r.ok; }).length;
  Logger.log('notifyNewUser_: push ' + sent + ' sent/' + (results.length - sent) + ' failed, to ' + tokens.length + ' device(s).');
  return respond({ success: true, sent: sent });
}

// ── Hub Asks ─────────────────────────────────────────────────────────────
// internal.chsnz.co.nz/asks/: quick requests between staff. After a change
// that should tell someone (a new ask, picked up, handed back, given to
// someone, waiting, done, reopened, people added, a comment) the browser
// sends only the ask's id. This reads the ask back from the staff schedule's
// Firestore and acts on its `event` only if the caller made it, in the last
// ten minutes, and it hasn't been sent already — so nobody can use the proxy
// to push their own text to anyone. Each person gets a push on their hub
// phones; anyone with no phone set up gets an email instead, once
// RESEND_API_KEY and RESEND_FROM are in Script Properties (the same Resend
// account as the staff schedule's reminders). Logs counts only.
const ASKS_URL = 'https://internal.chsnz.co.nz/asks/';

// A Firestore REST value as a plain value.
function fsPlain_(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsPlain_);
  if ('mapValue' in v) return fsFields_(v.mapValue.fields);
  return null;
}
function fsFields_(fields) {
  const o = {};
  Object.keys(fields || {}).forEach(function(k) { o[k] = fsPlain_(fields[k]); });
  return o;
}

// Who an ask's event is for — never the person who made the change. Pure, so
// it can be checked outside Apps Script (apps/asks/tests/notify.test.mjs).
// users: [{ uid, team, pending }]. People copied in (cc) hear when it's
// raised, when they're copied in later, and when it's done; and @mentions.
function askRecipients_(ask, ev, users, comment) {
  const assignees = ask.assignees || [];
  const cc = ask.cc || [];
  const teams = ask.teams || [];
  const people = ask.people || [];
  const out = {};
  const add = function(uids) { (uids || []).forEach(function(u) { if (u) out[u] = true; }); };
  const membersOf = function(ts) {
    return users.filter(function(u) { return !u.pending && u.team && ts.indexOf(u.team) >= 0; }).map(function(u) { return u.uid; });
  };
  switch (ev.type) {
    case 'created':  add(assignees); add(membersOf(teams)); add(cc); break;
    case 'added':    add((ev.to || []).filter(function(u) { return assignees.indexOf(u) >= 0; }));
                     add(membersOf((ev.teams || []).filter(function(t) { return teams.indexOf(t) >= 0; })));
                     add((ev.cc || []).filter(function(u) { return cc.indexOf(u) >= 0; })); break;
    case 'claimed':  add([ask.createdBy]); add(assignees); break;
    case 'handed':   add([ask.createdBy]); add(assignees); add(membersOf(teams)); break;
    case 'given':    add([ask.owner, ask.createdBy]); break;
    case 'waiting':  add([ask.createdBy]); break;
    case 'done':     add([ask.createdBy]); add(assignees); add(cc); break;
    case 'reopened': if (ask.owner) add([ask.owner]); else { add(assignees); add(membersOf(teams)); } break;
    case 'comment':
      add([ask.createdBy]);
      if (ask.owner) add([ask.owner]); else add(assignees);
      add(((comment && comment.mentions) || []).filter(function(u) { return people.indexOf(u) >= 0; }));
      break;
  }
  delete out[ev.by];
  return Object.keys(out);
}

// What each person is told. Pure, like askRecipients_.
function askMessage_(ask, ev, actor, recipientUid, comment) {
  const who = String(actor || 'Someone').split(/\s+/)[0];
  const what = String(ask.title || '').slice(0, 120);
  const ownerFirst = String(ask.ownerName || 'someone').split(/\s+/)[0];
  // Copied in, not sent it: told it's for their information.
  const copied = (ask.cc || []).indexOf(recipientUid) >= 0 && (ask.assignees || []).indexOf(recipientUid) < 0;
  if (copied && (ev.type === 'created' || ev.type === 'added')) return { title: who + ' copied you in on an ask', body: what };
  switch (ev.type) {
    case 'created':
    case 'added':    return { title: 'New ask from ' + who, body: what };
    case 'claimed':  return { title: who + ' has picked this up', body: what };
    case 'handed':   return { title: 'Back in the pool: nobody has it', body: what };
    case 'given':    return { title: who + ' gave ' + (recipientUid === ask.owner ? 'you' : ownerFirst) + ' an ask', body: what };
    case 'waiting':  return { title: 'Waiting on ' + (ask.waitingOn || 'someone else'), body: what };
    case 'done':     return { title: 'Done: ' + what, body: who + ' finished it' };
    case 'reopened': return { title: who + ' reopened an ask', body: what };
    case 'comment':  return { title: who + ' on “' + what.slice(0, 60) + '”', body: (comment && comment.text ? comment.text : 'Added a photo').slice(0, 160) };
  }
  return { title: 'Asks', body: what };
}

// Everyone in the hub's users list: [{ uid, name, email, team, pending, tokens }].
function loadAskUsers_(token) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents/users' +
    '?pageSize=300&mask.fieldPaths=email&mask.fieldPaths=displayName&mask.fieldPaths=team&mask.fieldPaths=fcmTokens&mask.fieldPaths=pending';
  const users = [];
  let pageToken = '';
  do {
    const resp = UrlFetchApp.fetch(base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Firestore read refused (' + resp.getResponseCode() + ')');
    const json = JSON.parse(resp.getContentText());
    (json.documents || []).forEach(function(d) {
      const f = fsFields_(d.fields);
      users.push({ uid: d.name.split('/').pop(), name: f.displayName || '', email: String(f.email || '').trim(),
        team: f.team || '', pending: f.pending === true, tokens: (f.fcmTokens || []).filter(Boolean) });
    });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return users;
}

function askEmailOn_() {
  const p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('RESEND_API_KEY') && p.getProperty('RESEND_FROM'));
}

function sendAskEmail_(to, msg, url) {
  const p = PropertiesService.getScriptProperties();
  const esc = function(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  const html =
    '<div style="font-family:\'Source Sans 3\',\'Segoe UI\',Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#575756;">' +
    '<div style="height:4px;background:linear-gradient(90deg,#554596 33.3%,#80bd01 33.3% 66.6%,#ef7d00 66.6%);margin-bottom:24px;"></div>' +
    '<h2 style="font-size:20px;margin:0 0 8px;color:#1d1d1d;">' + esc(msg.title) + '</h2>' +
    '<p style="line-height:1.6;margin:0 0 24px;white-space:pre-wrap;">' + esc(msg.body) + '</p>' +
    '<a href="' + esc(url) + '" style="display:inline-block;background:#554596;color:#fff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:16px;font-weight:600;">Open in Asks</a>' +
    '<p style="color:#747577;font-size:13px;margin-top:32px;">You got this by email because notifications aren\'t turned on for Asks on your phone. Open Asks on your phone and tap "Turn on" to get them there instead.</p>' +
    '</div>';
  const resp = UrlFetchApp.fetch('https://api.resend.com/emails', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + p.getProperty('RESEND_API_KEY') },
    payload: JSON.stringify({ from: p.getProperty('RESEND_FROM'), to: [to], subject: msg.title, html: html })
  });
  return resp.getResponseCode() < 300;
}

function notifyAsk_(payload) {
  const caller = tryVerifyStaff_(payload.idToken);
  if (!caller) return respond({ success: false, error: 'Sign in to use this.' });
  const id = String(payload.id || '');
  if (!/^[A-Za-z0-9]{8,40}$/.test(id)) return respond({ success: false, error: 'Bad ask id' });
  const token = hubAccessToken_();
  if (!token) return respond({ success: false, error: 'Hub push is not set up' });

  const base = 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents/';
  const resp = UrlFetchApp.fetch(base + 'asks/' + id, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) return respond({ success: false, error: 'Ask not found' });
  const ask = fsFields_(JSON.parse(resp.getContentText()).fields);
  const ev = ask.event || {};
  if (ev.by !== caller.uid || !ev.atMs || Math.abs(Date.now() - ev.atMs) > 10 * 60 * 1000 || !/^[a-z0-9]{6,24}$/.test(String(ev.id || ''))) {
    Logger.log('notifyAsk_: refused (not the caller’s change, or not new).');
    return respond({ success: false, error: 'Not a new change of yours' });
  }
  const cache = CacheService.getScriptCache();
  const key = 'ask:' + id + ':' + ev.id;
  if (cache.get(key)) return respond({ success: true, already: true });
  cache.put(key, '1', 21600);

  let comment = null;
  if (ev.type === 'comment') {
    const c = UrlFetchApp.fetch(base + 'asks/' + id + '/comments/' + encodeURIComponent(String(ev.ref || '')),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (c.getResponseCode() !== 200) return respond({ success: false, error: 'Comment not found' });
    comment = fsFields_(JSON.parse(c.getContentText()).fields);
    if (comment.uid !== caller.uid) return respond({ success: false, error: 'Not your comment' });
  }

  const out = deliverAsk_(id, ask, ev, comment, token, caller.name);
  if (out.error) return respond({ success: false, error: out.error });
  return respond(out);
}

/**
 * Tells the people an ask's latest event concerns (push, else email) and returns counts only:
 * { success, people, pushed, failed, emailed, unreached } or { error }. Shared by notifyAsk_ (the
 * sender's page, right after saving) and sweepAsks (a timer, for asks that reached the server late).
 */
function deliverAsk_(id, ask, ev, comment, token, fallbackActor) {
  let users;
  try { users = loadAskUsers_(token); }
  catch (err) { Logger.log('deliverAsk_: could not read users: ' + err.message); return { error: 'Could not read the people list' }; }
  const byUid = {};
  users.forEach(function(u) { byUid[u.uid] = u; });
  const actor = (byUid[ev.by] && byUid[ev.by].name) || fallbackActor || '';
  const url = ASKS_URL + '#/mine?ask=' + id;
  const emailOn = askEmailOn_();
  let pushed = 0, failed = 0, emailed = 0, unreached = 0;
  const to = askRecipients_(ask, ev, users, comment);
  to.forEach(function(uid) {
    const u = byUid[uid];
    if (!u || u.pending) return;
    const msg = askMessage_(ask, ev, actor, uid, comment);
    if (u.tokens.length) {
      sendHubPush_(u.tokens, msg.title, msg.body, url).forEach(function(r) { if (r.ok) pushed++; else failed++; });
    } else if (emailOn && u.email) {
      try { if (sendAskEmail_(u.email, msg, url)) emailed++; else unreached++; } catch (err) { unreached++; }
    } else {
      unreached++;
    }
  });
  Logger.log('deliverAsk_: ' + ev.type + ', ' + to.length + ' to tell; push ' + pushed + ' sent/' + failed + ' failed; email ' +
    (emailOn ? emailed + ' sent' : 'off (Resend not set up)') + '; ' + unreached + ' not reached.');
  // Counts only, for the "Notified 2 people on 3 phones" line in Asks.
  return { success: true, people: to.length, pushed: pushed, failed: failed, emailed: emailed, unreached: unreached };
}

// ── Asks that reached the server late ─────────────────────────────────────────────────────────
// An ask written with no connection is kept on the sender's device and sent when it's back, perhaps
// hours later, and then notifyAsk_ refuses it (its event is more than ten minutes old) or the sender's
// page is gone. This timer covers that: every five minutes it looks at asks the SERVER saved since
// its last look (Firestore's own update time, not the sender's clock) and tells people about any
// latest event nobody has been told about yet. An event the sender's page already announced is
// skipped (same cache key as notifyAsk_), and each event is done once (ASK_SWEPT).
// Run installAskSweepTrigger() once from the Apps Script editor.
function installAskSweepTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'sweepAsks') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sweepAsks').timeBased().everyMinutes(5).create();
  Logger.log('Ask sweep trigger installed (every 5 minutes).');
}

function sweepAsks() {
  const token = hubAccessToken_();
  if (!token) { Logger.log('sweepAsks: hub push is not set up'); return; }
  const props = PropertiesService.getScriptProperties();
  const cache = CacheService.getScriptCache();
  const now = Date.now();
  const upTo = now - 2 * 60 * 1000; // the sender's own page has had its go at telling people
  const stored = Number(props.getProperty('ASK_SWEEP_AT') || 0);
  if (!stored) { props.setProperty('ASK_SWEEP_AT', String(upTo)); Logger.log('sweepAsks: first run, watching from now.'); return; }
  const from = Math.max(stored, now - 6 * 60 * 60 * 1000); // the "already told" cache lasts six hours
  const base = 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents';
  const q = UrlFetchApp.fetch(base + ':runQuery', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token },
    // Created or changed (by the sender's clock) in the last week: an ask kept on a device that long is still found.
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'asks' }],
      where: { fieldFilter: { field: { fieldPath: 'updatedAtMs' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(now - 7 * 24 * 60 * 60 * 1000) } } },
      orderBy: [{ field: { fieldPath: 'updatedAtMs' }, direction: 'DESCENDING' }], limit: 300 } })
  });
  if (q.getResponseCode() !== 200) { Logger.log('sweepAsks: could not read asks (' + q.getResponseCode() + ')'); return; }
  let swept = {};
  try { swept = JSON.parse(props.getProperty('ASK_SWEPT') || '{}'); } catch (e) { swept = {}; }
  let told = 0, skipped = 0, failed = 0;
  JSON.parse(q.getContentText()).forEach(function(row) {
    const d = row.document;
    if (!d) return;
    const saved = Date.parse(d.updateTime);
    if (!(saved > from && saved <= upTo)) return;
    const ask = fsFields_(d.fields);
    const ev = ask.event || {};
    if (!ev.by || !/^[a-z0-9]{6,24}$/.test(String(ev.id || ''))) return;
    const id = d.name.split('/').pop();
    const key = 'ask:' + id + ':' + ev.id;
    if (swept[key] || cache.get(key)) { skipped++; swept[key] = 1; return; }
    let comment = null;
    if (ev.type === 'comment') {
      const c = UrlFetchApp.fetch(base + '/asks/' + id + '/comments/' + encodeURIComponent(String(ev.ref || '')),
        { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      if (c.getResponseCode() !== 200) { failed++; return; }
      comment = fsFields_(JSON.parse(c.getContentText()).fields);
      if (comment.uid !== ev.by) { swept[key] = 1; return; }
    }
    const out = deliverAsk_(id, ask, ev, comment, token, '');
    if (out.error) { failed++; return; }
    cache.put(key, '1', 21600);
    swept[key] = 1;
    told++;
  });
  const keys = Object.keys(swept);
  if (keys.length > 150) keys.slice(0, keys.length - 150).forEach(function(k) { delete swept[k]; });
  props.setProperty('ASK_SWEPT', JSON.stringify(swept));
  if (!failed) props.setProperty('ASK_SWEEP_AT', String(upTo)); // a failure is looked at again next time
  Logger.log('sweepAsks: ' + told + ' told, ' + skipped + ' already told, ' + failed + ' failed.');
}

// ── Hub company news ─────────────────────────────────────────────────────
// internal.chsnz.co.nz: a new post ticked "Notify everyone" goes to every
// phone on the hub (a pasted team email as one "Team update" push for the
// lot); a comment goes to the post's author and everyone else who has
// commented. The browser sends only ids. This reads the post (and comment)
// back from the staff schedule's Firestore and acts only if the caller wrote
// it, in the last ten minutes, and it hasn't been sent already — so nobody
// can use the proxy to push their own text to anyone. Logs counts only.
const HUB_URL = 'https://internal.chsnz.co.nz/';

// Who hears about a comment: the post's author and earlier commenters, never
// the commenter. Pure (tested in apps/hub/tests/social.test.mjs).
function newsCommentRecipients_(post, commenterUids, byUid) {
  const out = {};
  if (post.authorUid) out[post.authorUid] = true;
  (commenterUids || []).forEach(function(u) { if (u) out[u] = true; });
  delete out[byUid];
  return Object.keys(out);
}

// What the push says. Pure, like newsCommentRecipients_.
function newsMessage_(kind, post, actor, extra) {
  const who = String(actor || 'Someone').split(/\s+/)[0];
  const title = String(post.title || '').slice(0, 100);
  if (kind === 'comment') {
    return { title: who + ' commented on “' + title.slice(0, 60) + '”', body: String((extra && extra.text) || '').slice(0, 160) };
  }
  if (kind === 'batch') {
    const n = (extra && extra.count) || 1;
    return { title: 'Team update from ' + who, body: n + ' new item' + (n === 1 ? '' : 's') + ': ' + title + (n > 1 ? ' and more' : '') };
  }
  const icon = { Announcements: '📣 ', Events: '📅 ', 'Tool updates': '🛠️ ', 'Team news': '🗺️ ' }[post.category] || '📣 ';
  const body = String(post.body || '').replace(/\s+/g, ' ').trim();
  return { title: icon + title, body: who + (body ? ': ' + body.slice(0, 140) : ' posted in ' + (post.category || 'Announcements')) };
}

function notifyNews_(payload) {
  const caller = tryVerifyStaff_(payload.idToken);
  if (!caller) return respond({ success: false, error: 'Sign in to use this.' });
  const id = String(payload.id || '');
  const cid = payload.cid ? String(payload.cid) : '';
  if (!/^[A-Za-z0-9_-]{6,60}$/.test(id) || (cid && !/^[A-Za-z0-9]{10,40}$/.test(cid))) return respond({ success: false, error: 'Bad post id' });
  const token = hubAccessToken_();
  if (!token) return respond({ success: false, error: 'Hub push is not set up' });
  const get = function(path) {
    const r = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents/' + path,
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    return r.getResponseCode() === 200 ? JSON.parse(r.getContentText()) : null;
  };
  const doc = get('announcements/' + id);
  if (!doc) return respond({ success: false, error: 'Post not found' });
  const post = fsFields_(doc.fields);
  const tenMin = 10 * 60 * 1000;
  const cache = CacheService.getScriptCache();

  let users;
  try { users = loadAskUsers_(token); }
  catch (err) { Logger.log('notifyNews_: could not read users: ' + err.message); return respond({ success: false, error: 'Could not read the people list' }); }
  const byUid = {};
  users.forEach(function(u) { byUid[u.uid] = u; });
  const actor = (byUid[caller.uid] && byUid[caller.uid].name) || caller.name;

  let to, msg, url, kind;
  if (cid) {
    const c = get('announcements/' + id + '/comments/' + cid);
    const comment = c ? fsFields_(c.fields) : null;
    if (!comment || comment.uid !== caller.uid || !comment.atMs || Math.abs(Date.now() - comment.atMs) > tenMin) {
      Logger.log('notifyNews_: refused comment (not the caller’s, or not new).');
      return respond({ success: false, error: 'Not a new comment of yours' });
    }
    if (cache.get('newsc:' + cid)) return respond({ success: true, already: true });
    cache.put('newsc:' + cid, '1', 21600);
    const list = get('announcements/' + id + '/comments?pageSize=300&mask.fieldPaths=uid');
    const commenters = ((list && list.documents) || []).map(function(d) { return fsFields_(d.fields).uid; });
    kind = 'comment';
    to = newsCommentRecipients_(post, commenters, caller.uid);
    msg = newsMessage_('comment', post, actor, comment);
    url = HUB_URL + '#/news/' + encodeURIComponent(id) + '?c=1';
  } else {
    const created = post.createdAt || 0;
    if (post.authorUid !== caller.uid || post.notifyTeam !== true || !created || Date.now() - created > tenMin) {
      Logger.log('notifyNews_: refused post (not the caller’s, not ticked to notify, or not new).');
      return respond({ success: false, error: 'Not a new post of yours to notify' });
    }
    const batchId = /^email-/.test(String(post.batchId || '')) ? String(post.batchId) : '';
    const key = batchId ? 'newsb:' + batchId : 'newsp:' + id;
    if (cache.get(key)) return respond({ success: true, already: true });
    cache.put(key, '1', 21600);
    let count = 1;
    if (batchId) {
      const q = UrlFetchApp.fetch('https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents:runQuery', {
        method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token },
        payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'announcements' }],
          where: { fieldFilter: { field: { fieldPath: 'batchId' }, op: 'EQUAL', value: { stringValue: batchId } } },
          select: { fields: [{ fieldPath: 'batchId' }] } } })
      });
      if (q.getResponseCode() === 200) count = JSON.parse(q.getContentText()).filter(function(r) { return r.document; }).length || 1;
    }
    kind = batchId ? 'batch' : 'post';
    to = users.filter(function(u) { return !u.pending && u.uid !== caller.uid; }).map(function(u) { return u.uid; });
    msg = newsMessage_(kind, post, actor, { count: count });
    url = batchId ? HUB_URL : HUB_URL + '#/news/' + encodeURIComponent(id);
  }

  let pushed = 0, failed = 0, phones = 0;
  to.forEach(function(uid) {
    const u = byUid[uid];
    if (!u || u.pending || !u.tokens.length) return;
    phones++;
    sendHubPush_(u.tokens, msg.title, msg.body, url).forEach(function(r) { if (r.ok) pushed++; else failed++; });
  });
  Logger.log('notifyNews_: ' + kind + ', ' + to.length + ' to tell, ' + phones + ' with phones; push ' + pushed + ' sent/' + failed + ' failed.');
  return respond({ success: true, people: to.length, pushed: pushed, failed: failed });
}

// Run from the editor after the IAM roles are granted. Sends nothing to
// anyone: it reads the hub's phone list and asks FCM to validate (not send) a
// message, then says whether demo reminders will go to hub phones.
function checkHubPush() {
  CacheService.getScriptCache().remove('hubAccessToken');
  let users;
  try { users = loadHubUsers_(); }
  catch (err) {
    Logger.log('NOT READY — cannot read the staff schedule\'s users (' + err.message + '). Grant the service account "Cloud Datastore Viewer" in that project\'s IAM.');
    return;
  }
  hubUsers_ = users;
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = (Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw)).filter(Boolean);
  const matched = ams.filter(function(a) { return hubTokensFor_(a).length; }).length;
  const resp = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/messages:send', {
    method: 'post', contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + hubAccessToken_() },
    payload: JSON.stringify({ validate_only: true, message: { token: 'check-hub-push', notification: { title: 'check' } } }),
    muteHttpExceptions: true
  });
  const code = resp.getResponseCode();
  if (code === 401 || code === 403) {
    Logger.log('NOT READY — reading works, but sending is refused (' + code + '). Grant the service account "Firebase Cloud Messaging API Admin" in the staff schedule project\'s IAM.');
    return;
  }
  Logger.log('READY — ' + users.length + ' hub user(s) with phones; ' + matched + ' of ' + ams.length +
    ' demo tracker people will get reminders on their hub phones (the rest stay on demo.chsnz.co.nz devices).');
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
// The requester is whoever is signed in (caller, from handlePayload), matched
// to their account manager record by email, then name — never a name the
// request supplies, which anyone could set to someone in Service.
function sendTestPush_(payload, caller) {
  const amsRaw = fetchFirebaseJson('/accountManagers.json') || [];
  const ams = Array.isArray(amsRaw) ? amsRaw : Object.values(amsRaw);
  const lower = function(s) { return String(s || '').trim().toLowerCase(); };
  const requester = (caller && caller.email && ams.find(function(a) { return a && lower(a.email) === lower(caller.email); }))
    || (caller && ams.find(function(a) { return a && lower(a.name) === lower(caller.name); }));
  if (!requester || amEffectiveRole_(requester) !== 'service') {
    Logger.log('sendTestPush_: rejected — the signed-in person is not Service & Projects.');
    return respond({ success: false, error: 'Only Service & Projects can send test notifications.' });
  }
  const am = ams.find(function(a) { return a && a.name === payload.amName; });
  if (!am) return respond({ success: false, error: 'Account manager not found: ' + payload.amName });
  const deviceCount = hubTokensFor_(am).length || (Array.isArray(am.fcmTokens) ? am.fcmTokens.length : 0);
  if (!deviceCount) {
    return respond({ success: false, error: am.name + ' has no registered device — they need to turn notifications on at internal.chsnz.co.nz on their phone first.' });
  }
  // Fixed wording: a test can't be used to put someone's own text on a colleague's phone.
  const first = String(requester.name || 'Someone').split(/\s+/)[0];
  const results = sendPushToPerson_(am, 'Test notification', first + ' sent this to check notifications reach your phone.', TRACKER_URL + '?mobile=1', true);
  Logger.log('Test push sent (' + deviceCount + ' device(s)).');
  return respond({ success: true, sentTo: am.name, deviceCount: deviceCount, results: results });
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
  sendPushToPerson_(am, 'Test notification', 'This is a test push from the CHS Equipment Tracker — no email or Simpro job was touched.', TRACKER_URL + '?mobile=1', true);
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
    // After the cutover, the tracker's data is read from the hub's Firestore (below).
    if (trackerOnFirestore_()) { const r = trackerFsRead_(path); if (r.handled) return r.value; }
    const resp = firebaseFetch_(path);
    if (resp.getResponseCode() >= 300) return null;
    return JSON.parse(resp.getContentText());
  } catch (err) {
    Logger.log('fetchFirebaseJson failed for ' + path + ': ' + err);
    return null;
  }
}

function putFirebaseJson(path, obj) {
  if (trackerOnFirestore_()) {
    try { if (trackerFsWrite_(path, obj)) return; } catch (err) { Logger.log('Firestore write failed for ' + String(path).split('/')[1] + ': ' + err.message); return; }
  }
  firebaseFetch_(path, {
    method: 'put',
    headers: { 'Content-Type': 'application/json' },
    payload: JSON.stringify(obj)
  });
}

// ── Write job ID back to Firebase so the tracker can reference it ─────────────
function writeJobIdToFirebase(pdfKey, jobId) {
  try {
    if (trackerOnFirestore_()) {
      trackerFsWrite_('/loanDocs/' + encodeURIComponent(pdfKey) + '/simproJobId.json', jobId);
      Logger.log('Firestore write: a loan job number');
      return;
    }
    firebaseFetch_('/loanDocs/' + encodeURIComponent(pdfKey) + '/simproJobId.json', {
      method: 'put',
      headers: { 'Content-Type': 'application/json' },
      payload: JSON.stringify(jobId)
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
  // Company-wide asset list, read-only. Needs the search query policy for
  // filters like AssetType.ID=9, Site.ID=in(1,2) and columns=ID,Site,CustomFields.
  [['get'],        /^\/companies\/\d+\/customerAssets\/$/, SIMPRO_QUERY_SEARCH],
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

// Checks a filename is a filename, rather than checking it against a list of
// characters someone thought filenames contain. The first version of this was
// an allowlist of [\w .()-] and it rejected five real PVT reports because their
// device names contain "+" ("HP Monitor Visual + EST"). Punctuation is not the
// risk here — path separators and traversal are, and Simpro can decide for
// itself what it will accept beyond that.
function simproSyncFilenameOk_(name) {
  const n = String(name == null ? '' : name);
  if (!n || n.length > 180) return false;
  if (n.indexOf('/') !== -1 || n.indexOf('\\') !== -1) return false;  // no paths
  if (n.indexOf('..') !== -1) return false;                           // no traversal
  if (n.charAt(0) === '.') return false;                              // no dotfiles
  if (/[\x00-\x1f\x7f]/.test(n)) return false;                        // no control characters
  return /\.[A-Za-z0-9]{1,8}$/.test(n);                               // must end in an extension
}

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
// ── Staff sign-in for the demo tracker ──────────────────────────────────────
//
// The tracker's Realtime Database lives in the chs-equipment Firebase project,
// but people sign in through the staff schedule's project (one Microsoft
// sign-in for every tool). A schedule ID token is not accepted by the
// chs-equipment database, so this proxy bridges them: it checks the schedule
// token, then mints a chs-equipment custom token carrying {staff:true}, which
// the tracker exchanges for an ID token its database will accept.
//
// "Staff" = someone with a real (non-placeholder) record in the schedule's
// users collection. Firestore does the signature check, the same way
// simproSyncVerifyAdmin_ does: the record is read using the caller's own token,
// so a forged or expired token gets a 401 from Firestore rather than a profile.

function verifyStaff_(idToken) {
  const decoded = verifyScheduleIdTokenShape_(idToken);
  const cache = CacheService.getScriptCache();
  const cacheKey = 'staff_' + Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, idToken)
  );
  const cached = cache.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const url = 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() +
    '/databases/(default)/documents/users/' + encodeURIComponent(decoded.uid);
  const resp = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + idToken }, muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) throw new Error('Could not verify sign-in (' + resp.getResponseCode() + ')');
  const f = (JSON.parse(resp.getContentText()).fields) || {};
  if (f.pending && f.pending.booleanValue === true) throw new Error('This account has not finished signing in.');

  const staff = {
    uid: decoded.uid,
    email: decoded.email,
    name: (f.displayName && f.displayName.stringValue) || decoded.email,
    admin: !!(f.role && f.role.stringValue === 'admin'),
  };
  const ttl = Math.max(1, Math.min(600, decoded.exp - Math.floor(Date.now() / 1000)));
  cache.put(cacheKey, JSON.stringify(staff), ttl);
  return staff;
}

// Like verifyStaff_, but null instead of throwing — for the soft check in front
// of the tracker's job and push actions.
function tryVerifyStaff_(idToken) {
  if (!idToken) return null;
  try { return verifyStaff_(idToken); } catch (err) { Logger.log('Sign-in check failed: ' + err); return null; }
}

// A Firebase custom token for the chs-equipment project, signed with its
// service account. Claims are what the database rules check.
function mintChsCustomToken_(staff) {
  const key = serviceAccountKey_();
  if (!key) throw new Error('Service account key is not configured');
  if (key.project_id !== 'chs-equipment') throw new Error('Service account is for ' + key.project_id + ', not chs-equipment');
  const b64url = function(obj) { return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, ''); };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({
    iss: key.client_email,
    sub: key.client_email,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid: String(staff.uid).slice(0, 128),
    claims: { staff: true, admin: !!staff.admin, name: String(staff.name || '').slice(0, 100) }
  });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, key.private_key)).replace(/=+$/, '');
  return unsigned + '.' + sig;
}

function rtdbTokenProxy_(payload) {
  let staff;
  try {
    staff = verifyStaff_(payload.idToken);
  } catch (err) {
    return respond({ success: false, error: 'Not signed in: ' + err.message });
  }
  try {
    return respond({ success: true, customToken: mintChsCustomToken_(staff), name: staff.name, admin: staff.admin });
  } catch (err) {
    Logger.log('rtdbToken: ' + err);
    return respond({ success: false, error: 'Could not issue a database pass: ' + err.message });
  }
}

// The chs-equipment web API key. Not a secret — it is the same public value in
// FIREBASE_CONFIG in index.html, and only identifies the project. Used solely
// by the self-test below to exchange a custom token the way the tracker does.
const CHS_WEB_API_KEY = 'AIzaSyB-A5wIEoqD9SBQPJnc6bs_qjHytZFDaBA';

// Run from the editor. Proves the whole path the tracker will use: mint a
// custom token, exchange it, read the database with the resulting ID token.
function checkCustomTokenMinting() {
  const token = mintChsCustomToken_({ uid: 'proxy-selftest', name: 'Proxy self-test', admin: false });
  const ex = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=' + CHS_WEB_API_KEY, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ token: token, returnSecureToken: true }), muteHttpExceptions: true
  });
  const exJson = JSON.parse(ex.getContentText());
  if (!exJson.idToken) {
    Logger.log('NOT READY — exchange failed (' + ex.getResponseCode() + '): ' + ex.getContentText().slice(0, 300) +
      '\nIf it mentions CONFIGURATION_NOT_FOUND or a disabled API: Firebase console → chs-equipment → Authentication → Get started.');
    return;
  }
  const read = UrlFetchApp.fetch(FIREBASE_BASE + '/simproConfig.json?auth=' + encodeURIComponent(exJson.idToken), { muteHttpExceptions: true }).getResponseCode();
  Logger.log(read === 200
    ? 'READY — a staff pass can read the database (200).'
    : 'NOT READY — exchange worked but the database read returned ' + read + '.');
}

function verifyScheduleIdTokenShape_(idToken) {
  const claims = decodeFirebaseIdToken_(idToken);
  const projectId = scheduleFirebaseProjectId_();
  if (claims.aud !== projectId) throw new Error('Token is not for the expected Firebase project');
  if (claims.iss !== FIREBASE_ISSUER_PREFIX + projectId) throw new Error('Token issuer mismatch');
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('Token expired');
  const uid = claims.user_id || claims.sub;
  if (!uid) throw new Error('Token has no user id');
  // Company accounts only: the second lock behind the tenant-only Microsoft
  // sign-in (firestore.rules isCompanyEmail checks the same).
  if (!/^[^@\s]+@(cass|chsnz)\.co\.nz$/i.test(String(claims.email || ''))) throw new Error('Not a company account');
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
      if (!simproSyncFilenameOk_(body.Filename)) {
        return respond({ success: false, error: 'Request ' + i + ' has an unusable attachment filename: ' + String(body.Filename).slice(0, 120) });
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

// ── The demo tracker's data in Firestore (step 5B's cutover) ─────────────────
// settings/equipmentCutover in the hub's Firestore says where the tracker's
// data is ({ source: 'rtdb' | 'firestore' }), the same switch the tracker
// follows (apps/equipment/src/db.js). Until it says 'firestore', nothing here
// changes. After, fetchFirebaseJson / putFirebaseJson / writeJobIdToFirebase
// answer the same paths from the hub's Firestore (the shapes are
// apps/equipment/src/fs-shape.js's): equipment, the bookings, a loan's form
// and Simpro settings are read there; a job number is written to the loan's
// document; the "already sent" records go in equipmentReminders. The team
// list (accountManagers) stays in the old database, still readable, until
// step 5A moves it. Writing to Firestore needs this script's service account
// given write access in the staff schedule's project (Cloud Datastore User).

let trackerSource_ = null; // once per run
function trackerOnFirestore_() {
  if (trackerSource_ === null) {
    trackerSource_ = 'rtdb';
    try {
      const d = fsGetDoc_('settings/equipmentCutover');
      if (d && d.source === 'firestore') trackerSource_ = 'firestore';
    } catch (err) { Logger.log('Cutover switch not read (' + err.message + '): using the old database.'); }
  }
  return trackerSource_ === 'firestore';
}

function fsBase_() { return 'https://firestore.googleapis.com/v1/projects/' + scheduleFirebaseProjectId_() + '/databases/(default)/documents/'; }
function fsAuth_() {
  const token = hubAccessToken_();
  if (!token) throw new Error('no service account token');
  return { Authorization: 'Bearer ' + token };
}
// A document path's parts, each encoded (a loan key can hold '%', '|' and spaces).
function fsPath_(p) { return p.split('/').map(encodeURIComponent).join('/'); }

// Arrays inside arrays are kept as { _a: [...] } (Firestore can't nest them).
function fsUnpack_(v) {
  if (Array.isArray(v)) return v.map(function(x) { return (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && Array.isArray(x._a)) ? fsUnpack_(x._a) : fsUnpack_(x); });
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(function(k) { o[k] = fsUnpack_(v[k]); }); return o; }
  return v;
}
// A plain value as a Firestore REST value.
function fsValue_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(fsValue_) } };
  const fields = {};
  Object.keys(v).forEach(function(k) { fields[k] = fsValue_(v[k]); });
  return { mapValue: { fields: fields } };
}

/** One document's fields as plain values, or null if it isn't there. */
function fsGetDoc_(path) {
  const resp = UrlFetchApp.fetch(fsBase_() + fsPath_(path), { headers: fsAuth_(), muteHttpExceptions: true });
  if (resp.getResponseCode() === 404) return null;
  if (resp.getResponseCode() !== 200) throw new Error('Firestore read refused (' + resp.getResponseCode() + ') for ' + path.split('/')[0]);
  return fsUnpack_(fsFields_(JSON.parse(resp.getContentText()).fields));
}
/** Every document in a collection: [{ id, ...fields }]. */
function fsList_(collection, fields) {
  const mask = (fields || []).map(function(f) { return '&mask.fieldPaths=' + encodeURIComponent(f); }).join('');
  const out = [];
  let pageToken = '';
  do {
    const resp = UrlFetchApp.fetch(fsBase_() + collection + '?pageSize=300' + mask + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''),
      { headers: fsAuth_(), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Firestore read refused (' + resp.getResponseCode() + ') for ' + collection);
    const json = JSON.parse(resp.getContentText());
    (json.documents || []).forEach(function(d) { const o = fsUnpack_(fsFields_(d.fields)); o.__id = d.name.split('/').pop(); /* names come back as stored, not encoded */ out.push(o); });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return out;
}
/** Some fields of a document set (a.b for one inside a map); with mustExist, only if it's there already. */
function fsPatch_(path, values, mustExist) {
  const fields = {}, masks = [];
  Object.keys(values).forEach(function(k) {
    masks.push('updateMask.fieldPaths=' + encodeURIComponent(k));
    const parts = k.split('.');
    let o = fields;
    for (let i = 0; i < parts.length - 1; i++) { o[parts[i]] = o[parts[i]] || { mapValue: { fields: {} } }; o = o[parts[i]].mapValue.fields; }
    o[parts[parts.length - 1]] = fsValue_(values[k]);
  });
  const resp = UrlFetchApp.fetch(fsBase_() + fsPath_(path) + '?' + masks.join('&') + (mustExist ? '&currentDocument.exists=true' : ''), {
    method: 'patch', contentType: 'application/json', headers: fsAuth_(), muteHttpExceptions: true,
    payload: JSON.stringify({ fields: fields })
  });
  if (resp.getResponseCode() >= 300) throw new Error('Firestore write refused (' + resp.getResponseCode() + ') for ' + path.split('/')[0]);
}

// Which Firestore place an old database path is (pure: apps/equipment/tests checks it).
//   { kind: 'equipment' | 'bookings' | 'form' | 'jobId' | 'simproConfig' | 'marker' | 'old', key, mark }
function trackerFsPlace_(path) {
  const parts = String(path).replace(/^\//, '').replace(/\.json$/, '').split('/').map(decodeURIComponent);
  const top = parts[0];
  if (top === 'data' && parts[1] === 'equipment') return { kind: 'equipment' };
  if (top === 'upcomingLoans' && parts.length === 1) return { kind: 'bookings' };
  if (top === 'loanDocs' && parts.length === 2) return { kind: 'form', key: parts[1] };
  if (top === 'loanDocs' && parts.length === 3 && parts[2] === 'simproJobId') return { kind: 'jobId', key: parts[1] };
  if (top === 'simproConfig') return { kind: 'simproConfig' };
  if (['demoReminders', 'stuckLoanReminders', 'returnDueSoonReminders'].indexOf(top) >= 0 && parts.length === 2) return { kind: 'marker', mark: top, key: parts[1] };
  return { kind: 'old' };
}
// A reminder record's document id: which reminder, and its key (encoded: a key can hold '/').
function trackerMarkerId_(mark, key) { return mark + '__' + encodeURIComponent(key); }

/** An old database path, read from Firestore. { handled: false } for one that stays in the old database. */
function trackerFsRead_(path) {
  const p = trackerFsPlace_(path);
  if (p.kind === 'equipment') {
    return { handled: true, value: fsList_('equipment').sort(function(a, b) { return (a._pos || 0) - (b._pos || 0); })
      .map(function(e) { delete e._pos; delete e.__id; return e; }) };
  }
  if (p.kind === 'bookings') {
    const out = {};
    fsList_('loans', ['booking']).forEach(function(l) { if (l.booking && l.booking.id) out[l.booking.id] = l.booking; });
    return { handled: true, value: out };
  }
  if (p.kind === 'form') { const l = fsGetDoc_('loans/' + p.key); return { handled: true, value: l && l.form ? l.form : null }; }
  if (p.kind === 'jobId') { const l = fsGetDoc_('loans/' + p.key); return { handled: true, value: l && l.form ? (l.form.simproJobId == null ? null : l.form.simproJobId) : null }; }
  if (p.kind === 'simproConfig') { const s = fsGetDoc_('settings/equipment'); return { handled: true, value: s ? (s.simproConfig || {}) : null }; }
  if (p.kind === 'marker') { return { handled: true, value: fsGetDoc_('equipmentReminders/' + trackerMarkerId_(p.mark, p.key)) }; }
  return { handled: false };
}

/** An old database path, written to Firestore. False for one that stays in the old database. */
function trackerFsWrite_(path, value) {
  const p = trackerFsPlace_(path);
  if (p.kind === 'jobId') { fsPatch_('loans/' + p.key, { 'form.simproJobId': value, simproJobId: value }, true); return true; }
  if (p.kind === 'marker') { fsPatch_('equipmentReminders/' + trackerMarkerId_(p.mark, p.key), value || {}, false); return true; }
  if (p.kind !== 'old') throw new Error('The proxy doesn\'t write ' + p.kind + ' to the tracker\'s Firestore data');
  return false;
}
