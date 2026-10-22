/* The loan form (old: generateLoanDoc and the loan form window): the printed
   CMCHS Demo Equipment Loan Form, editable where the old one was (the
   header, every device row, notes and shipping), with rows to add, Print,
   and Send to the account manager.

   Opened two ways:
     finishing  right after a new loan is made. Finish saves it, emails it to
                the account manager and makes the Simpro job (if job creation
                is on and it isn't long term): what closing the old form did.
     viewing    a loan's form from its card. Save keeps changes (and brings
                its Simpro job up to date, as the old Save Changes). */
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Plus, Printer, Send, X } from 'lucide-react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { fmtDate, formRows, loanFormHtml, loanFormRtf, toISO } from './model.js'

export default function LoanForm({ s, docKey, doc, info, items, finishing = null, onClose, onDone }) {
  const [f, setF] = useState(() => ({
    loanTo: doc?.loanTo || info.loanTo || '', location: doc?.location || info.location || '',
    startDate: doc?.startDate || info.startDate || s.today, endDate: info.longTerm ? '' : (doc?.endDate || info.endDate || ''),
    accountManager: doc?.accountManager || info.accountManager || '', contactNumber: doc?.contactNumber || info.contactNumber || '',
    rows: formRows(doc, items, s.equipment), notes: doc?.notesCell || doc?.notes || '', shipping: doc?.authCell || '',
  }))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [done, setDone] = useState([])
  const [edited, setEdited] = useState(false)
  const set = (k) => (e) => { setF((x) => ({ ...x, [k]: e.target.value })); setEdited(true) }
  const setCell = (r, c) => (e) => { const v = e.target.value; setF((x) => ({ ...x, rows: x.rows.map((row, i) => (i === r ? row.map((cell, j) => (j === c ? v : cell)) : row)) })); setEdited(true) }
  const form = useMemo(() => ({ ...f, items, longTerm: !!info.longTerm }), [f, items, info.longTerm])
  const formInfo = info

  async function step(label, fn) {
    setBusy(label); setError('')
    try { return await fn() } catch (e) { setError(e.message || String(e)); throw e } finally { setBusy('') }
  }
  const save = () => step('Saving…', async () => { const r = await s.saveForm(docKey, form, formInfo, { simproToo: !finishing }); setEdited(false); return r })
  const send = () => step('Sending…', async () => {
    const r = await s.emailForm({ ...form, startDate: toISO(f.startDate), endDate: toISO(f.endDate) }, finishing?.email || info.email, finishing?.name || f.accountManager)
    setDone((d) => [...d, r.simulated ? 'Email not sent (test mode or the dev server).' : `Emailed to ${finishing?.email || info.email}.`])
  })
  async function finish({ away = false } = {}) {
    started.current = true
    try {
      const notes = []
      await step('Saving…', () => s.saveForm(docKey, form, formInfo, { simproToo: false }))
      if (finishing.email) {
        try {
          const r = await step('Sending the email…', () => s.emailForm({ ...form, startDate: toISO(f.startDate), endDate: toISO(f.endDate) }, finishing.email, finishing.name))
          notes.push(r.simulated ? 'email not sent here (test mode or dev)' : `emailed to ${finishing.email}`)
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
  function print() {
    const w = window.open('', '_blank')
    if (!w) return setError('The print window was blocked. Allow pop-ups for this site and try again.')
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>CHS Loan Form</title><style>@page{margin:0}body{margin:0;padding:14mm;font-family:Arial,sans-serif}body>div{max-width:none!important}td,th{font-size:13px!important;padding:4px 8px!important}</style></head><body>${loanFormHtml({ ...form, startDate: toISO(f.startDate), endDate: toISO(f.endDate) })}<script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }
  // While finishing, closing finishes (old: closing the form sent the email and made the Simpro job).
  // Viewing, closing keeps what was changed (old: notes and shipping saved as typed, the rest on close); Discard changes doesn't.
  const close = () => (busy ? undefined : finishing ? finish() : edited ? save().then(() => onDone?.('Loan form saved.')).catch(() => {}) : onClose())

  return (
    <Dialog title={finishing ? 'Check the loan form, then finish' : 'Loan form'} description={finishing ? (finishing.email ? `Finish saves it, emails it to ${finishing.email}${info.longTerm ? '' : ' and makes the Simpro job (if job creation is on)'}.` : 'Finish saves it.') : f.loanTo}
      onClose={close} width={1000} className="eq-formdlg">
      <div className="eq-lf" data-working={busy ? '' : undefined}>
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
        <label className="field"><span className="field-label">Notes</span><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></label>
        <label className="field"><span className="field-label">Shipping details</span><textarea className="input" rows={2} value={f.shipping} onChange={set('shipping')} /></label>
        <p className="eq-note">The signatures, the ESC reminder and the “data cleared on return” boxes are on the printed form.</p>
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
          {!finishing && (info.email || f.accountManager) && <Button variant="ghost" iconLeft={<Send size={16} />} onClick={() => send().catch(() => {})} disabled={!!busy || !info.email}>Email it{info.email ? ` to ${info.email}` : ''}</Button>}
          {!finishing && edited && <Button variant="ghost" onClick={onClose} disabled={!!busy}>Discard changes</Button>}
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
