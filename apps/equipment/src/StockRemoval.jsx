/* Stock removal (the "Stock" tab): CHS Form 39, "Items removed from stock", filled in from photos of the bags
   the accessories are in. Photograph a label and its part number (P/N) and description come back as a row to check;
   say how many of each you're taking first. One form for each trial or demo (its own reason, date, who took them and
   SimPro job number); the finished list is saved as a sheet or copied.

   The photo is read on this phone or PC (shared/ocr.js, tesseract.js in a worker): nothing is uploaded, which is what
   QP33 asks for. The rules for picking the part numbers out of the text, for a repeat of one already on the form, and
   for the rows are in model.js (readLabelText, addStockItems, stockRows). A misread character can't always be told
   from the photo (B for 8), so every field is editable and a row the reader wasn't sure of says to check.
   A description comes from the accessory list (Manage › Accessories) when the part number is on it.

   The forms are kept on this device only (localStorage) until they're deleted: they aren't tracker data, so there is
   nothing to log, and no one else sees them. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Camera, Copy, Download, ImagePlus, Minus, Plus, Trash2, X } from 'lucide-react'
import { Alert, Badge, Button, Spinner, Toast, useToast } from '../../../shared/ui/index.jsx'
import { closeOcr, readPhoto, toCanvas } from '../../../shared/ocr.js'
import { STOCK_COLUMNS, addStockItems, fmtDate, readLabelText, stockProblems, stockRows, toCsv } from './model.js'
import { save } from './download.js'

const KEY = 'equipment:stockRemoval'
const QP33 = 'This looks like it may contain patient information. QP33 does not allow patient data to be shared with AI tools. Please remove identifiers before sharing files.'
const uid = () => Math.random().toString(36).slice(2, 10)
const blank = (s) => ({ id: uid(), reason: '', date: s.today, by: s.operator || '', job: '', items: [] })

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

export default function StockRemoval({ s }) {
  const [drafts, setDrafts] = useState(() => loadDrafts() || { forms: [blank(s)], active: '', qty: 1 })
  const live = useRef(drafts)
  live.current = drafts
  const form = drafts.forms.find((f) => f.id === drafts.active) || drafts.forms[0]
  const qty = Math.max(1, Number(drafts.qty) || 1)
  const [reading, setReading] = useState(0) // photos waiting or being read
  const [percent, setPercent] = useState(0)
  const [slowNote, setSlowNote] = useState(false)
  const [notice, setNotice] = useState(null) // { tone, title, body, raw, actions }
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [toast, showToast] = useToast()
  const thumbs = useRef({}) // item id -> the photo it was read from (this visit only)
  const queue = useRef(Promise.resolve())

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(drafts)) } catch { /* private window */ } }, [drafts])
  useEffect(() => () => { closeOcr(); Object.values(thumbs.current).forEach((u) => URL.revokeObjectURL(u)) }, [])

  const patch = (id, fn) => setDrafts((d) => ({ ...d, forms: d.forms.map((f) => (f.id === id ? fn(f) : f)) }))
  const setField = (k, v) => patch(form.id, (f) => ({ ...f, [k]: v }))
  const setItem = (iid, p) => patch(form.id, (f) => ({ ...f, items: f.items.map((i) => (i.id === iid ? { ...i, ...p } : i)) }))
  const clampQty = (n) => Math.min(999, Math.max(1, Math.round(Number(n) || 1)))

  // Each photo in turn: read on this device, the part numbers picked out, put on the form.
  async function readOne(file, formId, each) {
    const url = URL.createObjectURL(file)
    let kept = false
    setPercent(0); setSlowNote(false)
    const slow = setTimeout(() => setSlowNote(true), 6000)
    try {
      const canvas = toCanvas(await createImageBitmap(file))
      const text = await readPhoto(canvas, { onProgress: (p) => setPercent(Math.round(p * 100)), enough: (t) => readLabelText(t).items.length > 0 })
      const r = readLabelText(text)
      if (r.patient) { setNotice({ tone: 'critical', title: 'Patient information in the photo', body: QP33 }); return }
      if (!r.items.length) {
        setNotice({ tone: 'warning', title: 'No part number found', body: 'Hold the phone closer so the P/N line fills the picture, with no glare across it, then try again. Or add the item by hand.', raw: text })
        return
      }
      const f = live.current.forms.find((x) => x.id === formId)
      if (!f) return
      const res = addStockItems(f.items, r.items, each, s.accessoryList || [], uid)
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
    const list = [...(files || [])]
    if (!list.length) return
    const formId = form.id, each = qty
    setNotice(null)
    setReading((n) => n + list.length)
    for (const file of list) queue.current = queue.current.then(() => readOne(file, formId, each)).finally(() => setReading((n) => n - 1))
  }

  const newForm = () => { const f = blank(s); setDrafts((d) => ({ ...d, forms: [f, ...d.forms], active: f.id })); setNotice(null); setConfirmDelete(false) }
  const deleteForm = () => {
    if (!confirmDelete) { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 4000); return }
    setConfirmDelete(false)
    setDrafts((d) => { const forms = d.forms.filter((f) => f.id !== form.id); const keep = forms.length ? forms : [blank(s)]; return { ...d, forms: keep, active: keep[0].id } })
    setNotice(null)
  }
  const addByHand = () => patch(form.id, (f) => ({ ...f, items: [...f.items, { id: uid(), pn: '', desc: '', qty, lot: '', note: '', check: false }] }))
  const removeItem = (i) => { patch(form.id, (f) => ({ ...f, items: f.items.filter((x) => x.id !== i.id) })); showToast(`Removed ${i.pn || 'the item'}`) }

  const rows = useMemo(() => stockRows(form), [form])
  const problems = useMemo(() => stockProblems(form), [form])
  const units = form.items.reduce((n, i) => n + (Number(i.qty) || 0), 0)
  const saveSheet = () => { save(new Blob(['﻿' + toCsv(rows, STOCK_COLUMNS)], { type: 'text/csv;charset=utf-8' }), `form-39-${slug(form.reason)}-${form.date}.csv`); showToast('Saved as a sheet') }
  const copyList = async () => showToast((await copyText([STOCK_COLUMNS.map(([, h]) => h), ...rows.map((r) => STOCK_COLUMNS.map(([k]) => r[k]))].map((r) => r.join('\t')).join('\n'))) ? 'List copied' : 'Couldn’t copy')

  return (
    <div className="eq-stock">
      <p className="eq-small eq-stock-intro">Form 39, items removed from stock. Set how many of each you are taking, then photograph each bag’s label. The photo is read on this {typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'phone' : 'device'}: nothing is uploaded. Keep anything about a patient out of the picture.</p>

      <div className="eq-stock-switch">
        <select className="input" aria-label="Form" value={form.id} onChange={(e) => { setDrafts((d) => ({ ...d, active: e.target.value })); setNotice(null); setConfirmDelete(false) }}>
          {drafts.forms.map((f) => <option key={f.id} value={f.id}>{f.reason || 'Untitled form'} · {fmtDate(f.date)} · {f.items.length}</option>)}
        </select>
        <Button size="sm" variant="secondary" iconLeft={<Plus size={14} />} onClick={newForm}>New form</Button>
        {(drafts.forms.length > 1 || form.items.length > 0 || form.reason) && (
          <Button size="sm" variant="secondary" iconLeft={<Trash2 size={14} />} onClick={deleteForm}>{confirmDelete ? 'Tap again to delete' : 'Delete form'}</Button>
        )}
      </div>

      <div className="card eq-stock-head">
        <label className="field eq-stock-wide"><span className="field-label">Reason for taking</span>
          <input className="input" value={form.reason} onChange={(e) => setField('reason', e.target.value)} placeholder="e.g. Wanganui trial, demo, repair" /></label>
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
            <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { enqueue(e.target.files); e.target.value = '' }} /></label>
          <label className="btn btn-secondary"><ImagePlus size={16} aria-hidden="true" /> Choose photos
            <input type="file" accept="image/*" multiple hidden onChange={(e) => { enqueue(e.target.files); e.target.value = '' }} /></label>
        </div>
        {reading > 0 && (
          <div className="eq-stock-busy" role="status">
            <Spinner size={20} />
            <span>Reading {reading > 1 ? `${reading} photos` : 'the photo'}…{percent > 0 ? ` ${percent}%` : ''}</span>
            {slowNote && <span className="eq-small">The first read loads the reader (about 7 MB) and takes longer.</span>}
          </div>
        )}
      </div>

      <h2 className="eq-section-title">Items <span className="eq-small eq-count">{form.items.length} {form.items.length === 1 ? 'item' : 'items'} · {units} {units === 1 ? 'unit' : 'units'}</span></h2>
      {form.items.length === 0
        ? <p className="eq-small eq-stock-empty">No items on this form yet. Photograph a bag’s label, or <button type="button" className="eq-linkbtn" onClick={addByHand}>add one by hand</button>.</p>
        : (
          <div className="eq-stock-items">
            {form.items.map((i, n) => (
              <div key={i.id} className={`card eq-stock-item${i.check ? ' check' : ''}`}>
                {thumbs.current[i.id] ? <img className="eq-stock-thumb" src={thumbs.current[i.id]} alt={`Photo the item ${n + 1} was read from`} /> : <span className="eq-stock-thumb eq-stock-nopic" aria-hidden="true">{n + 1}</span>}
                <div className="eq-stock-fields">
                  <label className="field"><span className="field-label">Part number (P/N)</span>
                    <input className="input eq-mono" value={i.pn} onChange={(e) => setItem(i.id, { pn: e.target.value })} autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="040-000973-00" /></label>
                  <label className="field"><span className="field-label">Description</span>
                    <input className="input" value={i.desc} onChange={(e) => setItem(i.id, { desc: e.target.value })} /></label>
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
            ))}
            <div><Button size="sm" variant="secondary" iconLeft={<Plus size={14} />} onClick={addByHand}>Add an item by hand</Button></div>
          </div>
        )}

      {form.items.length > 0 && (
        <div className="card eq-stock-done">
          {problems.length > 0 && <ul className="eq-stock-todo">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
          <div className="eq-stock-buttons">
            <Button iconLeft={<Download size={16} />} onClick={saveSheet} disabled={!rows.length}>Save as a sheet</Button>
            <Button variant="secondary" iconLeft={<Copy size={16} />} onClick={copyList} disabled={!rows.length}>Copy list</Button>
          </div>
          <p className="eq-small">The sheet has Form 39’s columns, one row an item. The paper form takes one set of fields, so hand in one page for each item or attach the list.</p>
        </div>
      )}
      <Toast message={toast} />
    </div>
  )
}
