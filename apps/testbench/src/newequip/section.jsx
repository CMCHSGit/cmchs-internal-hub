/* New equipment testing, as a section of the one app: the hub (apps/hub/src/App.jsx) opens this at /new-equipment/, under its own
   header. One page for the whole job on a customer's new equipment, from recording the asset to filing the test report; it is
   being built beside the three tools it replaces (the Test Bench, Simpro Asset Sync and the Ansur report builder), which keep
   working as they are until this page does everything they do.

   So far: pick a customer (the project tracker's customer folders, where each customer's links are kept), open its asset list and
   reports folder, and add a customer or set its two links from here. Admins and the tracker's teams may add and change them. */
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, Pencil, Plus } from 'lucide-react'
import { AuthProvider, useAuth } from '../../../schedule/src/contexts/AuthContext'
import { TEAMS } from '../../../schedule/src/utils/teams.js'
import { Alert, Button, Dialog, Loading, Toast, useToast } from '../../../../shared/ui/index.jsx'
import { logActivity } from '../../../../shared/activity.js'
import { assetListHref, customerProblems, draftFrom, formOf, reportsHref } from './customers.js'
import { saveCustomer, watchCustomers } from './customers-firebase.js'
import './newequip.css'

const PICK_KEY = 'newEquip.customer'
const remembered = () => { try { return localStorage.getItem(PICK_KEY) || '' } catch { return '' } }
const remember = (id) => { try { localStorage.setItem(PICK_KEY, id) } catch { /* not remembered */ } }

export default function NewEquipmentSection() {
  return (
    <AuthProvider>
      <Page />
    </AuthProvider>
  )
}

function Page() {
  const { user, profile } = useAuth()
  const [data, setData] = useState(null) // { customers, defaults }
  const [error, setError] = useState('')
  const [pick, setPick] = useState(remembered)
  const [editing, setEditing] = useState(null) // { existing? }
  const [toast, say] = useToast()
  const canEdit = Boolean(profile && (profile.role === 'admin' || TEAMS.includes(profile.team))) // as the tracker's rules say

  useEffect(() => {
    if (!user) return undefined
    return watchCustomers(setData, (e) => { setData({ customers: [] }); setError(e?.code === 'permission-denied' ? 'The customers can’t be read with this account.' : (e?.message || 'The customers can’t be read.')) })
  }, [user])

  const customers = data?.customers
  const current = useMemo(() => customers?.find((c) => c.id === pick) || null, [customers, pick])
  const choose = (id) => { setPick(id); remember(id) }

  if (user === undefined || (user && !customers)) return <div className="ne-host"><Loading /></div>
  const list = customers || []
  const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const listHref = current && assetListHref(current)
  const folderHref = current && reportsHref(current)

  return (
    <div className="ne-host">
      <div className="ne-head">
        <h1 className="ne-title">New equipment testing</h1>
        <p className="ne-sub">Pick a customer to open its asset list and reports folder. Recording assets, adding them to Simpro, testing and filing the reports are coming onto this page one step at a time.</p>
      </div>
      {error && <Alert tone="warning" title="Customers not available">{error}</Alert>}

      <section className="card ne-card" aria-label="Customer">
        <div className="ne-row">
          <label className="field ne-pick"><span className="field-label">Customer</span>
            <select className="input" value={current?.id || ''} onChange={(e) => choose(e.target.value)}>
              <option value="">{sorted.length ? 'Choose a customer…' : 'No customers yet'}</option>
              {sorted.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {canEdit && <Button variant="secondary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setEditing({})}>Add a customer</Button>}
        </div>

        {current && (
          <div className="ne-links">
            {listHref ? <a className="btn btn-md btn-primary" href={listHref} target="_blank" rel="noopener noreferrer">Open asset list <ExternalLink size={15} aria-hidden="true" /></a> : <span className="ne-missing">No asset list link yet</span>}
            {folderHref ? <a className="btn btn-md btn-secondary" href={folderHref} target="_blank" rel="noopener noreferrer">Open reports folder <ExternalLink size={15} aria-hidden="true" /></a> : <span className="ne-missing">No reports folder link yet</span>}
            {canEdit && <Button variant="ghost" iconLeft={<Pencil size={15} aria-hidden="true" />} onClick={() => setEditing({ existing: current })}>Edit links</Button>}
          </div>
        )}
        {current && (!listHref || !folderHref) && !canEdit && <p className="ne-note">Ask someone on the service or project teams to add the missing link.</p>}
        {!current && sorted.length > 0 && <p className="ne-note">The customers are the project tracker’s customer folders. A customer’s asset list is its “Equipment list” link and its reports folder is its “Test reports” link.</p>}
        {!current && sorted.length === 0 && !error && <p className="ne-note">There are no customer folders yet. {canEdit ? 'Add one here, or in the project tracker’s Customers tab.' : 'The service and project teams can add them.'}</p>}
      </section>

      <section className="card ne-card" aria-label="The other tools">
        <h2 className="ne-h2">Until this page does it all</h2>
        <p className="ne-note">These keep working as they always have.</p>
        <div className="ne-links">
          <a className="btn btn-md btn-ghost" href="/testbench/">Test Bench</a>
          <a className="btn btn-md btn-ghost" href="/simprosync/">Simpro Asset Sync</a>
          <a className="btn btn-md btn-ghost" href="/ansurtopdf/">Ansur reports</a>
        </div>
      </section>

      {editing && (
        <CustomerForm existing={editing.existing} others={list} defaults={data?.defaults} onClose={() => setEditing(null)}
          onSaved={(c, isNew) => { setEditing(null); choose(c.id); say(isNew ? 'Customer added' : 'Saved') }} />
      )}
      <Toast message={toast} />
    </div>
  )
}

function CustomerForm({ existing, others, defaults, onClose, onSaved }) {
  const [f, setF] = useState(formOf(existing))
  const [errors, setErrors] = useState([])
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  const save = async (e) => {
    e.preventDefault()
    const draft = draftFrom(existing, f, defaults)
    const problems = customerProblems(draft, others)
    setErrors(problems)
    if (problems.length) return
    setBusy(true)
    try {
      const c = await saveCustomer(draft)
      logActivity(null, `${existing ? 'Changed' : 'Added'} a customer folder`, { app: 'new-equipment' })
      onSaved(c, !existing)
    } catch (err) {
      setErrors([err?.code === 'permission-denied' ? 'Only an admin or someone on the service, project or sales teams can change the customers.' : (err?.message || 'Couldn’t save it.')])
      setBusy(false)
    }
  }

  return (
    <Dialog title={existing ? 'Edit customer links' : 'Add a customer'} description="This is the customer’s folder in the project tracker’s Customers tab. Paste the links as they are from OneDrive or SharePoint (Share, Copy link)." onClose={onClose} width={600}>
      <form className="ne-form" onSubmit={save}>
        <label className="field"><span className="field-label">Customer name</span>
          <input className="input" value={f.name} onChange={set('name')} autoComplete="off" /></label>
        <label className="field"><span className="field-label">Asset list link (Equipment list)</span>
          <input className="input" value={f.assetList} onChange={set('assetList')} placeholder="https://…sharepoint.com/…" autoComplete="off" /></label>
        <label className="field"><span className="field-label">Reports folder link (Test reports)</span>
          <input className="input" value={f.reports} onChange={set('reports')} placeholder="https://…sharepoint.com/…" autoComplete="off" /></label>
        {errors.length > 0 && <Alert tone="critical" title="Not saved yet">{errors.map((x) => <div key={x}>{x}</div>)}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
  )
}
