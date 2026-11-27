/* Stock removal (the "Stock" tab): CHS Form 39, "Items removed from stock", filled in from photos of the bags
   the accessories are in. Photograph a label and its part number (P/N) and description come back as a row to check;
   say how many of each you're taking first. One form for each demo or other reason (its own loan, date, who took
   them and SimPro job number); the finished list is saved as a sheet or copied.

   The photo is read on this phone or PC (stock-read.js and shared/ocr.js, tesseract.js in a worker): nothing is
   uploaded, which is what QP33 asks for. A label is photographed any way up, and a P/N beside a barcode comes back
   with a digit missing, so what was read is checked against the accessory list (Manage › Accessories): the list's
   own code and name are used when it has the number, a near miss is offered as the list's code and marked to check,
   and a number the list hasn't got says so. The rules (readLabelText, matchAccessory, addStockItems, stockRows,
   stockOnLoan) are in model.js. A misread can't always be told from the photo, so every field is editable.

   Reason: Demo (the default) with the loan it is for, chosen by searching the loans, or something else typed.
   For a demo, "Record on the loan" puts how many of each accessory came out of stock on that loan's accessory list
   (each line's `stock`, shown on the Loans tab as "From stock"); an accessory the loan doesn't list yet is added.
   Recording again after a change moves the numbers by the difference, so nothing is counted twice.

   The forms are kept on this device only (localStorage) until they're deleted; the only shared data this touches is
   the loan's accessory lines, saved the way the loan card's Accessories are (store.jsx saveAccessories, audited). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Check, Copy, Download, ImagePlus, Minus, PackageMinus, Plus, Trash2, X } from 'lucide-react'
import { Alert, Badge, Button, Dialog, Spinner, Toast, useToast } from '../../../shared/ui/index.jsx'
import { closeOcr, toCanvas } from '../../../shared/ocr.js'
import { readLabelPhoto } from './stock-read.js'
import { STOCK_COLUMNS, addStockItems, fmtDate, isStockDemo, loanDocKey, loanLabel, loanSections, matchAccessory, readLabelText, stockLoanChoices, stockOnLoan, stockProblems, stockReasonText, stockRows, toCsv } from './model.js'
import { save } from './download.js'

const KEY = 'equipment:stockRemoval'
const QP33 = 'This looks like it may contain patient information. QP33 does not allow patient data to be shared with AI tools. Please remove identifiers before sharing files.'
const OTHER_REASONS = ['Repair', 'Replacement', 'Evaluation', 'Training']
const uid = () => Math.random().toString(36).slice(2, 10)
const blank = (s) => ({ id: uid(), kind: 'demo', reason: '', loan: null, date: s.today, by: s.operator || '', job: '', items: [], recorded: null })

function loadDrafts() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (d && Array.isArray(d.forms) && d.forms.length) return d
  } catch { /* none kept */ }
  return null
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true } catch { /* try the old way */ }
  try {
    const box = Object.assign(document.createElement('textarea'), { value: text })
    document.body.appendChild(box); box.select()
    const ok = document.execCommand('copy')
    box.remove()
    return ok
  } catch { return false }
}

const slug = (t) => String(t || 'form').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'form'
const clampQty = (n) => Math.min(999, Math.max(1, Math.round(Number(n) || 1)))

export default function StockRemoval({ s }) {
  const [drafts, setDrafts] = useState(() => loadDrafts() || { forms: [blank(s)], active: '', qty: 1 })
  const live = useRef(drafts)
  live.current = drafts
  const form = drafts.forms.find((f) => f.id === drafts.active) || drafts.forms[0]
  const demo = isStockDemo(form)
  const qty = clampQty(drafts.qty)
  const list = s.accessoryList || []
  const [reading, setReading] = useState(0) // photos waiting or being read
  const [percent, setPercent] = useState(0)
  const [step, setStep] = useState('')
  const [slowNote, setSlowNote] = useState(false)
  const [notice, setNotice] = useState(null) // { tone, title, body, raw, actions }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [recording, setRecording] = useState(false) // the "Record on the loan" dialog
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [picking, setPicking] = useState(false) // the camera or photo picker is open (the page is in the background)
  const [toast, showToast] = useToast()
  const thumbs = useRef({}) // item id -> the photo it was read from (this visit only)
  const queue = useRef(Promise.resolve())
  const listRef = useRef(list)
  listRef.current = list

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(drafts)) } catch { /* private window */ } }, [drafts])
  useEffect(() => () => { closeOcr(); Object.values(thumbs.current).forEach((u) => URL.revokeObjectURL(u)) }, [])
  // Cancelling the camera sends nothing back, so the hold on the app's update reload ends by itself after a while.
  useEffect(() => { if (!picking) return undefined; const t = setTimeout(() => setPicking(false), 3 * 60_000); return () => clearTimeout(t) }, [picking])

  const patch = (id, fn) => setDrafts((d) => ({ ...d, forms: d.forms.map((f) => (f.id === id ? fn(f) : f)) }))
  const setField = (k, v) => patch(form.id, (f) => ({ ...f, [k]: v }))
  const setItem = (iid, p) => patch(form.id, (f) => ({ ...f, items: f.items.map((i) => (i.id === iid ? { ...i, ...p } : i)) }))

  // The loans a demo can be for, and the one chosen (as it is now: its accessories are what stock is recorded on).
  const sections = useMemo(() => loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode, team: s.managers }),
    [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode, s.managers])
  const loanG = useMemo(() => (form.loan?.key ? Object.values(sections).flat().find((g) => g.key === form.loan.key) || null : null), [sections, form.loan?.key])
  const docKey = loanG ? loanDocKey(loanG) : ''
  const loanAcc = loanG ? (s.loanDocs?.[docKey] || loanG.doc)?.accessories || [] : []
  const recordedHere = form.recorded && form.recorded.loanKey === form.loan?.key

  // Each photo in turn: read on this device, the part numbers picked out and checked against the list, put on the form.
  async function readOne(file, formId, each) {
    const url = URL.createObjectURL(file)
    let kept = false
    setPercent(0); setSlowNote(false); setStep('Reading the photo…')
    const slow = setTimeout(() => setSlowNote(true), 8000)
    try {
      const canvas = toCanvas(await createImageBitmap(file))
      const text = await readLabelPhoto(canvas, { onProgress: (p) => setPercent(Math.round(p * 100)), onStep: setStep })
      const r = readLabelText(text, listRef.current)
      if (r.patient) { setNotice({ tone: 'critical', title: 'Patient information in the photo', body: QP33 }); return }
      if (!r.items.length) {
        setNotice({ tone: 'warning', title: 'No part number found', body: 'Hold the phone closer so the label fills the picture, with no glare across it, then try again. Or add the item by hand.', raw: text })
        return
      }
      const f = live.current.forms.find((x) => x.id === formId)
      if (!f) return
      const res = addStockItems(f.items, r.items, each, listRef.current, uid)
      patch(formId, (cur) => ({ ...cur, items: res.items }))
      for (const i of res.items) if (res.added.includes(i.pn) && !thumbs.current[i.id]) { thumbs.current[i.id] = url; kept = true }
      const bits = []
      if (res.added.length) bits.push(`Added ${res.added.length === 1 ? res.added[0] : `${res.added.length} items`}.`)
      for (const b of res.bumped) bits.push(`${b.pn} was already on the form with a different lot, so it now has ${b.qty}.`)
      if (res.ask.length) {
        const a = res.ask[0]
        setNotice({ tone: 'warning', title: `${a.pn} is already on the form`, body: `${a.lot ? `Lot ${a.lot}. ` : ''}Is this the same bag again, or more of them? ${bits.join(' ')}`.trim(),
          actions: [{ label: `More: make it ${a.total}`, run: () => { patch(formId, (cur) => ({ ...cur, items: cur.items.map((i) => (i.pn === a.pn ? { ...i, qty: clampQty(i.qty + a.qty), lot: i.lot || a.lot } : i)) })); setNotice(null) } },
            { label: 'Same bag, leave it', run: () => setNotice(null) }] })
      } else {
        setNotice({ tone: 'info', title: bits.join(' '), body: 'Check each part number against its label before you finish.' })
      }
    } catch {
      setNotice({ tone: 'warning', title: 'That photo couldn’t be read',
        body: navigator.onLine === false ? 'The first read needs a connection, to load the reader (about 7 MB). Connect, then try again.' : 'Try again closer and in better light, or add the item by hand.' })
    } finally { clearTimeout(slow); if (!kept) URL.revokeObjectURL(url) }
  }

  function enqueue(files) {
    const picked = [...(files || [])]
    if (!picked.length) return
    const formId = form.id, each = qty
    setPicking(false)
    setNotice(null)
    setReading((n) => n + picked.length)
    for (const file of picked) queue.current = queue.current.then(() => readOne(file, formId, each)).finally(() => setReading((n) => n - 1))
  }

  const newForm = () => { const f = blank(s); setDrafts((d) => ({ ...d, forms: [f, ...d.forms], active: f.id })); setNotice(null); setConfirmDelete(false) }
  const deleteForm = () => {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return }
    setConfirmDelete(false)
    setDrafts((d) => { const forms = d.forms.filter((f) => f.id !== form.id); const keep = forms.length ? forms : [blank(s)]; return { ...d, forms: keep, active: keep[0].id } })
    setNotice(null)
  }
  const addByHand = () => patch(form.id, (f) => ({ ...f, items: [...f.items, { id: uid(), pn: '', desc: '', qty, lot: '', note: '', check: false, label: '' }] }))
  const removeItem = (i) => { patch(form.id, (f) => ({ ...f, items: f.items.filter((x) => x.id !== i.id) })); showToast(`Removed ${i.pn || 'the item'}`) }
  const useListed = (i, a) => setItem(i.id, { pn: a.code, desc: a.name || i.desc, check: false, note: '' })

  const rows = useMemo(() => stockRows(form), [form])
  const problems = useMemo(() => stockProblems(form, list), [form, list])
  const units = form.items.reduce((n, i) => n + (Number(i.qty) || 0), 0)
  const saveSheet = () => { save(new Blob(['﻿' + toCsv(rows, STOCK_COLUMNS)], { type: 'text/csv;charset=utf-8' }), `form-39-${slug(rows[0]?.reason)}-${form.date}.csv`); showToast('Saved as a sheet') }
  const copyList = async () => showToast((await copyText([STOCK_COLUMNS.map(([, h]) => h), ...rows.map((r) => STOCK_COLUMNS.map(([k]) => r[k]))].map((r) => r.join('\t')).join('\n'))) ? 'List copied' : 'Couldn’t copy')

  // What recording would do to the loan's accessories (shown before anything is saved).
  const plan = useMemo(() => (recording && loanG ? stockOnLoan(loanAcc, form.items, { applied: recordedHere ? form.recorded.applied : {}, list }) : null),
    [recording, loanG, loanAcc, form.items, recordedHere, form.recorded, list])
  async function record() {
    setBusy(true); setProblem('')
    try {
      const n = plan.changes.length, pieces = plan.changes.reduce((t, c) => t + (c.after.stock - (c.before?.stock || 0)), 0)
      await s.saveAccessories(loanG, plan.lines, loanAcc, { type: 'stock_removed', summary: `Stock taken for a demo loan: ${n} accessory line${n === 1 ? '' : 's'} recorded (${pieces >= 0 ? '+' : ''}${pieces} from stock)`, detail: { lines: n, pieces } })
      patch(form.id, (f) => ({ ...f, recorded: { loanKey: loanG.key, at: s.today, applied: plan.applied } }))
      setRecording(false)
      showToast(`Recorded on ${loanG.loanTo}’s accessories`)
    } catch (e) { setProblem(e?.message || 'It couldn’t be saved. Try again.') } finally { setBusy(false) }
  }

  return (
    // data-working: coming back from the camera must not let the app reload onto a new version before the photo is read (shared/updateGuard.js)
    <div className="eq-stock" data-working={reading > 0 || picking ? '' : undefined}>
      <p className="eq-small eq-stock-intro">Form 39, items removed from stock. Set how many of each you are taking, then photograph each bag’s label. The photo is read on this {typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'device'}: nothing is uploaded. Keep anything about a patient out of the picture.</p>

      <div className="eq-stock-switch">
        <select className="input" aria-label="Form" value={form.id} onChange={(e) => { setDrafts((d) => ({ ...d, active: e.target.value })); setNotice(null); setConfirmDelete(false) }}>
          {drafts.forms.map((f) => <option key={f.id} value={f.id}>{stockReasonText(f) || 'Untitled form'} · {fmtDate(f.date)} · {f.items.length}</option>)}
        </select>
        <Button size="sm" variant="secondary" iconLeft={<Plus size={14} />} onClick={newForm}>New form</Button>
        {(drafts.forms.length > 1 || form.items.length > 0 || form.loan || form.reason) && (
          <Button size="sm" variant="secondary" iconLeft={<Trash2 size={14} />} onClick={deleteForm}>{confirmDelete ? 'Tap again to delete' : 'Delete form'}</Button>
        )}
      </div>

      <div className="card eq-stock-head">
        <label className="field"><span className="field-label">Reason for taking</span>
          <select className="input" value={demo ? 'demo' : 'other'} onChange={(e) => setField('kind', e.target.value)} disabled={recordedHere}>
            <option value="demo">Demo</option>
            <option value="other">Something else</option>
          </select></label>
        {demo
          ? <LoanPicker sections={sections} chosen={form.loan} g={loanG} locked={recordedHere} me={s.me?.name || ''} onPick={(g) => setField('loan', { key: g.key, label: g.loanTo || 'a loan' })} onClear={() => setField('loan', null)} />
          : (
            <label className="field"><span className="field-label">What for?</span>
              <input className="input" list="eq-stock-reasons" value={form.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="e.g. Repair, replacement" />
              <datalist id="eq-stock-reasons">{OTHER_REASONS.map((r) => <option key={r} value={r} />)}</datalist></label>
          )}
        <label className="field"><span className="field-label">Date taken</span>
          <input className="input" type="date" value={form.date} onChange={(e) => setField('date', e.target.value)} /></label>
        <label className="field"><span className="field-label">Taken by</span>
          <input className="input" value={form.by} onChange={(e) => setField('by', e.target.value)} autoComplete="name" /></label>
        <label className="field eq-stock-wide"><span className="field-label">SimPro job number</span>
          <input className="input" inputMode="numeric" value={form.job} onChange={(e) => setField('job', e.target.value)} placeholder="Not yet known" /></label>
      </div>

      {notice && (
        <Alert tone={notice.tone} title={notice.title}>
          {notice.body}
          {(notice.actions || []).length > 0 && <div className="eq-stock-acts">{notice.actions.map((a) => <Button key={a.label} size="sm" variant="secondary" onClick={a.run}>{a.label}</Button>)}</div>}
          {notice.raw ? <details className="eq-stock-raw"><summary>What was read</summary><pre>{notice.raw || '(nothing)'}</pre></details> : null}
        </Alert>
      )}

      <div className="eq-stock-scan card">
        <div className="eq-stock-qty">
          <span className="eq-small">Taking</span>
          <span className="eq-acc-step">
            <button type="button" className="icon-btn icon-btn-sm" aria-label="One fewer of each" onClick={() => setDrafts((d) => ({ ...d, qty: clampQty(qty - 1) }))}><Minus size={14} /></button>
            <input className="input" inputMode="numeric" value={drafts.qty} aria-label="How many of each you are taking"
              onChange={(e) => setDrafts((d) => ({ ...d, qty: e.target.value.replace(/\D/g, '') }))} onBlur={() => setDrafts((d) => ({ ...d, qty: clampQty(d.qty) }))} />
            <button type="button" className="icon-btn icon-btn-sm" aria-label="One more of each" onClick={() => setDrafts((d) => ({ ...d, qty: clampQty(qty + 1) }))}><Plus size={14} /></button>
          </span>
          <span className="eq-small">of each</span>
        </div>
        <div className="eq-stock-buttons">
          <label className="btn btn-primary eq-stock-photo"><Camera size={16} aria-hidden="true" /> Photograph a label
            <input type="file" accept="image/*" capture="environment" hidden onClick={() => setPicking(true)} onChange={(e) => { enqueue(e.target.files); e.target.value = '' }} /></label>
          <label className="btn btn-secondary"><ImagePlus size={16} aria-hidden="true" /> Choose photos
            <input type="file" accept="image/*" multiple hidden onClick={() => setPicking(true)} onChange={(e) => { enqueue(e.target.files); e.target.value = '' }} /></label>
        </div>
        {reading > 0 && (
          <div className="eq-stock-busy" role="status">
            <Spinner size={20} />
            <span>{reading > 1 ? `${reading} photos: ` : ''}{step}{percent > 0 && percent < 100 ? ` ${percent}%` : ''}</span>
            {slowNote && <span className="eq-small">A label can be read up to four ways round, and the first read loads the reader (about 7 MB), so this takes a few seconds.</span>}
          </div>
        )}
      </div>

      <h2 className="eq-section-title">Items <span className="eq-small eq-count">{form.items.length} {form.items.length === 1 ? 'item' : 'items'} · {units} {units === 1 ? 'unit' : 'units'}</span></h2>
      {form.items.length === 0
        ? <p className="eq-small eq-stock-empty">No items on this form yet. Photograph a bag’s label, or <button type="button" className="eq-linkbtn" onClick={addByHand}>add one by hand</button>.</p>
        : (
          <div className="eq-stock-items">
            {form.items.map((i, n) => {
              const m = list.length && String(i.pn || '').trim() ? matchAccessory(i.pn, list) : null
              return (
                <div key={i.id} className={`card eq-stock-item${i.check ? ' check' : ''}`}>
                  {thumbs.current[i.id] ? <img className="eq-stock-thumb" src={thumbs.current[i.id]} alt={`Photo the item ${n + 1} was read from`} /> : <span className="eq-stock-thumb eq-stock-nopic" aria-hidden="true">{n + 1}</span>}
                  <div className="eq-stock-fields">
                    <label className="field"><span className="field-label">Part number (P/N)</span>
                      <input className="input eq-mono" value={i.pn} onChange={(e) => setItem(i.id, { pn: e.target.value })} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="040-000973-00" /></label>
                    {m && (
                      <div className="eq-stock-match">
                        {m.status === 'exact'
                          ? <Badge tone="green"><Check size={12} aria-hidden="true" /> On the accessory list</Badge>
                          : <Badge tone="orange">Not on the accessory list</Badge>}
                        {m.status !== 'exact' && m.candidates.map((a) => (
                          <button key={a.code} type="button" className="btn btn-secondary btn-sm eq-stock-suggest" onClick={() => useListed(i, a)} title={a.name}>Use <span className="eq-mono">{a.code}</span>{a.name ? `: ${a.name}` : ''}</button>
                        ))}
                      </div>
                    )}
                    <label className="field"><span className="field-label">Description</span>
                      <input className="input" value={i.desc} onChange={(e) => setItem(i.id, { desc: e.target.value })} /></label>
                    {i.label && i.label !== i.desc && <p className="eq-small eq-stock-label">The label says: {i.label}</p>}
                    <div className="eq-stock-line">
                      <span className="eq-acc-step">
                        <button type="button" className="icon-btn icon-btn-sm" aria-label={`One fewer of item ${n + 1}`} onClick={() => setItem(i.id, { qty: clampQty((i.qty || 1) - 1) })}><Minus size={14} /></button>
                        <input className="input" inputMode="numeric" value={i.qty} aria-label={`Quantity taken, item ${n + 1}`}
                          onChange={(e) => setItem(i.id, { qty: e.target.value.replace(/\D/g, '') })} onBlur={() => setItem(i.id, { qty: clampQty(i.qty) })} />
                        <button type="button" className="icon-btn icon-btn-sm" aria-label={`One more of item ${n + 1}`} onClick={() => setItem(i.id, { qty: clampQty((Number(i.qty) || 1) + 1) })}><Plus size={14} /></button>
                      </span>
                      {i.lot && <span className="eq-small eq-mono">Lot {i.lot}</span>}
                      {i.check && <Badge tone="orange">Check</Badge>}
                    </div>
                    {i.note && <p className="eq-small eq-stock-note">{i.note}</p>}
                    {i.check && <div><Button size="sm" variant="secondary" onClick={() => setItem(i.id, { check: false, note: '' })}>Checked, it’s right</Button></div>}
                  </div>
                  <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove item ${n + 1}`} onClick={() => removeItem(i)}><X size={14} /></button>
                </div>
              )
            })}
            <div><Button size="sm" variant="secondary" iconLeft={<Plus size={14} />} onClick={addByHand}>Add an item by hand</Button></div>
          </div>
        )}

      {form.items.length > 0 && (
        <div className="card eq-stock-done">
          {problems.length > 0 && <ul className="eq-stock-todo">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          {demo && loanG && (
            <div className="eq-stock-loan">
              <p className="eq-small">{recordedHere ? `Recorded on ${loanG.loanTo}’s accessories on ${fmtDate(form.recorded.at)}. Changed something since? Update the loan.` : `Put how many of each came out of stock on ${loanG.loanTo}’s accessory list.`}</p>
              <Button iconLeft={<PackageMinus size={16} />} onClick={() => { setProblem(''); setRecording(true) }}>{recordedHere ? 'Update the loan' : 'Record on the loan'}</Button>
            </div>
          )}
          {demo && form.loan?.key && !loanG && <p className="eq-small">The loan chosen for this form isn’t in the list any more (it may have been returned). Choose another to record the stock on.</p>}
          <div className="eq-stock-buttons">
            <Button variant="secondary" iconLeft={<Download size={16} />} onClick={saveSheet} disabled={!rows.length}>Save as a sheet</Button>
            <Button variant="secondary" iconLeft={<Copy size={16} />} onClick={copyList} disabled={!rows.length}>Copy list</Button>
          </div>
          <p className="eq-small">The sheet has Form 39’s columns, one row an item. The paper form takes one set of fields, so hand in one page for each item or attach the list.</p>
        </div>
      )}

      {recording && loanG && plan && (
        <Dialog title="Record the stock on the loan" description={`${loanG.loanTo}: how many of each accessory came out of stock.`} onClose={() => !busy && setRecording(false)} width={620}>
          <div className="eq-stock-plan">
            {plan.changes.length === 0 && plan.problems.length === 0 && <p>Nothing to change: this loan already has these numbers.</p>}
            {plan.changes.length > 0 && (
              <table className="eq-acc-table">
                <thead><tr><th>Code</th><th>Accessory</th><th className="eq-acc-qty">On the loan</th><th className="eq-acc-qty">From stock</th></tr></thead>
                <tbody>{plan.changes.map((c) => (
                  <tr key={c.code}>
                    <td className="eq-mono">{c.code}</td>
                    <td>{c.name}{c.added && <span className="eq-small">Not on the loan’s list yet: it is added</span>}</td>
                    <td className="eq-acc-qty">{c.before && c.before.qty !== c.after.qty ? `${c.before.qty} → ${c.after.qty}` : c.after.qty}</td>
                    <td className="eq-acc-qty">{c.before ? `${c.before.stock} → ${c.after.stock}` : c.after.stock}</td>
                  </tr>))}</tbody>
              </table>
            )}
            {plan.problems.length > 0 && (
              <Alert tone="warning" title="Not on the accessory list">
                {plan.problems.map((p) => p.code).join(', ')} {plan.problems.length === 1 ? 'isn’t' : 'aren’t'} on the accessory list or on this loan, so {plan.problems.length === 1 ? 'it' : 'they'} can’t be recorded: it may be a misread. Fix the part number (or take the item off the form), then record again.
              </Alert>
            )}
            {problem && <Alert tone="critical" title="Not saved">{problem}</Alert>}
            <div className="eq-stock-buttons">
              <Button onClick={record} disabled={busy || plan.problems.length > 0 || plan.changes.length === 0}>{busy ? 'Saving…' : 'Record on the loan'}</Button>
              <Button variant="secondary" onClick={() => setRecording(false)} disabled={busy}>Cancel</Button>
            </div>
          </div>
        </Dialog>
      )}
      <Toast message={toast} />
    </div>
  )
}

/** The loan a demo is for: a search over every loan and booking (customer, location, account manager, job number), a chosen one shown with how to change it. */
function LoanPicker({ sections, chosen, g, locked, me, onPick, onClear }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const choices = useMemo(() => (open ? stockLoanChoices(sections, q) : []), [open, sections, q])
  if (chosen?.key) {
    return (
      <div className="field">
        <span className="field-label">Loan</span>
        <div className="eq-stock-chosen">
          <span className="eq-stock-chosen-name"><strong>{chosen.label}</strong>{g && <span className="eq-small">{loanLabel(g, me)}</span>}</span>
          {!locked && <Button size="sm" variant="secondary" onClick={onClear}>Change</Button>}
        </div>
      </div>
    )
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor="eq-stock-loan">Loan this demo is for</label>
      <input id="eq-stock-loan" className="input" value={q} onChange={(e) => { setQ(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} placeholder="Search by customer, location or account manager" autoComplete="off" />
      {open && (
        <div className="eq-stock-loans" role="listbox" aria-label="Loans">
          {choices.length === 0 && <p className="eq-small eq-stock-none">{q.trim() ? 'No loan matches that.' : 'No loans yet.'}</p>}
          {choices.map((c) => (
            <button key={c.key} type="button" role="option" aria-selected="false" className="eq-stock-loanopt" onClick={() => { onPick(c.g); setQ(''); setOpen(false) }}>
              <strong>{c.label}</strong>
              <span className="eq-small">{loanLabel(c.g, me)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
