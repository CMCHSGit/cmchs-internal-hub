/* The dialogs: quick-add a job, the archive question on Complete, and
   import from Excel or CSV. */

import { useState } from 'react'
import { Alert, Button } from '../../schedule/src/components/ui'
import { useStore } from './store.jsx'
import { useUi } from './App.jsx'
import { Modal, Field } from './ui.jsx'
import { PRIORITIES, addDays, fmt, fmtY, overdueReturns } from './model.js'
import { readImportFile } from './io.js'

export function QuickAdd({ prefill, onClose }) {
  const s = useStore()
  const ui = useUi()
  const [v, setV] = useState({ name: '', category: prefill.category || s.settings.categories[0]?.id || '', customer: '', region: '', start: '', end: '', priority: 'Medium', ...prefill })
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  async function submit(e) {
    e.preventDefault()
    if (!v.name.trim()) return
    setBusy(true)
    try {
      const id = await s.createJob({ ...v, name: v.name.trim() })
      onClose()
      ui.openJob(id, ui.route.view === 'archive' || ui.route.view === 'settings' ? 'table' : ui.route.view)
    } catch (err) {
      ui.toast('Not saved: ' + err.message)
      setBusy(false)
    }
  }
  return (
    <Modal title="New job" description="The rest of the details go in the job's panel. Press N from any page to get here." onClose={onClose}>
      <form className="pt-stack" onSubmit={submit}>
        <Field label="Job name"><input className="input" value={v.name} onChange={set('name')} placeholder='e.g. "Waikato 13x D30 training across sites"' required /></Field>
        <div className="pt-grid2">
          <Field label="Category" className="pt-span2">
            <select value={v.category} onChange={set('category')}>{s.settings.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          </Field>
          <Field label="Customer / hospital"><input className="input" value={v.customer} onChange={set('customer')} /></Field>
          <Field label="Region"><input className="input" value={v.region} onChange={set('region')} /></Field>
          <Field label="Planned start"><input className="input" type="date" value={v.start} onChange={set('start')} /></Field>
          <Field label="Planned end"><input className="input" type="date" value={v.end} min={v.start} onChange={set('end')} /></Field>
          <Field label="Priority"><select value={v.priority} onChange={set('priority')}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></Field>
        </div>
        <div className="pt-addrow"><span className="pt-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy || !v.name.trim()}>Create job</Button></div>
      </form>
    </Modal>
  )
}

export function ArchivePrompt({ job, onClose }) {
  const s = useStore()
  const ui = useUi()
  const days = s.settings.autoArchiveDays
  const [always, setAlways] = useState(false)
  const out = overdueReturns([job], addDays(s.today, 1)).concat()
  const stillOut = (job.equipment || []).filter((l) => ['Shipped', 'At site'].includes(l.line))
  async function choose(what) {
    if (always) await s.saveSettings({ askOnComplete: false, autoArchive: true })
    if (what === 'now') { await s.archiveJob(job); ui.toast('Moved to the Archive'); ui.closeJob() }
    if (what === 'later') { await s.scheduleArchive(job, days); ui.toast(`Archives on ${fmt(addDays(s.today, days))}`) }
    if (what === 'keep') { await s.keepActive(job); ui.toast('Kept active') }
    onClose()
  }
  return (
    <Modal title="Archive this job?" description={`${job.name} is now Complete.`} onClose={() => choose('keep')} width={540}>
      <div className="pt-stack">
        <p>Archiving moves it to the Archive tab and takes it off Home, Table, Timeline and Equipment. Nothing is deleted: fields, equipment, staff weeks, notes, action points, comments and history all stay, and you can restore it at any time.</p>
        {stillOut.length > 0 && (
          <Alert tone="warning" title={`${stillOut.reduce((t, l) => t + Number(l.qty || 0), 0)} demo unit${stillOut.length === 1 && Number(stillOut[0].qty) === 1 ? '' : 's'} still out`}>
            {stillOut.map((l) => `${l.qty}x ${l.model}${l.note ? ' ' + l.note : ''}`).join(', ')} {out.length ? 'is overdue' : 'is marked Shipped or At site'}. It keeps counting against the demo pool until it's marked Returned.
          </Alert>
        )}
        <label className="pt-check"><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} />
          <span>Don't ask again. Archive completed jobs automatically after {days} days. <span className="text-sm text-muted">(Change this in Settings.)</span></span>
        </label>
        <div className="pt-addrow pt-wrap">
          <span className="pt-grow" />
          <Button variant="ghost" onClick={() => choose('keep')}>Keep active</Button>
          <Button variant="secondary" onClick={() => choose('later')}>Archive in {days} days</Button>
          <Button onClick={() => choose('now')}>Archive now</Button>
        </div>
      </div>
    </Modal>
  )
}

export function ImportDialog({ onClose }) {
  const s = useStore()
  const ui = useUi()
  const [rows, setRows] = useState(null)
  const [bundle, setBundle] = useState(null)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  async function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setMsg('Reading…')
    setRows(null); setBundle(null)
    if (/\.json$/i.test(file.name)) {
      try {
        const b = JSON.parse(await file.text())
        if (b?.kind !== 'project-tracker-import') throw new Error('This is not a project tracker import file.')
        setBundle(b)
        setMsg('')
      } catch (err) { setMsg('Could not read that file: ' + err.message) }
      return
    }
    try {
      const r = await readImportFile(file, s.settings)
      setRows(r)
      setMsg(r.length ? '' : 'No rows with a job name were found. The first row needs headings such as Job, Customer, Region, Status, Start, End.')
    } catch (err) { setMsg('Could not read that file: ' + err.message) }
  }
  async function go() {
    setBusy(true)
    try {
      const n = await s.importJobs(rows)
      ui.toast(`${n} job${n === 1 ? '' : 's'} imported`)
      onClose()
    } catch (err) { setMsg('Import failed: ' + err.message); setBusy(false) }
  }
  return (
    <Modal title="Import from Excel or CSV" description="One job per row. Columns are found by their headings, so order doesn't matter." onClose={onClose} width={720}>
      <div className="pt-stack">
        <p className="text-sm">Headings it understands: <b>Job</b> (or Name, Project), <b>Customer</b> (or Hospital, Site), <b>Region</b>, <b>Category</b>, <b>Status</b>, <b>Priority</b>, <b>Start</b>, <b>End</b>, <b>Waiting on</b>, <b>Tracking</b>, <b>Notes</b>, <b>Project manager</b>. Dates can be 12/10/2026, 2026-10-12 or real Excel dates.</p>
        <p className="text-sm text-muted">A project tracker import file (.json) brings in jobs, who is where each week, staff and activity colours together.</p>
        <label className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>Choose a file…<input type="file" accept=".xlsx,.csv,.json" onChange={pick} hidden /></label>
        {msg && <p className="text-sm">{msg}</p>}
        {bundle && (
          <>
            <Alert tone="info" title={bundle.title || 'Project tracker import'}>
              {bundle.jobs?.length || 0} jobs, {bundle.assignments?.length || 0} staff weeks, {bundle.staff?.length || 0} staff (matched to the staff list by initials; new ones are added)
              {bundle.activities?.length ? `, and ${bundle.activities.length} activity types, which replace the current ones` : ''}. Jobs already imported from this file are skipped.
            </Alert>
            <div className="pt-addrow"><span className="pt-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button disabled={busy} onClick={async () => {
                setBusy(true)
                try {
                  const r = await s.importBundle(bundle)
                  ui.toast(`${r.jobs} jobs and ${r.weeks} staff weeks imported${r.skipped ? `, ${r.skipped} already there` : ''}`)
                  onClose()
                } catch (err) { setMsg('Import failed: ' + err.message); setBusy(false) }
              }}>Import</Button>
            </div>
          </>
        )}
        {rows?.length > 0 && (
          <>
            <p className="text-sm"><b>{rows.length}</b> job{rows.length === 1 ? '' : 's'} ready to import. The first few:</p>
            <div className="pt-import-preview">
              {rows.slice(0, 8).map((r, i) => (
                <div key={i} className="pt-row text-sm"><b className="pt-grow pt-ellipsis">{r.name}</b><span className="pt-ellipsis">{r.customer}</span><span>{r.status}</span><span>{r.start ? fmtY(r.start) : ''}</span></div>
              ))}
            </div>
            <div className="pt-addrow"><span className="pt-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy} onClick={go}>Import {rows.length} job{rows.length === 1 ? '' : 's'}</Button></div>
          </>
        )}
      </div>
    </Modal>
  )
}
