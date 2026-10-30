/**
 * CHS Equipment Tracker — Daily Backup
 * =====================================================
 * A SEPARATE Google Apps Script project from ../proxy/Code.js (the
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
 * THE WHOLE TRACKER DATABASE TOO (2026-10-17):
 *   The spreadsheet above is for reading; it can't be put back, and it leaves
 *   out the kits, retired items, account managers, audit log and the full loan
 *   forms. So the same folder also gets, each night:
 *     - Demo-Tracker-YYYY-MM-DD.json — every top-level path of the tracker's
 *       Realtime Database exactly as stored (data, upcomingLoans, loanDocs,
 *       accountManagers, retired, kitGroups, auditLog, config…), except the
 *       uploaded test report files. Kept a year.
 *     - Test report files/<key>--<id>.txt — each uploaded test report once,
 *       the first night it exists, exactly as stored (a data: URL). They're
 *       up to 8 MB each, so in every nightly file they'd soon pass Apps
 *       Script's 50 MB limit.
 *   To restore: Firebase console → chs-equipment → Realtime Database → open the
 *   path to put back (e.g. data) → ⋮ → Import JSON, with that path's part of
 *   the file. Importing the whole file at the top would also delete the test
 *   report files, which aren't in it. The file holds what the database does,
 *   including /config's admin password, so keep the folder private.
 *   Same signed reads as the spreadsheet; checkTrackerJsonBackup() says
 *   whether it can read. Independent of the others.
 *
 * AFTER STEP 5'S CUTOVER (2026-10-19):
 *   Once settings/equipmentCutover in the hub's Firestore says 'firestore',
 *   the spreadsheet and the JSON file read the tracker from there, turned back
 *   into the old tree (so both look the same, and migrate.mjs can put a JSON
 *   file back into Firestore: --from <file> --reports <folder>). The team list
 *   and config still come from the old database. See "After step 5's cutover"
 *   below; it needs the Cloud Datastore Viewer grant the project backup has.
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
 * ASKS TOO (2026-10-16):
 *   And the hub's Asks (internal.chsnz.co.nz/asks/), also in the staff
 *   schedule's Firestore: asks (with their comments and photos
 *   subcollections) and askStats. Drive folder "CMCHS Asks Backups":
 *     - Asks-YYYY-MM-DD.json — asks, askStats and comments exactly as stored,
 *       and every photo's details (not its picture). Kept a year.
 *     - Asks-YYYY-MM-DD.xlsx — one row per ask, to read without the tool.
 *     - Photos/<askId>-<photoId>.jpg — each photo saved once, the first night
 *       it exists, rather than in every nightly file (they're up to ~480 KB
 *       each). Removed only when its ask is gone and it's over a year old.
 *   Same service account and IAM grant as the project tracker's backup;
 *   checkAsksBackup() says whether it can read. Independent of the others.
 *
 * THE HUB ACTIVITY LOG TOO (2026-10-30):
 *   And the hub's activity log — one line per action, who did what and when, from
 *   every tool (cmchs-internal-hub shared/activity.js; Firestore `activity` in the
 *   staff schedule's project). Admins read it on Settings → Staff schedule → Activity
 *   log; this copies it to Drive each night so a copy exists outside Firebase. Drive
 *   folder "CMCHS Hub Activity Log Backups":
 *     - Hub activity log YYYY-MM — one spreadsheet a month (New Zealand time), the
 *       night's new lines added at the bottom: When, Who, Email, Tool, What, Entry id.
 *     - Hub-Activity-YYYY-MM-DD-HHmm.json — that night's lines exactly as stored.
 *   Only lines since the last good run are copied (Script Property
 *   ACTIVITY_BACKUP_CURSOR_MS); lines from the last ten minutes wait for tomorrow. A
 *   failed run emails and the next one carries on from the same place. Unlike the
 *   backups above nothing is deleted after a year: the log is the record. It holds
 *   people's names and what they did, so keep the folder private. Same service
 *   account and Datastore Viewer grant as the project tracker's backup;
 *   checkActivityBackup() says whether it can read. Independent of the others.
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
// tracker's backup, then the project tracker's, then Asks, then the hub's activity
// log, each failing on its own.
function dailyBackup() {
  // Each half reports its own failure; these catch what escapes that (a
  // failure email that itself can't be sent), so one never stops the other.
  try { equipmentBackup_(); } catch (err) { console.error('Demo tracker backup stopped:', err.toString()); }
  try { trackerJsonBackup_(); } catch (err) { console.error('Demo tracker JSON backup stopped:', err.toString()); }
  try { projectsBackup_(); } catch (err) { console.error('Project tracker backup stopped:', err.toString()); }
  try { asksBackup_(); } catch (err) { console.error('Asks backup stopped:', err.toString()); }
  try { activityBackup_(); } catch (err) { console.error('Activity log backup stopped:', err.toString()); }
}

function equipmentBackup_() {
  try {
    // 1. Fetch from Firebase — /data.json (equipment + history + loanMeta,
    // one document) plus the two separate top-level nodes it doesn't cover.
    // After step 5's cutover, the same from the hub's Firestore (see below).
    const fsTree      = trackerOnFirestore_() ? trackerTreeFromFirestore_() : null;
    const data        = fsTree ? fsTree.data : (JSON.parse(firebaseGet_('/data.json').getContentText()) || {});
    const equipment   = Array.isArray(data.equipment) ? data.equipment : [];
    const history     = Array.isArray(data.history)   ? data.history   : [];
    const loanMeta    = (data.loanMeta && typeof data.loanMeta === 'object') ? data.loanMeta : {};
    const loanDocsRaw = fsTree ? fsTree.loanDocs : (JSON.parse(firebaseGet_('/loanDocs.json').getContentText()) || {});
    const upcomingRaw = fsTree ? fsTree.upcomingLoans : (JSON.parse(firebaseGet_('/upcomingLoans.json').getContentText()) || {});

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

    reportJob_('backup-equipment', true, 'Backup written: ' + equipment.length + ' items, ' + history.length + ' history records');
    console.log('Backup complete' + (fsTree ? ' (from Firestore)' : '') + ': ' + fileName + ' (' + equipment.length + ' items, ' + history.length +
      ' history records, ' + currentLoanItems.length + ' on-loan items, ' + upcomingList.length + ' upcoming loans)');

  } catch (err) {
    reportJob_('backup-equipment', false, err.toString());
    console.error('Backup failed:', err.toString());
    MailApp.sendEmail(
      NOTIFY_EMAIL,
      'CHS Equipment Backup Failed - ' + new Date().toDateString(),
      'The daily backup failed.\n\nError: ' + err.toString() + '\n\nPlease check the Apps Script logs.'
    );
  }
}

// ── The demo tracker's whole database, as JSON ─────────────────────────────
// See "THE WHOLE TRACKER DATABASE TOO" at the top. Only counts go to the log.

const TRACKER_JSON_PREFIX = 'Demo-Tracker-';
const TEST_REPORTS_FOLDER_NAME = 'Test report files';
const TEST_REPORT_FILES = 'testReportFiles';

// The database's top-level paths (data, upcomingLoans, loanDocs…), without
// their contents.
function trackerPaths_() {
  const resp = firebaseGet_('/.json?shallow=true');
  if (resp.getResponseCode() !== 200) throw new Error('Could not list the tracker database (' + resp.getResponseCode() + ')');
  return Object.keys(JSON.parse(resp.getContentText()) || {});
}

function trackerRead_(path) {
  const resp = firebaseGet_('/' + path + '.json');
  if (resp.getResponseCode() !== 200) throw new Error('Could not read ' + path + ' (' + resp.getResponseCode() + ')');
  return JSON.parse(resp.getContentText());
}

function trackerJsonBackup_() {
  try {
    const folders = DriveApp.getFoldersByName(BACKUP_FOLDER_NAME);
    const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(BACKUP_FOLDER_NAME);
    const sub     = folder.getFoldersByName(TEST_REPORTS_FOLDER_NAME);
    const reportFolder = sub.hasNext() ? sub.next() : folder.createFolder(TEST_REPORTS_FOLDER_NAME);
    const stamp   = Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM-dd');
    const name    = TRACKER_JSON_PREFIX + stamp + '.json';

    // 1. Every path, read one at a time (each read and the file stay well
    //    under Apps Script's 50 MB limits), written as the database's own tree.
    //    After step 5's cutover: the tracker's part from Firestore, as the same
    //    tree, and what stays in the old database (the team list, config) from there.
    const onFs = trackerOnFirestore_();
    const tree = onFs ? trackerTreeFromFirestore_() : {};
    const paths = trackerPaths_().filter(function(p) { return p !== TEST_REPORT_FILES && !(p in tree); });
    paths.forEach(function(p) { tree[p] = trackerRead_(p); });
    folder.createFile(Utilities.newBlob(JSON.stringify(tree), 'application/json', name));

    // 2. Each uploaded test report once, the first night it exists, as
    //    <report key>--<file id>.txt holding exactly what the database holds
    //    (the file as a data: URL), so it goes back as it was. A test report
    //    never changes once uploaded, so one already saved is left alone.
    const have = {};
    const existing = reportFolder.getFiles();
    while (existing.hasNext()) have[existing.next().getName()] = true;
    let reports = 0, newReports = 0;
    if (onFs) {
      Object.keys(tree.testReports || {}).forEach(function(key) {
        Object.keys(tree.testReports[key]).forEach(function(id) {
          reports++;
          const fileName = (key + '--' + id).replace(/[\\/:*?"<>|]/g, '_') + '.txt';
          if (have[fileName]) return;
          const body = trackerFsReportFile_(key, id);
          if (typeof body !== 'string') return;
          reportFolder.createFile(Utilities.newBlob(body, 'text/plain', fileName));
          newReports++;
        });
      });
    }
    const listed = onFs ? null : firebaseGet_('/' + TEST_REPORT_FILES + '.json?shallow=true');
    const keys = listed && listed.getResponseCode() === 200 ? Object.keys(JSON.parse(listed.getContentText()) || {}) : [];
    keys.forEach(function(key) {
      const ids = firebaseGet_('/' + TEST_REPORT_FILES + '/' + encodeURIComponent(key) + '.json?shallow=true');
      Object.keys(JSON.parse(ids.getContentText()) || {}).forEach(function(id) {
        reports++;
        const fileName = (key + '--' + id).replace(/[\\/:*?"<>|]/g, '_') + '.txt';
        if (have[fileName]) return;
        const body = trackerRead_(TEST_REPORT_FILES + '/' + encodeURIComponent(key) + '/' + encodeURIComponent(id));
        if (typeof body !== 'string') return;
        reportFolder.createFile(Utilities.newBlob(body, 'text/plain', fileName));
        newReports++;
      });
    });

    // 3. Keep a year (the folder's other backups are kept a year too). The
    //    test report files are kept: they're the only copy outside the database.
    const files  = folder.getFiles();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    while (files.hasNext()) {
      const f = files.next();
      if (f.getName().indexOf(TRACKER_JSON_PREFIX) === 0 && f.getDateCreated() < cutoff) f.setTrashed(true);
    }

    reportJob_('backup-tracker', true, 'Backup written: ' + Object.keys(tree).length + ' paths');
    console.log('Demo tracker JSON backup complete' + (onFs ? ' (from Firestore)' : '') + ': ' + name + ' (' + Object.keys(tree).length + ' paths, ' +
      reports + ' test report files, ' + newReports + ' new)');
  } catch (err) {
    reportJob_('backup-tracker', false, err.toString());
    console.error('Demo tracker JSON backup failed:', err.toString());
    try {
      MailApp.sendEmail(NOTIFY_EMAIL, 'Demo Tracker JSON Backup Failed - ' + new Date().toDateString(),
        'The nightly copy of the demo tracker\'s whole database failed.\n\nError: ' + err.toString() +
        '\n\nRun checkTrackerJsonBackup() in the Apps Script editor to see why.');
    } catch (mailErr) { console.error('Could not send the failure email:', mailErr.toString()); }
  }
}

// Run from the editor: lists what the JSON backup would save, writes nothing.
function checkTrackerJsonBackup() {
  CacheService.getScriptCache().remove('rtdbAccessToken');
  try {
    if (trackerOnFirestore_()) {
      const t = trackerTreeFromFirestore_();
      Logger.log('READY — the tracker is on Firestore (the cutover is done) and the backup can read it: ' + t.data.equipment.length + ' items, ' +
        Object.keys(t.loanDocs).length + ' loan forms, ' + Object.keys(t.testReports).length + ' loans with test reports.');
    }
    const paths = trackerPaths_();
    Logger.log('READY — the JSON backup can read the tracker database: ' + paths.length + ' top-level paths (' + paths.join(', ') + ').');
  } catch (err) {
    Logger.log('NOT READY — ' + err.message + '. Run checkBackupDatabaseAuth() to check the service account.');
  }
}

// Run from the editor to take the JSON backup now.
function trackerJsonBackupNow() {
  trackerJsonBackup_();
}

// ── After step 5's cutover: the tracker's data from Firestore ───────────────
// settings/equipmentCutover in the hub's Firestore says where the tracker's
// data is (the same switch the tracker and the proxy follow). Until it says
// 'firestore', both backups above read the old database as they always have.
// After, they read the hub's Firestore (the shapes are cmchs-internal-hub
// apps/equipment/src/fs-shape.js's) and turn it back into the old database's
// tree, so the spreadsheet is the same and the JSON file is one
// backend/tracker-migration/migrate.mjs can put back (--from <file> --reports
// <folder>). Same service account and IAM grant as the project tracker's backup.

const DATASTORE_SCOPE = 'https://www.googleapis.com/auth/datastore';
let trackerOnFs_ = null; // once per run

function trackerOnFirestore_() {
  if (trackerOnFs_ !== null) return trackerOnFs_;
  const token = serviceAccountToken_(DATASTORE_SCOPE, 'firestoreAccessToken');
  if (!token) { trackerOnFs_ = false; return false; } // no key: only the old database can be read anyway
  const resp = UrlFetchApp.fetch(trackerFsBase_() + 'settings/equipmentCutover', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  const code = resp.getResponseCode();
  // A switch that can't be read stops the backup (it emails) rather than quietly copying a database that's no longer used.
  if (code !== 200 && code !== 404) throw new Error('Could not read the tracker\'s cutover switch (' + code + ')');
  trackerOnFs_ = code === 200 && fsFields_(JSON.parse(resp.getContentText()).fields).source === 'firestore';
  return trackerOnFs_;
}

function trackerFsBase_() { return 'https://firestore.googleapis.com/v1/projects/' + scheduleProjectId_() + '/databases/(default)/documents/'; }

// Arrays inside arrays are kept as { _a: [...] } (Firestore can't nest them).
function fsUnpack_(v) {
  if (Array.isArray(v)) return v.map(function(x) { return (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && Array.isArray(x._a)) ? fsUnpack_(x._a) : fsUnpack_(x); });
  if (v && typeof v === 'object') { const o = {}; Object.keys(v).forEach(function(k) { o[k] = fsUnpack_(v[k]); }); return o; }
  return v;
}

// A list kept one document per entry, back in its order (_pos), without _pos.
function trackerList_(docs) {
  return Object.keys(docs).map(function(id) { return fsUnpack_(docs[id]); })
    .sort(function(a, b) { return (a._pos || 0) - (b._pos || 0); })
    .map(function(e) { delete e._pos; return e; });
}

/**
 * The tracker's data from Firestore, as the old database's tree: data
 * (equipment, history, loanMeta), loanDocs, upcomingLoans, retired, kitGroups,
 * customDemoTypes, simproConfig, auditLog, testReports (each report's details;
 * the files are read one at a time by trackerFsReportFile_).
 */
function trackerTreeFromFirestore_() {
  const token = serviceAccountToken_(DATASTORE_SCOPE, 'firestoreAccessToken');
  if (!token) throw new Error('No service account token: set FIREBASE_SERVICE_ACCOUNT_KEY.');
  const loans = readCollection_(token, 'loans');
  const loanMeta = {}, loanDocs = {}, upcomingLoans = {};
  Object.keys(loans).sort().forEach(function(key) {
    const l = fsUnpack_(loans[key]);
    if (l.meta) loanMeta[key] = l.meta;
    if (l.form) loanDocs[key] = l.form;
    if (l.booking) upcomingLoans[l.booking.id || key] = l.booking;
  });
  const kits = readCollection_(token, 'equipmentKits');
  Object.keys(kits).forEach(function(k) { kits[k] = fsUnpack_(kits[k]); });
  const settingsResp = UrlFetchApp.fetch(trackerFsBase_() + 'settings/equipment', { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (settingsResp.getResponseCode() !== 200 && settingsResp.getResponseCode() !== 404) throw new Error('Firestore refused to read the tracker\'s settings (' + settingsResp.getResponseCode() + ')');
  const settings = settingsResp.getResponseCode() === 200 ? fsUnpack_(fsFields_(JSON.parse(settingsResp.getContentText()).fields)) : {};
  const audit = readCollection_(token, 'equipmentAudit');
  Object.keys(audit).forEach(function(k) { audit[k] = fsUnpack_(audit[k]); });

  // Every loan's test reports' details: one query over all of them.
  const testReports = {};
  const resp = UrlFetchApp.fetch(trackerFsBase_().replace(/\/$/, '') + ':runQuery', {
    method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
    payload: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'reports', allDescendants: true }] } })
  });
  if (resp.getResponseCode() !== 200) throw new Error('Firestore refused to list the test reports (' + resp.getResponseCode() + ')');
  JSON.parse(resp.getContentText()).forEach(function(r) {
    if (!r.document) return;
    const m = r.document.name.match(/\/documents\/loans\/([^/]+)\/reports\/([^/]+)$/);
    if (!m) return; // another tool's "reports"
    const meta = fsFields_(r.document.fields);
    delete meta.chunks;
    (testReports[m[1]] = testReports[m[1]] || {})[m[2]] = meta;
  });

  return {
    data: { equipment: trackerList_(readCollection_(token, 'equipment')), history: trackerList_(readCollection_(token, 'equipmentHistory')), loanMeta: loanMeta },
    loanDocs: loanDocs, upcomingLoans: upcomingLoans,
    retired: trackerList_(readCollection_(token, 'retiredEquipment')),
    kitGroups: kits, customDemoTypes: settings.demoTypes || [], simproConfig: settings.simproConfig || {},
    auditLog: audit, testReports: testReports
  };
}

/** One test report's file (the data: URL it was uploaded as) from its chunks, or null if it didn't finish uploading. */
function trackerFsReportFile_(key, id) {
  const token = serviceAccountToken_(DATASTORE_SCOPE, 'firestoreAccessToken');
  const path = 'loans/' + encodeURIComponent(key) + '/reports/' + encodeURIComponent(id);
  const metaResp = UrlFetchApp.fetch(trackerFsBase_() + path, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (metaResp.getResponseCode() !== 200) return null;
  const want = fsFields_(JSON.parse(metaResp.getContentText()).fields).chunks;
  const parts = [];
  let pageToken = '';
  do {
    const resp = UrlFetchApp.fetch(trackerFsBase_() + path + '/chunks?pageSize=20' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''),
      { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) throw new Error('Firestore refused to read a test report (' + resp.getResponseCode() + ')');
    const json = JSON.parse(resp.getContentText());
    (json.documents || []).forEach(function(d) { parts.push([Number(d.name.split('/').pop()), fsFields_(d.fields).data]); });
    pageToken = json.nextPageToken || '';
  } while (pageToken);
  if (parts.length !== want) return null;
  return parts.sort(function(a, b) { return a[0] - b[0]; }).map(function(p) { return p[1]; }).join('');
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

    reportJob_('backup-projects', true, 'Backup written: ' + jobs.length + ' jobs, ' + weeks.length + ' staff weeks');
    console.log('Project tracker backup complete: ' + name + ' (' + jobs.length + ' jobs, ' + weeks.length + ' staff weeks, ' +
      Object.keys(c.projectComments).length + ' comments, ' + Object.keys(c.projectHistory).length + ' history entries)');
  } catch (err) {
    reportJob_('backup-projects', false, err.toString());
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
  checkTrackerJsonBackup();
  checkProjectsBackup();
  checkAsksBackup();
  checkActivityBackup();
}

// ── Asks backup ──────────────────────────────────────────────────────────────
// See "ASKS TOO" at the top. Only counts go to the log, never names.

const ASKS_FOLDER_NAME = 'CMCHS Asks Backups';
const ASKS_PHOTOS_FOLDER_NAME = 'Photos';

// Every ask with its comments, and the counts copy. Photos come back as a
// list ({ askId, id, ...fields }, data included) for asksBackup_ to file
// separately. Comments and photos are only read for asks whose counts say
// they have some, so a quiet ask costs one read, not three.
function readAsks_() {
  const token = serviceAccountToken_('https://www.googleapis.com/auth/datastore', 'firestoreAccessToken');
  if (!token) throw new Error('No service account token: set FIREBASE_SERVICE_ACCOUNT_KEY.');
  const asks = readCollection_(token, 'asks');
  const askStats = readCollection_(token, 'askStats');
  const comments = {};
  const photos = [];
  Object.keys(asks).forEach(function(id) {
    const a = asks[id];
    if (a.commentCount > 0) {
      const c = readCollection_(token, 'asks/' + id + '/comments');
      if (Object.keys(c).length) comments[id] = c;
    }
    if (a.photoCount > 0) {
      const p = readCollection_(token, 'asks/' + id + '/photos');
      Object.keys(p).forEach(function(pid) { photos.push(Object.assign({ askId: id, id: pid }, p[pid])); });
    }
  });
  return { asks: asks, askStats: askStats, comments: comments, photos: photos };
}

function asksBackup_() {
  try {
    const r = readAsks_();
    const folders = DriveApp.getFoldersByName(ASKS_FOLDER_NAME);
    const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(ASKS_FOLDER_NAME);
    const sub     = folder.getFoldersByName(ASKS_PHOTOS_FOLDER_NAME);
    const photoFolder = sub.hasNext() ? sub.next() : folder.createFolder(ASKS_PHOTOS_FOLDER_NAME);
    const stamp   = Utilities.formatDate(new Date(), 'Pacific/Auckland', 'yyyy-MM-dd');
    const name    = 'Asks-' + stamp;

    // 1. Each photo once, as a JPEG named <askId>-<photoId>.jpg. A photo never
    //    changes once taken, so one already in the folder is left alone.
    const have = {};
    const existing = photoFolder.getFiles();
    while (existing.hasNext()) have[existing.next().getName()] = true;
    let newPhotos = 0;
    r.photos.forEach(function(p) {
      const file = p.askId + '-' + p.id + '.jpg';
      if (have[file]) return;
      const m = /^data:image\/jpeg;base64,(.+)$/.exec(String(p.data || ''));
      if (!m) return;
      photoFolder.createFile(Utilities.newBlob(Utilities.base64Decode(m[1]), 'image/jpeg', file));
      have[file] = true;
      newPhotos++;
    });

    // 2. Everything else exactly as stored. Photos are listed without their
    //    data, with the file in Photos that holds each one.
    const backup = {
      kind: 'asks-backup',
      version: 1,
      takenAt: new Date().toISOString(),
      source: 'nightly',
      collections: { asks: r.asks, askStats: r.askStats },
      comments: r.comments,
      photos: r.photos.map(function(p) {
        const out = {};
        Object.keys(p).forEach(function(k) { if (k !== 'data') out[k] = p[k]; });
        out.file = ASKS_PHOTOS_FOLDER_NAME + '/' + p.askId + '-' + p.id + '.jpg';
        return out;
      })
    };
    folder.createFile(Utilities.newBlob(JSON.stringify(backup), 'application/json', name + '.json'));

    // 3. A spreadsheet to read without the tool
    const token = serviceAccountToken_('https://www.googleapis.com/auth/datastore', 'firestoreAccessToken');
    const users = readCollection_(token, 'users');
    const nameOf = function(uid) { return (users[uid] && users[uid].displayName) || '?'; };
    const day = function(ms) { return ms ? Utilities.formatDate(new Date(ms), 'Pacific/Auckland', 'yyyy-MM-dd') : ''; };
    const STATUS = { open: 'Open', picked: 'Picked up', waiting: 'Waiting', done: 'Done' };
    const list = Object.keys(r.asks).map(function(id) { return r.asks[id]; })
      .sort(function(a, b) { return (b.createdAtMs || 0) - (a.createdAtMs || 0); });
    const rows = [['Asked', 'What', 'Asked by', 'Sent to', 'Status', 'Who has it', 'Waiting on', 'Due', 'Urgent', 'Done', 'Comments', 'Photos', 'Details']]
      .concat(list.map(function(a) {
        const sentTo = (a.assignees || []).map(nameOf).concat((a.teams || []).map(function(t) { return t + ' team'; })).join(', ');
        return [day(a.createdAtMs), a.title || '', a.createdByName || '', sentTo, STATUS[a.status] || a.status || '', a.ownerName || '',
          a.waitingOn || '', a.due || '', a.urgent ? 'Yes' : '', day(a.doneAtMs), a.commentCount || 0, a.photoCount || 0, a.details || ''];
      }));
    const ss = SpreadsheetApp.create('_temp_asks_backup');
    const sheet = ss.getActiveSheet();
    sheet.setName('Asks');
    writeSheetRows_(sheet, rows, rows[0].length);
    SpreadsheetApp.flush();
    const blob = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }).getBlob().setName(name + '.xlsx');
    folder.createFile(blob);
    DriveApp.getFileById(ss.getId()).setTrashed(true);

    // 4. Keep a year of nightly files. A photo goes only once its ask has been
    //    deleted and the photo is over a year old, so a live ask's photos stay.
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 365);
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      if (f.getDateCreated() < cutoff) f.setTrashed(true);
    }
    const pics = photoFolder.getFiles();
    while (pics.hasNext()) {
      const f = pics.next();
      if (f.getDateCreated() < cutoff && !r.asks[f.getName().split('-')[0]]) f.setTrashed(true);
    }

    const commentCount = Object.keys(r.comments).reduce(function(n, id) { return n + Object.keys(r.comments[id]).length; }, 0);
    reportJob_('backup-asks', true, 'Backup written: ' + list.length + ' asks, ' + commentCount + ' comments');
    console.log('Asks backup complete: ' + name + ' (' + list.length + ' asks, ' + commentCount + ' comments, ' +
      r.photos.length + ' photos, ' + newPhotos + ' new)');
  } catch (err) {
    reportJob_('backup-asks', false, err.toString());
    console.error('Asks backup failed:', err.toString());
    try {
      MailApp.sendEmail(NOTIFY_EMAIL, 'Asks Backup Failed - ' + new Date().toDateString(),
        'The nightly Asks backup failed.\n\nError: ' + err.toString() + '\n\nRun checkAsksBackup() in the Apps Script editor to see why.');
    } catch (mailErr) { console.error('Could not send the failure email:', mailErr.toString()); }
  }
}

// Run from the editor: reads Asks and logs counts, writes nothing.
function checkAsksBackup() {
  CacheService.getScriptCache().remove('firestoreAccessToken');
  try {
    const r = readAsks_();
    const comments = Object.keys(r.comments).reduce(function(n, id) { return n + Object.keys(r.comments[id]).length; }, 0);
    Logger.log('READY — the Asks backup can read: ' + Object.keys(r.asks).length + ' asks, ' + Object.keys(r.askStats).length +
      ' askStats, ' + comments + ' comments, ' + r.photos.length + ' photos.');
  } catch (err) {
    Logger.log('NOT READY — ' + String(err.message).replace(/\.+$/, '') + '. Same fix as checkProjectsBackup(): it uses the same service account.');
  }
}

// Run from the editor to take an Asks backup now.
function asksBackupNow() {
  asksBackup_();
}

// ── Hub activity log backup ──────────────────────────────────────────────────
// See "THE HUB ACTIVITY LOG TOO" at the top. Only counts go to the log, never names.

const ACTIVITY_FOLDER_NAME = 'CMCHS Hub Activity Log Backups';
// Script Property: the time (ms) up to which lines are already in Drive. Absent = nothing yet, so the first run takes them all.
const ACTIVITY_CURSOR_PROP = 'ACTIVITY_BACKUP_CURSOR_MS';
// Lines this recent are left for tomorrow: a phone that was offline can send a line a few minutes late.
const ACTIVITY_SETTLE_MS = 10 * 60 * 1000;
const ACTIVITY_PAGE = 1000;
const ACTIVITY_HEADERS = ['When (NZ)', 'Who', 'Email', 'Tool', 'What', 'Entry id'];
// Same names as shared/activity-core.js APP_LABELS. A tool not listed shows as its own key.
const ACTIVITY_TOOLS = {
  hub: 'Hub', schedule: 'Schedule', oncall: 'On call', maintenance: 'Maintenance', 'service-orders': 'Service orders',
  equipment: 'Equipment', projects: 'Projects', asks: 'Asks', checklists: 'Checklists', admin: 'Admin',
  settings: 'Settings', 'pdf-editor': 'PDF editor', simprosync: 'SimproSync', ansurtopdf: 'Ansur'
};

// Lines with fromMs <= at < toMs, oldest first: [{ id, uid, name, email, app, summary, atMs }]. Throws if Firestore refuses.
function readActivity_(token, fromMs, toMs) {
  const url = 'https://firestore.googleapis.com/v1/projects/' + scheduleProjectId_() + '/databases/(default)/documents:runQuery';
  const at = function(op, ms) {
    return { fieldFilter: { field: { fieldPath: 'at' }, op: op, value: { timestampValue: new Date(ms).toISOString() } } };
  };
  const out = [];
  for (let offset = 0; ; offset += ACTIVITY_PAGE) {
    const resp = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true,
      payload: JSON.stringify({ structuredQuery: {
        from: [{ collectionId: 'activity' }],
        where: { compositeFilter: { op: 'AND', filters: [at('GREATER_THAN_OR_EQUAL', fromMs), at('LESS_THAN', toMs)] } },
        orderBy: [{ field: { fieldPath: 'at' }, direction: 'ASCENDING' }],
        limit: ACTIVITY_PAGE, offset: offset
      } })
    });
    const code = resp.getResponseCode();
    if (code !== 200) throw new Error('Firestore refused to read activity (' + code + ')');
    const docs = JSON.parse(resp.getContentText()).filter(function(r) { return r.document; });
    docs.forEach(function(r) {
      const d = fsFields_(r.document.fields);
      out.push({ id: r.document.name.split('/').pop(), uid: d.uid || '', name: d.name || '', email: d.email || '', app: d.app || 'schedule',
        summary: d.summary || '', atMs: Date.parse(d.at) || 0 });
    });
    if (docs.length < ACTIVITY_PAGE) return out;
  }
}

// A cell as text: the log holds what people typed, and a value starting with = + - @ would be run as a formula.
function activityCell_(v) {
  const s = String(v == null ? '' : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// One spreadsheet row per line, in the order given.
function activityRows_(entries, tz) {
  return entries.map(function(e) {
    return [Utilities.formatDate(new Date(e.atMs), tz, 'yyyy-MM-dd HH:mm'), activityCell_(e.name), activityCell_(e.email),
      ACTIVITY_TOOLS[e.app || 'schedule'] || e.app, activityCell_(e.summary), e.id];
  });
}

// { 'yyyy-MM': [lines…] } by the month in New Zealand, each oldest first.
function activityByMonth_(entries, tz) {
  const months = {};
  entries.forEach(function(e) {
    const m = Utilities.formatDate(new Date(e.atMs), tz, 'yyyy-MM');
    (months[m] = months[m] || []).push(e);
  });
  return months;
}

// Appends this month's lines to its spreadsheet in the folder, making it (with its header) the first time.
function activityAppendMonth_(folder, month, entries, tz) {
  const name = 'Hub activity log ' + month;
  const found = folder.getFilesByName(name);
  let ss;
  if (found.hasNext()) {
    ss = SpreadsheetApp.openById(found.next().getId());
  } else {
    ss = SpreadsheetApp.create(name);
    DriveApp.getFileById(ss.getId()).moveTo(folder);
    const sheet = ss.getActiveSheet();
    sheet.setName('Activity');
    writeSheetRows_(sheet, [ACTIVITY_HEADERS], ACTIVITY_HEADERS.length);
    sheet.setColumnWidths(1, 1, 130); sheet.setColumnWidths(2, 2, 170); sheet.setColumnWidth(4, 110); sheet.setColumnWidth(5, 520);
  }
  const sheet = ss.getSheets()[0];
  const rows = activityRows_(entries, tz);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, ACTIVITY_HEADERS.length).setValues(rows);
}

// Copies the lines since the last run to Drive: a spreadsheet a month to read, and a JSON file a night to restore from.
// Returns the number of lines copied. The log is kept for good: nothing here is deleted after a year.
function activityBackup_() {
  try {
    const props = PropertiesService.getScriptProperties();
    const token = serviceAccountToken_('https://www.googleapis.com/auth/datastore', 'firestoreAccessToken');
    if (!token) throw new Error('No service account token: set FIREBASE_SERVICE_ACCOUNT_KEY.');
    const tz = 'Pacific/Auckland';
    const fromMs = Number(props.getProperty(ACTIVITY_CURSOR_PROP)) || 0;
    const toMs = Date.now() - ACTIVITY_SETTLE_MS;
    const entries = readActivity_(token, fromMs, toMs);
    if (!entries.length) {
      props.setProperty(ACTIVITY_CURSOR_PROP, String(toMs));
      reportJob_('backup-activity', true, 'No new lines');
      console.log('Activity log backup: no new lines.');
      return 0;
    }
    const folders = DriveApp.getFoldersByName(ACTIVITY_FOLDER_NAME);
    const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(ACTIVITY_FOLDER_NAME);

    // 1. The restore file: these lines exactly as stored
    const stamp = Utilities.formatDate(new Date(toMs), tz, 'yyyy-MM-dd-HHmm');
    folder.createFile(Utilities.newBlob(JSON.stringify({
      kind: 'hub-activity-backup', version: 1, takenAt: new Date().toISOString(),
      from: fromMs ? new Date(fromMs).toISOString() : null, to: new Date(toMs).toISOString(),
      entries: entries.map(function(e) { return { id: e.id, at: new Date(e.atMs).toISOString(), uid: e.uid, name: e.name, email: e.email, app: e.app, summary: e.summary }; })
    }), 'application/json', 'Hub-Activity-' + stamp + '.json'));

    // 2. A spreadsheet a month to read without the hub
    const months = activityByMonth_(entries, tz);
    Object.keys(months).sort().forEach(function(m) { activityAppendMonth_(folder, m, months[m], tz); });

    // Only now, with both written, is the cursor moved: a failure above is retried from the same place tomorrow.
    props.setProperty(ACTIVITY_CURSOR_PROP, String(toMs));
    reportJob_('backup-activity', true, entries.length + ' new lines backed up');
    console.log('Activity log backup complete: ' + entries.length + ' new line' + (entries.length === 1 ? '' : 's') + ' in ' + Object.keys(months).length + ' month' + (Object.keys(months).length === 1 ? '' : 's') + '.');
    return entries.length;
  } catch (err) {
    reportJob_('backup-activity', false, err.toString());
    console.error('Activity log backup failed:', err.toString());
    try {
      MailApp.sendEmail(NOTIFY_EMAIL, 'Hub Activity Log Backup Failed - ' + new Date().toDateString(),
        'The nightly backup of the hub activity log failed.\n\nError: ' + err.toString() + '\n\nRun checkActivityBackup() in the Apps Script editor to see why. Nothing is lost: the next run starts from where the last good one stopped.');
    } catch (mailErr) { console.error('Could not send the failure email:', mailErr.toString()); }
    return -1;
  }
}

// Run from the editor: reads the log and says how much is waiting to be copied, writes nothing.
function checkActivityBackup() {
  CacheService.getScriptCache().remove('firestoreAccessToken');
  try {
    const token = serviceAccountToken_('https://www.googleapis.com/auth/datastore', 'firestoreAccessToken');
    if (!token) throw new Error('No service account token: set FIREBASE_SERVICE_ACCOUNT_KEY.');
    const from = Number(PropertiesService.getScriptProperties().getProperty(ACTIVITY_CURSOR_PROP)) || 0;
    const waiting = readActivity_(token, from, Date.now() - ACTIVITY_SETTLE_MS).length;
    Logger.log('READY — the activity log backup can read the log: ' + waiting + ' line' + (waiting === 1 ? '' : 's') + ' waiting to be copied' +
      (from ? ' (copied up to ' + Utilities.formatDate(new Date(from), 'Pacific/Auckland', 'yyyy-MM-dd HH:mm') + ').' : ' (nothing copied yet).'));
  } catch (err) {
    const why = String(err.message).replace(/\.+$/, '');
    Logger.log('NOT READY — ' + why + '. ' + (/\(40[13]\)/.test(why)
      ? 'Grant the service account "Cloud Datastore Viewer" in the staff schedule project\'s Google Cloud IAM (the same grant as checkProjectsBackup).'
      : 'Same fix as checkProjectsBackup(): it uses the same service account.'));
  }
}

// Run from the editor to copy the log to Drive now.
function activityBackupNow() {
  activityBackup_();
}

// Run from the editor only to copy the whole log again from the start (after deleting the Drive folder): forgets how far it got.
function resetActivityBackup() {
  PropertiesService.getScriptProperties().deleteProperty(ACTIVITY_CURSOR_PROP);
  Logger.log('The next activity log backup copies everything from the beginning. Delete the "' + ACTIVITY_FOLDER_NAME + '" folder first, or its spreadsheets get every line twice.');
}

// Run once from the Apps Script editor to install the daily trigger.
// Deletes any prior trigger with the same handler first, same pattern
// ../proxy/Code.js's installers use, so re-running this is always safe.
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
    // '&' when the path already has a query (?shallow=true).
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    const signed = UrlFetchApp.fetch(url + sep + 'access_token=' + encodeURIComponent(token), { muteHttpExceptions: true });
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

// ── Background jobs page ─────────────────────────────────────────────────────
// Settings → Background jobs (internal.chsnz.co.nz/settings/jobs) shows how each
// timed job last went. Each writes one document, jobRuns/{id}, when it finishes
// (the list is shared/jobs.js in the hub repo). Counts and plain words only,
// never names or emails. Never throws: a job that worked must not fail because
// this could not be written.
function jobStatusToken_() { return serviceAccountToken_('https://www.googleapis.com/auth/datastore', 'firestoreAccessToken'); }

function cleanJobMessage_(message) {
  return String(message === undefined || message === null ? '' : message)
    .replace(/[^\s@]+@[^\s@]+/g, '…')
    .replace(/\s+/g, ' ').trim().slice(0, 300);
}

function reportJob_(id, ok, message) {
  try {
    const token = jobStatusToken_();
    if (!token) return;
    const url = 'https://firestore.googleapis.com/v1/projects/' + scheduleProjectId_() + '/databases/(default)/documents/jobRuns/' + encodeURIComponent(id);
    const headers = { Authorization: 'Bearer ' + token };
    const now = String(Date.now());
    const text = cleanJobMessage_(message);
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
