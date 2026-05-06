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
 */

// ── Configuration ─────────────────────────────────────────────────────────────
const SIMPRO_BASE_URL = 'https://cass.simprosuite.com/api/v1.0';
const SIMPRO_API_KEY  = '6d8d1fb9a7ae1d802e17bf52c50c9f97ab7bd678';
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