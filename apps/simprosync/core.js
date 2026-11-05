/* ---------- Sync rules (same as sync_assets.py) ---------- */
const SyncCore = (() => {
  const MATCH_FIELD = 'Serial Number', SITE_COL = 'Site ID', JOB_COL = 'Simpro Job';
  const XL_ERRORS = new Set(['#REF!', '#N/A', '#VALUE!', '#DIV/0!', '#NAME?', '#NUM!', '#NULL!', '#SPILL!', '#CALC!']);
  const DMY = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/;
  const pad = n => String(n).padStart(2, '0');

  function asText(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object' && v.err) return v.err;
    if (typeof v === 'object' && v.date) return `${v.date.d}/${pad(v.date.m)}/${v.date.y}`;   // NZ Excel style 1/09/2017
    if (typeof v === 'number') return String(v);
    const s = String(v).trim();
    const m = s.match(DMY);
    if (m) return `${+m[1]}/${pad(+m[2])}/${m[3]}`;
    return s;
  }
  function asDateIso(v) {   // '' = blank, null = not a date
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return '';
    if (typeof v === 'object' && v.date) return `${v.date.y}-${pad(v.date.m)}-${pad(v.date.d)}`;
    if (typeof v === 'object') return null;
    const s = String(v).trim();
    const m = s.match(DMY);
    if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])}`;
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return null;
  }
  const isErr = s => XL_ERRORS.has(String(s).trim().toUpperCase());

  /* rows: array of arrays (row 0 = header). Returns {header, recs:[{rownum, r}]} */
  function toRecords(rows) {
    const header = (rows[0] || []).map(h => (h === null || h === undefined) ? '' : String(typeof h === 'object' ? asText(h) : h).trim());
    const recs = [];
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i] || [];
      if (row.every(v => v === null || v === undefined || String(typeof v === 'object' ? asText(v) : v).trim() === '')) continue;
      const r = {};
      header.forEach((h, j) => { if (h) r[h] = row[j] ?? null; });
      recs.push({ rownum: i + 1, r });
    }
    return { header, recs };
  }

  /* fdef: {lowercaseName: {ID, Name, Type, ListItems}} */
  function mapColumns(header, fdef) {
    const mapped = {}, unmapped = [];
    for (const h of header) {
      if (!h || h === SITE_COL || h.toLowerCase() === JOB_COL.toLowerCase()) continue;
      const f = fdef[h.trim().toLowerCase()];
      if (f) mapped[h] = f; else unmapped.push(h);
    }
    return { mapped, unmapped };
  }

  /* existing: Map key `${site}|${SERIAL}` -> {id, values:{cfid: value}} */
  function compare(recs, mapped, existing, only) {
    const changes = [], creates = [], warnings = [], seen = new Set(), jobs = new Map();
    let unchanged = 0;
    const jobKey = Object.keys(recs[0] ? recs[0].r : {}).find(k => k.trim().toLowerCase() === JOB_COL.toLowerCase());
    // Carried onto each job item below so the job-completion note can record
    // what was attached (model + serial), not just the serial. Read from the
    // row's own headers rather than the Simpro-mapped ones, so it still
    // works for a column Simpro has no matching field for - and accept the
    // spellings these sheets actually use ("Device Model" in CHS's lists),
    // not just a bare "Model", which found nothing and silently left every
    // note serial-only.
    const rowKeys = Object.keys(recs[0] ? recs[0].r : {});
    const norm = k => k.trim().toLowerCase();
    const pick = (wants, loose) => wants.map(w => rowKeys.find(k => norm(k) === w)).find(Boolean)
      || (loose ? rowKeys.find(loose) : undefined);
    const modelKey = pick(['device model', 'model', 'model name', 'model number'], k => norm(k).includes('model'));
    // Device type and battery serial ride along too: a defibrillator's
    // battery is a separately tracked serial, and the job note has to record
    // it next to the device it belongs to.
    const typeKey = pick(['device type', 'devicetype', 'asset type'], k => norm(k).includes('device type'));
    const batteryKey = pick(
      ['battery serial number', 'battery serial no', 'battery serial', 'battery sn'],
      k => norm(k).includes('battery') && norm(k).includes('serial')
    );
    for (const { rownum, r } of recs) {
      const site = asText(r[SITE_COL]); const ser = asText(r[MATCH_FIELD]).toUpperCase();
      if (!ser) { warnings.push({ row: rownum, serial: '', msg: 'No serial number - row skipped' }); continue; }
      if (only && !only.has(ser)) continue;
      // No site means nothing to match against and nowhere to create it - it
      // used to fall through as a "create" and only fail at Apply.
      if (!/^\d+$/.test(site)) { warnings.push({ row: rownum, serial: ser, msg: site ? `Site ID '${site}' is not a number - row skipped` : `No ${SITE_COL} - row skipped` }); continue; }
      const key = `${site}|${ser}`;
      if (seen.has(key)) { warnings.push({ row: rownum, serial: ser, msg: 'Serial appears twice in the sheet - second row skipped' }); continue; }
      seen.add(key);
      const cur = existing.get(key);
      if (jobKey) {
        const jraw = asText(r[jobKey]).replace(/^#/, '').trim();
        if (jraw) {
          if (!/^\d+$/.test(jraw)) warnings.push({ row: rownum, serial: ser, msg: `Simpro Job '${jraw}' is not a job number - not attached to a job` });
          else {
            if (!jobs.has(jraw)) jobs.set(jraw, []);
            jobs.get(jraw).push({
              rownum, site, ser,
              model: modelKey ? asText(r[modelKey]) : '',
              deviceType: typeKey ? asText(r[typeKey]) : '',
              batterySerial: batteryKey ? asText(r[batteryKey]) : ''
            });
          }
        }
      }
      const rowChanges = [];
      for (const [col, f] of Object.entries(mapped)) {
        const raw = r[col]; const ftype = f.Type;
        if (raw && typeof raw === 'object' && raw.err) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' is an Excel error (${raw.err}) - skipped, fix the formula in the sheet` }); continue; }
        let nv;
        if (ftype === 'Date') {
          nv = asDateIso(raw);
          if (nv === null) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' value '${asText(raw)}' is not a date - skipped` }); continue; }
        } else nv = asText(raw);
        if (nv === '') continue;   // blanks never clear Simpro
        if (isErr(nv)) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' is an Excel error (${nv}) - skipped, fix the formula in the sheet` }); continue; }
        if (ftype === 'List') {
          const items = (f.ListItems || []).map(x => String(x).trim());
          if (items.length && !items.includes(nv)) { warnings.push({ row: rownum, serial: ser, msg: `'${col}' value '${nv}' is not in the Simpro list - rejected` }); continue; }
        }
        const ov = cur ? (cur.values[f.ID] === null || cur.values[f.ID] === undefined ? '' : String(cur.values[f.ID]).trim()) : '';
        if (nv !== ov) rowChanges.push({ col, cfid: f.ID, old: ov, nv });
      }
      if (!cur) creates.push({ rownum, site, ser, r, changes: rowChanges });
      else if (rowChanges.length) changes.push({ rownum, site, ser, id: cur.id, changes: rowChanges });
      else unchanged++;
    }
    const simproOnly = only ? [] : [...existing.keys()].filter(k => !seen.has(k)).map(k => ({ site: k.split('|')[0], ser: k.split('|')[1], id: existing.get(k).id }));
    return { changes, creates, warnings, unchanged, simproOnly, jobs };
  }
  /* A row the sheet says is on site A, whose serial is already in Simpro on site B (a wrong Site ID in the sheet),
     matches nothing by site and used to come up as "to create": the create then failed (no such site) or, on a real
     site, made a duplicate. Called with compare()'s creates and simproOnly (the assets read from the sheet's sites
     that no row matched): a create whose serial is among those is not a create. Returns the creates that remain,
     the moved ones (each with where Simpro has it: found [{site, id}]) and simproOnly without the ones claimed. */
  function splitMoved(creates, simproOnly) {
    const bySerial = new Map();
    for (const s of simproOnly) { if (!bySerial.has(s.ser)) bySerial.set(s.ser, []); bySerial.get(s.ser).push(s); }
    const keep = [], moved = [], claimed = new Set();
    for (const c of creates) {
      const hit = bySerial.get(c.ser);
      if (hit && hit.length) { moved.push({ rownum: c.rownum, site: c.site, ser: c.ser, found: hit.map(h => ({ site: h.site, id: h.id })) }); hit.forEach(h => claimed.add(h)); }
      else keep.push(c);
    }
    return { creates: keep, moved, simproOnly: simproOnly.filter(s => !claimed.has(s)) };
  }

  /* ---------- Job notes ----------
     Everything that decides what a job's Notes will say lives here, so the
     preview (which shows the text) and Apply (which writes it) cannot drift
     apart: both call jobNoteBlock(). Nothing here touches the network. */
  const escHtml = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plainNotes = h => String(h || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(div|p)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim();
  // A defibrillator's battery is a separately tracked serial, so it is named
  // alongside the device it belongs to.
  const isDefib = a => String(a.deviceType || '').toLowerCase().includes('defib');
  const assetText = a => {
    const base = a.model ? `${a.model} — SN:${a.ser}` : `SN:${a.ser}`;
    return isDefib(a) && a.batterySerial ? `${base} (Battery SN:${a.batterySerial})` : base;
  };
  const WARRANTY_COL = 'extended warranty';
  /* sheets: [{header, recs}] (toRecords output) of the ticked sheets.
     Returns {columnFound, serials:Set (Extended Warranty = Yes), values:Map(cell value -> rows)}.
     A sheet with the column but no Serial Number column still counts as "column found". */
  function warrantyScan(sheets) {
    const out = { columnFound: false, serials: new Set(), values: new Map() };
    for (const { header, recs } of sheets) {
      // header can hold real gaps (a skipped cell), which Array.find visits as undefined
      const wKey = (header || []).find(h => h && h.trim().toLowerCase() === WARRANTY_COL);
      if (!wKey) continue;
      out.columnFound = true;
      const sKey = header.find(h => h && h.trim().toLowerCase() === MATCH_FIELD.toLowerCase());
      if (!sKey) continue;
      for (const { r } of recs) {
        const raw = asText(r[wKey]).trim();
        if (raw) out.values.set(raw, (out.values.get(raw) || 0) + 1);
        if (raw.toLowerCase() !== 'yes') continue;
        const ser = asText(r[sKey]).trim().toUpperCase();
        if (ser) out.serials.add(ser);
      }
    }
    return out;
  }
  /* The note's lines for a job's attached assets, as [{kind, text}]. kind:
     'flat' (no Extended Warranty column in any ticked sheet, so no headings),
     'head', 'warranty' (marked Yes), 'other', 'blank'. */
  function jobNoteLines(all, warranty) {
    if (!all.length) return [];
    const line = (a, kind) => ({ kind, text: assetText(a) });
    if (!warranty.columnFound) return all.map(a => line(a, 'flat'));
    const onWarranty = a => warranty.serials.has(String(a.ser || '').toUpperCase());
    const yes = all.filter(onWarranty), no = all.filter(a => !onWarranty(a));
    // Says so when nothing is on warranty rather than omitting the section:
    // "no devices require it" and "we didn't check" must not look the same.
    const lines = yes.length
      ? [{ kind: 'head', text: 'Extended Warranty required on these devices:' }, ...yes.map(a => line(a, 'warranty'))]
      : [{ kind: 'head', text: 'No devices require Extended Warranty.' }];
    if (no.length) {
      lines.push({ kind: 'blank', text: '' });
      lines.push({ kind: 'head', text: yes.length ? 'Other devices added:' : 'Devices added:' }, ...no.map(a => line(a, 'other')));
    }
    return lines;
  }
  // ONE <div> with <br> between lines: Simpro's editor runs adjacent block elements together.
  const jobNoteListHtml = lines => lines.length ? `<div>${lines.map(l => escHtml(l.text)).join('<br>')}</div>` : '';
  /* What gets appended to the job's Notes, and how it relates to what is there. */
  function jobNoteBlock(jp, warranty, stampText) {
    const all = jp.attach.concat(jp.already);
    const lines = jobNoteLines(all, warranty);
    return { lines, html: jobNoteListHtml(lines) + `<div>${stampText}</div>`, stampText };
  }
  /* The preview of one job: the exact note, and what Apply will do with it. state:
     'skipped' (job has a problem: nothing written), 'unchanged' (the exact block is
     already in the notes), 'append' (added after existing notes), 'write' (notes empty). */
  function jobNotePreview(jp, warranty, stampText) {
    const { lines, html } = jobNoteBlock(jp, warranty, stampText);
    const existing = (jp.job && jp.job.notes) || '';
    let state;
    if (jp.problems.length) state = 'skipped';
    else if (plainNotes(existing).includes(plainNotes(html))) state = 'unchanged';
    else state = plainNotes(existing) ? 'append' : 'write';
    return {
      jobNo: jp.jobNo, state, lines, stampText, existingChars: plainNotes(existing).length,
      yes: lines.filter(l => l.kind === 'warranty').length, other: lines.filter(l => l.kind === 'other').length,
      flat: lines.filter(l => l.kind === 'flat').length
    };
  }
  /* Counts for the whole run. Jobs and devices only; nothing identifying. */
  function summariseNotes(previews, warranty) {
    const s = { jobs: previews.length, mode: warranty.columnFound ? 'grouped' : 'flat', written: 0, appended: 0, unchanged: 0, skipped: 0, jobsWithWarranty: 0, jobsNoneRequired: 0, devicesWarranty: 0, devicesOther: 0, devicesFlat: 0, nearMiss: [] };
    for (const p of previews) {
      if (p.state === 'skipped') { s.skipped++; continue; }
      if (p.state === 'unchanged') s.unchanged++;
      else if (p.state === 'append') { s.written++; s.appended++; }
      else s.written++;
      s.devicesWarranty += p.yes; s.devicesOther += p.other; s.devicesFlat += p.flat;
      if (s.mode === 'grouped') { if (p.yes) s.jobsWithWarranty++; else s.jobsNoneRequired++; }
    }
    // Values in the Extended Warranty column that are neither Yes nor No: those devices are
    // listed under "Other devices", and a "Y" or "Yes - 3 years" would otherwise go unnoticed.
    for (const [v, n] of warranty.values || []) if (!['yes', 'no'].includes(v.toLowerCase())) s.nearMiss.push({ value: v, rows: n });
    return s;
  }
  return { MATCH_FIELD, SITE_COL, JOB_COL, XL_ERRORS, asText, asDateIso, isErr, toRecords, mapColumns, compare,
    splitMoved, plainNotes, assetText, warrantyScan, jobNoteLines, jobNoteBlock, jobNotePreview, summariseNotes };
})();
export { SyncCore };
