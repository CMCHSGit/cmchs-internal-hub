/* Update weeks from the planning workbook: pick the workbook, see what would
   change in the tracker's weeks (colours, notes, who is on), untick anything,
   apply. Nothing is written until Apply, and the removals (what the workbook
   no longer says) start unticked. See plan-sheet.js for how it reads it. */

import { useMemo, useState } from 'react'
import { Alert, Button } from '../../schedule/src/components/ui'
import { useStore } from './store.jsx'
import { useUi } from './App.jsx'
import { Modal } from './ui.jsx'
import { fmt } from './model.js'
import { readPlanSheet, diffPlan, describeChange } from './plan-sheet.js'

const keyOf = (c) => [c.jobId, c.week, c.kind, c.who || '', c.to ?? ''].join('|')

export function PlanSyncDialog({ onClose }) {
  const s = useStore()
  const ui = useUi()
  const [plan, setPlan] = useState(null) // { rows, weeks, teamNames }
  const [file, setFile] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [choices, setChoices] = useState({}) // row name -> jobId, for rows matched by hand
  const [off, setOff] = useState({}) // change key -> true when unticked (optional ones start unticked)
  const [on, setOn] = useState({}) // change key -> true when an optional one is ticked

  async function pick(e) {
    const f = e.target.files?.[0]
    if (!f) return
    setBusy(true); setMsg(''); setPlan(null); setChoices({}); setOff({}); setOn({})
    try {
      setPlan(await readPlanSheet(await f.arrayBuffer()))
      setFile(f.name)
    } catch (err) { setMsg(err.message || String(err)) } finally { setBusy(false) }
  }

  const diff = useMemo(() => (plan
    ? diffPlan(plan.rows, { jobs: s.jobs, assignments: s.assignments, staff: s.settings.staff, teamNames: plan.teamNames, weeks: plan.weeks, choices })
    : null), [plan, s.jobs, s.assignments, s.settings.staff, choices])
  const ticked = (c) => (c.optional ? !!on[keyOf(c)] : !off[keyOf(c)])
  const chosen = diff ? diff.changes.filter(ticked) : []
  const byJob = useMemo(() => {
    const m = new Map()
    for (const c of diff?.changes || []) { if (!m.has(c.jobId)) m.set(c.jobId, { name: c.job, list: [] }); m.get(c.jobId).list.push(c) }
    return [...m.values()]
  }, [diff])
  const live = s.jobs.filter((j) => !j.archived).sort((a, b) => a.name.localeCompare(b.name))

  async function apply() {
    setBusy(true)
    try {
      const r = await s.applyPlan(chosen)
      ui.toast(`${r.changes} change${r.changes === 1 ? '' : 's'} applied to ${r.jobs} job${r.jobs === 1 ? '' : 's'}`)
      onClose()
    } catch (err) { setMsg('Not applied: ' + (err.message || err)); setBusy(false) }
  }

  return (
    <Modal title="Update weeks from the planning workbook" description="Reads the Team Planning sheet and shows what would change in the weeks: each week's colour, its note, and who is on it. Nothing changes until you apply." onClose={onClose} width={760}>
      <div className="pt-stack">
        <label className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>{file ? 'Choose another file…' : 'Choose the workbook…'}<input type="file" accept=".xlsx" onChange={pick} hidden /></label>
        {file && <p className="text-sm text-muted">{file}</p>}
        {busy && !diff && <p className="text-sm">Reading…</p>}
        {msg && <Alert tone="critical" title="Not done">{msg}</Alert>}
        {diff && (
          <>
            <p className="text-sm">
              {diff.changes.length === 0 ? 'The weeks already match the workbook.' : <><b>{diff.changes.length}</b> difference{diff.changes.length === 1 ? '' : 's'} in <b>{byJob.length}</b> job{byJob.length === 1 ? '' : 's'}, from the week of {fmt(plan.weeks[0])}. Unticked ones are things the tracker has that the workbook doesn’t say.</>}
            </p>
            {diff.unmatched.length > 0 && (
              <div className="card pt-card">
                <b className="text-sm">Rows with no matching job ({diff.unmatched.length})</b>
                <span className="text-sm text-muted">Pick the job each one is, or leave it to be skipped.</span>
                {diff.unmatched.map((r) => (
                  <label key={r.name} className="pt-row text-sm">
                    <span className="pt-grow pt-ellipsis" title={r.name}>{r.name}</span>
                    <select value={choices[r.name] || ''} aria-label={`Job for ${r.name}`} onChange={(e) => setChoices((c) => ({ ...c, [r.name]: e.target.value }))} style={{ maxWidth: 280 }}>
                      <option value="">Skip</option>
                      {live.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            )}
            <div className="pt-import-preview pt-plandiff">
              {byJob.map((g) => (
                <section key={g.list[0].jobId}>
                  <b className="text-sm">{g.name}</b>
                  {g.list.map((c) => (
                    <label key={keyOf(c)} className={`pt-row text-sm${c.optional ? ' text-muted' : ''}`}>
                      <input type="checkbox" checked={ticked(c)} onChange={(e) => (c.optional ? setOn((o) => ({ ...o, [keyOf(c)]: e.target.checked })) : setOff((o) => ({ ...o, [keyOf(c)]: !e.target.checked })))} />
                      <span className="pt-wk">{fmt(c.week)}</span>
                      <span className="pt-grow">{describeChange(c)}</span>
                    </label>
                  ))}
                </section>
              ))}
            </div>
            {diff.notes.map((n) => <p key={n} className="text-sm text-muted">{n}</p>)}
            <p className="text-sm text-muted">Statuses, dates and job notes aren’t changed here, only the weekly grid.</p>
            <div className="pt-addrow"><span className="pt-grow" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={busy || chosen.length === 0} onClick={apply}>{busy ? 'Applying…' : `Apply ${chosen.length} change${chosen.length === 1 ? '' : 's'}`}</Button></div>
          </>
        )}
      </div>
    </Modal>
  )
}
