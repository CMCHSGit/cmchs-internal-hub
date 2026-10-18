/* An equipment record's changes (old: the Add/Edit item form, Retire, and
   Delete with the admin password). The loan fields are on the form as in
   the old one, for putting a record right; loans themselves are made and
   changed from Loans. */
import { useState } from 'react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { FIELDS, RETIRE_REASONS } from './model.js'

const DATES = new Set(['MfgDate', 'PurchaseDate', 'LoanStartDate', 'LoanEndDate'])
const NUMBERS = new Set(['USPrice', 'NZPrice'])
const GROUPS = [
  ['The item', ['CHSAssetNo', 'Model', 'Description', 'SerialNo', 'BatterySerialNo', 'PartNo', 'MfgDate', 'PurchaseDate', 'USPrice', 'NZPrice', 'ShelfLocation', 'Notes']],
  ['Tracking', ['TileNo', 'TileType', 'TileUUID', 'DeviceID', 'LanMAC', 'WlanMAC', 'OldCHS', 'Counted']],
  ['Loan (put a record right; loans are made in Loans)', ['OnLoanTo', 'Location', 'LoanStartDate', 'LoanEndDate', 'Returned', 'BorrowerEmail']],
]
const LABEL = Object.fromEntries(FIELDS)

/** Add an item, or edit one (old: saveItem). */
export function ItemForm({ s, item = null, onClose, onDone }) {
  const [f, setF] = useState(() => Object.fromEntries(FIELDS.map(([k]) => [k, item?.[k] ?? ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await s.saveItem(f, item?.id || null); onDone(item ? `${f.CHSAssetNo} updated.` : `${f.CHSAssetNo} added.`) } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }
  const input = (k) => {
    if (k === 'Returned') return <select value={f[k]} onChange={set(k)}><option value="">—</option><option>Yes</option><option>No</option></select>
    if (k === 'Notes') return <textarea className="input" rows={2} value={f[k]} onChange={set(k)} />
    return <input className="input" type={DATES.has(k) ? 'date' : NUMBERS.has(k) ? 'number' : 'text'} step={NUMBERS.has(k) ? '0.01' : undefined} value={f[k]} onChange={set(k)} required={k === 'CHSAssetNo'} autoFocus={k === 'CHSAssetNo' && !item} />
  }
  return (
    <Dialog title={item ? `Edit ${item.CHSAssetNo}` : 'Add equipment'} onClose={onClose} width={760}>
      <form className="eq-form" onSubmit={save}>
        {GROUPS.map(([title, keys]) => (
          <fieldset key={title} className="eq-fieldset">
            <legend className="eq-section-title">{title}</legend>
            <div className="eq-fields-grid">
              {keys.map((k) => <label key={k} className={`field${k === 'Notes' || k === 'Description' ? ' eq-wide' : ''}`}><span className="field-label">{LABEL[k] || k}{k === 'CHSAssetNo' ? ' *' : ''}</span>{input(k)}</label>)}
            </div>
          </fieldset>
        ))}
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : item ? 'Save' : 'Add it'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Something only an admin may do, after the admin password (old: adminPrompt). */
export function AdminDialog({ s, title, message, confirmLabel, danger = false, children, onClose, onConfirm }) {
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function go(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (!(await s.checkAdmin(pw))) { setError('That isn’t the admin password.'); return }
      await onConfirm()
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }
  return (
    <Dialog title={title} onClose={onClose} width={480}>
      <form className="eq-form" onSubmit={go}>
        {message && <p className="confirm-text">{message}</p>}
        {children}
        <label className="field"><span className="field-label">Admin password</span><input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" autoFocus /></label>
        {error && <Alert tone="critical" title="Not done">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy || !pw}>{busy ? 'Working…' : confirmLabel}</Button>
        </div>
      </form>
    </Dialog>
  )
}

/** Retire an item: why, and any notes (old: the retire modal). */
export function RetireDialog({ s, item, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  return (
    <AdminDialog s={s} title={`Retire ${item.CHSAssetNo}${item.Model ? ' · ' + item.Model : ''}`} confirmLabel="Retire it" onClose={onClose}
      message="It moves to Sold / Retired, off the equipment list. It can be brought back from there."
      onConfirm={async () => { await s.retireItem(item.id, { reason, notes }); onDone(`${item.CHSAssetNo} moved to Sold / Retired.`) }}>
      <label className="field"><span className="field-label">Why</span>
        <select value={reason} onChange={(e) => setReason(e.target.value)}><option value="">Optional…</option>{RETIRE_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
      </label>
      <label className="field"><span className="field-label">Notes</span><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
    </AdminDialog>
  )
}
