/* Orders: a job or batch with how many of each device model are to be tested (15 D30, 2 D60), so that by the end of testing every
   device is accounted for. Any engineer can test devices for an order and the progress adds up across laptops (orders.js). */
import { useMemo, useState } from 'react'
import { Alert, Badge, Button } from '../../../shared/ui/index.jsx'
import { logActivity } from '../../../shared/activity.js'
import JobPicker from './JobPicker.jsx'
import { expectedText, expectedTotal, jobNumber, orderProblem, progress, rowsToExpected } from './orders.js'
import { saveOrder, removeOrder } from './orders-firebase.js'

const today = () => new Date().toISOString().slice(0, 10)
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }).format(d) }
const blank = () => ({ number: '', jobLabel: '', customer: '', expected: {}, since: today(), note: '', status: 'open' })

function OrderForm({ start, customers, models, sim, online, user, onCancel, onSave }) {
  const [o, setO] = useState(start)
  // One row for each model: the model, and how many of it. (Always a spare empty row at the end to type into.)
  const [rows, setRows] = useState(() => [...Object.entries(start.expected || {}).map(([model, qty]) => ({ model, qty: String(qty) })), { model: '', qty: '' }])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const { expected, bad } = useMemo(() => rowsToExpected(rows), [rows])
  const job = o.number ? { id: o.number, label: o.jobLabel || `#${o.number}` } : null
  const set = (patch) => setO((x) => ({ ...x, ...patch }))
  const change = (i, patch) => setRows((rs) => { const n = rs.map((r, k) => (k === i ? { ...r, ...patch } : r)); return n[n.length - 1].model || n[n.length - 1].qty ? [...n, { model: '', qty: '' }] : n })
  const remove = (i) => setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : [{ model: '', qty: '' }]))
  async function save() {
    const draft = { ...o, expected }
    const p = orderProblem(draft) || (bad.length ? `Give “${bad[0]}” a quantity (a whole number, 1 or more).` : '')
    if (p) { setErr(p); return }
    setBusy(true); setErr('')
    try { await onSave({ ...draft, number: jobNumber(draft.number) }) } catch (e) { setErr(e?.message || 'Not saved.'); setBusy(false) }
  }
  return (
    <div className="tb-orderform">
      <h3>{start.id ? 'Edit order' : 'New order'}</h3>
      <div className="field"><label>Simpro job</label>
        <JobPicker call={sim.call} online={online} user={user} companies={sim.companies} companyId={sim.companyId} onCompany={sim.setCompanyId} disabled={!!sim.access}
          job={job} onJob={(j) => (j ? set({ number: jobNumber(j.id), jobLabel: j.label, customer: o.customer || j.customer || '' }) : set({ number: '', jobLabel: '' }))} />
      </div>
      <div className="tb-orderrow">
        <label>Customer<input value={o.customer} list="tbCustomers" onChange={(e) => set({ customer: e.target.value })} placeholder="As entered on the tests, e.g. Waikato" /></label>
        <datalist id="tbCustomers">{customers.map((c) => <option key={c} value={c} />)}</datalist>
        <label>Counting tests from<input type="date" value={o.since} onChange={(e) => set({ since: e.target.value })} /></label>
      </div>
      <div className="tb-models" role="group" aria-label="Devices on this order">
        <div className="tb-modelhead"><span>Device model</span><span>Quantity</span><span /></div>
        {rows.map((r, i) => (
          <div className="tb-modelrow" key={i}>
            <input value={r.model} list="tbModels" onChange={(e) => change(i, { model: e.target.value })} placeholder={i === 0 ? 'e.g. D30' : 'Another model'} aria-label={`Device model ${i + 1}`} />
            <input type="number" min="1" step="1" inputMode="numeric" value={r.qty} onChange={(e) => change(i, { qty: e.target.value })} placeholder="Qty" aria-label={`Quantity of model ${i + 1}`} />
            <button type="button" className="tb-rowx" onClick={() => remove(i)} aria-label={`Remove row ${i + 1}`} title="Remove this row" disabled={!r.model && !r.qty}>×</button>
          </div>
        ))}
        <datalist id="tbModels">{models.map((m) => <option key={m} value={m} />)}</datalist>
        <p className="tb-muted">{expectedTotal(expected) > 0 ? `${expectedTotal(expected)} device${expectedTotal(expected) === 1 ? '' : 's'} in all (${expectedText(expected)}).` : 'Add each model on its own row, with how many are to be tested.'} A test counts toward a model when its model contains that name as a whole word, so “D30” also counts “BeneHeart D30”.</p>
      </div>
      <label className="tb-orderq">Note (optional)<input value={o.note} onChange={(e) => set({ note: e.target.value })} placeholder="e.g. delivered to the ward, ready from Monday" /></label>
      {err && <p className="tb-note tb-note-warning" role="alert">{err}</p>}
      <div className="tb-actionbar-row">
        <Button disabled={busy} onClick={save}>{start.id ? 'Save changes' : 'Create order'}</Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function OrderCard({ order, tests, who, onEdit, onReview, onToggle, onDelete }) {
  const p = useMemo(() => progress(order, tests), [order, tests])
  const pct = p.need ? Math.min(100, Math.round((p.tested / p.need) * 100)) : 0
  const closed = order.status === 'closed'
  return (
    <section className={`tb-order${closed ? ' is-closed' : ''}`}>
      <div className="tb-order-head">
        <div>
          <h3>Job #{order.number} · {order.customer}</h3>
          <p className="tb-muted">{expectedText(order.expected)}{order.note ? ` · ${order.note}` : ''} · started {order.since} by {order.createdByName || order.createdBy}</p>
        </div>
        <div className="tb-order-badges">
          {closed ? <Badge tone="grey">Closed</Badge> : p.complete ? <Badge tone="green">All tested</Badge> : <Badge tone="orange">{p.missing} to go</Badge>}
          {p.failed > 0 && <Badge tone="red">{p.failed} failed</Badge>}
        </div>
      </div>
      <div className="tb-progress"><progress max={p.need || 1} value={p.tested} /><span><strong>{p.tested} of {p.need}</strong> tested · {p.passed} passed{p.failed ? `, ${p.failed} failed` : ''} ({pct}%)</span></div>
      <table className="tb-ordertable">
        <thead><tr><th>Model</th><th className="num">Needed</th><th className="num">Tested</th><th className="num">Passed</th><th className="num">Failed</th><th className="num">To go</th></tr></thead>
        <tbody>
          {p.rows.map((r) => (
            <tr key={r.model} className={r.missing ? 'is-short' : r.extra ? 'is-extra' : ''}>
              <td>{r.model}</td><td className="num">{r.need}</td><td className="num">{r.tested}</td><td className="num">{r.passed}</td><td className="num">{r.failed || ''}</td>
              <td className="num">{r.missing ? <strong>{r.missing}</strong> : r.extra ? `+${r.extra} over` : '✓'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(p.other.length > 0 || p.incomplete.length > 0) && (
        <p className="tb-note tb-note-warning">
          {p.other.length > 0 && <>{p.other.length} tested device{p.other.length === 1 ? '' : 's'} {p.other.length === 1 ? 'is' : 'are'} for a model not on this order ({[...new Set(p.other.map((d) => d.model || 'no model'))].join(', ')}). </>}
          {p.incomplete.length > 0 && <>{p.incomplete.length} test{p.incomplete.length === 1 ? ' was' : 's were'} left incomplete ({p.incomplete.map((d) => d.serial || 'no serial').join(', ')}): they don’t count until finished.</>}
        </p>
      )}
      <details>
        <summary>{p.devices.length} test{p.devices.length === 1 ? '' : 's'} so far, with who tested them</summary>
        <table className="tb-ordertable">
          <thead><tr><th>Serial</th><th>Model</th><th>Result</th><th>Tested by</th><th>When</th></tr></thead>
          <tbody>{p.devices.map((d) => <tr key={d.id}><td>{d.serial || '—'}</td><td>{d.model || '—'}</td><td>{d.overall === 'pass' ? 'Pass' : d.overall === 'fail' ? 'Fail' : 'Incomplete'}</td><td>{d.byName || d.by}</td><td>{when(d.finished)}</td></tr>)}</tbody>
        </table>
      </details>
      <div className="tb-actionbar-row">
        <Button variant="secondary" size="sm" disabled={!p.devices.length} onClick={() => onReview(order, p)} title="Open Saved reports on this order's devices, with its job chosen">Review and attach PDFs</Button>
        <Button variant="ghost" size="sm" onClick={() => onEdit(order)}>Edit</Button>
        <Button variant="ghost" size="sm" onClick={() => onToggle(order, p)}>{closed ? 'Reopen' : 'Close order'}</Button>
        {(order.createdBy === who.email || who.admin) && <Button variant="ghost" size="sm" onClick={() => onDelete(order)}>Delete</Button>}
      </div>
    </section>
  )
}

export default function Orders({ orders, ordersError, tests, who, user, online, sim, onReview }) {
  const [form, setForm] = useState(null) // an order being made or edited
  const [show, setShow] = useState('open')
  const [note, setNote] = useState({ text: '', tone: 'info' })
  const customers = useMemo(() => [...new Set(tests.map((t) => t.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [tests])
  const models = useMemo(() => [...new Set(tests.map((t) => String(t.model || '').split(/[,;]/)[0].trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [tests])   // models already tested: suggestions for the model field
  const shown = orders.filter((o) => (show === 'open' ? o.status !== 'closed' : o.status === 'closed'))

  async function save(o) {
    const id = await saveOrder(o, who)
    logActivity(null, `${o.id ? 'Changed' : 'Created'} a Test Bench order (${Object.keys(o.expected).length} models, ${expectedTotal(o.expected)} devices)`, { app: 'testbench' })
    setForm(null); setNote({ text: `Order for job #${o.number} saved.`, tone: 'success' }); return id
  }
  async function toggle(o, p) {
    if (o.status !== 'closed' && !p.complete && !window.confirm(`${p.missing} device${p.missing === 1 ? ' is' : 's are'} still to be tested on this order. Close it anyway?`)) return
    try {
      await saveOrder({ ...o, status: o.status === 'closed' ? 'open' : 'closed', closedAt: Date.now(), closedBy: who.email }, who)
      logActivity(null, `${o.status === 'closed' ? 'Reopened' : 'Closed'} a Test Bench order`, { app: 'testbench' })
    } catch (e) { setNote({ text: 'Not saved: ' + (e.message || e), tone: 'warning' }) }
  }
  async function del(o) {
    if (!window.confirm(`Delete the order for job #${o.number}? The tests stay; only the order goes.`)) return
    try { await removeOrder(o.id); logActivity(null, 'Deleted a Test Bench order', { app: 'testbench' }) } catch (e) { setNote({ text: 'Not deleted: ' + (e.message || e), tone: 'warning' }) }
  }

  return (
    <div className="tb-reports tb-orders">
      <div className="tb-rhead">
        <div>
          <h2>Orders</h2>
          <p className="tb-muted">Set how many of each model a job has (15 D30, 2 D60) and the bench counts the devices as any engineer finishes them, so you can see at the end that every device is accounted for. A test counts toward an order when it was started for it, or when its customer matches.</p>
        </div>
      </div>
      {!user && <Alert tone="warning" title="Sign in to see orders">Orders are shared between engineers, so sign in to the hub (while online).</Alert>}
      {ordersError && <Alert tone="warning" title="Orders aren’t switched on yet">{ordersError}</Alert>}
      {note.text && <p className={`tb-note tb-note-${note.tone}`} role="status">{note.text}</p>}
      {form ? (
        <OrderForm start={form} customers={customers} models={models} sim={sim} online={online} user={user} onCancel={() => setForm(null)} onSave={save} />
      ) : (
        <>
          <div className="tb-selbar">
            <Button onClick={() => { setNote({ text: '', tone: 'info' }); setForm(blank()) }} disabled={!user || !!ordersError}>New order</Button>
            <label className="tb-check"><input type="radio" name="tbOrdersShow" checked={show === 'open'} onChange={() => setShow('open')} /> Open ({orders.filter((o) => o.status !== 'closed').length})</label>
            <label className="tb-check"><input type="radio" name="tbOrdersShow" checked={show === 'closed'} onChange={() => setShow('closed')} /> Closed ({orders.filter((o) => o.status === 'closed').length})</label>
          </div>
          {shown.length === 0 && !ordersError && <p className="tb-empty">{show === 'open' ? 'No open orders. Create one for a job when the devices arrive.' : 'No closed orders.'}</p>}
          {shown.map((o) => <OrderCard key={o.id} order={o} tests={tests} who={who} onEdit={(x) => setForm(x)} onReview={onReview} onToggle={toggle} onDelete={del} />)}
        </>
      )}
    </div>
  )
}
