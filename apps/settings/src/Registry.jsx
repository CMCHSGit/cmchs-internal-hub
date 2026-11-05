/*
 * Settings → New equipment testing (admins only): the customer registry. For each large customer, the links to its asset
 * list and its reports folder (online OneDrive or SharePoint) and which Simpro customer and sites it is, so the new-equipment
 * page can open a customer's files without anyone browsing to a folder. Links and numbers only: no workbook and no report
 * is kept here. Stored in Firestore `customerRegistry` (apps/testbench/src/registry*.js; rules/firestore.rules).
 */
import { useEffect, useState } from 'react'
import { ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react'
import { Alert, Badge, Button, Dialog, Loading, Toast, useConfirm, useToast } from '../../../shared/ui/index.jsx'
import { logActivity } from '../../../shared/activity.js'
import { cleanEntry, cleanLink, linkKind, missingOf } from '../../testbench/src/registry.js'
import { removeCustomer, saveCustomer, watchRegistry } from '../../testbench/src/registry-firebase.js'

const blank = { name: '', assetListUrl: '', reportsUrl: '', simproCustomerId: '', sites: '' }
const formOf = (c) => ({ name: c.name || '', assetListUrl: c.assetListUrl || '', reportsUrl: c.reportsUrl || '', simproCustomerId: c.simproCustomerId || '', sites: (c.siteIds || []).join(', ') })
const goodLink = (u) => Boolean(u) && !cleanLink(u).error

export default function Registry() {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | { id?, form }
  const [toast, say] = useToast()
  const [confirmDialog, confirm] = useConfirm()

  useEffect(() => watchRegistry(setList, (e) => {
    setList([])
    setError(e?.code === 'permission-denied' ? 'The registry can’t be read: the database rules for it may not be published yet.' : (e?.message || 'The registry can’t be read.'))
  }), [])

  const remove = async (c) => {
    if (!await confirm({ title: 'Remove this customer?', message: `${c.name} is taken off the registry. Its asset list and reports folder are not touched.`, confirmLabel: 'Remove', danger: true })) return
    try { await removeCustomer(c.id); logActivity(null, 'Removed a customer from the registry', { app: 'testbench' }); say('Removed') } catch (e) { say(e?.code === 'permission-denied' ? 'Only an admin can remove a customer.' : 'Couldn’t remove it.') }
  }

  if (list === null) return <div className="page page-narrow"><Loading /></div>
  return (
    <div className="page page-narrow reg">
      <p className="st-note">Each large customer’s asset list and reports folder, as links. Everyone on the bench teams can read the list; only admins change it. Nothing here is a file: only the links, the name and the Simpro numbers.</p>
      {error && <Alert tone="warning" title="Not available">{error}</Alert>}
      <div className="reg-bar">
        <Button iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing({ form: blank })}>Add a customer</Button>
      </div>
      {list.length === 0 && !error && <div className="card reg-empty">No customers yet. Add the large customers, with the links to their asset lists and reports folders.</div>}
      {list.length > 0 && (
        <div className="card reg-list">
          {list.map((c) => {
            const missing = missingOf(c)
            const sites = c.siteIds || []
            return (
              <div key={c.id} className="reg-row">
                <div className="reg-main">
                  <strong className="reg-name">{c.name}</strong>
                  <span className="st-note">{[c.simproCustomerId && `Simpro customer ${c.simproCustomerId}`, sites.length > 0 && `site${sites.length === 1 ? '' : 's'} ${sites.join(', ')}`].filter(Boolean).join(' · ') || 'No Simpro customer or sites yet'}</span>
                  <span className="reg-links">
                    {goodLink(c.assetListUrl) ? <a href={c.assetListUrl} target="_blank" rel="noopener noreferrer">Asset list <ExternalLink size={13} aria-hidden="true" /></a> : <span className="st-note">No asset list link</span>}
                    {goodLink(c.reportsUrl) ? <a href={c.reportsUrl} target="_blank" rel="noopener noreferrer">Reports folder <ExternalLink size={13} aria-hidden="true" /></a> : <span className="st-note">No reports folder link</span>}
                  </span>
                </div>
                <div className="reg-side">
                  {missing.length ? <Badge tone="orange">{missing.length} missing</Badge> : <Badge tone="green">Complete</Badge>}
                  <Button variant="ghost" size="sm" iconLeft={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing({ id: c.id, form: formOf(c) })}>Edit</Button>
                  <Button variant="ghost" size="sm" iconLeft={<Trash2 size={14} aria-hidden="true" />} onClick={() => remove(c)}>Remove</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {editing && <CustomerForm start={editing} onClose={() => setEditing(null)} onSaved={(adding) => { setEditing(null); say(adding ? 'Customer added' : 'Saved') }} />}
      {confirmDialog}
      <Toast message={toast} />
    </div>
  )
}

function CustomerForm({ start, onClose, onSaved }) {
  const [f, setF] = useState(start.form)
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const warn = (u) => (goodLink(u) && linkKind(u) === 'other') ? 'This isn’t a OneDrive or SharePoint address. It will still open, but check it is the right one.' : ''

  const save = async (e) => {
    e.preventDefault()
    const { entry, errors: errs } = cleanEntry(f)
    setErrors(errs)
    if (errs.length) return
    setBusy(true)
    try {
      await saveCustomer(entry, start.id)
      logActivity(null, start.id ? 'Changed a customer in the registry' : 'Added a customer to the registry', { app: 'testbench' })
      onSaved(!start.id)
    } catch (err) {
      setErrors([err?.code === 'permission-denied' ? 'Only an admin can change the registry, and its database rules must be published.' : (err?.message || 'Couldn’t save it.')])
      setBusy(false)
    }
  }

  return (
    <Dialog title={start.id ? 'Edit customer' : 'Add a customer'} description="Paste the links as they are from OneDrive or SharePoint (Share, Copy link)." onClose={onClose} width={600}>
      <form className="reg-form" onSubmit={save}>
        <label className="field"><span className="field-label">Customer name</span>
          <input className="input" value={f.name} onChange={set('name')} autoComplete="off" /></label>
        <label className="field"><span className="field-label">Asset list link</span>
          <input className="input" value={f.assetListUrl} onChange={set('assetListUrl')} placeholder="https://…sharepoint.com/…" autoComplete="off" />
          {warn(f.assetListUrl) && <span className="st-note">{warn(f.assetListUrl)}</span>}</label>
        <label className="field"><span className="field-label">Reports folder link</span>
          <input className="input" value={f.reportsUrl} onChange={set('reportsUrl')} placeholder="https://…sharepoint.com/…" autoComplete="off" />
          {warn(f.reportsUrl) && <span className="st-note">{warn(f.reportsUrl)}</span>}</label>
        <div className="reg-two">
          <label className="field"><span className="field-label">Simpro customer number</span>
            <input className="input" inputMode="numeric" value={f.simproCustomerId} onChange={set('simproCustomerId')} autoComplete="off" /></label>
          <label className="field"><span className="field-label">Simpro site IDs</span>
            <input className="input" value={f.sites} onChange={set('sites')} placeholder="e.g. 2350, 2351" autoComplete="off" /></label>
        </div>
        {errors.length > 0 && <Alert tone="critical" title="Not saved yet">{errors.map((x) => <div key={x}>{x}</div>)}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
