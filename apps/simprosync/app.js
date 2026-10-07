/* ---------- Simpro Asset Sync - page logic ----------
   Started by main.js once an admin has signed in. Every Simpro call goes
   through main.js's transport(), which relays it via chs-equipment's Apps
   Script proxy - this file never sees a Simpro key. */
import { XLSXLite } from './reader.js';
import { SyncCore } from './core.js';

export function startApp({ transport, who }) {
  const DEFAULT_COMPANY = 3, DEFAULT_TYPE = 114;
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } }
  };

  const WHO = who;
  let book = null, fileName = '', plan = null, logLines = [];
  let busy = false;
  let assetTypes = []; // [{ID, Name}] from Simpro, for the selected company
  let warrantySerials = new Set(); // serials with "Extended Warranty" = Yes, across ticked sheets
  let warrantyColumnFound = false; // whether the ticked sheets have an Extended Warranty column at all
  let warrantyValuesSeen = new Set(); // distinct values in that column, to explain a zero match

  /* ---------- logging & progress ---------- */
  function log(msg) { logLines.push(msg); $('log').textContent = logLines.join('\n'); }
  function progress(text, done, total) {
    $('progress').hidden = false;
    $('progText').textContent = text;
    $('progBar').style.width = total ? Math.round(100 * done / total) + '%' : '100%';
    $('progBar').classList.toggle('indeterminate', !total);
  }
  function progressDone() { $('progress').hidden = true; }
  function setBusy(b) { busy = b; document.body.classList.toggle('busy', b); updateButtons(); }
  function showError(msg) { const el = $('error'); el.textContent = msg; el.hidden = !msg; }

  /* ---------- API ---------- */
  async function call(method, path, body) {
    for (let a = 0; a < 4; a++) {
      let r;
      try {
        r = await transport(method, path, body);
      } catch (e) {
        // Logged permanently - a call that's silently retrying with
        // multi-second backoff sleeps looks like "it's just slow" from the
        // UI alone, so this is the first thing worth checking on any future
        // slowdown report.
        console.warn('[simproSync] call() retry', a + 1, 'of 4 -', method, path, '-', e.message);
        if (a < 3) { await sleep(2000 * (a + 1)); continue; }
        return { status: 0, data: 'Network error: ' + e.message };
      }
      if ((r.status === 429 || r.status >= 500) && a < 3) {
        console.warn('[simproSync] call() retry', a + 1, 'of 4 -', method, path, '- status', r.status);
        await sleep(4000 * (a + 1)); continue;
      }
      return r;
    }
  }
  const brief = d => (typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400);
  async function getAll(path) {
    let out = [], page = 1; const sep = path.includes('?') ? '&' : '?';
    for (;;) {
      const { status, data } = await call('GET', `${path}${sep}pageSize=250&page=${page}`);
      if (status !== 200) throw new Error(`Simpro request failed (${status}) for ${path}: ${brief(data)}`);
      out = out.concat(data);
      if (data.length < 250) return out;
      page++;
    }
  }
  async function pool(items, n, fn, onTick) {
    let i = 0, done = 0; const res = new Array(items.length);
    async function worker() { while (i < items.length) { const k = i++; res[k] = await fn(items[k], k); done++; onTick && onTick(done, items.length); } }
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
    return res;
  }

  /* ---------- setup lists ---------- */
  async function loadSetup() {
    try {
      const { status, data } = await call('GET', '/companies/');
      if (status === 401 || status === 403) throw new Error('Simpro rejected the request (' + status + '). Ask an admin to check the SIMPRO_API_KEY script property on the proxy.');
      if (status !== 200) throw new Error('Could not reach Simpro (' + status + '): ' + brief(data));
      const savedC = +(store.get('simproSync.company') || DEFAULT_COMPANY);
      $('company').innerHTML = data.filter(c => !/do not use/i.test(c.Name)).map(c => `<option value="${c.ID}" ${c.ID === savedC ? 'selected' : ''}>${esc(c.Name)}</option>`).join('');
      await loadTypes();
    } catch (e) { showError(e.message); }
  }
  async function loadTypes() {
    const cid = $('company').value;
    assetTypes = await getAll(`/companies/${cid}/setup/assetTypes/`);
    assetTypes.sort((a, b) => a.Name.localeCompare(b.Name));
    renderSheetRows(); // re-populate every sheet row's type options for the (possibly new) company
    $('delType').innerHTML = '<option value="">Choose…</option>' + assetTypeOptionsHtml('');
    preModels = null; renderPreModels(); resetDelete();
  }
  $('company').onchange = () => { store.set('simproSync.company', $('company').value); resetResults(); loadTypes().catch(e => showError(e.message)); };

  // the "IT" sheet goes in as "Mindray IT"; everything else defaults to "Mindray"
  function defaultTypeIdForSheet(sheetName) {
    const want = /^\s*IT\s*$/i.test(sheetName || '') ? 'mindray it' : 'mindray';
    const t = assetTypes.find(t => t.Name.trim().toLowerCase() === want);
    if (t) return t.ID;
    const fallback = assetTypes.find(t => t.ID === DEFAULT_TYPE);
    return fallback ? fallback.ID : (assetTypes[0] ? assetTypes[0].ID : '');
  }
  function assetTypeOptionsHtml(selectedId) {
    return assetTypes.map(t => `<option value="${t.ID}" ${String(t.ID) === String(selectedId) ? 'selected' : ''}>${esc(t.Name.trim())}</option>`).join('');
  }

  /* ---------- sheet picker ----------
     One row per sheet in the workbook, each independently toggleable and
     independently typed - lets one upload sync e.g. "Monitors" as Mindray
     and "IT" as Mindray IT in a single run, instead of two separate ones. */
  function renderSheetRows() {
    const el = $('sheetPicker');
    if (!el) return;
    if (!book) { el.innerHTML = ''; return; }
    // Preserve each row's current checked/type state across a re-render
    // (e.g. triggered by a company change) rather than resetting it.
    const prior = {};
    el.querySelectorAll('.sheetrow').forEach(row => {
      prior[row.dataset.idx] = { checked: row.querySelector('.sheet-chk').checked, tid: row.querySelector('.sheet-type').value };
    });
    el.innerHTML = book.sheets.map((name, i) => {
      const p = prior[i];
      const checked = p ? p.checked : true;
      const tid = (p && p.tid) || defaultTypeIdForSheet(name);
      return `<div class="row sheetrow" data-idx="${i}" style="gap:8px;align-items:center;flex-wrap:nowrap">
        <label style="display:flex;align-items:center;gap:6px;min-width:0;flex:2;font-size:14px;color:var(--ink);cursor:pointer">
          <input type="checkbox" class="sheet-chk" ${checked ? 'checked' : ''}>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(name)}</span>
        </label>
        <select class="sheet-type" style="flex:1;min-width:140px">${assetTypeOptionsHtml(tid)}</select>
      </div>`;
    }).join('');
    el.querySelectorAll('.sheet-chk, .sheet-type').forEach(input => input.addEventListener('change', () => { resetResults(); updateButtons(); refreshWarrantyInfo(); }));
    updateButtons();
  }
  function getCheckedSheets() {
    if (!book) return [];
    return [...document.querySelectorAll('#sheetPicker .sheetrow')]
      .filter(row => row.querySelector('.sheet-chk').checked)
      .map(row => {
        const idx = +row.dataset.idx;
        const typeSel = row.querySelector('.sheet-type');
        return { idx, name: book.sheets[idx], tid: typeSel.value, typeName: typeSel.selectedOptions[0] ? typeSel.selectedOptions[0].textContent : '' };
      });
  }

  // Scans every ticked sheet for an "Extended Warranty" column and collects
  // the Serial Number of every row where it's "Yes". That set decides which
  // group each asset lands in within the job note - nothing is excluded by
  // it. Stays hidden, and assetListHtml() falls back to one flat list, if no
  // ticked sheet has the column at all.
  async function refreshWarrantyInfo() {
    const row = $('warrantyFilterRow'), countEl = $('warrantyCount');
    warrantySerials = new Set();
    warrantyValuesSeen = new Set();
    warrantyColumnFound = false;
    if (!book) { row.hidden = true; return; }
    let anyColumn = false;
    for (const sr of getCheckedSheets()) {
      // Ticked sheets aren't necessarily asset lists at all (e.g. a
      // "Reference"/"Networking" tab) - read defensively so one odd sheet
      // can't break the scan for the rest, or block the file loading at all.
      let header, recs;
      try { ({ header, recs } = SyncCore.toRecords(await book.rows(sr.idx))); }
      catch (e) { continue; }
      // header can contain holes (a header row with a skipped/blank cell is
      // a real gap in the array, not an empty string) - Array.find() visits
      // holes as undefined, unlike the map()/forEach() toRecords() itself
      // uses, so h must be guarded before calling .trim() on it.
      const warrantyKey = header.find(h => h && h.trim().toLowerCase() === 'extended warranty');
      if (!warrantyKey) continue;
      anyColumn = true;
      const serialKey = header.find(h => h && h.trim().toLowerCase() === SyncCore.MATCH_FIELD.toLowerCase());
      if (!serialKey) continue;
      recs.forEach(({ r }) => {
        const raw = SyncCore.asText(r[warrantyKey]).trim();
        if (raw) warrantyValuesSeen.add(raw);
        if (raw.toLowerCase() !== 'yes') return;
        const ser = SyncCore.asText(r[serialKey]).trim().toUpperCase();
        if (ser) warrantySerials.add(ser);
      });
    }
    warrantyColumnFound = anyColumn;
    row.hidden = !anyColumn;
    if (!anyColumn) return;
    // When nothing is marked Yes, say what the column actually contains -
    // "0 found" on its own gives no way to tell "none are on warranty" apart
    // from "the column says Y, not Yes".
    countEl.textContent = warrantySerials.size === 0 && warrantyValuesSeen.size
      ? `- nothing marked Yes (that column contains: ${[...warrantyValuesSeen].slice(0, 6).join(', ')})`
      : `- ${warrantySerials.size} item${warrantySerials.size === 1 ? '' : 's'} marked Yes`;
  }

  /* ---------- file ---------- */
  async function takeFile(f) {
    if (!f) return;
    if (!/\.(xlsx|xlsm|csv)$/i.test(f.name)) { showError('Choose an .xlsx or .csv asset list.'); return; }
    showError(''); resetResults();
    try {
      book = await XLSXLite.read(f); fileName = f.name;
      renderSheetRows();
      $('fileName').textContent = f.name;
      $('fileInfo').hidden = false; $('drop').classList.add('has-file');
      await refreshWarrantyInfo();
    } catch (e) { book = null; showError('Could not read that file: ' + e.message + ' (if it is open in Excel with unsaved changes, save it first).'); }
    updateButtons();
  }
  const drop = $('drop');
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => takeFile(e.dataTransfer.files[0]));
  $('file').onchange = e => { takeFile(e.target.files[0]); e.target.value = ''; };
  $('only').oninput = resetResults;
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => e.preventDefault());

  function updateButtons() {
    $('runDry').disabled = busy || !book || !getCheckedSheets().length;
    $('apply').disabled = busy || !plan || plan.applied || actionCount(plan) === 0;
    $('delFind').disabled = busy || !$('delType').value;
    $('delRun').disabled = busy || !delPlan || delPlan.ran || !delChosen().length;
  }
  function resetResults() { plan = null; $('results').hidden = true; updateButtons(); }

  /* ---------- jobs ---------- */
  const CLOSED_STAGES = ['Complete', 'Invoiced', 'Archived'];
  const todayNZ = () => { const d = new Date(); return `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };
  const noteText = () => `EST and PVT completed - ${todayNZ()}`;
  const plainNotes = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  // One line per asset for the job-completion note, covering everything
  // attached when the job closes (new this run plus already-attached from an
  // earlier one, possibly spanning more than one sheet - see combinedJobs in
  // the preview below).
  //
  // A defibrillator's battery is a separately tracked serial, so it's named
  // alongside the device it belongs to rather than left to be looked up.
  const isDefib = a => String(a.deviceType || '').toLowerCase().includes('defib');
  const assetLine = a => {
    const base = a.model ? `${a.model} — SN:${a.ser}` : `SN:${a.ser}`;
    return esc(isDefib(a) && a.batterySerial ? `${base} (Battery SN:${a.batterySerial})` : base);
  };
  // Every asset is listed; Extended Warranty decides which group it lands in
  // rather than whether it appears at all. Falls back to a flat list when the
  // sheets have no Extended Warranty column, since the headings would be
  // claiming a distinction nothing in the file actually supports.
  //
  // Built as ONE <div> with <br> between lines, not a <div> per line - Simpro's
  // notes editor runs adjacent top-level blocks together, which is what made an
  // earlier per-item-<div> version come out squished.
  const assetListHtml = jp => {
    const all = jp.attach.concat(jp.already);
    if (!all.length) return '';
    if (!warrantyColumnFound) return `<div>${all.map(assetLine).join('<br>')}</div>`;
    const onWarranty = a => warrantySerials.has(String(a.ser || '').toUpperCase());
    const yes = all.filter(onWarranty), no = all.filter(a => !onWarranty(a));
    // Says so explicitly when nothing is on warranty, rather than just
    // omitting the section - "no devices require it" and "we didn't check"
    // shouldn't look identical to whoever reads the job later.
    const lines = yes.length
      ? ['Extended Warranty required on these devices:', ...yes.map(assetLine)]
      : ['No devices require Extended Warranty.'];
    if (no.length) {
      lines.push(''); // blank line between the two groups
      // "Other devices added" only reads correctly as a contrast with a group
      // above it. With nothing on warranty there is no such group, so these are
      // simply the devices added.
      lines.push(yes.length ? 'Other devices added:' : 'Devices added:', ...no.map(assetLine));
    }
    return `<div>${lines.join('<br>')}</div>`;
  };
  const ccPath = (p, jp) => `/companies/${p.cid}/jobs/${jp.jobNo}/sections/${jp.cc.sec}/costCenters/${jp.cc.id}/assets/`;
  async function planJobs(p) {
    p.jobPlans = [];
    if (!p.jobs.size) return;
    const codes = await getAll(`/companies/${p.cid}/setup/statusCodes/projects/`).catch(() => []);
    p.completedStatus = codes.find(c => String(c.Name).trim().toLowerCase() === 'job : completed') || null;
    let i = 0;
    for (const [jobNo, items] of p.jobs) {
      progress(`Checking Simpro job ${jobNo}… (${++i} of ${p.jobs.size})`, i, p.jobs.size);
      const jp = { jobNo, items, problems: [], notes: [], attach: [], already: [] };
      p.jobPlans.push(jp);
      const { status, data } = await call('GET', `/companies/${p.cid}/jobs/${jobNo}`);
      if (status === 404) { jp.problems.push('Job not found in Simpro'); continue; }
      if (status !== 200) { jp.problems.push(`Could not read the job (${status}): ${brief(data)}`); continue; }
      jp.job = { name: data.Name || '', site: data.Site || {}, stage: data.Stage || '', status: (data.Status || {}).Name || '', customer: (data.Customer || {}).CompanyName || '', notes: data.Notes || '' };
      const wrong = items.filter(x => String(x.site) !== String(jp.job.site.ID));
      if (wrong.length) jp.problems.push(`Job is for site ${jp.job.site.ID} (${jp.job.site.Name}) but ${wrong.length} asset(s) are on site ${[...new Set(wrong.map(x => x.site))].join(', ')} - job left alone`);
      if (CLOSED_STAGES.includes(jp.job.stage)) jp.problems.push(`Job is already at stage "${jp.job.stage}" - left alone`);
      if (!p.completedStatus) jp.problems.push('Status "Job : Completed" was not found in Simpro');
      const ccs = [];
      for (const sec of await getAll(`/companies/${p.cid}/jobs/${jobNo}/sections/`))
        for (const c of await getAll(`/companies/${p.cid}/jobs/${jobNo}/sections/${sec.ID}/costCenters/`))
          ccs.push({ sec: sec.ID, id: c.ID, name: c.Name || (c.CostCenter || {}).Name || String(c.ID) });
      if (!ccs.length) { jp.problems.push('Job has no cost centre to attach assets to'); continue; }
      jp.cc = ccs[0];
      if (ccs.length > 1) jp.notes.push(`Job has ${ccs.length} cost centres - assets go on the first one (${ccs[0].name})`);
      const attached = new Set();
      for (const c of ccs) (await getAll(`/companies/${p.cid}/jobs/${jobNo}/sections/${c.sec}/costCenters/${c.id}/assets/`)).forEach(x => attached.add(String((x.Asset || {}).ID)));
      for (const it of items) {
        const ex = p.existing.get(`${it.site}|${it.ser}`);
        if (ex && attached.has(String(ex.id))) jp.already.push(Object.assign({}, it, { assetId: ex.id }));
        else jp.attach.push(Object.assign({}, it, { assetId: ex ? ex.id : null }));
      }
    }
  }
  const okJobs = p => (p.jobPlans || []).filter(j => !j.problems.length);
  const actionCount = p => p.creates.length + p.changes.length + okJobs(p).length;

  /* ---------- preview ----------
     Runs every ticked sheet in turn, each against its own asset type's
     Simpro fields and existing-asset lookup, then merges everything into
     one combined plan - one preview / one Apply for the whole workbook
     instead of one pass per sheet. A job number referenced from more than
     one sheet (e.g. the same shipment carries both Monitors and IT items)
     is merged into a single job plan too, so it only gets attached-to and
     closed once, with every sheet's items accounted for. */
  $('runDry').onclick = async () => {
    showError(''); resetResults(); logLines = []; setBusy(true);
    const cid = $('company').value;
    const sheets = getCheckedSheets();
    // "Only these serials" restricts the sync itself (unchanged, pre-existing
    // behaviour). The Extended Warranty checkbox does NOT - every asset in
    // the ticked sheets is still created/updated as normal; it only controls
    // which of a job's attached assets get listed in that job's Notes field
    // (see assetListHtml() below), since Jonathan wants all assets processed
    // but only warranty items recorded there.
    const only = $('only').value.trim() ? new Set($('only').value.split(/[\s,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean)) : null;
    const stamp = new Date();
    if (!sheets.length) { showError('Tick at least one sheet to sync.'); progressDone(); setBusy(false); return; }
    try {
      log(`PREVIEW | ${fileName} | sheets: ${sheets.map(s => `${s.name} (${s.typeName})`).join(', ')} | ${stamp.toLocaleString('en-NZ')} | by ${WHO}` + (only ? ` | only: ${[...only].join(', ')}` : '') + (warrantyColumnFound ? ` | job notes grouped by Extended Warranty (${warrantySerials.size} marked Yes)` : ''));

      const creates = [], changes = [], warnings = [], simproOnly = [], simproErrors = [], dupes = [], unmapped = [];
      let unchanged = 0;
      const combinedExisting = new Map(); // site|serial -> {id, values} - for job-attach lookups, across all sheets
      const combinedJobs = new Map();     // jobNo -> items[] - merged across sheets
      // Two sheets very often share a site (same customer's Monitors + IT
      // lists) or, less often, a type - without these, each sheet redid the
      // same "fetch every asset at this site" / "fetch this type's field
      // definitions" work from scratch, doubling (or worse) Simpro traffic
      // for no reason.
      const siteAssetsCache = new Map(); // site -> raw unfiltered assets[]
      const fieldDefsCache = new Map();  // tid -> {lowercaseName: fieldDef}

      for (const sr of sheets) {
        progress(`Reading sheet "${sr.name}"…`);
        const { header, recs } = SyncCore.toRecords(await book.rows(sr.idx));
        log(`\n--- "${sr.name}" (${sr.typeName}) --- rows with data: ${recs.length}`);
        if (!recs.length) { log('  (no data rows - skipped)'); continue; }

        let fdef = fieldDefsCache.get(sr.tid);
        if (!fdef) {
          progress(`Reading ${sr.typeName} fields from Simpro…`);
          const fields = await getAll(`/companies/${cid}/setup/assetTypes/${sr.tid}/customFields/`);
          // Concurrency here isn't about hammering Simpro - main.js's
          // transport packs up to 25 calls into ONE proxy round trip, so a
          // pool narrower than that just leaves most of each ~3s round trip
          // empty. Keep these at/above 25 so every batch travels full.
          const fdefList = await pool(fields, 50, async f => {
            const { status, data } = await call('GET', `/companies/${cid}/setup/assetTypes/${sr.tid}/customFields/${f.ID}`);
            return status === 200 ? data : f;
          });
          fdef = {}; fdefList.forEach(f => { fdef[f.Name.trim().toLowerCase()] = f; });
          fieldDefsCache.set(sr.tid, fdef);
        }
        const { mapped, unmapped: sheetUnmapped } = SyncCore.mapColumns(header, fdef);
        log(`  Columns mapped to Simpro fields: ${Object.keys(mapped).length}`);
        if (sheetUnmapped.length) { log(`  Columns with NO matching Simpro field (ignored): ${sheetUnmapped.join(', ')}`); unmapped.push(...sheetUnmapped.map(u => `${sr.name}: ${u}`)); }
        if (!mapped[SyncCore.MATCH_FIELD]) {
          log(`  SKIPPED this sheet: no "${SyncCore.MATCH_FIELD}" column matching a ${sr.typeName} field.`);
          warnings.push({ row: '', serial: '', sheet: sr.name, msg: `Sheet "${sr.name}" skipped entirely: no "${SyncCore.MATCH_FIELD}" column matching a ${sr.typeName} field in Simpro` });
          continue;
        }
        const serialCf = mapped[SyncCore.MATCH_FIELD].ID;

        const sites = [...new Set(recs.map(x => SyncCore.asText(x.r[SyncCore.SITE_COL])))];
        const sheetExisting = new Map();
        for (const site of sites) {
          if (!/^\d+$/.test(site)) { log(`  Skipping rows with bad Site ID "${site}"`); continue; }
          let siteAssets = siteAssetsCache.get(site);
          if (!siteAssets) {
            progress(`Finding assets on site ${site}…`);
            siteAssets = await getAll(`/companies/${cid}/sites/${site}/assets/`);
            siteAssetsCache.set(site, siteAssets);
          }
          const assets = siteAssets.filter(a => String((a.AssetType || {}).ID) === String(sr.tid) && !a.Archived);
          log(`  Site ${site}: ${assets.length} ${sr.typeName} assets in Simpro`);
          // One call per asset is unavoidable (the serial we match on is
          // itself a custom field, so there's no knowing which assets matter
          // until they're read) - but at 50 wide these pack into full
          // 25-request batches instead of quarter-full ones.
          const cfs = await pool(assets, 50, async a => {
            const { status, data } = await call('GET', `/companies/${cid}/sites/${site}/assets/${a.ID}/customFields/?pageSize=250`);
            if (status !== 200) { log(`    could not read asset ${a.ID}: ${status}`); return null; }
            return data;
          }, (d, t) => progress(`Reading asset details on site ${site}… ${d} of ${t}`, d, t));
          assets.forEach((a, i) => {
            if (!cfs[i]) return;
            const values = {}; cfs[i].forEach(c => { values[c.CustomField.ID] = c.Value; });
            const ser = String(values[serialCf] ?? '').trim().toUpperCase();
            for (const c of cfs[i]) if (c.Value !== null && SyncCore.isErr(c.Value)) simproErrors.push({ site, ser, id: a.ID, field: c.CustomField.Name, value: c.Value, sheet: sr.name });
            if (!ser) return;
            const k = `${site}|${ser}`;
            if (sheetExisting.has(k)) { dupes.push({ site, ser, a: sheetExisting.get(k).id, b: a.ID, sheet: sr.name }); return; }
            sheetExisting.set(k, { id: a.ID, values });
            if (combinedExisting.has(k)) dupes.push({ site, ser, a: combinedExisting.get(k).id, b: a.ID, sheet: sr.name + ' (also matched on another sheet)' });
            else combinedExisting.set(k, { id: a.ID, values });
          });
        }

        const res = SyncCore.compare(recs, mapped, sheetExisting, only);
        res.creates.forEach(c => Object.assign(c, { sheet: sr.name, cid, tid: sr.tid, typeName: sr.typeName }));
        res.changes.forEach(c => Object.assign(c, { sheet: sr.name, cid, tid: sr.tid, typeName: sr.typeName }));
        res.warnings.forEach(w => w.sheet = sr.name);
        res.simproOnly.forEach(s => Object.assign(s, { sheet: sr.name }));
        creates.push(...res.creates);
        changes.push(...res.changes);
        warnings.push(...res.warnings);
        simproOnly.push(...res.simproOnly);
        unchanged += res.unchanged;
        log(`  To create: ${res.creates.length}   To update: ${res.changes.length} (${res.changes.reduce((n, c) => n + c.changes.length, 0)} field changes)   Unchanged: ${res.unchanged}`);

        for (const [jobNo, items] of res.jobs) {
          const tagged = items.map(it => ({ ...it, sheet: sr.name }));
          if (!combinedJobs.has(jobNo)) combinedJobs.set(jobNo, []);
          combinedJobs.get(jobNo).push(...tagged);
        }
      }

      plan = { creates, changes, warnings, unchanged, simproOnly, dupes, simproErrors, unmapped, cid, stamp, fileName, applied: false, existing: combinedExisting, jobs: combinedJobs };
      await planJobs(plan);
      log(`\nTOTAL  To create: ${creates.length}   To update: ${changes.length} (${changes.reduce((n, c) => n + c.changes.length, 0)} field changes)   Unchanged: ${unchanged}`);
      log(`In Simpro but not in sheet (left alone): ${simproOnly.length}`);
      if (plan.jobPlans.length) {
        log(`Jobs: ${plan.jobPlans.length} (${okJobs(plan).length} will have assets attached and be completed)`);
        plan.jobPlans.forEach(j => log(`  Job ${j.jobNo}: attach ${j.attach.length}, already attached ${j.already.length}` + (j.problems.length ? ' - NOT CHANGED: ' + j.problems.join('; ') : ` - then note "${noteText()}", Stage Complete, Status "Job : Completed"`) + (j.notes.length ? ' (' + j.notes.join('; ') + ')' : '')));
      }
      log(`Warnings: ${warnings.length}`);
      warnings.forEach(w => log(`  ${w.sheet ? '[' + w.sheet + '] ' : ''}Row ${w.row} ${w.serial}: ${w.msg}`));
      if (simproErrors.length) { log(`Excel errors already stored in Simpro: ${simproErrors.length}`); simproErrors.forEach(e => log(`  ${e.ser || '(no serial)'} (asset ${e.id}) ${e.field} = ${e.value}`)); }
      log('\nPreview only - nothing was changed in Simpro.');
      renderResults();
    } catch (e) { showError(e.message); log('STOPPED: ' + e.message); }
    progressDone(); setBusy(false);
  };

  /* ---------- results ---------- */
  function tile(n, label, cls) { return `<div class="tile ${cls || ''}"><b>${n}</b><span>${label}</span></div>`; }
  function renderResults() {
    const p = plan;
    const fieldChanges = p.changes.reduce((n, c) => n + c.changes.length, 0);
    $('tiles').innerHTML =
      tile(p.creates.length, 'to create', p.creates.length ? 'accent' : '') +
      tile(p.changes.length, `to update<small>${fieldChanges} field change${fieldChanges === 1 ? '' : 's'}</small>`, p.changes.length ? 'accent' : '') +
      tile(p.unchanged, 'unchanged') +
      tile(p.warnings.length, 'warnings', p.warnings.length ? 'warn' : '') +
      tile(p.simproOnly.length, 'in Simpro only<small>left alone</small>') +
      (p.simproErrors.length ? tile(p.simproErrors.length, 'Excel errors<small>already in Simpro</small>', 'warn') : '') +
      (p.jobPlans.length ? tile(okJobs(p).length, `job${okJobs(p).length === 1 ? '' : 's'} to complete<small>${okJobs(p).reduce((n, j) => n + j.attach.length, 0)} assets to attach${p.jobPlans.length - okJobs(p).length ? ` · ${p.jobPlans.length - okJobs(p).length} with problems` : ''}</small>`, p.jobPlans.length - okJobs(p).length ? 'warn' : (okJobs(p).length ? 'accent' : '')) : '');
    const n = actionCount(p);
    $('apply').textContent = n ? `Apply ${n} change${n === 1 ? '' : 's'} to Simpro` : 'Nothing to apply';
    $('resultTitle').textContent = p.applied ? 'Result' : 'Preview - nothing has been changed yet';
    const tabs = [
      ['create', `Create (${p.creates.length})`], ['update', `Update (${p.changes.length})`], ['warn', `Warnings (${p.warnings.length})`],
      ['only', `In Simpro only (${p.simproOnly.length})`]
    ];
    if (p.jobPlans.length) tabs.splice(2, 0, ['jobs', `Jobs (${p.jobPlans.length})`]);
    if (p.simproErrors.length) tabs.push(['serr', `Errors in Simpro (${p.simproErrors.length})`]);
    if (p.unmapped.length || p.dupes.length) tabs.push(['other', 'Other notes']);
    const first = (tabs.find(t => /\((?!0\))/.test(t[1])) || tabs[0])[0];
    $('tabs').innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${k === first ? 'on' : ''}">${l}</button>`).join('');
    $('tabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; [...$('tabs').children].forEach(x => x.classList.toggle('on', x === b)); renderTab(b.dataset.tab); };
    renderTab(first);
    $('results').hidden = false; updateButtons();
    $('results').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function table(head, rows) {
    if (!rows.length) return '<p class="empty">Nothing here.</p>';
    return `<div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  function renderTab(k) {
    const p = plan; let html = '';
    if (k === 'create') html = p.creates.map(c => `<details class="asset"><summary><b>${esc(c.ser)}</b> <span class="muted">row ${c.rownum} · ${esc(c.sheet)} · site ${esc(c.site)} · ${c.changes.length} fields</span>${c.newId ? ` <span class="pill ok">created ${c.newId}</span>` : ''}${c.error ? ` <span class="pill bad">error</span>` : ''}</summary>${table(['Field', 'Value'], c.changes.map(x => [esc(x.col), esc(x.nv)]))}</details>`).join('') || '<p class="empty">No new assets.</p>';
    if (k === 'update') html = table(['Sheet', 'Serial', 'Row', 'Asset', 'Field', 'Simpro now', 'Spreadsheet', ''], p.changes.flatMap(c => c.changes.map(x => [esc(c.sheet), esc(c.ser), c.rownum, c.id, esc(x.col), `<span class="old">${esc(x.old) || '<i>blank</i>'}</span>`, `<span class="new">${esc(x.nv)}</span>`, x.status === 'ok' ? '<span class="pill ok">done</span>' : x.status ? '<span class="pill bad">failed</span>' : ''])));
    if (k === 'jobs') html = '<p class="muted">After the assets are imported, each job below gets ALL its assets attached, then every one of them is listed in the job Notes' + (warrantyColumnFound ? ' - grouped into <b>Extended Warranty required</b> and <b>Not required</b>' : '') + ' (model and serial number, plus the battery serial for defibrillators), followed by the note <b>' + esc(noteText()) + '</b>. Its stage is set to <b>Complete</b> and status to <b>Job : Completed</b>. A job is only completed if every one of its assets attached successfully. A job referenced from more than one sheet is only attached-to and closed once, with items from every sheet it appeared in.</p>' +
      table(['Job', 'Name / site', 'Now', 'To attach', 'Already attached', 'Notes', ''], p.jobPlans.map(j => [
        `<b>#${esc(j.jobNo)}</b>`,
        j.job ? `${esc(j.job.name)}<br><span class="muted">${esc(j.job.site.Name || '')}</span>` : '',
        j.job ? `${esc(j.job.stage)}<br><span class="muted">${esc(j.job.status)}</span>` : '',
        j.attach.map(a => esc(a.ser) + ` <span class="muted">[${esc(a.sheet)}]</span>` + (a.assetId ? '' : ' <span class="muted">(new)</span>') + (a.status === 'ok' ? ' <span class="pill ok">attached</span>' : a.status ? ' <span class="pill bad">failed</span>' : '')).join('<br>') || '<span class="muted">none</span>',
        j.already.map(a => esc(a.ser) + ` <span class="muted">[${esc(a.sheet)}]</span>`).join('<br>') || '<span class="muted">none</span>',
        j.problems.map(x => `<span class="bad">${esc(x)}</span>`).concat(j.notes.map(esc)).join('<br>'),
        j.closed ? '<span class="pill ok">completed</span>' : (j.result ? '<span class="pill bad">left open</span>' : (j.problems.length ? '<span class="pill bad">skipped</span>' : ''))
      ]));
    if (k === 'warn') html = table(['Sheet', 'Row', 'Serial', 'Warning'], p.warnings.map(w => [esc(w.sheet || ''), w.row, esc(w.serial), esc(w.msg)]));
    if (k === 'only') html = '<p class="muted">These are in Simpro but not in the sheet. The sync never deletes or archives anything.</p>' + table(['Sheet', 'Serial', 'Site', 'Asset ID'], p.simproOnly.map(s => [esc(s.sheet || ''), esc(s.ser), esc(s.site), s.id]));
    if (k === 'serr') html = '<p class="muted">These values were saved into Simpro as Excel errors by an earlier import. Fix the formula in the sheet and run again to replace them.</p>' + table(['Sheet', 'Serial', 'Asset ID', 'Field', 'Value in Simpro'], p.simproErrors.map(e => [esc(e.sheet || ''), esc(e.ser), e.id, esc(e.field), esc(e.value)]));
    if (k === 'other') html = (p.unmapped.length ? `<p><b>Columns with no matching Simpro field (ignored):</b> ${esc(p.unmapped.join(', '))}</p>` : '') +
      (p.dupes.length ? '<p><b>Duplicate serials in Simpro</b> (the first asset is used):</p>' + table(['Sheet', 'Serial', 'Site', 'Asset', 'Duplicate'], p.dupes.map(d => [esc(d.sheet || ''), esc(d.ser), esc(d.site), d.a, d.b])) : '');
    $('tabBody').innerHTML = html;
  }

  /* ---------- apply ---------- */
  $('apply').onclick = async () => {
    const p = plan; const n = actionCount(p);
    const jl = okJobs(p);
    if (!confirm(`Apply ${n} change${n === 1 ? '' : 's'} to Simpro now?\n\n${p.creates.length} new asset(s), ${p.changes.length} updated asset(s)` + (jl.length ? `\n${jl.length} job(s) to attach assets to and complete: ${jl.map(j => '#' + j.jobNo).join(', ')}` : '') + '.')) return;
    setBusy(true); showError('');
    log(`\nAPPLY started ${new Date().toLocaleString('en-NZ')} by ${WHO}`);
    let added = 0, updated = 0, errors = 0, done = 0, closedJobs = 0; const total = n;
    const setField = async (site, aid, x) => {
      const { status, data } = await call('PATCH', `/companies/${p.cid}/sites/${site}/assets/${aid}/customFields/${x.cfid}`, { Value: x.nv });
      x.status = (status === 200 || status === 204) ? 'ok' : 'fail';
      if (x.status !== 'ok') { errors++; log(`  ERROR ${aid} ${x.col}: ${status} ${brief(data)}`); }
      return x.status === 'ok';
    };
    try {
      // Concurrency model, and why it is this specific shape:
      //
      // Calls are batched by main.js's transport (up to 25 per proxy round
      // trip), so work has to be issued concurrently or every call pays its
      // own ~1.5s round trip - that was the original "30-60s per asset".
      // BUT two PATCHes to the SAME asset must never be in flight together:
      // Simpro answers both 200 while silently losing one of the values. A
      // run that reported 164/164 fields "ok" came back on the next preview
      // with 37 of them still blank across 10 assets, and an asset whose
      // Serial Number write is the one lost reappears as "to create",
      // duplicating it.
      //
      // So: one in-flight call per asset (fields strictly sequential within
      // an asset), many assets at once. Batches stay full because they're
      // filled by DIFFERENT assets, which don't collide. Job attaches are
      // left parallel - they're separate assets going onto one cost centre
      // and verified fine (45 of 47 already attached on the re-check).
      await pool(p.changes, 25, async c => {
        let ok = true;
        for (const x of c.changes) ok = (await setField(c.site, c.id, x)) && ok;
        if (ok) updated++;
        progress(`Applying… ${++done} of ${total}`, done, total);
      }, () => {});
      await pool(p.creates, 25, async c => {
        const start = SyncCore.asDateIso(c.r['Date Installed']) || new Date().toISOString().slice(0, 10);
        const { status, data } = await call('POST', `/companies/${p.cid}/sites/${c.site}/assets/`, { AssetType: +c.tid, StartDate: start });
        if (!(status === 200 || status === 201) || !data || !data.ID) { errors++; c.error = true; log(`  ERROR creating ${c.ser} (row ${c.rownum}, ${c.sheet}): ${status} ${brief(data)}`); }
        else {
          c.newId = data.ID; added++;
          for (const x of c.changes) await setField(c.site, c.newId, x);
          log(`  created asset ${c.newId} for ${c.ser} (${c.sheet})`);
        }
        progress(`Applying… ${++done} of ${total}`, done, total);
      }, () => {});
      // ---- jobs: attach assets, then complete
      const okStatus = r => r.status === 200 || r.status === 201 || r.status === 204;
      for (const jp of jl) {
        jp.result = { attached: 0, failed: 0 };
        await Promise.all(jp.attach.map(async it => {
          let aid = it.assetId;
          if (!aid) { const cr = p.creates.find(c => c.site === it.site && c.ser === it.ser); aid = cr && cr.newId; }
          if (!aid) { it.status = 'fail'; jp.result.failed++; log(`  ERROR job ${jp.jobNo}: ${it.ser} has no Simpro asset (it was not created)`); return; }
          let r = await call('POST', ccPath(p, jp), { Asset: +aid });
          if (!okStatus(r) && r.status >= 400 && r.status < 500) { const r2 = await call('POST', ccPath(p, jp), { Asset: { ID: +aid } }); if (okStatus(r2)) r = r2; }
          if (okStatus(r)) { it.status = 'ok'; jp.result.attached++; }
          else { it.status = 'fail'; jp.result.failed++; log(`  ERROR job ${jp.jobNo}: attaching ${it.ser} (asset ${aid}) failed: ${r.status} ${brief(r.data)}`); }
        }));
        if (jp.result.failed) { errors++; log(`  Job ${jp.jobNo} LEFT OPEN - ${jp.result.failed} asset(s) could not be attached`); progress(`Applying… ${++done} of ${total}`, done, total); continue; }
        const note = noteText();
        // Skip only when the exact block about to be written is already
        // there. This used to test for the "EST and PVT completed - <date>"
        // line alone, which silently swallowed the whole write - asset list
        // included - on a job that had been run before and then reopened,
        // even though the list itself had changed (warranty-filtered now,
        // and with models). Existing notes are never edited or removed, only
        // appended to; re-running a job that's genuinely unchanged still
        // writes nothing, and the Complete-stage check above stops this
        // repeating unless someone deliberately reopens the job.
        const block = assetListHtml(jp) + `<div>${note}</div>`;
        if (!plainNotes(jp.job.notes).includes(plainNotes(block))) {
          const newNotes = (jp.job.notes ? jp.job.notes + '\n' : '') + block;
          const rn = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Notes: newNotes });
          if (!okStatus(rn)) { errors++; jp.closeError = `notes: ${rn.status} ${brief(rn.data)}`; log(`  ERROR job ${jp.jobNo}: could not add the note - job LEFT OPEN: ${rn.status} ${brief(rn.data)}`); progress(`Applying… ${++done} of ${total}`, done, total); continue; }
          jp.noteAdded = note;
          log(`  Job ${jp.jobNo}: notes updated (${jp.attach.concat(jp.already).length} assets attached, ${plainNotes(assetListHtml(jp)).split('\n').filter(Boolean).length} listed in notes)`);
        } else {
          log(`  Job ${jp.jobNo}: notes already contain this exact list - left as they are`);
        }
        let r = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Stage: 'Complete' });
        if (!okStatus(r)) { errors++; jp.closeError = `stage: ${r.status} ${brief(r.data)}`; log(`  ERROR job ${jp.jobNo}: could not set stage Complete: ${r.status} ${brief(r.data)}`); }
        else {
          r = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Status: +p.completedStatus.ID });
          if (!okStatus(r) && r.status >= 400 && r.status < 500) { const r2 = await call('PATCH', `/companies/${p.cid}/jobs/${jp.jobNo}`, { Status: { ID: +p.completedStatus.ID } }); if (okStatus(r2)) r = r2; }
          if (!okStatus(r)) { errors++; jp.closeError = `status: ${r.status} ${brief(r.data)}`; log(`  ERROR job ${jp.jobNo}: stage is Complete but status could not be set: ${r.status} ${brief(r.data)}`); }
          else { jp.closed = true; closedJobs++; log(`  Job ${jp.jobNo}: attached ${jp.result.attached} asset(s), note "${note}", stage Complete, status "Job : Completed"`); }
        }
        progress(`Applying… ${++done} of ${total}`, done, total);
      }
    } catch (e) { showError('Stopped part-way: ' + e.message + ' - run the preview again to see what is left.'); }
    log(`\nDONE  Added: ${added}   Updated: ${updated}   Jobs completed: ${closedJobs}   Errors: ${errors}`);
    p.applied = true; p.result = { added, updated, errors, closedJobs };
    progressDone(); setBusy(false);
    renderResults();
    $('tiles').insertAdjacentHTML('afterbegin', `<div class="banner ${errors ? 'bad' : 'ok'}">${errors ? '⚠' : '✓'} Applied: ${added} added, ${updated} updated${jl.length ? `, ${closedJobs} of ${jl.length} job${jl.length === 1 ? '' : 's'} completed` : ''}, ${errors} error${errors === 1 ? '' : 's'}. Run the preview again to confirm everything matches.</div>`);
    downloadReport(true);
  };

  /* ---------- report download ---------- */
  function csvCell(v) { v = String(v ?? ''); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function downloadReport(auto) {
    if (!plan) return;
    const p = plan, rows = [['Action', 'Sheet', 'Row', 'Site', 'Serial', 'Asset ID', 'Field', 'Simpro before', 'Spreadsheet', 'Result']];
    p.changes.forEach(c => c.changes.forEach(x => rows.push(['UPDATE', c.sheet, c.rownum, c.site, c.ser, c.id, x.col, x.old, x.nv, x.status || ''])));
    p.creates.forEach(c => c.changes.forEach(x => rows.push(['CREATE', c.sheet, c.rownum, c.site, c.ser, c.newId || '', x.col, '', x.nv, x.status || (c.error ? 'fail' : '')])));
    p.warnings.forEach(w => rows.push(['WARNING', w.sheet || '', w.row, '', w.serial, '', '', '', w.msg, '']));
    p.simproOnly.forEach(s => rows.push(['IN SIMPRO ONLY', s.sheet || '', '', s.site, s.ser, s.id, '', '', '', '']));
    (p.jobPlans || []).forEach(j => {
      j.attach.forEach(a => rows.push(['JOB ATTACH', a.sheet || '', a.rownum, a.site, a.ser, a.assetId || '', 'Job ' + j.jobNo, '', '', a.status || (j.problems.length ? 'skipped' : '')]));
      j.already.forEach(a => rows.push(['JOB ALREADY ATTACHED', a.sheet || '', a.rownum, a.site, a.ser, a.assetId, 'Job ' + j.jobNo, '', '', '']));
      rows.push(['JOB COMPLETE', '', '', j.job ? j.job.site.ID : '', '', '', 'Job ' + j.jobNo, j.job ? `${j.job.stage} / ${j.job.status}` : '', `Complete / Job : Completed / note: ${noteText()}`, j.closed ? 'ok' : (j.problems.length ? 'skipped: ' + j.problems.join('; ') : (j.result ? 'left open ' + (j.closeError || '') : ''))]);
    });
    p.simproErrors.forEach(e => rows.push(['ERROR IN SIMPRO', e.sheet || '', '', e.site, e.ser, e.id, e.field, e.value, '', '']));
    const csv = '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n\r\n' + logLines.map(l => csvCell(l)).join('\r\n');
    const ts = p.stamp.toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `Simpro sync ${p.applied ? 'APPLIED' : 'PREVIEW'} ${p.fileName.replace(/\.[^.]+$/, '')} ${ts}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('download').onclick = () => downloadReport(false);

  /* ---------- delete assets by type ----------
     Separate from the sync, which never deletes. Find scans every site (or
     the listed ones) for assets of the chosen type and reads each one's
     serial/model so the list can be checked; Delete then removes exactly that
     list, one asset per call. The proxy only relays DELETE for role:'admin'. */
  let delPlan = null; // { cid, tid, typeName, items:[{site, siteName, id, ser, model, status}], picked:Set<modelKey>, stamp, ran }
  const NO_MODEL = '(no model recorded)';
  const modelKey = i => i.model.trim() || NO_MODEL;
  // Only the ticked models are listed, deleted and reported. Nothing starts
  // ticked unless chosen before Find, so Delete always reflects a deliberate
  // choice of models.
  const delChosen = () => delPlan ? delPlan.items.filter(i => delPlan.picked.has(modelKey(i))) : [];
  const delStatus = t => { $('delStatus').textContent = t; };
  const delError = t => { $('delError').textContent = t || ''; $('delError').hidden = !t; };
  function resetDelete() { delPlan = null; $('delResults').hidden = true; $('delModels').innerHTML = ''; delError(''); delStatus('Reads Simpro only. Nothing is deleted yet.'); updateButtons(); }

  // Models can be chosen before Find when the type's model field is a Simpro
  // List (AEDs' "Device Model" is) - its ListItems are every allowed value.
  // Values outside that list (typos, blanks) come under PRE_OTHER. Find then
  // starts with these ticked; the picker after Find can still change them.
  // Other types (free-text model field, or none) only get the after-Find picker.
  const PRE_OTHER = '(other / not recorded)';
  let preModels = null; // { items:[listItem], picked:Set } or null
  function renderPreModels() {
    const el = $('delPreModels');
    if (!preModels) { el.innerHTML = ''; return; }
    el.innerHTML = `<div style="font-size:13px;color:var(--muted);margin-bottom:6px">Models to delete (optional - choose now, or after Find) <button type="button" id="preAll" style="padding:2px 8px;font-size:12px">All</button> <button type="button" id="preNone" style="padding:2px 8px;font-size:12px">None</button></div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${preModels.items.concat(PRE_OTHER).map(m => `<label class="sheetrow" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
        <input type="checkbox" class="pre-model" value="${esc(m)}" ${preModels.picked.has(m) ? 'checked' : ''}>${esc(m)}</label>`).join('')}</div>`;
    el.querySelectorAll('.pre-model').forEach(cb => cb.onchange = () => { cb.checked ? preModels.picked.add(cb.value) : preModels.picked.delete(cb.value); resetDelete(); });
    const setAll = on => { preModels.picked = new Set(on ? preModels.items.concat(PRE_OTHER) : []); renderPreModels(); resetDelete(); };
    $('preAll').onclick = () => setAll(true); $('preNone').onclick = () => setAll(false);
  }
  async function loadPreModels() {
    preModels = null; renderPreModels();
    const cid = $('company').value, tid = $('delType').value;
    if (!tid) return;
    try {
      const fields = await getAll(`/companies/${cid}/setup/assetTypes/${tid}/customFields/`);
      const f = fields.find(f => /^(device )?model$/i.test(String(f.Name).trim()));
      if (!f) return;
      const { status, data } = await call('GET', `/companies/${cid}/setup/assetTypes/${tid}/customFields/${f.ID}`);
      if ($('delType').value !== tid) return; // type changed while loading
      if (status === 200 && data.Type === 'List' && (data.ListItems || []).length) {
        preModels = { items: data.ListItems.map(s => String(s).trim()), picked: new Set() };
        renderPreModels();
      }
    } catch (e) { /* the after-Find picker still works */ }
  }
  $('delType').onchange = () => { resetDelete(); loadPreModels(); };
  $('delSites').oninput = resetDelete;

  $('delFind').onclick = async () => {
    const cid = $('company').value, tid = $('delType').value;
    const typeName = $('delType').selectedOptions[0].textContent;
    const onlySites = $('delSites').value.split(/[\s,;]+/).filter(Boolean);
    if (onlySites.some(s => !/^\d+$/.test(s))) { delError('Site IDs must be numbers.'); return; }
    resetDelete(); setBusy(true);
    try {
      let items = await findFast(cid, tid, onlySites), sites = null, archived = 0;
      if (items) {
        archived = items.filter(i => i.archived).length;
        items = items.filter(i => !i.archived);
      } else {
        items = await findSlow(cid, tid, onlySites);
        sites = items.sitesScanned;
      }
      items.sort((a, b) => String(a.siteName).localeCompare(String(b.siteName)) || a.site - b.site || a.id - b.id);
      // Carry the before-Find choice over, matching list values case-insensitively.
      const picked = new Set();
      if (preModels) {
        const listed = new Map(preModels.items.map(m => [m.toLowerCase(), m]));
        items.forEach(i => {
          const k = modelKey(i), li = listed.get(i.model.trim().toLowerCase());
          if (li ? preModels.picked.has(li) : preModels.picked.has(PRE_OTHER)) picked.add(k);
        });
      }
      delPlan = { cid, tid, typeName, items, picked, stamp: new Date(), ran: false, sitesScanned: sites };
      delStatus(`Found ${items.length} ${typeName}` + (archived ? ` (plus ${archived} already archived, left out)` : '') + (sites ? ` across ${sites} sites scanned` : '') + '. Nothing has been deleted.');
      renderDelete();
    } catch (e) { delError(e.message); delStatus('Stopped.'); }
    setBusy(false);
  };

  const assetModelSerial = (it, cfs) => {
    const val = name => { const c = (cfs || []).find(c => String(c.CustomField.Name).trim().toLowerCase() === name); return c && c.Value ? String(c.Value) : ''; };
    it.ser = val('serial number');
    it.model = val('device model') || val('model');
    return it;
  };

  // One company-wide list call per 250 assets, already filtered by type and
  // carrying each asset's site, archived flag and custom fields - a handful of
  // calls instead of one per site plus one per asset. Returns null if the
  // proxy doesn't allow /customerAssets/ yet, so Find falls back to findSlow().
  async function findFast(cid, tid, onlySites) {
    const q = `AssetType.ID=${tid}` + (onlySites.length ? `&Site.ID=in(${onlySites.join(',')})` : '') + '&columns=ID,Site,AssetType,Archived,CustomFields&pageSize=250';
    const path = page => `/companies/${cid}/customerAssets/?${q}&page=${page}`;
    delStatus('Reading assets…');
    let first;
    // Straight to transport, not call(): a proxy refusal would otherwise be
    // retried with backoff before falling back.
    try { first = await transport('GET', path(1)); }
    catch (e) { if (/not allowed/i.test(e.message)) return null; throw e; }
    if (first.status !== 200) throw new Error(`Simpro request failed (${first.status}): ${brief(first.data)}`);
    let raw = first.data;
    // Pages are fetched 4 at a time; they travel together in one proxy batch.
    for (let page = 2; raw.length === (page - 1) * 250; page += 4) {
      delStatus(`Reading assets… ${raw.length} so far`);
      const res = await Promise.all([0, 1, 2, 3].map(k => call('GET', path(page + k))));
      for (const r of res) {
        if (r.status !== 200) throw new Error(`Simpro request failed (${r.status}): ${brief(r.data)}`);
        raw = raw.concat(r.data);
      }
    }
    return raw.filter(a => String((a.AssetType || {}).ID) === String(tid)).map(a => assetModelSerial(
      { site: (a.Site || {}).ID, siteName: (a.Site || {}).Name || '', id: a.ID, archived: !!a.Archived, ser: '', model: '' }, a.CustomFields));
  }

  // The original route: every site, then every matching asset's custom fields.
  async function findSlow(cid, tid, onlySites) {
    let sites;
    if (onlySites.length) sites = onlySites.map(id => ({ ID: +id, Name: '' }));
    else { delStatus('Listing sites…'); sites = await getAll(`/companies/${cid}/sites/`); }
    const items = [];
    await pool(sites, 50, async s => {
      const { status, data } = await call('GET', `/companies/${cid}/sites/${s.ID}/assets/?pageSize=250`);
      if (status !== 200) throw new Error(`Could not read site ${s.ID} (${status}): ${brief(data)}`);
      // A site with 250+ assets needs the remaining pages too.
      const all = data.length < 250 ? data : await getAll(`/companies/${cid}/sites/${s.ID}/assets/`);
      all.filter(a => String((a.AssetType || {}).ID) === String(tid))
        .forEach(a => items.push({ site: s.ID, siteName: s.Name || '', id: a.ID, ser: '', model: '' }));
    }, (d, t) => delStatus(`Scanning sites… ${d} of ${t} (${items.length} found)`));
    await pool(items, 50, async it => {
      const { status, data } = await call('GET', `/companies/${cid}/sites/${it.site}/assets/${it.id}/customFields/?pageSize=250`);
      if (status === 200) assetModelSerial(it, data);
    }, (d, t) => delStatus(`Reading serial numbers… ${d} of ${t}`));
    items.sitesScanned = sites.length;
    return items;
  }

  function renderModels() {
    const p = delPlan, counts = new Map();
    p.items.forEach(i => counts.set(modelKey(i), (counts.get(modelKey(i)) || 0) + 1));
    const models = [...counts.keys()].sort((a, b) => (a === NO_MODEL) - (b === NO_MODEL) || a.localeCompare(b));
    $('delModels').innerHTML = !models.length ? '' :
      `<div style="font-size:13px;color:var(--muted);margin-bottom:6px">Tick the models to delete <button type="button" id="delAll" style="padding:2px 8px;font-size:12px">All</button> <button type="button" id="delNone" style="padding:2px 8px;font-size:12px">None</button></div>
       <div style="display:flex;flex-wrap:wrap;gap:6px">${models.map(m => `<label class="sheetrow" style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:14px">
         <input type="checkbox" class="del-model" value="${esc(m)}" ${p.picked.has(m) ? 'checked' : ''} ${p.ran ? 'disabled' : ''}>${esc(m)} <span class="muted">(${counts.get(m)})</span></label>`).join('')}</div>`;
    $('delModels').querySelectorAll('.del-model').forEach(cb => cb.onchange = () => { cb.checked ? p.picked.add(cb.value) : p.picked.delete(cb.value); renderDelete(); });
    const setAll = on => { if (p.ran) return; p.picked = new Set(on ? models : []); renderModels(); renderDelete(); };
    if ($('delAll')) { $('delAll').onclick = () => setAll(true); $('delNone').onclick = () => setAll(false); $('delAll').disabled = $('delNone').disabled = p.ran; }
  }

  function renderDelete() {
    const p = delPlan, chosen = delChosen(), siteCount = new Set(chosen.map(i => i.site)).size;
    const done = chosen.filter(i => i.status === 'deleted').length, failed = chosen.filter(i => i.status && i.status !== 'deleted').length;
    if (!$('delModels').childElementCount) renderModels();
    $('delTiles').innerHTML = (p.ran ? `<div class="banner ${failed ? 'bad' : 'ok'}">${failed ? '⚠' : '✓'} Deleted ${done} of ${chosen.length} ${esc(p.typeName)} assets${failed ? `, ${failed} failed (see below)` : ''}.</div>` : '') +
      tile(chosen.length, `selected to delete<small>of ${p.items.length} ${esc(p.typeName)} found</small>`, chosen.length ? 'warn' : '') +
      tile(siteCount, `site${siteCount === 1 ? '' : 's'}` + (p.sitesScanned ? `<small>of ${p.sitesScanned} scanned</small>` : ''));
    $('delRun').textContent = chosen.length ? `Delete ${chosen.length} asset${chosen.length === 1 ? '' : 's'}` : (p.items.length ? 'Tick a model to delete' : 'Nothing to delete');
    $('delTable').innerHTML = table(['Site', 'Site name', 'Asset ID', 'Serial', 'Model', ''], chosen.map(i => [
      i.site, esc(i.siteName), i.id, esc(i.ser) || '<span class="muted">-</span>', esc(i.model),
      i.status === 'deleted' ? '<span class="pill ok">deleted</span>' : i.status ? `<span class="pill bad" title="${esc(i.status)}">failed</span> <span class="muted">${esc(i.status)}</span>` : ''
    ]));
    $('delResults').hidden = false; updateButtons();
  }

  $('delRun').onclick = async () => {
    const p = delPlan, chosen = delChosen(), n = chosen.length;
    const typed = prompt(`This permanently deletes ${n} ${p.typeName} asset${n === 1 ? '' : 's'} from Simpro, across ${new Set(chosen.map(i => i.site)).size} site(s).\nModels: ${[...p.picked].join(', ')}\n\nIt cannot be undone. Type DELETE ${n} to confirm.`);
    if (typed === null) return;
    if (typed.trim() !== `DELETE ${n}`) { alert('That did not match - nothing was deleted.'); return; }
    setBusy(true); delError('');
    try {
      // Different assets don't collide (unlike PATCHes to one asset - see
      // apply above), so a wide pool keeps every proxy batch full.
      await pool(chosen, 25, async it => {
        const { status, data } = await call('DELETE', `/companies/${p.cid}/sites/${it.site}/assets/${it.id}`);
        it.status = (status === 200 || status === 204) ? 'deleted' : `${status} ${brief(data)}`;
      }, d => delStatus(`Deleting… ${d} of ${n}`));
    } catch (e) { delError('Stopped part-way: ' + e.message + ' - run Find again to see what is left.'); }
    p.ran = true; p.ranAt = new Date();
    delStatus(`Finished. Run Find again to confirm nothing is left.`);
    renderModels(); renderDelete(); setBusy(false);
    downloadDeleteReport();
  };

  function downloadDeleteReport() {
    const p = delPlan; if (!p) return;
    const rows = [['Site ID', 'Site name', 'Asset ID', 'Asset type', 'Serial', 'Model', 'Result']];
    // Every asset found, so the CSV also shows what was deliberately kept.
    p.items.forEach(i => rows.push([i.site, i.siteName, i.id, p.typeName, i.ser, i.model,
      !p.picked.has(modelKey(i)) ? 'kept (model not selected)' : i.status || (p.ran ? 'not attempted' : 'would delete')]));
    const head = `${p.ran ? 'DELETED' : 'TO DELETE'} | ${p.typeName} (type ${p.tid}) | company ${p.cid} | ${(p.ranAt || p.stamp).toLocaleString('en-NZ')} | by ${WHO}`;
    const csv = '﻿' + csvCell(head) + '\r\n' + rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
    const ts = (p.ranAt || p.stamp).toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `Simpro ${p.ran ? 'DELETED' : 'delete list'} ${p.typeName.replace(/[\\/:*?"<>|]/g, '')} ${ts}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  $('delDownload').onclick = downloadDeleteReport;

  updateButtons();
  loadSetup();
}
