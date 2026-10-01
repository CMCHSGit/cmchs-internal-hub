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

function dailyBackup() {
  try {
    // 1. Fetch from Firebase — /data.json (equipment + history + loanMeta,
    // one document) plus the two separate top-level nodes it doesn't cover.
    const data        = JSON.parse(UrlFetchApp.fetch(FIREBASE_URL).getContentText()) || {};
    const equipment   = Array.isArray(data.equipment) ? data.equipment : [];
    const history     = Array.isArray(data.history)   ? data.history   : [];
    const loanMeta    = (data.loanMeta && typeof data.loanMeta === 'object') ? data.loanMeta : {};
    const loanDocsRaw = JSON.parse(UrlFetchApp.fetch(FIREBASE_BASE + '/loanDocs.json').getContentText()) || {};
    const upcomingRaw = JSON.parse(UrlFetchApp.fetch(FIREBASE_BASE + '/upcomingLoans.json').getContentText()) || {};

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
