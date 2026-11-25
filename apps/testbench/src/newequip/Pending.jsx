/* Assets recorded while testing, waiting to go into the customer's workbook (pending.js). Record one here (the details of the new
   asset-list template), test it on the bench straight away, and when the day's done copy the rows to paste under the asset list's last
   row (in that sheet's own column order) or download them as a .csv, then clear them. NOTHING is written to the workbook or to Simpro. */
import { useEffect, useMemo, useState } from 'react'
import { ClipboardCopy, Download, FlaskConical, Pencil, Plus, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Dialog, Toast, useConfirm, useToast } from '../../../../shared/ui/index.jsx'
import { logActivity } from '../../../../shared/activity.js'
import { CHOICE_KEYS, FIELDS, choicesFor, clashes, editClashes, changedFields, fillFromModel, cleanPending, missingSite, testLink, toCsv, toHtml, toTsv, sheetsToRemember } from './pending.js'
import { sendToSimpro } from './toSimpro.js'
import { useTestLink } from './open-device.js'
import { addPending, editPending, removePending, watchPending } from './pending-firebase.js'

const PLACEHOLDER = { installed: 'd/mm/yyyy', manufactured: 'e.g. 3/2026', warranty: 'd/mm/yyyy', site: 'Simpro site ID' }
const KEEP = ['site', 'manufacturer', 'ward', 'service', 'job'] // carried to the next asset: the same visit, usually the same ward and job

// Each customer's sheet columns (names and header rows only), remembered on this PC when its asset list is loaded, so Copy lays the
// rows out in the right columns on a later day too. AssetList saves them; read here.
const SHEETS_KEY = 'newEquip.sheets'
export function rememberSheets(customerId, sheets) {
  try { const all = JSON.parse(localStorage.getItem(SHEETS_KEY) || '{}'); all[customerId] = sheetsToRemember(sheets); localStorage.setItem(SHEETS_KEY, JSON.stringify(all)) } catch { /* not remembered */ }
}
function rememberedSheets(customerId) {
  try { const v = JSON.parse(localStorage.getItem(SHEETS_KEY) || '{}')[customerId]; return Array.isArray(v) ? v : [] } catch { return [] }
}

/**
 * Puts the text and the HTML on the clipboard through a copy event, which writes the HTML exactly as given. (navigator.clipboard.write
 * cleans HTML up first, and that may drop the mso-number-format Excel needs.) True when it worked; it must run from a click.
 */
function copyBoth(text, html) {
  let handled = false
  const on = (e) => { e.clipboardData.setData('text/plain', text); e.clipboardData.setData('text/html', html); e.preventDefault(); handled = true }
  document.addEventListener('copy', on)
  try { return document.execCommand('copy') && handled } catch { return false } finally { document.removeEventListener('copy', on) }
}

const saveBlob = (name, blob) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000) }

export default function Pending({ customer, units, sheets: loaded, canSimpro }) {
  const [rows, setRows] = useState(null)
  const { onClick: openTest } = useTestLink()
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(null) // null | { start: form } | { start: form, original: the row being corrected }
  const [sheet, setSheet] = useState('')
  const [toast, say] = useToast()
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => {
    setRows(null); setError('')
    return watchPending(customer.id, setRows, (e) => { setRows([]); setError(e?.code === 'permission-denied' ? 'The pending rows can’t be read with this account, or the database rules for them aren’t published yet.' : (e?.message || 'The pending rows can’t be read.')) })
  }, [customer.id])

  const remembered = useMemo(() => rememberedSheets(customer.id), [customer.id, loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  const sheets = loaded.length ? loaded : remembered
  const headers = useMemo(() => (sheets.find((s) => s.name === sheet) || sheets[0])?.header || null, [sheets, sheet])
  const list = rows || []

  // All the rows, or one (`only`): tab-separated in the sheet's column order, to paste under the asset list's last row.
  // Text and an HTML table: Excel pastes the table, which marks asset numbers, serials and the like as text and sends dates as yyyy-mm-dd.
  const copy = async (only) => {
    const these = only ? [only] : list
    if (!headers && !await confirm({ title: 'The asset list’s columns aren’t known yet', message: 'Load the asset list first (Asset list, below) so the rows are laid out in its own columns; it is remembered on this PC after that. Copied now, they are in the new template’s usual order, which may not match this customer’s sheet.', confirmLabel: 'Copy in the usual order' })) return
    const text = toTsv(these, headers)
    const done = () => say(only ? `${only.serial} copied` : `${these.length} row${these.length === 1 ? '' : 's'} copied`)
    if (copyBoth(text, toHtml(these, headers))) return done()
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([toHtml(these, headers)], { type: 'text/html' }) })])
      done()
    } catch {
      try { await navigator.clipboard.writeText(text); say('Copied as plain text') } catch { say('Couldn’t copy: use Download instead.') }
    }
  }
  const download = () => saveBlob(`${customer.name} new assets.csv`, new Blob(['﻿' + toCsv(list, headers)], { type: 'text/csv;charset=utf-8' }))
  const noSite = useMemo(() => missingSite(list), [list])
  const toSimpro = () => sendToSimpro({ name: `${customer.name} new assets.csv`, mime: 'text/csv', buffer: new TextEncoder().encode(toCsv(list, null)).buffer }).catch(() => say('Couldn’t hand the rows to Simpro Asset Sync.'))
  const remove = async (r) => {
    if (!await confirm({ title: 'Remove this row?', message: `${r.serial} is taken off the pending list. It isn’t in the workbook, so record it again if it should be.`, confirmLabel: 'Remove', danger: true })) return
    try { await removePending(r.id); logActivity(null, 'Removed a pending asset row', { app: 'new-equipment' }) } catch { say('Couldn’t remove it.') }
  }
  const clearAll = async () => {
    if (!await confirm({ title: `Clear all ${list.length} pending rows?`, message: 'Only do this once they are pasted into the workbook. They are removed from this list for everyone.', confirmLabel: 'They are pasted', danger: true })) return
    try { for (const r of list) await removePending(r.id); logActivity(null, `Cleared ${list.length} pending asset rows (pasted into the workbook)`, { app: 'new-equipment' }); say('Cleared') } catch { say('Couldn’t clear them all.') }
  }

  const start = () => {
    const last = list[list.length - 1], form = {}
    if (last) for (const k of KEEP) form[k] = last[k]
    setAdding({ start: form })
  }

  return (
    <section className="card ne-card" aria-label="Recorded assets">
      <div className="ne-row">
        <div className="ne-grow">
          <h2 className="ne-h2">Recorded assets {list.length > 0 && <Badge tone="orange">{list.length} not in the workbook</Badge>}</h2>
          <p className="ne-note">Record each new asset as you test it. They wait here until you paste them into the asset list.</p>
        </div>
        <Button iconLeft={<Plus size={16} aria-hidden="true" />} onClick={start}>Record an asset</Button>
      </div>
      {error && <Alert tone="warning" title="Pending rows not available">{error}</Alert>}

      {list.length > 0 && (
        <>
          <div className="ne-table-wrap">
            <table className="ne-table">
              <thead><tr><th scope="col">Serial number</th><th scope="col">Device</th><th scope="col">Site</th><th scope="col">Ward</th><th scope="col"><span className="ne-sr">Actions</span></th></tr></thead>
              <tbody>
                {list.map((r) => (
                  <tr key={r.id}>
                    <td className="ne-mono">{r.serial}</td>
                    <td>{[r.model || r.description, r.type && r.model ? r.type : ''].filter(Boolean).join(' · ') || '–'}</td>
                    <td>{r.site || '–'}</td><td>{r.ward || '–'}</td>
                    <td className="ne-actions">
                      <Button variant="ghost" size="sm" aria-label={`Copy ${r.serial} for the workbook`} title="Copy this row to paste into the asset list" iconLeft={<ClipboardCopy size={14} aria-hidden="true" />} onClick={() => copy(r)}>Copy</Button>
                      <Button variant="ghost" size="sm" aria-label={`Edit ${r.serial}`} iconLeft={<Pencil size={14} aria-hidden="true" />} onClick={() => setAdding({ start: { ...r }, original: r })}>Edit</Button>
                      <a className="btn btn-sm btn-secondary" href={testLink(r, customer.name)} onClick={openTest(testLink(r, customer.name))}><FlaskConical size={14} aria-hidden="true" /> Test this device</a>
                      <Button variant="ghost" size="sm" aria-label={`Remove ${r.serial}`} iconLeft={<Trash2 size={14} aria-hidden="true" />} onClick={() => remove(r)}>Remove</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ne-links">
            {sheets.length > 1 && (
              <label className="field"><span className="field-label">Lay out for sheet</span>
                <select className="input" value={sheet || sheets[0].name} onChange={(e) => setSheet(e.target.value)}>{sheets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}</select></label>
            )}
            <Button iconLeft={<ClipboardCopy size={15} aria-hidden="true" />} onClick={() => copy()}>Copy rows for the workbook</Button>
            <Button variant="secondary" iconLeft={<Download size={15} aria-hidden="true" />} onClick={download}>Download .csv</Button>
            {canSimpro && <Button variant="secondary" disabled={noSite.length > 0} onClick={toSimpro}>Preview these in Simpro</Button>}
            <Button variant="ghost" onClick={clearAll}>They’re pasted: clear</Button>
          </div>
          {canSimpro && noSite.length > 0 && <p className="ne-note">To preview these in Simpro, each needs a Site ID (Simpro matches an asset within its site): {noSite.slice(0, 4).join(', ')}{noSite.length > 4 ? '…' : ''}.</p>}
          {canSimpro && <p className="ne-note">“Preview these in Simpro” opens Simpro Asset Sync with just these rows. It reads Simpro and shows what would be created; nothing changes until you press Apply there.</p>}
          <p className="ne-note">{loaded.length ? 'Laid out in the columns of the asset list you loaded.' : headers ? 'Laid out in the columns of this customer’s asset list as it was when last loaded on this PC.' : 'Load the asset list to lay the rows out in its columns; until then they use the new template’s usual order.'} Dates go out as year-month-day, which Excel reads the same whatever its date order. Paste under the sheet’s last row (Copy on a row copies just that one), then clear them.</p>
        </>
      )}
      {list.length === 0 && !error && rows && <p className="ne-note">Nothing waiting.</p>}

      {adding && <RecordForm key={adding.original?.id || 'new'} customer={customer} units={units} pending={list} start={adding.start} original={adding.original} onClose={() => setAdding(null)}
        onSaved={(more, msg) => { say(msg || 'Recorded'); if (!more) setAdding(null) }} />}
      {confirmDialog}
      <Toast message={toast} />
    </section>
  )
}

/** Record a new asset, or (with `original`) correct one already recorded: the same form, filled in with its details. */
function RecordForm({ customer, units, pending, start, original, onClose, onSaved }) {
  const [f, setF] = useState(start)
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const { go } = useTestLink()
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const choices = useMemo(() => Object.fromEntries(CHOICE_KEYS.map((k) => [k, choicesFor(k, units, pending)])), [units, pending])

  const save = async (then) => {
    const { row, errors: errs } = cleanPending(f)
    const all = [...errs, ...(original ? editClashes(row, original, units, pending) : clashes(row, units, pending))]
    setErrors(all)
    if (all.length) return
    if (original) {
      const changed = changedFields(original, row)
      if (!changed.length) { if (then === 'test') go(testLink(row, customer.name)); else onClose(); return }
      setBusy(true)
      try {
        await editPending(original.id, row)
        logActivity(null, `Corrected a recorded asset (${changed.length} field${changed.length === 1 ? '' : 's'})`, { app: 'new-equipment' })
        if (then === 'test') { go(testLink(row, customer.name)); return }
        onSaved(false, 'Saved')
      } catch (err) {
        setErrors([err?.code === 'permission-denied' ? 'The database refused the change: the rules that allow editing recorded assets may not be published yet (rules/README.md), or this account can’t use the Test Bench.' : (err?.message || 'Couldn’t save it.')])
        setBusy(false)
      }
      return
    }
    setBusy(true)
    try {
      await addPending(customer.id, row)
      logActivity(null, 'Recorded a new asset (pending)', { app: 'new-equipment' })
      if (then === 'test') { go(testLink(row, customer.name)); return }
      if (then === 'more') { const keep = {}; for (const k of KEEP) keep[k] = row[k]; setF(keep); setBusy(false); onSaved(true); return }
      onSaved(false)
    } catch (err) {
      setErrors([err?.code === 'permission-denied' ? 'This account can’t record assets, or the database rules for them aren’t published yet.' : (err?.message || 'Couldn’t save it.')])
      setBusy(false)
    }
  }

  return (
    <Dialog title={original ? `Edit ${original.serial}` : 'Record an asset'} description={original ? `${customer.name}. Correct what was recorded; it keeps its place in the list.` : `${customer.name}. Only the serial number is needed; fill in what you have.`} onClose={onClose} width={680}>
      <form className="ne-form" onSubmit={(e) => { e.preventDefault(); save('close') }}>
        <div className="ne-grid2">
          {FIELDS.map(([k, label]) => (
            <label key={k} className="field"><span className="field-label">{label}{k === 'serial' ? ' *' : ''}</span>
              <input className="input" value={f[k] || ''} onChange={set(k)} placeholder={PLACEHOLDER[k] || ''} autoComplete="off" autoFocus={k === 'serial'}
                list={choices[k]?.length ? `ne-choices-${k}` : undefined} onBlur={k === 'model' ? () => setF((x) => fillFromModel(x, units)) : undefined} /></label>
          ))}
        </div>
        {CHOICE_KEYS.map((k) => choices[k].length > 0 && <datalist key={k} id={`ne-choices-${k}`}>{choices[k].map((v) => <option key={v} value={v} />)}</datalist>)}
        {errors.length > 0 && <Alert tone="critical" title={original ? 'Not saved yet' : 'Not recorded yet'}>{errors.map((x) => <div key={x}>{x}</div>)}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {!original && <Button variant="secondary" disabled={busy} onClick={() => save('more')}>Save and add another</Button>}
          <Button variant="secondary" disabled={busy} onClick={() => save('test')}>Save and test it</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
