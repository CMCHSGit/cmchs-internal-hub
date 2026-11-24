/* The loan form (old: generateLoanDoc and the loan form window): the printed
   CMCHS Demo Equipment Loan Form, editable where the old one was (the
   header, every device row, notes and shipping), with rows to add, Print,
   and Send to the account manager.

   Opened two ways:
     finishing  right after a new loan is made. Finish saves it, emails it to
                the account manager and makes the Simpro job (if job creation
                is on and it isn't long term): what closing the old form did.
     viewing    a loan's form from its card. Save keeps changes (and brings
                its Simpro job up to date, as the old Save Changes). Typed
                changes are never lost quietly: leaving the form any way but
                Discard changes saves them (the phone's Back, another tab of
                the tracker), closing or reloading the page asks first, and
                emailing it saves it first, so the email is what's kept.

   The device table is only the printed sheet: a device goes on a loan with
   Add items. One typed into the table that isn't on the loan is pointed out. */
import AutoText from './AutoText.jsx'
import { AccessoryEditor, AccessoryNotesHint } from './Accessories.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Plus, Printer, Send, X } from 'lucide-react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { cleanAccessories, fmtDate, formAssetsNotOnLoan, formFromDoc, loanFormHtml, loanFormRtf, rowsWithout, toISO } from './model.js'

export default function LoanForm({ s, docKey, doc, info, items, finishing = null, onClose, onDone }) {
  const [f, setF] = useState(() => formFromDoc(doc, info, items, s.equipment, s.today))
  // What it showed when it opened, then what it last saved: a save keeps what's stored now for anything not
  // changed since (store.jsx saveForm, model.js formOverStored), so a form opened from an out-of-date copy
  // never puts back what someone else saved meanwhile.
  const opened = useRef(null)
  if (!opened.current) opened.current = f
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState([])
  const [edited, setEdited] = useState(false)
  // Accessories are optional: the list shows once ticked (or when the loan already has some); unticked, the loan has none.
  const [withAcc, setWithAcc] = useState(() => cleanAccessories(doc?.accessories).length > 0)
  const models = useMemo(() => [...new Set((items || []).map((e) => e.Model).filter(Boolean))], [items])
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setEdited(true) }
  const setCell = (r, c) => (e) => { const v = e.target.value; setF((x) => ({ ...x, rows: x.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)) })); setEdited(true) }
  const form = useMemo(() => ({ ...f, accessories: withAcc ? cleanAccessories(f.accessories) : [], items, longTerm: !!info.longTerm }), [f, withAcc, items, info.longTerm])
  const formInfo = info
  const notOnLoan = useMemo(() => formAssetsNotOnLoan(f.rows, items, s.equipment), [f.rows, items, s.equipment])
  // For leaving without Save: what's typed now, whether it's unsaved, and whether it was thrown away on purpose.
  const editedRef = useRef(false), formRef = useRef(form), discarded = useRef(false)
  editedRef.current = edited
  formRef.current = form

  async function step(label, fn) {
    setBusy(label); setError('')
    try { return await fn() } catch (e) { setError(e.message || String(e)); throw e } finally { setBusy('') }
  }
  const save = () => step('Saving…', async () => {
    const sent = form
    const r = await s.saveForm(docKey, sent, formInfo, { simproToo: !finishing, opened: opened.current })
    opened.current = sent; editedRef.current = false; setEdited(false)
    return r
  })
  // Emailing saves first: the email never shows changes the tracker doesn't have.
  const send = () => (edited ? save() : Promise.resolve()).then(() => step('Sending…', async () => {
    const r = await s.emailForm({ ...form, startDate: toISO(f.startDate), endDate: toISO(f.endDate) }, finishing?.email || info.email, finishing?.name || f.accountManager, { key: docKey })
    setDone((d) => [...d, r.simulated ? 'Email not sent (test mode or the dev server).' : `Emailed to ${finishing?.email || info.email}.`])
  }))
  const discard = () => { discarded.current = true; onClose() }
  async function finish({ away = false } = {}) {
    started.current = true
    try {
      const notes = []
      await step('Saving…', () => s.saveForm(docKey, form, formInfo, { simproToo: false, opened: opened.current }))
      if (finishing.email) {
        try {
          const r = await step('Sending the email…', () => s.emailForm({ ...form, startDate: toISO(f.startDate), endDate: toISO(f.endDate) }, finishing.email, finishing.name, { key: docKey, once: true }))
          notes.push(r.simulated ? 'email not sent here (test mode or dev)' : r.already ? `already emailed to ${finishing.email}` : `emailed to ${finishing.email}`)
        } catch { notes.push('the email didn’t go (send it again from the loan’s form)') }
      }
      if (!info.longTerm) {
        const job = await step('Making the Simpro job…', () => s.submitJob(docKey, {
          loanTo: f.loanTo, location: f.location, startDate: f.startDate, endDate: f.endDate, accountManager: f.accountManager, contactNumber: f.contactNumber,
          jobType: info.jobType || 'Demo', notes: f.notes, shippingDetails: f.shipping, items: f.rows.filter((r) => r.some(Boolean)).map((r) => ({ CHSAssetNo: r[0], Model: r[1], Description: r[2], SerialNo: r[3] })),
        })).catch(() => ({ skipped: 'failed' }))
        notes.push(job.test ? `Simpro job ${job.jobId} (made up: test mode or dev)` : job.created ? 'Simpro job being made' : job.skipped === 'creation off' ? 'no Simpro job (job creation is off)' : job.skipped === 'failed' ? 'the Simpro job didn’t go (make it from the loan’s Job number button, or Manage, Simpro)' : 'Simpro job up to date')
      }
      const msg = `Loan to ${f.loanTo} done: ${notes.join(', ') || 'saved'}.`
      if (away) finishing.away?.(msg); else onDone?.(msg)
    } catch { started.current = false /* shown */ }
  }
  // As closing the old form did, leaving it finishes the loan: the email and the Simpro job are never skipped
  // because someone went to another tab or pressed Back. (The timeout lets React's dev double-mount through.)
  const started = useRef(false), alive = useRef(false), finishRef = useRef(finish)
  finishRef.current = finish
  useEffect(() => {
    alive.current = true
    if (!finishing) return undefined
    const warn = (e) => { if (!started.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      alive.current = false
      setTimeout(() => { if (!alive.current && !started.current) finishRef.current({ away: true }) }, 0)
    }
  }, [finishing])
  // Viewing: left with changes unsaved (Back, another tab of the tracker) they're saved; closing or reloading the page asks first.
  useEffect(() => {
    if (finishing) return undefined
    const warn = (e) => { if (editedRef.current && !discarded.current) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => {
      window.removeEventListener('beforeunload', warn)
      alive.current = false
      setTimeout(() => {
        if (alive.current || !editedRef.current || discarded.current) return
        editedRef.current = false
        s.saveForm(docKey, formRef.current, formInfo, { simproToo: true, opened: opened.current })
          .then(() => onDone?.('Loan form saved as you left it.'))
          .catch((e) => console.warn('[equipment] loan form not saved on leaving', e))
      }, 0)
    }
  }, [finishing]) // eslint-disable-line react-hooks/exhaustive-deps
  function print() {
    const w = window.open('', '_blank')
    if (!w) return setError('The print window was blocked. Allow pop-ups for this site and try again.')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>CHS Loan Form</title><style>@page{size:A4 landscape;margin:0}body{margin:0;padding:10mm;font-family:Arial,sans-serif}body>div{max-width:none!important}td,th{font-size:12px!important;padding:3px 6px!important}</style></head><body>${loanFormHtml({ ...form, startDate: toISO(f.startDate), endDate: toISO(f.endDate) })}<script>window.onload=function(){var d=document.body.firstElementChild,m=document.createElement('div');m.style.height='100mm';document.body.appendChild(m);var mm=m.offsetHeight/100;m.remove();d.style.zoom=Math.min(1,(210-20)*mm/d.offsetHeight*0.97);window.print()}<\/script></body></html>`)
    w.document.close()
  }
  // While finishing, closing finishes (old: closing the form sent the email and made the Simpro job).
  // Viewing, closing keeps what was changed (old: notes and shipping saved as typed, the rest on close); Discard changes doesn't.
  const close = () => (busy ? undefined : finishing ? finish() : edited ? save().then(() => onDone?.('Loan form saved.')).catch(() => {}) : onClose())

  return (
    <Dialog title={finishing ? 'Check the loan form, then finish' : 'Loan form'} description={finishing ? (finishing.email ? `Finish saves it, emails it to ${finishing.email}${info.longTerm ? '' : ' and makes the Simpro job (if job creation is on)'}.` : 'Finish saves it.') : f.loanTo}
      onClose={close} width={1000} className="eq-formdlg">
      <div className="eq-lf" data-working={busy || edited || finishing ? '' : undefined}>
        <div className="eq-lf-head">
          <span className="eq-lf-title">CMCHS Demo Equipment Loan Form</span>
          <img src="/brand/logo-full-colour.png" alt="Connected Healthcare Systems" className="eq-lf-logo" />
        </div>
        <div className="eq-lf-grid eq-lf-who">
          <label><span>Event and/or customer name</span><input value={f.loanTo} onChange={set('loanTo')} /></label>
          <label><span>Customer address</span><input value={f.location} onChange={set('location')} /></label>
          <label><span>Loan date</span><input type="date" value={toISO(f.startDate)} onChange={set('startDate')} /></label>
          <label><span>Loan ends{info.longTerm ? ' (long term)' : ''}</span><input type="date" value={toISO(f.endDate)} onChange={set('endDate')} disabled={!!info.longTerm} /></label>
          <label><span>Account manager</span><input value={f.accountManager} onChange={set('accountManager')} /></label>
          <label><span>Contact number</span><input value={f.contactNumber} onChange={set('contactNumber')} /></label>
        </div>
        <div className="eq-lf-tablewrap">
          <table className="eq-lf-table">
            <thead><tr><th>CHS asset #</th><th>Model</th><th>Description</th><th>Serial/part #</th><th>Notes / additional info</th><th aria-label="Remove row" /></tr></thead>
            <tbody>
              {f.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => <td key={c}><input value={cell} onChange={setCell(r, c)} aria-label={['Asset number', 'Model', 'Description', 'Serial or part number', 'Notes'][c] + ', row ' + (r + 1)} /></td>)}
                  <td><button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove row ${r + 1}`} onClick={() => { setF((x) => ({ ...x, rows: x.rows.filter((_, i) => i !== r) })); setEdited(true) }}><X size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button size="sm" variant="ghost" iconLeft={<Plus size={14} />} onClick={() => { setF((x) => ({ ...x, rows: [...x.rows, ['', '', '', '', '']] })); setEdited(true) }}>Add a row</Button>
        <p className="eq-note">This table is the printed form only. To put a device on the loan or take one off, use Add items or the × beside it on the loan card.</p>
        {notOnLoan.length > 0 && (
          <Alert tone="warning" title={`${notOnLoan.join(', ')} ${notOnLoan.length === 1 ? 'is' : 'are'} on the form but not on the loan`}>
            Typing a device here only prints it: it isn’t booked, tracked or expected back. To put {notOnLoan.length === 1 ? 'it' : 'them'} on the loan, close this form and use Add items on the loan card. If {notOnLoan.length === 1 ? 'it was' : 'they were'} taken off the loan, take {notOnLoan.length === 1 ? 'it' : 'them'} off the form too.
            <div className="eq-actions-row">
              <Button size="sm" variant="secondary" onClick={() => { setF((x) => ({ ...x, rows: rowsWithout(x.rows, notOnLoan) })); setEdited(true) }}>
                Take {notOnLoan.length === 1 ? notOnLoan[0] : 'them'} off the form
              </Button>
            </div>
          </Alert>
        )}
        <div className="field">
          <label className="eq-check"><input type="checkbox" checked={withAcc} onChange={(e) => { setWithAcc(e.target.checked); setEdited(true) }} /> Accessories (cuffs, sensors, leads…) by code and quantity</label>
          {withAcc && <AccessoryEditor value={f.accessories} onChange={(list) => { setF((x) => ({ ...x, accessories: list })); setEdited(true) }} s={s} models={models} notKey={docKey} />}
        </div>
        <div className="field"><label className="field-label" htmlFor="eq-lf-notes">Notes</label><AutoText id="eq-lf-notes" rows={2} value={f.notes} onChange={set('notes')} />
          <AccessoryNotesHint text={f.notes} onUse={withAcc ? null : () => { setWithAcc(true); setEdited(true) }} /></div>
        <label className="field"><span className="field-label">Shipping details</span><AutoText rows={1} value={f.shipping} onChange={set('shipping')} /></label>
        {done.map((d) => <p key={d} className="eq-note">{d}</p>)}
        {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
        <div className="dialog-actions eq-lf-actions">
          <Button variant="ghost" iconLeft={<Printer size={16} />} onClick={print} disabled={!!busy}>Print</Button>
          <Button variant="ghost" iconLeft={<FileText size={16} />} disabled={!!busy} onClick={() => {
            // Old: Export RTF, the form as a file for Word.
            const { name, rtf } = loanFormRtf({ ...form, longTerm: !!info.longTerm })
            const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([rtf], { type: 'application/rtf' })); a.download = name; a.click()
            setTimeout(() => URL.revokeObjectURL(a.href), 1000)
          }}>Export RTF</Button>
          {!finishing && (info.email || f.accountManager) && <Button variant="ghost" iconLeft={<Send size={16} />} onClick={() => send().catch(() => {})} disabled={!!busy || !info.email}>{edited ? 'Save and email it' : 'Email it'}{info.email ? ` to ${info.email}` : ''}</Button>}
          {!finishing && edited && <Button variant="ghost" onClick={discard} disabled={!!busy}>Discard changes</Button>}
          {!finishing && <Button variant="secondary" onClick={close} disabled={!!busy}>{edited ? 'Save and close' : 'Close'}</Button>}
          {!finishing && <Button onClick={() => save().then(() => onDone?.('Loan form saved.')).catch(() => {})} disabled={!!busy || !edited}>{busy || 'Save'}</Button>}
          {finishing && <Button onClick={finish} disabled={!!busy}>{busy || 'Finish'}</Button>}
        </div>
        {finishing && <p className="eq-note">The loan is already made. Finish (or closing this form) saves your changes here, sends the email and makes the Simpro job.</p>}
        {!finishing && <p className="eq-note">Loan {fmtDate(toISO(f.startDate))}{f.endDate ? ` to ${fmtDate(toISO(f.endDate))}` : ''}.</p>}
      </div>
    </Dialog>
  )
}
