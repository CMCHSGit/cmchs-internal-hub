/* Manage (old: the Sold / Retired tab, Import / Export, and Settings' kit
   groups, Simpro switch, missing Simpro jobs and test mode). The tracker's
   team (account managers and roles) is kept in Settings, People and access,
   for every tool at once. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Badge, Button, Dialog, Loading, useConfirm } from '../../../shared/ui/index.jsx'
import { AdminDialog } from './Items.jsx'
import { setCutover } from './db.js'
import { TRACKER_ROLES, addMember, removeMember, saveMember, setMemberRole } from '../../admin/src/tracker.js'
import {
  EXPORT_COLUMNS, HISTORY_COLUMNS, RETIRED_COLUMNS, RETIRE_REASONS, filterRetired, fmtDate, importRow, loanSections, loansMissingJobs, newId, roleOf, toCsv,
} from './model.js'

// The old tabs' order: Import, Sold / Retired, then Settings (kits, Simpro).
const PARTS = [['data', 'Import and export'], ['retired', 'Sold / Retired'], ['kits', 'Kits'], ['simpro', 'Simpro'], ['team', 'Team'], ['notify', 'Test notifications'], ['test', 'Test mode'], ['source', 'Data source']]

/** A library from the same CDN the old tracker uses, once (old: needLib): SheetJS and PapaParse. */
const LIBS = { xlsx: ['https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', 'XLSX'], papa: ['https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js', 'Papa'] }
const loading = {}
function lib(name) {
  const [src, global] = LIBS[name]
  if (window[global]) return Promise.resolve(window[global])
  loading[name] ??= new Promise((resolve, reject) => {
    const el = document.createElement('script')
    el.src = src; el.async = true
    el.onload = () => resolve(window[global]); el.onerror = () => { delete loading[name]; reject(new Error('The spreadsheet tools didn’t load. Check the connection and try again.')) }
    document.head.appendChild(el)
  })
  return loading[name]
}
const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }

export default function Manage({ s, params, setParams, onDone }) {
  const part = PARTS.some(([p]) => p === params.part) ? params.part : 'data'
  // Test mode: admins and the testers an admin marks (shared/can.js), not the two names the old one had written in.
  // Test notifications: Service & Projects (old: Settings, shown to them only; the proxy checks it too).
  const service = roleOf(s.me) === 'service'
  const parts = PARTS.filter(([p]) => (p !== 'test' || s.canTestMode || s.testMode) && (p !== 'source' || s.isAdmin) && (p !== 'notify' || service) && (p !== 'team' || s.isAdmin))
  return (
    <div className="eq-manage">
      <nav className="eq-filters" aria-label="Manage">
        {parts.map(([p, l]) => <button key={p} type="button" className={`tag${part === p ? ' tag-selected' : ''}`} aria-pressed={part === p} onClick={() => setParams({ part: p === 'data' ? undefined : p })}>{l}</button>)}
      </nav>
      {part !== 'team' && <p className="eq-note">The tracker’s team (account managers, Service &amp; Projects) is in {s.isAdmin ? <><a href={'#/manage?part=team'}>Team</a> here, and </> : ''}<a href="/settings/people">Settings, People and access</a>.</p>}
      {part === 'retired' && <Retired s={s} onDone={onDone} />}
      {part === 'kits' && <Kits s={s} onDone={onDone} />}
      {part === 'data' && <Data s={s} onDone={onDone} />}
      {part === 'simpro' && <Simpro s={s} onDone={onDone} />}
      {part === 'team' && s.isAdmin && <Team s={s} onDone={onDone} />}
      {part === 'notify' && service && <TestPush s={s} onDone={onDone} />}
      {part === 'test' && <TestMode s={s} onDone={onDone} />}
      {part === 'source' && s.isAdmin && <Source s={s} onDone={onDone} />}
    </div>
  )
}

// The old Sold / Retired table's columns, each sortable (old: sortRetired); newest retired first to start.
const RETIRED_TABLE = [['CHSAssetNo', 'Asset no.'], ['Model', 'Model'], ['Description', 'Description'], ['SerialNo', 'Serial no.'], ['RetiredNotes', 'Notes'], ['RetiredDate', 'Retired'], ['RetiredReason', 'Why'], ['PartNo', 'Part no.'], ['NZPrice', 'NZ$']]
const nz = (v) => (v ? '$' + Number(v).toLocaleString('en-NZ', { minimumFractionDigits: 2 }) : '—')

function Retired({ s, onDone }) {
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState(new Set())
  const [asking, setAsking] = useState(null)
  const [error, setError] = useState('')
  const [sort, setSort] = useState({ key: 'RetiredDate', dir: -1 })
  const [open, setOpen] = useState(null) // a retired item's id, its record shown (old: openRetiredDetail)
  const [editing, setEditing] = useState(false)
  const [importing, setImporting] = useState(false)
  const file = useRef(null)
  const [confirmDialog, confirm] = useConfirm()
  const rows = useMemo(() => filterRetired(s.retired || [], { q, sort: sort.key, dir: sort.dir }), [s.retired, q, sort])
  const ids = [...picked]
  const item = open && (s.retired || []).find((r) => r.id === open)
  const toggle = (id) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n })
  async function restore(list = ids) {
    if (!(await confirm({ title: `Bring back ${list.length} ${list.length === 1 ? 'item' : 'items'}?`, message: 'They go back on the equipment list.', confirmLabel: 'Bring back' }))) return
    try { const n = await s.restoreItems(list); setPicked(new Set()); setOpen(null); onDone(`${n} ${n === 1 ? 'item' : 'items'} back on the equipment list.`) } catch (e) { setError(e.message || String(e)) }
  }
  // Import (old: handleRetiredImport): CSV or Excel, its own headings; no admin step, as the old one.
  async function pickFile(ev) {
    const f = ev.target.files?.[0]
    if (!f) return
    setImporting(true); setError('')
    try {
      const ext = f.name.split('.').pop().toLowerCase()
      let data
      if (ext === 'csv' || ext === 'txt') { const Papa = await lib('papa'); data = await new Promise((resolve, reject) => Papa.parse(f, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data), error: reject })) }
      else if (ext === 'xlsx' || ext === 'xls') { const XLSX = await lib('xlsx'); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' }); data = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }) }
      else throw new Error('Choose a CSV or Excel file.')
      if (!data.length) throw new Error('There’s nothing in that file.')
      const r = await s.importRetired(data)
      onDone(`Import done: ${r.added} added, ${r.updated} updated.`)
    } catch (e) { setError(e.message || String(e)) } finally { setImporting(false); if (file.current) file.current.value = '' }
  }
  return (
    <>
      <div className="card eq-toolbar">
        <label className="field eq-grow"><span className="field-label">Search</span><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Anything about the item" /></label>
        <Button variant="secondary" size="sm" onClick={() => save(new Blob([toCsv(s.retired || [], RETIRED_COLUMNS)], { type: 'text/csv' }), `CHS-Retired-Assets-${s.today}.csv`)}>Export CSV</Button>
        <Button size="sm" disabled={importing} onClick={() => file.current?.click()}>{importing ? 'Importing…' : 'Import'}</Button>
        <input ref={file} type="file" accept=".csv,.txt,.xlsx,.xls" hidden onChange={pickFile} />
      </div>
      {!s.extrasReady && <Loading />}
      {picked.size > 0 && (
        <div className="card eq-selbar">
          <span className="eq-grow">{picked.size} selected</span>
          <Button size="sm" variant="secondary" onClick={restore}>Bring back</Button>
          <Button size="sm" variant="ghost" className="eq-danger" onClick={() => setAsking('delete')}>Delete for good</Button>
          <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
        </div>
      )}
      {error && <Alert tone="critical" title="Not done">{error}</Alert>}
      <p className="text-sm text-muted eq-shown">{rows.length} {rows.length === 1 ? 'item' : 'items'}</p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead><tr><th aria-label="Select" />{RETIRED_TABLE.map(([k, label]) => (
            <th key={k} aria-sort={sort.key === k ? (sort.dir > 0 ? 'ascending' : 'descending') : undefined}>
              <button type="button" className="data-table-sort" onClick={() => setSort((x) => ({ key: k, dir: x.key === k ? -x.dir : 1 }))}>
                {label}{sort.key === k && <span aria-hidden="true">{sort.dir > 0 ? '▲' : '▼'}</span>}
              </button>
            </th>
          ))}</tr></thead>
          <tbody>
            {rows.map((e) => (
              <tr key={e.id} className="data-table-row" tabIndex={0} onClick={() => { setOpen(e.id); setEditing(false) }} onKeyDown={(ev) => { if (ev.key === 'Enter') { setOpen(e.id); setEditing(false) } }}>
                <td data-label="Select" onClick={(ev) => ev.stopPropagation()}><input type="checkbox" checked={picked.has(e.id)} onChange={() => toggle(e.id)} onKeyDown={(ev) => ev.stopPropagation()} aria-label={`Select ${e.CHSAssetNo}`} /></td>
                <td data-label="Asset no."><span className="eq-strong">{e.CHSAssetNo}</span></td>
                <td data-label="Model">{e.Model}</td>
                <td data-label="Description">{e.Description}</td>
                <td data-label="Serial no." className="eq-mono">{e.SerialNo}</td>
                <td data-label="Notes" className="eq-history-notes">{e.RetiredNotes || e.Notes}</td>
                <td data-label="Retired" className="eq-nowrap">{fmtDate(e.RetiredDate)}</td>
                <td data-label="Why">{e.RetiredReason && <Badge tone="orange">{e.RetiredReason}</Badge>}</td>
                <td data-label="Part no." className="eq-mono">{e.PartNo}</td>
                <td data-label="NZ$" className="eq-nowrap">{nz(e.NZPrice)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && s.extrasReady && <p className="data-table-empty">{(s.retired || []).length ? 'Nothing matches that.' : 'Nothing retired yet.'}</p>}
      </div>
      {asking === 'delete' && (
        <AdminDialog s={s} title={`Delete ${ids.length} retired ${ids.length === 1 ? 'item' : 'items'} for good?`} message="They can’t be brought back after this." confirmLabel="Delete for good" danger
          onClose={() => setAsking(null)} onConfirm={async () => { const n = await s.deleteRetired(ids); setPicked(new Set()); setAsking(null); onDone(`${n} deleted.`) }} />
      )}
      {item && !editing && asking !== 'deleteOne' && (
        <Dialog title={item.CHSAssetNo || 'Retired item'} description={[item.Model, item.Description].filter(Boolean).join(' · ')} onClose={() => setOpen(null)} width={640}>
          <Badge tone="orange">{item.RetiredReason || 'Sold / Retired'}</Badge>
          <p className="eq-note">Retired {fmtDate(item.RetiredDate) || '—'}{item.RetiredNotes ? ` · ${item.RetiredNotes}` : ''}</p>
          <dl className="eq-fields">
            {[['CHSAssetNo', 'CHS asset no.'], ['Model', 'Model'], ['Description', 'Description'], ['SerialNo', 'Serial no.'], ['BatterySerialNo', 'Battery serial no.'], ['PartNo', 'Part no.'],
              ['MfgDate', 'Manufactured'], ['PurchaseDate', 'Purchased'], ['USPrice', 'US$'], ['NZPrice', 'NZ$'], ['TileNo', 'Tile no.'], ['ShelfLocation', 'Shelf'], ['Notes', 'Notes']]
              .filter(([k]) => item[k]).map(([k, label]) => (
                <div key={k}><dt>{label}</dt><dd className={/SerialNo/.test(k) ? 'eq-mono' : ''}>{/Date$/.test(k) ? fmtDate(item[k]) : k === 'NZPrice' ? nz(item[k]) : k === 'USPrice' ? '$' + Number(item[k]).toLocaleString() : item[k]}</dd></div>
              ))}
          </dl>
          <div className="dialog-actions">
            <button type="button" className="btn btn-ghost btn-md eq-danger" onClick={() => setAsking('deleteOne')}>Delete for good</button>
            <button type="button" className="btn btn-secondary btn-md" onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="btn btn-primary btn-md" onClick={() => restore([item.id])}>Bring back</button>
          </div>
        </Dialog>
      )}
      {item && editing && <RetiredEdit s={s} item={item} onClose={() => setEditing(false)} onDone={(msg) => { setEditing(false); onDone(msg) }} />}
      {item && asking === 'deleteOne' && (
        <AdminDialog s={s} title={`Delete ${item.CHSAssetNo} for good?`} message="It can’t be brought back after this." confirmLabel="Delete for good" danger
          onClose={() => setAsking(null)} onConfirm={async () => { await s.deleteRetired([item.id]); setAsking(null); setOpen(null); onDone(`${item.CHSAssetNo} deleted.`) }} />
      )}
      {confirmDialog}
    </>
  )
}

/** A retired item's why and notes (old: the retired edit modal). */
function RetiredEdit({ s, item, onClose, onDone }) {
  const [f, setF] = useState({ reason: item.RetiredReason || '', retiredNotes: item.RetiredNotes || '', notes: item.Notes || '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const reasons = [...new Set([...RETIRE_REASONS, ...(f.reason ? [f.reason] : [])])]
  return (
    <Dialog title={`Edit ${item.CHSAssetNo || ''}${item.Model ? ' — ' + item.Model : ''}`} onClose={onClose} width={480}>
      <form className="eq-form" onSubmit={async (e) => { e.preventDefault(); setBusy(true); setError(''); try { await s.editRetired(item.id, f); onDone(`${item.CHSAssetNo || 'Item'} updated.`) } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) } }}>
        <label className="field"><span className="field-label">Why</span><select value={f.reason} onChange={set('reason')}><option value="">—</option>{reasons.map((r) => <option key={r}>{r}</option>)}</select></label>
        <label className="field"><span className="field-label">Retired notes</span><textarea className="input" rows={2} value={f.retiredNotes} onChange={set('retiredNotes')} /></label>
        <label className="field"><span className="field-label">Notes</span><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></label>
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Kits (old: Settings' kit groups): a device that, when loaned, suggests its accessories. */
function Kits({ s, onDone }) {
  const kits = s.kits || {}
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [confirmDialog, confirm] = useConfirm()
  const run = async (fn, msg) => { setError(''); try { await fn(); if (msg) onDone(msg) } catch (e) { setError(e.message || String(e)) } }
  const find = (no) => (s.equipment || []).find((e) => e && String(e.CHSAssetNo || '').trim().toLowerCase() === String(no || '').trim().toLowerCase())
  return (
    <>
      <p className="eq-note">When a kit’s trigger device is picked for a loan, its accessories are offered too.</p>
      {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
      {Object.entries(kits).map(([key, kit]) => (
        <section key={key} className="card eq-kit">
          <div className="eq-actions-row">
            <h3 className="eq-h3 eq-grow">{kit.label || key}</h3>
            <Button size="sm" variant="ghost" className="eq-danger" onClick={async () => {
              if (!(await confirm({ title: `Delete the kit “${kit.label || key}”?`, message: 'The devices aren’t touched; they just stop being suggested together.', confirmLabel: 'Delete kit', danger: true }))) return
              run(() => s.changeKits((k) => { const n = { ...k }; delete n[key]; return n }, ['kit_deleted', `Kit "${kit.label || key}" deleted`, { kit: kit.label || key }]), 'Kit deleted.')
            }}>Delete kit</Button>
          </div>
          <KitList title="Trigger devices" items={(kit.triggers || []).map((t) => ({ assetNo: t }))} find={find}
            onAdd={(no) => run(() => s.changeKits((k) => ({ ...k, [key]: { ...k[key], triggers: [...new Set([...(k[key]?.triggers || []), no])] } })))}
            onRemove={(no) => run(() => s.changeKits((k) => ({ ...k, [key]: { ...k[key], triggers: (k[key]?.triggers || []).filter((t) => t !== no) } })))} />
          <KitList title="Accessories" items={kit.accessories || []} find={find}
            onAdd={(no) => { const e = find(no); return run(() => s.changeKits((k) => ({ ...k, [key]: { ...k[key], accessories: [...(k[key]?.accessories || []).filter((a) => a.assetNo !== no), { assetNo: no, model: e?.Model || '', desc: e?.Description || '' }] } }))) }}
            onRemove={(no) => run(() => s.changeKits((k) => ({ ...k, [key]: { ...k[key], accessories: (k[key]?.accessories || []).filter((a) => a.assetNo !== no) } }), ['kit_accessory_removed', `${no} removed from kit "${kit.label || key}"`, { kit: key, assetNo: no }]))} />
        </section>
      ))}
      {!Object.keys(kits).length && <p className="data-table-empty">No kits yet.</p>}
      {adding ? (
        <form className="card eq-kit" onSubmit={(e) => { e.preventDefault(); const label = new FormData(e.currentTarget).get('label').trim(); if (!label) return; run(() => s.changeKits((k) => ({ ...k, ['kit_' + newId().slice(3)]: { label, triggers: [], accessories: [] } })), 'Kit added: now add its devices.').then(() => setAdding(false)) }}>
          <label className="field"><span className="field-label">Kit name</span><input className="input" name="label" placeholder="e.g. A9 anaesthesia kit" autoFocus /></label>
          <div className="eq-actions-row"><Button type="submit">Add kit</Button><Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button></div>
        </form>
      ) : <div><Button variant="secondary" onClick={() => setAdding(true)}>New kit</Button></div>}
      {confirmDialog}
    </>
  )
}

function KitList({ title, items, find, onAdd, onRemove }) {
  const [no, setNo] = useState('')
  const known = no.trim() && find(no)
  return (
    <div className="eq-kit-list">
      <span className="field-label">{title}</span>
      <ul className="eq-picklist">
        {items.map((a) => { const e = find(a.assetNo); return (
          <li key={a.assetNo} className="eq-picked"><span className="eq-picked-main"><span className="eq-strong">{a.assetNo}</span> {e?.Model || a.model}{!e && <span className="eq-small eq-st-bad">Not in the equipment list</span>}</span>
            <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${a.assetNo}`} onClick={() => onRemove(a.assetNo)}>×</button></li>
        ) })}
        {!items.length && <li className="eq-note">None yet.</li>}
      </ul>
      <form className="eq-picker-add" onSubmit={(e) => { e.preventDefault(); if (known) { onAdd(known.CHSAssetNo); setNo('') } }}>
        <label className="field eq-grow"><span className="visually-hidden">Add to {title}</span><input className="input" value={no} onChange={(e) => setNo(e.target.value)} placeholder="Asset number" /></label>
        <Button type="submit" size="sm" variant="secondary" disabled={!known}>Add</Button>
      </form>
      {no.trim() && !known && <p className="eq-note eq-problem">Not in the equipment list.</p>}
    </div>
  )
}

/** Export everything, and import a spreadsheet behind the admin password (old: Import / Export). */
function Data({ s, onDone }) {
  const [unlocked, setUnlocked] = useState(false)
  const [asking, setAsking] = useState(false)
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const file = useRef(null)
  async function excel() {
    setBusy('Making the spreadsheet…'); setError('')
    try {
      const XLSX = await lib('xlsx')
      const when = (ts) => (ts ? new Date(ts).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')
      const ws = XLSX.utils.aoa_to_sheet([EXPORT_COLUMNS.map(([, h]) => h), ...(s.equipment || []).map((e) => EXPORT_COLUMNS.map(([k]) => e[k] || ''))])
      ws['!cols'] = EXPORT_COLUMNS.map(() => ({ wch: 18 }))
      const ws2 = XLSX.utils.aoa_to_sheet([HISTORY_COLUMNS.map(([, h]) => h), ...(s.history || []).map((h) => HISTORY_COLUMNS.map(([k]) => (k === 'ts' ? when(h.ts) : h[k] || '')))])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Equipment'); XLSX.utils.book_append_sheet(wb, ws2, 'History')
      XLSX.writeFile(wb, `CHS-Demo-Equipment-${s.today}.xlsx`)
    } catch (e) { setError(e.message || String(e)) } finally { setBusy('') }
  }
  async function read(f) {
    if (!f) return
    setBusy('Reading it…'); setError(''); setRows(null)
    try {
      const ext = f.name.split('.').pop().toLowerCase()
      if (ext === 'csv' || ext === 'txt') {
        const Papa = await lib('papa')
        setRows(await new Promise((resolve, reject) => Papa.parse(f, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data), error: reject })))
      } else if (ext === 'xlsx' || ext === 'xls') {
        const XLSX = await lib('xlsx')
        const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
        setRows(XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' }))
      } else throw new Error('Choose a CSV or Excel file.')
    } catch (e) { setError(e.message || String(e)) } finally { setBusy(''); if (file.current) file.current.value = '' }
  }
  const preview = rows ? rows.slice(0, 3).map(importRow) : []
  const usable = rows ? rows.filter((r) => importRow(r).CHSAssetNo).length : 0
  return (
    <>
      <section className="card eq-kit">
        <h3 className="eq-h3">Export</h3>
        <p className="eq-note">Everything on the equipment list, as the old tracker exported it. The Excel file has the history too.</p>
        <div className="eq-actions-row">
          <Button variant="secondary" onClick={() => save(new Blob([toCsv(s.equipment || [], EXPORT_COLUMNS)], { type: 'text/csv' }), `chs-demo-equipment-${s.today}.csv`)}>CSV</Button>
          <Button variant="secondary" onClick={excel} disabled={!!busy}>Excel</Button>
          <Button variant="ghost" onClick={() => save(new Blob([EXPORT_COLUMNS.map(([, h]) => h).join(',') + '\n'], { type: 'text/csv' }), 'chs-equipment-template.csv')}>Blank template</Button>
        </div>
      </section>
      <section className="card eq-kit">
        <h3 className="eq-h3">Import</h3>
        {!unlocked ? (
          <><p className="eq-note">Adds new asset numbers and updates ones already there. Admins only.</p><div><Button variant="secondary" onClick={() => setAsking(true)}>Import a spreadsheet…</Button></div></>
        ) : (
          <>
            <p className="eq-note">A CSV or Excel file with a header row: CHS Asset Number, Model, Description, Serial Number and so on (as the export). A known asset number is updated, a new one added.</p>
            <input ref={file} type="file" accept=".csv,.txt,.xlsx,.xls" onChange={(e) => read(e.target.files?.[0])} />
            {rows && (
              <>
                <p className="eq-note"><b>{rows.length} rows</b>, {usable} with an asset number. The first ones:</p>
                <ul className="eq-picklist">{preview.map((m, i) => <li key={i} className="eq-picked eq-small">{Object.entries(m).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(' · ') || '(nothing recognised)'}</li>)}</ul>
                <div className="eq-actions-row">
                  <Button disabled={!!busy || !usable} onClick={async () => { setBusy('Importing…'); setError(''); try { const r = await s.importItems(rows); setRows(null); onDone(`Import done: ${r.added} added, ${r.updated} updated.`) } catch (e) { setError(e.message || String(e)) } finally { setBusy('') } }}>{busy || `Import ${usable}`}</Button>
                  <Button variant="ghost" onClick={() => setRows(null)}>Cancel</Button>
                </div>
              </>
            )}
          </>
        )}
        {busy && !rows && <p className="eq-note">{busy}</p>}
        {error && <Alert tone="critical" title="Not done">{error}</Alert>}
      </section>
      {asking && <AdminDialog s={s} title="Import a spreadsheet" message="Importing changes the equipment list for everyone." confirmLabel="Continue" onClose={() => setAsking(false)} onConfirm={async () => { setUnlocked(true); setAsking(false) }} />}
    </>
  )
}

/** Simpro: job creation on or off (old: toggleSimproJobCreation), and loans with no job (old: Simpro Job Health). */
function Simpro({ s, onDone }) {
  const [cfg, setCfg] = useState(s.simproConfig || null)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const [making, setMaking] = useState('')
  const [confirmDialog, confirm] = useConfirm()
  useEffect(() => { s.loadJobConfig().then(setCfg, (e) => setError(e.message || String(e))) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const sections = useMemo(() => loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode }), [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode])
  const missing = useMemo(() => (cfg && s.extrasReady ? loansMissingJobs(sections, s.loanDocs, cfg, s.today, s.equipment) : []), [sections, s.loanDocs, cfg, s.today, s.extrasReady, s.equipment])
  const [links, setLinks] = useState({}) // a job number typed against a row (old: the "Existing job #" box and Link)
  async function link(g) {
    const n = Number(String(links[g.docKey] || '').trim())
    if (!Number.isInteger(n) || n <= 0) return setError('Type the Simpro job number (digits only), then Link.')
    setMaking(g.docKey); setError('')
    try { await s.setJobNumber(g.docKey, n, g.loanTo); onDone(`Job #${n} linked to ${g.loanTo}.`) } catch (e) { setError(e.message || String(e)) } finally { setMaking('') }
  }
  if (!cfg) return error ? <Alert tone="critical" title="Didn’t load">{error}</Alert> : <Loading />
  async function off() {
    if (!(await confirm({ title: 'Turn Simpro job creation off?', message: 'New loans stop making Simpro jobs. Jobs already made still update and close as before.', confirmLabel: 'Turn off' }))) return
    try { setCfg(await s.setJobCreation(false)); onDone('Simpro job creation is off.') } catch (e) { setError(e.message || String(e)) }
  }
  async function make(g) {
    if (!cfg.createJobs && !(await confirm({ title: `Make a new Simpro job for ${g.loanTo}?`, message: 'New loans don’t make jobs at the moment. Only do this if this loan really needs one: if the job already exists in Simpro, put its number on the loan’s form instead.', confirmLabel: 'Make the job' }))) return
    setMaking(g.docKey); setError('')
    try {
      const r = await s.submitJob(g.docKey, { loanTo: g.loanTo, location: g.location, startDate: g.startDate, endDate: g.endDate, accountManager: g.am, jobType: 'Demo',
        items: g.items.map((e) => ({ CHSAssetNo: e.CHSAssetNo, Model: e.Model, Description: e.Description, SerialNo: e.SerialNo })) }, { allowCreate: true })
      onDone(r.test ? `Made up job ${r.jobId} (test mode or the dev server).` : r.skipped ? `Nothing made: ${r.skipped}.` : `Simpro job being made for ${g.loanTo}.`)
    } catch (e) { setError(e.message || String(e)) } finally { setMaking('') }
  }
  return (
    <>
      <section className="card eq-kit">
        <h3 className="eq-h3">Job creation</h3>
        <p className="eq-note">Job creation is <b className={cfg.createJobs ? 'eq-st-ok' : 'eq-st-bad'}>{cfg.createJobs ? 'on' : 'off'}</b>
          {cfg.createJobs ? (cfg.changedBy ? `, switched on by ${cfg.changedBy}${cfg.changedAt ? ' ' + fmtDate(cfg.changedAt.slice(0, 10)) : ''}` : '')
            : (cfg.windDownFrom ? `, switched off ${fmtDate(cfg.windDownFrom)}${cfg.changedBy ? ' by ' + cfg.changedBy : ''}` : '')}.</p>
        <div>{cfg.createJobs ? <Button variant="danger" onClick={off}>Turn off</Button> : <Button onClick={() => setAsking(true)}>Turn on…</Button>}</div>
      </section>
      <section className="card eq-kit">
        <h3 className="eq-h3">Loans with no Simpro job</h3>
        <p className="eq-note">{cfg.createJobs ? 'Every loan out (not long term) with no job number.' : 'Loans started before job creation was switched off, with no job number.'}</p>
        {!s.extrasReady ? <Loading /> : missing.length ? (
          <ul className="eq-picklist">
            {missing.map((g) => (
              <li key={g.docKey} className="eq-picked">
                <span className="eq-picked-main"><span className="eq-strong">{g.loanTo}</span> <Badge tone={g.type === 'Active' ? 'green' : 'purple'}>{g.type}</Badge>
                  <span className="eq-small">{[g.am, g.location, g.startDate && `${fmtDate(g.startDate)} to ${fmtDate(g.endDate) || '…'}`, `${g.items.length} ${g.items.length === 1 ? 'device' : 'devices'}`].filter(Boolean).join(' · ')}</span></span>
                <input className="input eq-mono eq-job-link" inputMode="numeric" placeholder="Existing job #" aria-label={`Existing Simpro job number for ${g.loanTo}`} value={links[g.docKey] || ''} onChange={(e) => setLinks((x) => ({ ...x, [g.docKey]: e.target.value }))} />
                <Button size="sm" variant="ghost" disabled={!!making || !links[g.docKey]} onClick={() => link(g)}>Link</Button>
                <Button size="sm" variant="secondary" disabled={!!making} onClick={() => make(g)}>{making === g.docKey ? 'Working…' : 'Make job'}</Button>
              </li>
            ))}
          </ul>
        ) : <p className="eq-note">None: every loan that should have a job has one.</p>}
      </section>
      {error && <Alert tone="critical" title="Not done">{error}</Alert>}
      {asking && <AdminDialog s={s} title="Turn Simpro job creation on?" message="New loans start making Simpro jobs again." confirmLabel="Turn on" onClose={() => setAsking(false)}
        onConfirm={async () => { setCfg(await s.setJobCreation(true)); setAsking(false); onDone('Simpro job creation is on.') }} />}
      {confirmDialog}
    </>
  )
}

/**
 * The tracker's team (old: the Account Managers list, behind the admin password; now hub admins):
 * each person's role, name and email, adding someone (with or without a sign-in) and taking
 * them off. The same changes as Settings, People and access (apps/admin/src/tracker.js), so
 * whichever place is used, the other shows it.
 */
function Team({ s, onDone }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // { was, name, email }
  const [adding, setAdding] = useState({ name: '', email: '', role: 'am' })
  const [confirmDialog, confirm] = useConfirm()
  const norm = (v) => String(v || '').trim().toLowerCase()
  const hubFor = (m) => (s.hubUsers || []).find((u) => !u.pending && ((m.email && norm(u.email) === norm(m.email)) || (norm(u.displayName) && norm(u.displayName) === norm(m.name))))
  const people = [...(s.managers || [])].filter((m) => m && m.name)
    .filter((m) => !q.trim() || norm(m.name).includes(norm(q)) || norm(m.email).includes(norm(q)))
    .sort((a, b) => a.name.localeCompare(b.name))
  const person = (m) => { const u = hubFor(m); return { uid: u?.uid, name: m.name, email: m.email || u?.email || '' } }
  async function run(key, fn, msg) {
    setBusy(key); setError('')
    try { await fn(); await s.reloadTeam(); onDone(msg); return true } catch (e) { setError(e.message || String(e)); return false } finally { setBusy('') }
  }
  return (
    <>
      <section className="card eq-kit">
        <h3 className="eq-h3">The demo tracker’s team</h3>
        <p className="eq-note">Account managers get reminders for their own loans; Service &amp; Projects get the ones they handle. The same roles are in <a href="/settings/people">Settings, People and access</a>: a change in either shows in both.</p>
        <label className="field"><span className="field-label">Search</span><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name or email" /></label>
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <ul className="eq-picklist">
          {people.map((m) => {
            const u = hubFor(m), key = norm(m.name)
            return (
              <li key={key} className="eq-picked eq-team-row">
                <span className="eq-picked-main"><span className="eq-strong">{m.name}</span>
                  <span className="eq-small">{m.email || 'No email'}{u ? ' · signs in to the hub' : ' · no hub sign-in'}</span></span>
                <select value={m.role === 'service' ? 'service' : 'am'} disabled={!!busy} aria-label={`${m.name}’s role`}
                  onChange={(e) => { const role = e.target.value; run(key, () => setMemberRole(person(m), role), `${m.name} is now ${TRACKER_ROLES.find((r) => r.id === role)?.label}.`) }}>
                  {TRACKER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditing({ was: { name: m.name, email: m.email || '' }, name: m.name, email: m.email || '' })}>Edit</Button>
                <Button size="sm" variant="ghost" className="eq-danger" disabled={!!busy} onClick={async () => {
                  if (!(await confirm({ title: `Take ${m.name} off the team?`, message: 'They stop getting demo reminders and aren’t offered as an account manager. Their loans keep their name.', confirmLabel: 'Take them off', danger: true }))) return
                  run(key, async () => { await removeMember(person(m)); await s.audit('am_removed', `${m.name} removed from account managers`, { name: m.name, email: m.email || '' }) }, `${m.name} taken off the team.`)
                }}>Remove</Button>
              </li>
            )
          })}
          {!people.length && <li className="eq-note">{(s.managers || []).length ? 'No one matches that.' : 'No one on the team yet.'}</li>}
        </ul>
      </section>
      <section className="card eq-kit">
        <h3 className="eq-h3">Add someone</h3>
        <p className="eq-note">For someone who should be offered as an account manager, even before they sign in to the hub.</p>
        <form className="eq-actions-row" onSubmit={(e) => { e.preventDefault(); run('add', () => addMember(adding), `${adding.name.trim()} added to the team.`).then((ok) => ok && setAdding({ name: '', email: '', role: 'am' })) }}>
          <label className="field eq-grow"><span className="field-label">Name</span><input className="input" value={adding.name} onChange={(e) => setAdding((x) => ({ ...x, name: e.target.value }))} /></label>
          <label className="field eq-grow"><span className="field-label">Email</span><input className="input" type="email" value={adding.email} onChange={(e) => setAdding((x) => ({ ...x, email: e.target.value }))} /></label>
          <label className="field"><span className="field-label">Role</span>
            <select value={adding.role} onChange={(e) => setAdding((x) => ({ ...x, role: e.target.value }))}>{TRACKER_ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select>
          </label>
          <Button type="submit" disabled={!!busy || !adding.name.trim()}>{busy === 'add' ? 'Adding…' : 'Add'}</Button>
        </form>
      </section>
      {editing && (
        <Dialog title={`Edit ${editing.was.name}`} description="Their phones and reminder settings stay with them." onClose={() => setEditing(null)} width={480}>
          <form className="eq-form" onSubmit={(e) => { e.preventDefault(); const ed = editing; run('edit', () => saveMember(ed.was, ed), `${ed.name.trim()} saved.`).then((ok) => ok && setEditing(null)) }}>
            <label className="field"><span className="field-label">Name</span><input className="input" value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} autoFocus /></label>
            <label className="field"><span className="field-label">Email</span><input className="input" type="email" value={editing.email} onChange={(e) => setEditing((x) => ({ ...x, email: e.target.value }))} /></label>
            <p className="eq-note">Loans already made keep the old name as their account manager.</p>
            {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
            <div className="dialog-actions"><Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button><Button type="submit" disabled={!!busy}>{busy === 'edit' ? 'Saving…' : 'Save'}</Button></div>
          </form>
        </Dialog>
      )}
      {confirmDialog}
    </>
  )
}

/** A test notification to someone on the team, to check it reaches their phone (old: Settings, Test Notifications). */
function TestPush({ s, onDone }) {
  const people = [...(s.managers || [])].filter((m) => m && m.name).sort((a, b) => a.name.localeCompare(b.name))
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function send(e) {
    e.preventDefault()
    if (!to) return
    setBusy(true); setError('')
    try {
      const r = await s.testPush(to)
      onDone(r.simulated ? `Not sent (the dev server): it would go to ${r.sentTo}.` : `Test notification sent to ${r.sentTo}${r.devices ? ` (${r.devices} ${r.devices === 1 ? 'device' : 'devices'})` : ''}.`)
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }
  return (
    <section className="card eq-kit">
      <h3 className="eq-h3">Send a test notification</h3>
      <p className="eq-note">It says who sent it and that it’s a test. They need notifications turned on at internal.chsnz.co.nz on their phone first.</p>
      <form className="eq-actions-row" onSubmit={send}>
        <label className="field eq-grow"><span className="field-label">To</span>
          <select value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose someone…</option>{people.map((m) => <option key={m.name}>{m.name}</option>)}</select>
        </label>
        <Button type="submit" disabled={busy || !to}>{busy ? 'Sending…' : 'Send test notification'}</Button>
      </form>
      {error && <Alert tone="critical" title="Not sent">{error}</Alert>}
    </section>
  )
}

/** Test mode (old: toggleTestMode): Simpro jobs and emails are pretended, loans are made as test loans. This browser only. */
function TestMode({ s, onDone }) {
  const [asking, setAsking] = useState(false)
  return (
    <section className="card eq-kit">
      <h3 className="eq-h3">Test mode is {s.testMode ? 'on' : 'off'} in this browser</h3>
      <p className="eq-note">With it on, loans are made as test loans (seen only with test mode on), and Simpro jobs and emails are pretended rather than sent. Everything else is saved for real.</p>
      <div>{s.testMode ? <Button variant="secondary" onClick={() => { s.setTestMode(false); onDone('Test mode is off: Simpro and email are live again.') }}>Turn off</Button> : <Button onClick={() => setAsking(true)}>Turn on…</Button>}</div>
      {asking && <TestModeConfirm s={s} onClose={() => setAsking(false)} onConfirm={() => { s.setTestMode(true); setAsking(false); onDone('Test mode is on: Simpro jobs and emails are pretended.') }} />}
    </section>
  )
}

/** Test mode on: for admins and the testers an admin marks (users.trackerTester). */
function TestModeConfirm({ s, onClose, onConfirm }) {
  return (
    <Dialog title="Turn test mode on?" onClose={onClose} width={440}>
      <p className="confirm-text">{s.canTestMode ? 'Loans you make are test loans until you turn it off, in this browser.' : 'Test mode is for admins and the testers an admin marks.'}</p>
      <div className="dialog-actions">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        {s.canTestMode && <Button onClick={onConfirm} autoFocus>Turn on</Button>}
      </div>
    </Dialog>
  )
}

/**
 * Data source (step 5B's cutover, admins): where the tracker's data is, and
 * read-only for the quiet hour while it's copied. The steps, in order:
 * read-only on; the migration run (backend/tracker-migration, by someone with
 * the keys); Firestore on; read-only off. Every open tracker, the project
 * tracker's feed and the proxy follow the switch within a second or two.
 */
function Source({ s, onDone }) {
  const c = s.cutover || { source: 'rtdb', readOnly: false }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDialog, confirm] = useConfirm()
  async function change(next, ask) {
    if (ask && !(await confirm(ask))) return
    setBusy(true); setError('')
    try { await setCutover({ ...c, ...next }, s.operator); onDone('Data source saved.') } catch (e) { setError(e.message || String(e)) } finally { setBusy(false) }
  }
  const fs = c.source === 'firestore'
  return (
    <section className="card eq-kit">
      <h3 className="eq-h3">The tracker’s data is in {fs ? 'Firestore (the hub)' : 'the old Realtime Database'}{c.readOnly ? ', read-only' : ''}</h3>
      {c.at && <p className="eq-note">Last changed {fmtDate(c.at.slice(0, 10))}{c.by ? ' by ' + c.by : ''}.</p>}
      <ol className="eq-bullets">
        <li>Read-only on, so nothing changes while it’s copied.</li>
        <li>The migration run (backend/tracker-migration: its dry run first, then --write), by someone with the two keys.</li>
        <li>Firestore on. Every open tracker reloads onto it.</li>
        <li>Read-only off.</li>
      </ol>
      <div className="eq-actions-row">
        <Button variant="secondary" disabled={busy} onClick={() => change({ readOnly: !c.readOnly })}>{c.readOnly ? 'Read-only off' : 'Read-only on'}</Button>
        {!fs && <Button disabled={busy} onClick={() => change({ source: 'firestore' }, { title: 'Move the tracker onto Firestore?', message: 'Only once the migration has run and its check passed. Every open tracker reloads onto it.', confirmLabel: 'Move it' })}>Firestore on</Button>}
        {fs && <Button variant="danger" disabled={busy} onClick={() => change({ source: 'rtdb' }, { title: 'Go back to the old database?', message: 'Changes made on Firestore since the move aren’t in the old database. Only for undoing a move that went wrong.', confirmLabel: 'Go back', danger: true })}>Back to the old database</Button>}
      </div>
      {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
      {confirmDialog}
    </section>
  )
}
