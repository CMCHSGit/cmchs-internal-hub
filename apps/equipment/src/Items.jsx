/* An equipment record's changes (old: the Add/Edit item form, Retire, and
   Delete, which an admin confirms: the hub role, not the old admin password). The loan fields are on the form as in
   the old one, for putting a record right; loans themselves are made and
   changed from Loans. */
import { useState } from 'react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { ADD_FIELDS, FIELDS, RETIRE_REASONS } from './model.js'

const DATES = new Set(['MfgDate', 'PurchaseDate', 'LoanStartDate', 'LoanEndDate'])
const NUMBERS = new Set(['USPrice', 'NZPrice'])
const GROUPS = [
  ['The item', ['CHSAssetNo', 'Model', 'Description', 'SerialNo', 'BatterySerialNo', 'PartNo', 'MfgDate', 'PurchaseDate', 'USPrice', 'NZPrice', 'ShelfLocation', 'Notes']],
  ['Tracking', ['TileNo', 'TileType', 'TileUUID', 'DeviceID', 'LanMAC', 'WlanMAC', 'OldCHS', 'Counted']],
  ['Loan (put a record right; loans are made in Loans)', ['OnLoanTo', 'Location', 'LoanStartDate', 'LoanEndDate', 'Returned', 'BorrowerEmail']],
]
const LABEL = Object.fromEntries(FIELDS)

const ADD_LABELS = { CHSAssetNo: 'CHS asset no.', Model: 'Model', Description: 'Description', SerialNo: 'Serial number', BatterySerialNo: 'Battery serial no.', PartNo: 'Part number',
  MfgDate: 'Manufactured', PurchaseDate: 'Purchased', USPrice: 'US$ price', NZPrice: 'NZ$ price', ShelfLocation: 'Shelf location', DeviceID: 'Device ID', Notes: 'Notes' }
const blankSlot = () => Object.fromEntries(ADD_FIELDS.map((f) => [f, '']))

/**
 * Add assets (old: the "+ Add Asset" form, maSaveAll): one or more, "Add another asset" for each
 * more, and optionally a kit made from them: a new one (a name and the trigger, the rest its
 * accessories) or the rest added to an existing kit. Save all checks every one first.
 */
export function AddAssets({ s, onClose, onDone }) {
  const [slots, setSlots] = useState([blankSlot()])
  const [kitOn, setKitOn] = useState(false)
  const [kit, setKit] = useState({ name: '', trigger: '', existing: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (i, k) => (e) => { const v = e.target.value; setSlots((l) => l.map((x, j) => (j === i ? { ...x, [k]: v } : x))) }
  const known = (k) => [...new Set((s.equipment || []).map((e) => e?.[k]).filter(Boolean))].sort()
  const numbers = slots.map((x) => x.CHSAssetNo.trim()).filter(Boolean)
  const kits = Object.entries(s.kits || {})
  async function save(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      const r = await s.addAssets(slots, kitOn ? { ...kit, trigger: kit.trigger || numbers[0] || '' } : null)
      onDone(`${r.added} ${r.added === 1 ? 'asset' : 'assets'} added${r.kit ? `; kit “${r.kit}” ${kit.existing ? 'updated' : 'made'}` : ''}.`)
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }
  return (
    <Dialog title="Add assets" onClose={onClose} width={820}>
      <form className="eq-form" onSubmit={save}>
        <datalist id="eq-models">{known('Model').map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="eq-descs">{known('Description').map((v) => <option key={v} value={v} />)}</datalist>
        {slots.map((slot, i) => (
          <fieldset key={i} className="eq-fieldset">
            <legend className="eq-section-title">Asset {i + 1}
              {i > 0 && <button type="button" className="btn btn-ghost btn-sm eq-danger" onClick={() => setSlots((l) => l.filter((_, j) => j !== i))}>Remove</button>}
            </legend>
            <div className="eq-fields-grid">
              {ADD_FIELDS.map((k) => (
                <label key={k} className={`field${k === 'Notes' || k === 'Description' ? ' eq-wide' : ''}`}><span className="field-label">{ADD_LABELS[k]}{k === 'CHSAssetNo' ? ' *' : ''}</span>
                  <input className="input" value={slot[k]} onChange={set(i, k)} required={k === 'CHSAssetNo'} autoFocus={k === 'CHSAssetNo' && i === slots.length - 1}
                    type={/Date$/.test(k) ? 'date' : /Price$/.test(k) ? 'number' : 'text'} step={/Price$/.test(k) ? '0.01' : undefined}
                    inputMode={k === 'CHSAssetNo' ? 'numeric' : undefined} list={k === 'Model' ? 'eq-models' : k === 'Description' ? 'eq-descs' : undefined} autoComplete="off" />
                </label>
              ))}
            </div>
          </fieldset>
        ))}
        <Button variant="secondary" onClick={() => setSlots((l) => [...l, blankSlot()])}>+ Add another asset</Button>
        <label className="eq-check"><input type="checkbox" checked={kitOn} onChange={(e) => setKitOn(e.target.checked)} /> Make a kit from these assets</label>
        {kitOn && (
          <div className="eq-form-row">
            <label className="field"><span className="field-label">Add to an existing kit instead?</span>
              <select value={kit.existing} onChange={(e) => setKit((k) => ({ ...k, existing: e.target.value }))}><option value="">No, a new kit</option>{kits.map(([key, k]) => <option key={key} value={key}>{k.label || key}</option>)}</select>
            </label>
            {!kit.existing && <label className="field"><span className="field-label">Kit name</span><input className="input" value={kit.name} onChange={(e) => setKit((k) => ({ ...k, name: e.target.value }))} placeholder="e.g. TE9 Ultrasound Crate" /></label>}
            <label className="field"><span className="field-label">Trigger device (the main one)</span>
              <select value={kit.trigger || numbers[0] || ''} onChange={(e) => setKit((k) => ({ ...k, trigger: e.target.value }))}>
                {!numbers.length && <option value="">Type the asset numbers first</option>}
                {numbers.map((n, i) => <option key={n + i} value={n}>{n}{slots.find((x) => x.CHSAssetNo.trim() === n)?.Model ? ' — ' + slots.find((x) => x.CHSAssetNo.trim() === n).Model : ''}</option>)}
              </select>
            </label>
          </div>
        )}
        {error && <Alert tone="critical" title="Not saved">{error}</Alert>}
        <div className="dialog-actions">
          <span className="text-sm text-muted eq-grow">{slots.length} {slots.length === 1 ? 'asset' : 'assets'}</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save all'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

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
    return <input className="input" type={DATES.has(k) ? 'date' : NUMBERS.has(k) ? 'number' : 'text'} step={NUMBERS.has(k) ? '0.01' : undefined} value={f[k]} onChange={set(k)} required={k === 'CHSAssetNo'} autoFocus={k === 'CHSAssetNo' && !item}
      list={k === 'Model' ? 'eq-models' : k === 'Description' ? 'eq-descs' : undefined} />
  }
  // The models and descriptions already in use, offered as typed (old: _populateModelDescLists), so spellings stay the same.
  const known = (k) => [...new Set((s.equipment || []).map((e) => e?.[k]).filter(Boolean))].sort()
  return (
    <Dialog title={item ? `Edit ${item.CHSAssetNo}` : 'Add equipment'} onClose={onClose} width={760}>
      <form className="eq-form" onSubmit={save}>
        <datalist id="eq-models">{known('Model').map((v) => <option key={v} value={v} />)}</datalist>
        <datalist id="eq-descs">{known('Description').map((v) => <option key={v} value={v} />)}</datalist>
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

/**
 * Something only a hub admin may do (step 5A: in place of the old tracker's
 * admin password, adminPrompt). An admin confirms; anyone else is told who can.
 * The Firestore rules refuse it for anyone else too.
 */
export function AdminDialog({ s, title, message, confirmLabel, danger = false, children, onClose, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function go(e) {
    e.preventDefault()
    setBusy(true); setError('')
    try { await onConfirm() } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }
  if (!s.isAdmin) {
    return (
      <Dialog title={title} onClose={onClose} width={440}>
        <p className="confirm-text">Only a hub admin can do this. Ask one of the admins (Settings, People and access, lists them).</p>
        <div className="dialog-actions"><Button onClick={onClose}>OK</Button></div>
      </Dialog>
    )
  }
  return (
    <Dialog title={title} onClose={onClose} width={480}>
      <form className="eq-form" onSubmit={go}>
        {message && <p className="confirm-text">{message}</p>}
        {children}
        {error && <Alert tone="critical" title="Not done">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant={danger ? 'danger' : 'primary'} disabled={busy} autoFocus>{busy ? 'Working…' : confirmLabel}</Button>
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
