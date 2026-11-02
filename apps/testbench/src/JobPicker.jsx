/* Choosing the Simpro job reports go to: type a job number, customer or description and pick from what Simpro finds.
   With no connection a typed job number is taken as it is and checked when the files are sent. */
import { useState } from 'react'
import { Button } from '../../../shared/ui/index.jsx'
import { COMPANY_KEY, findJobs, jobLabel } from './simpro-api.js'

export default function JobPicker({ call, online, user, companies, companyId, onCompany, job, onJob, disabled }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const isNumber = /^\d+$/.test(q.trim())

  async function find() {
    const text = q.trim()
    if (!text) return setNote('Type a job number, customer or description to search for.')
    setBusy(true); setHits([]); setNote('Searching…')
    try {
      const jobs = await findJobs(call, companyId, text)
      setHits(jobs)
      setNote(jobs.length ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} found.` : `Nothing matched “${text}”. Check the company, or try the job number.`)
    } catch (e) { setNote(e.message || String(e)) } finally { setBusy(false) }
  }
  const pick = (j) => { onJob({ id: String(j.ID), label: jobLabel(j) }); setHits([]); setNote(''); setQ('') }
  const useNumber = () => { onJob({ id: q.trim(), label: `#${q.trim()}` }); setHits([]); setNote(''); setQ('') }

  if (job) {
    return (
      <div className="tb-job">
        <strong>{job.label}</strong>
        <Button variant="ghost" size="sm" onClick={() => onJob(null)}>Change job</Button>
      </div>
    )
  }
  return (
    <div className="tb-picker">
      <div className="tb-find">
        {companies.length > 1 && (
          <select aria-label="Simpro company" value={companyId} onChange={(e) => { onCompany(+e.target.value); try { localStorage.setItem(COMPANY_KEY, e.target.value) } catch { /* private mode */ } setHits([]) }}>
            {companies.map((c) => <option key={c.ID} value={c.ID}>{c.Name}</option>)}
          </select>
        )}
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={online ? 'Job number, customer or description' : 'Job number'} aria-label="Simpro job"
          onKeyDown={(e) => { if (e.key === 'Enter') { if (online && user && !disabled) find(); else if (isNumber) useNumber() } }} />
        <Button variant="secondary" disabled={busy || !online || !user || disabled} onClick={find}>Find</Button>
        {isNumber && <Button variant="ghost" onClick={useNumber}>Use job #{q.trim()}</Button>}
      </div>
      {!online && <p className="tb-muted">No connection: type the job number and use it. The job is checked when the files are sent.</p>}
      {note && <p className="tb-muted" role="status">{note}</p>}
      {hits.map((j) => (
        <button key={j.ID} type="button" className="tb-hit" onClick={() => pick(j)}>
          <strong>#{j.ID}</strong> {j.Customer?.CompanyName || [j.Customer?.GivenName, j.Customer?.FamilyName].filter(Boolean).join(' ')}
          <span>{[j.Site?.Name, j.Name || j.Description].filter(Boolean).join(' · ')}</span>
        </button>
      ))}
    </div>
  )
}
