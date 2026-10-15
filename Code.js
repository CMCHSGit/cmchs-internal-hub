/**
 * CHS Equipment Tracker — Daily Backup
 * =====================================================
 * A SEPARATE Google Apps Script project from .gas-proxy/Code.js (the
 * Simpro/reminder proxy) — this one is a standalone script, not a deployed
 * web app, and isn't called by the tracker at all. It just reads straight
 * from the tracker's Firebase Realtime Database on a daily timer and writes
 * a dated .xlsx snapshot to Google Drive.
 *
 * DEPLOYMENT:
 *   1. Paste this file's contents into script.google.com as its own project
 *      (no web app deployment needed — it's trigger-only).
 *   2. Run installDailyBackupTrigger() once from the Apps Script editor,
 *      authorising the Drive/Sheets/Firebase/Mail scopes when prompted.
 *   3. After any code change here: no redeploy step exists for a plain
 *      trigger-run script — the next scheduled run just picks up the new
 *      code automatically.
 *
 * WHAT IT BACKS UP (2026-10-02 — added Current Loans / Upcoming Loans):
 *   Originally only "Equipment" (every equipment record, which already
 *   carries each item's own OnLoanTo/LoanStartDate/LoanEndDate) and
 *   "History" (the full per-device action log). That meant two real gaps:
 *     - /upcomingLoans.json (unconfirmed bookings — no equipment assigned
 *       yet, so literally invisible on the Equipment sheet) wasn't captured
 *       at all.
 *     - Loan-level detail that lives separately from the equipment record —
 *       account manager, contact number, job type, demo type, shipping
 *       island, long-term status, Simpro job number, loan notes — all live
 *       in /loanDocs.json (plus loanMeta inside /data.json for account
 *       manager + long-term), not on the equipment row, so a restore from
 *       the old backup could tell you WHAT was on loan and WHEN, but not WHO
 *       it was assigned to or any of the rest.
 *   Now backs up four sheets: Equipment, History (both unchanged), plus
 *   Current Loans (one row per equipment item currently on loan, joined
 *   with its /loanDocs.json detail) and Upcoming Loans (one row per item
 *   within each unconfirmed booking).
 *
 * THE PROJECT TRACKER TOO (2026-10-15):
 *   The same nightly run also backs up the project tracker
 *   (internal.chsnz.co.nz/projects/), whose data is in the STAFF SCHEDULE's
 *   Firestore (projectJobs, projectAssignments, projectComments,
 *   projectHistory, projectSettings). Two files a night in Drive folder
 *   "CMCHS Project Tracker Backups", kept a year:
 *     - Project-Tracker-YYYY-MM-DD.json — everything, exactly as stored. The
 *       tracker restores from it: Settings → Backups → Restore from a backup.
 *     - Project-Tracker-YYYY-MM-DD.xlsx — the jobs and who is where each week,
 *       to read without the tracker.
 *   It reads with the same service account as the database reads below
 *   (FIREBASE_SERVICE_ACCOUNT_KEY), which needs "Cloud Datastore Viewer" in
 *   the staff schedule's Google Cloud project — the same grant the Simpro
 *   proxy's hub push uses. checkProjectsBackup() says whether it is in place.
 *   The two backups are independent: one failing never stops the other.
 *
 * LIVE vs REPO (found 2026-10-15): the "CHS Daily Backup" project in Apps
 *   Script was still running an older copy of this file — no Current/Upcoming
 *   Loans sheets and no signed reads. Pushing this file (clasp, see
 *   .clasp.json) changes its permissions, so someone must open the editor and
 *   run setupBackups() once to approve them, or the nightly run stops.
 */

const FIREBASE_BASE      = 'https://chs-equipment-default-rtdb.asia-southeast1.firebasedatabase.app';
const FIREBASE_URL       = FIREBASE_BASE + '/data.json';
const BACKUP_FOLDER_NAME = 'CHS Equipment Backups';
const NOTIFY_EMAIL       = Session.getActiveUser().getEmail();

const EQUIPMENT_COLS = [
  'CHSAssetNo','Model','Description','SerialNo','MfgDate','TileNo',
  'OnLoanTo','Location','LoanStartDate','LoanEndDate','Returned','Counted',
  'PartNo','PurchaseDate','USPrice','NZPrice','ShelfLocation','Notes',
  'DeviceID','LanMAC','WlanMAC','OldCHS','TileType','BorrowerEmail','AccountManager'
];
const EQUIPMENT_HEADERS = [
  'CHS Asset No.','Model','Description','Serial Number','Manufacture Date','Tile No.',
  'On Loan To','Location','Loan Start Date','Loan End Date','Returned','Counted',
  'Part Number','Purchase Date','US$ Price','NZ$ Price','Shelf Location','Notes',
  'Device ID','LAN MAC','WLAN MAC','Old CHS #','Tile Type','Account Manager Email','Account Manager'
];
const HISTORY_COLS    = ['ts','chsAssetNo','model','action','loanTo','location','loanStart','loanEnd','notes'];
const HISTORY_HEADERS = ['Date/Time','CHS Asset No.','Model','Action','On Loan To','Location','Loan Start','Loan End','Notes'];

// One row per equipment item currently on loan, joined with its loan-level
// detail from /loanDocs.json — looked up the exact same way the tracker
// itself does (index.html's getLoanAM()/_readinessKey()): by BatchID when
// present, falling back to the 'loandoc_'+encodeURIComponent(loanTo+'|||'
// +endDate) key for loans that predate BatchID tracking.
const CURRENT_LOAN_HEADERS = [
  'CHS Asset No.','Model','Description','Serial Number',
  'On Loan To','Location','Loan Start Date','Loan End Date','Long Term',
  'Account Manager','Contact Number','Job Type','Demo Type','Shipping Island',
  'Simpro Job #','Notes'
];

// One row per item within an unconfirmed booking (/upcomingLoans.json) —
// these have no equipment assigned yet, so they never appear on the
// Equipment sheet at all.
const UPCOMING_LOAN_HEADERS = [
  'Loan To','Location','Start Date','End Date','Long Term',
  'Account Manager','Borrower Email','CHS Asset No.','Model','Serial Number'
];

// The trigger's handler (installed by installDailyBackupTrigger): the demo
// tracker's backup, then the project tracker's, each failing on its own.
function dailyBackup() {
  // Each half reports its own failure; these catch what escapes that (a
  // failure email that itself can't be sent), so one never stops the other.
  try { equipmentBackup_(); } catch (err) { console.error('Demo tracker backup stopped:', err.toString()); }
  try { projectsBackup_(); } catch (err) { console.error('Project tracker backup stopped:', err.toString()); }
}

function equipmentBackup_() {
  try {
    // 1. Fetch from Firebase — /data.json (equipment + history + loanMeta,
    // one document) plus the two separate top-level nodes it doesn't cover.
    const data        = JSON.parse(firebaseGet_('/data.json').getContentText()) || {};
    const equipment   = Array.isArray(data.equipment) ? data.equipment : [];
    const history     = Array.isArray(data.history)   ? data.history   : [];
    const loanMeta    = (data.loanMeta && typeof data.loanMeta === 'object') ? data.loanMeta : {};
    const loanDocsRaw = JSON.parse(firebaseGet_('/loanDocs.json').getContentText()) || {};
    const upcomingRaw = JSON.parse(firebaseGet_('/upcomingLoans.json').getContentText()) || {};

    // 2. Find or create backup folder in Google Drive
    const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
    const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);

    // 3. Build spreadsheet rows
    const eqRows = [EQUIPMENT_HEADERS, ...equipment.map(e => EQUIPMENT_COLS.map(c => {
      // The tracker migrated AccountManager off the equipment record and
      // into loanMeta a while back (index.html's loadData()), so reading it
      // straight off the equipment record like every other column here
      // would always come back blank now — resolve it the way the tracker
      // itself does instead.
      if (c === 'AccountManager') return (e.BatchID && loanMeta[e.BatchID] && loanMeta[e.BatchID].accountManager) || '';
      return e[c] || '';
    }))];
    const histRows = [HISTORY_HEADERS,   ...history.map(h => HISTORY_COLS.map(c => {
      if (c === 'ts' && h[c]) return new Date(h[c]).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' });
      return h[c] || '';
    }))];

    function findLoanDoc_(onLoanTo, batchId, endDate) {
      if (batchId && loanDocsRaw[batchId]) return loanDocsRaw[batchId];
      const fallbackKey = 'loandoc_' + encodeURIComponent((onLoanTo || '') + '|||' + (endDate || ''));
      return loanDocsRaw[fallbackKey] || null;
    }

    const currentLoanItems = equipment.filter(e => e && e.OnLoanTo && e.Returned !== 'Yes');
    const curRows = [CURRENT_LOAN_HEADERS, ...currentLoanItems.map(e => {
      const doc  = findLoanDoc_(e.OnLoanTo, e.BatchID, e.LoanEndDate) || {};
      const meta = (e.BatchID && loanMeta[e.BatchID]) || {};
      const isLongTerm = !!(meta.longTerm || doc.longTerm);
      const am = meta.accountManager || doc.accountManager || '';
      const simproJobId = (doc.simproJobId && typeof doc.simproJobId !== 'object' && doc.simproJobId !== 'pending') ? doc.simproJobId : '';
      return [
        e.CHSAssetNo || '', e.Model || '', e.Description || '', e.SerialNo || '',
        e.OnLoanTo || '', e.Location || '', e.LoanStartDate || '', e.LoanEndDate || '',
        isLongTerm ? 'Yes' : 'No',
        am, doc.contactNumber || '', doc.jobType || '', doc.demoType || '', doc.island || '',
        simproJobId, doc.notes || doc.notesCell || ''
      ];
    })];

    const upcomingList = Object.keys(upcomingRaw)
      .map(k => { const v = upcomingRaw[k]; if (v && !v.id) v.id = k; return v; })
      .filter(u => u && u.loanTo);
    const upRows = [UPCOMING_LOAN_HEADERS];
    upcomingList.forEach(u => {
      const meta = loanMeta[u.id] || {};
      const isLongTerm = !!meta.longTerm;
      const items = (Array.isArray(u.items) && u.items.length) ? u.items : [{}];
      items.forEach(it => {
        upRows.push([
          u.loanTo || '', u.location || '', u.startDate || '', u.endDate || '',
          isLongTerm ? 'Yes' : 'No',
          u.accountManager || '', u.borrowerEmail || '',
          it.CHSAssetNo || '', it.Model || '', it.SerialNo || ''
        ]);
      });
    });

    // 4. Create a temporary Google Sheet
    const ss      = SpreadsheetApp.create('_temp_chs_backup');
    const eqSheet = ss.getActiveSheet();
    eqSheet.setName('Equipment');
    writeSheetRows_(eqSheet, eqRows, EQUIPMENT_HEADERS.length);

    const histSheet = ss.insertSheet('History');
    writeSheetRows_(histSheet, histRows, HISTORY_HEADERS.length);

    const curSheet = ss.insertSheet('Current Loans');
    writeSheetRows_(curSheet, curRows, CURRENT_LOAN_HEADERS.length);

    const upSheet = ss.insertSheet('Upcoming Loans');
    writeSheetRows_(upSheet, upRows, UPCOMING_LOAN_HEADERS.length);

    // 5. Export as .xlsx and save to Drive
    const dateStr   = Utilities.formatDate(new Date(), 'Pacific/Auckland', 'dd-MM-yyyy');
    const fileName  = 'CHS-Equipment-' + dateStr + '.xlsx';
    const ssId      = ss.getId();
    const exportUrl = 'https://docs.google.com/spreadsheets/d/' + ssId + '/export?format=xlsx';
    const blob = UrlFetchApp.fetch(exportUrl, {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }).getBlob().setName(fileName);

    folder.createFile(blob);

    // 6. Delete the temporary sheet
    DriveApp.getFileById(ssId).setTrashed(true);

    // 7. Delete backups older than 365 days
    const files  = folder.getFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated() < cutoff) f.setTrashed(true);
    }

    console.log('Backup complete: ' + fileName + ' (' + equipment.length + ' items, ' + history.length +
      ' history records, ' + currentLoanItems.length + ' on-loan items, ' + upcomingList.length + ' upcoming loans)');

  } catch (err) {
    console.error('Backup failed:', err.toString());
    MailApp.sendEmail(
      NOTIFY_EMAIL,
      'CHS Equipment Backup Failed - ' + new Date().toDateString(),
      'The daily backup failed.\n\nError: ' + err.toString() + '\n\nPlease check the Apps Script logs.'
    );
  }
}

// Shared by all four sheets above — sets values (skipping when a sheet has
// only its header row, same guard the original script used per-sheet) and
// applies the same header styling/frozen-row treatment to each.
function writeSheetRows_(sheet, rows, numCols) {
  if (rows.length > 1) {
    sheet.getRange(1, 1, rows.length, numCols).setValues(rows);
  } else {
    sheet.getRange(1, 1, 1, numCols).setValues([rows[0]]);
  }
  const header = sheet.getRange(1, 1, 1, numCols);
  header.setBackground('#1d4ed8').setFontColor('#ffffff').setFontWeight('bold');
  sheet.setFrozenRows(1);
}

// ── Project tracker backup ───────────────────────────────────────────────────
// See "THE PROJECT TRACKER TOO" at the top. Only counts go to the log, never
// names (the repo is public and so are its logs' habits).

const PROJECTS_FOLDER_NAME = 'CMCHS Project Tracker Backups';
const PROJECTS_COLLECTIONS = ['projectJobs', 'projectAssignments', 'projectComments', 'projectHistory', 'projectSettings'];
// The staff schedule's Firebase project. Not a secret: it is in every page on
// internal.chsnz.co.nz. A Script Property of the same name overrides it.
const SCHEDULE_PROJECT_ID_DEFAULT = 'cmchsstaffschedule';

function scheduleProjectId_() {
  return PropertiesService.getScriptProperties().getProperty('FIREBASE_SCHEDULE_PROJECT_ID') || SCHEDULE_PROJECT_ID_DEFAULT;
}

// Firestore's REST values, as plain JSON (what the tracker reads and writes).
function fsValue_(v) {
  if (!v) return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValue_);
  if ('mapValue' in v) return fsFields_(v.mapValue.fields || {});
  if ('referenceValue' in v) return v.referenceValue;
  if ('geoPointValue' in v) return v.geoPointValue;
  if ('bytesValue' in v) return v.bytesValue;
  return null;
}
function fsFields_(fields) {
  const out = {};
  Object.keys(fields || {}).forEach(function(k) { out[k] = fsValue_(fields[k]); });
  return out;
}

// Every document in one collection: { id: data }. Throws if Firestore refuses.
function readCollection_(token, name) {
  const base = 'https://firestore.googleapis.com/v1/projects/' + scheduleProjectId_() + '/databases/(default)/documents/' + name + '?pageSize=300';
  const docs = {};
  let pageToken = '';
  do {
    const resp = UrlFetchApp.fetch(base + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''), {
      headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true
    });
    const code = resp.getResponseCode();
    if (code !== 200) throw new Error('Firestore refused to read ' + name + ' (' + code + ')');
    const json = JSON.parse(resp.getContentText());
    (json.documents || []).forEach(function(d) { docs[d.name.split('/').pop()] = fsFields_(d.fields); });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  return docs;
}

// The tracker's whole store, in the format its Restore reads
// (cmchs-internal-hub apps/projects/src/backup.js).
function readProjectTracker_() {
  const token = serviceAccountToken_('https://www.googleapis.com/auth/datastore', 'firestoreAccessToken');
  if (!token) throw new Error('No service account token: set FIREBASE_SERVICE_ACCOUNT_KEY.');
  const collections = {};
  PROJECTS_COLLECTIONS.forEach(function(name) { collections[name] = readCollection_(token, name); });
  return {
    kind: 'project-tracker-backup',
    version: 1,
    takenAt: new Date().toISOString(),
    source: 'nightly',
    collections: collections
  };
}

function projectsBackup_() {
  try {
    const backup = readProjectTracker_();
    const c = backup.collections;
    const folders = DriveApp.getFoldersByName(PROJECTS_FOLDER_NAME);
    const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(PROJECTS_FOLDER_NAME);
    const stamp   = Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM-dd');
    const name    = 'Project-Tracker-' + stamp;

    // 1. The restore file: everything, exactly as stored
    folder.createFile(Utilities.newBlob(JSON.stringify(backup), 'application/json', name + '.json'));

    // 2. A spreadsheet to read without the tracker
    const settings = (c.projectSettings && c.projectSettings.main) || {};
    const staff = {};
    (settings.staff || []).forEach(function(p) { if (p && p.id) staff[p.id] = p.initials || p.name || ''; });
    const cats = {};
    (settings.categories || []).forEach(function(x) { if (x && x.id) cats[x.id] = x.name || ''; });
    const initials = function(ids) { return (ids || []).map(function(id) { return staff[id] || '?'; }).join(', '); };
    const jobs = Object.keys(c.projectJobs).map(function(id) { return c.projectJobs[id]; })
      .sort(function(a, b) { return String(a.start || '9').localeCompare(String(b.start || '9')); });
    const jobRows = [['Job', 'Category', 'Status', 'Customer', 'Region', 'Start', 'End', 'Priority', 'Engineering', 'Apps / sales', 'Archived']]
      .concat(jobs.map(function(j) {
        return [j.name || '', cats[j.category] || '', j.status || '', j.customer || '', j.region || '', j.start || '', j.end || '',
          j.priority || '', initials(j.eng), initials(j.apps), j.archived ? 'Yes' : ''];
      }));
    const weeks = Object.keys(c.projectAssignments).map(function(id) { return c.projectAssignments[id]; })
      .sort(function(a, b) { return String(a.week).localeCompare(String(b.week)); });
    const weekRows = [['Week (Monday)', 'Person', 'Job', 'Activity', 'Not confirmed']]
      .concat(weeks.map(function(a) {
        const j = c.projectJobs[a.jobId] || {};
        return [a.week || '', staff[a.staffId] || '?', j.name || '(deleted job)', a.activity || '', a.tentative ? 'Yes' : ''];
      }));
    const ss = SpreadsheetApp.create('_temp_project_tracker_backup');
    const jobSheet = ss.getActiveSheet();
    jobSheet.setName('Jobs');
    writeSheetRows_(jobSheet, jobRows, jobRows[0].length);
    writeSheetRows_(ss.insertSheet('Staff weeks'), weekRows, weekRows[0].length);
    SpreadsheetApp.flush();
    const blob = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }).getBlob().setName(name + '.xlsx');
    folder.createFile(blob);
    DriveApp.getFileById(ss.getId()).setTrashed(true);

    // 3. Keep a year
    const files  = folder.getFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated() < cutoff) f.setTrashed(true);
    }

    console.log('Project tracker backup complete: ' + name + ' (' + jobs.length + ' jobs, ' + weeks.length + ' staff weeks, ' +
      Object.keys(c.projectComments).length + ' comments, ' + Object.keys(c.projectHistory).length + ' history entries)');
  } catch (err) {
    console.error('Project tracker backup failed:', err.toString());
    try {
      MailApp.sendEmail(NOTIFY_EMAIL, 'Project Tracker Backup Failed - ' + new Date().toDateString(),
        'The nightly project tracker backup failed.\n\nError: ' + err.toString() + '\n\nRun checkProjectsBackup() in the Apps Script editor to see why.');
    } catch (mailErr) { console.error('Could not send the failure email:', mailErr.toString()); }
  }
}

// Run from the editor: reads the tracker and logs counts, writes nothing.
function checkProjectsBackup() {
  CacheService.getScriptCache().remove('firestoreAccessToken');
  try {
    const c = readProjectTracker_().collections;
    Logger.log('READY — the project tracker backup can read: ' + PROJECTS_COLLECTIONS.map(function(n) { return Object.keys(c[n]).length + ' ' + n; }).join(', ') + '.');
  } catch (err) {
    const why = String(err.message).replace(/\.+$/, '');
    const fix = /\(40[13]\)/.test(why)
      ? 'Grant the service account "Cloud Datastore Viewer" in the staff schedule project\'s Google Cloud IAM.'
      : /service account token/.test(why)
        ? 'Add Script Property FIREBASE_SERVICE_ACCOUNT_KEY: the same JSON the Simpro proxy project holds as FCM_SERVICE_ACCOUNT_KEY.'
        : 'See the error above.';
    Logger.log('NOT READY — ' + why + '. ' + fix);
  }
}

// Run from the editor to take a project tracker backup now (both files).
function projectsBackupNow() {
  projectsBackup_();
}

// Run ONCE from the editor after pushing this file: approves the permissions
// the newer code needs, reinstalls the 3am trigger, and checks both backups
// can read. Safe to run again.
function setupBackups() {
  installDailyBackupTrigger();
  checkBackupDatabaseAuth();
  checkProjectsBackup();
}

// Run once from the Apps Script editor to install the daily trigger.
// Deletes any prior trigger with the same handler first, same pattern
// .gas-proxy/Code.js's installers use, so re-running this is always safe.
function installDailyBackupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dailyBackup')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .inTimezone('Pacific/Auckland')
    .create();
  console.log('Daily backup trigger installed (3am NZ time).');
}

// ── Signed database reads ───────────────────────────────────────────────────
// The tracker's Realtime Database is being locked so only signed-in staff and
// back-office jobs can read it. This backup is one of those jobs, so it signs
// its reads with the chs-equipment service account.
//
// SETUP (once): Project Settings → Script Properties → add
//   Name:  FIREBASE_SERVICE_ACCOUNT_KEY
//   Value: the same service account JSON the Simpro proxy holds as
//          FCM_SERVICE_ACCOUNT_KEY (Firebase console → Project settings →
//          Service accounts → Generate new private key). Never paste it into
//          this file — the repo is public.
//
// Until that property exists the reads go unsigned, which works only while the
// database is still open. Run checkBackupDatabaseAuth() to confirm before the
// lock — a backup that silently stops is the worst kind of failure.

function backupDbToken_() {
  return serviceAccountToken_('https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', 'rtdbAccessToken');
}

// An access token for the service account in FIREBASE_SERVICE_ACCOUNT_KEY,
// for these scopes, cached under cacheKey for 50 minutes.
function serviceAccountToken_(scope, cacheKey) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(cacheKey);
  if (hit) return hit;
  const raw = PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVICE_ACCOUNT_KEY');
  if (!raw) { Logger.log('FIREBASE_SERVICE_ACCOUNT_KEY not set — backup reads are unsigned.'); return null; }
  let key;
  try { key = JSON.parse(raw); } catch (err) { Logger.log('FIREBASE_SERVICE_ACCOUNT_KEY is not valid JSON: ' + err); return null; }
  const b64url = function(obj) { return Utilities.base64EncodeWebSafe(JSON.stringify(obj)).replace(/=+$/, ''); };
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url({ alg: 'RS256', typ: 'JWT' }) + '.' + b64url({
    iss: key.client_email,
    scope: scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  });
  const sig = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, key.private_key)).replace(/=+$/, '');
  const resp = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + sig },
    muteHttpExceptions: true
  });
  const json = JSON.parse(resp.getContentText());
  if (!json.access_token) { Logger.log('Service account token exchange failed: ' + resp.getContentText()); return null; }
  cache.put(cacheKey, json.access_token, 50 * 60);
  return json.access_token;
}

function firebaseGet_(path) {
  const url = FIREBASE_BASE + path;
  const token = backupDbToken_();
  if (token) {
    const signed = UrlFetchApp.fetch(url + '?access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
    const code = signed.getResponseCode();
    if (code !== 401 && code !== 403) return signed;
    Logger.log('Database refused the service account token (' + code + ') for ' + path + ' — retrying unsigned.');
    CacheService.getScriptCache().remove('rtdbAccessToken');
  }
  return UrlFetchApp.fetch(url, { muteHttpExceptions: true });
}

function checkBackupDatabaseAuth() {
  CacheService.getScriptCache().remove('rtdbAccessToken');
  const token = backupDbToken_();
  if (!token) { Logger.log('NOT READY — set FIREBASE_SERVICE_ACCOUNT_KEY first.'); return; }
  const url = FIREBASE_BASE + '/upcomingLoans.json?shallow=true';
  const code = UrlFetchApp.fetch(url + '&access_token=' + encodeURIComponent(token), { muteHttpExceptions: true }).getResponseCode();
  Logger.log(code === 200 ? 'READY — the backup can read the database signed.' : 'NOT READY — signed read returned ' + code + '.');
}
