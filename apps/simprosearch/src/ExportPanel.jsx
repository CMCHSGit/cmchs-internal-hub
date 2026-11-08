/* "Export to a file": the chosen jobs' number, title, description and notes as one file (or a zip of several for a long list),
   for reading through or handing to Cowork. Read only: it reads from Simpro and saves a file on this computer. */
import { useRef, useState } from 'react'
import { Alert, Button } from '../../../shared/ui/index.jsx'
import { logActivity } from '../../../shared/activity.js'
import { makeZip } from '../../testbench/src/zip.js'
import { FORMATS, buildFiles, recordOf } from './export.js'
import { completeJobs } from './search.js'

function save(name, bytesOrText, type) {
  const url = URL.createObjectURL(new Blob([bytesOrText], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10000)
}

export default function ExportPanel({ call, companyId, jobs, searched = '', one = false }) {
  const [format, setFormat] = useState('md')
  const [people, setPeople] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState(null) // { tone, text }
  const cancelled = useRef(false)

  async function run() {
    if (!jobs.length) return
    cancelled.current = false
    setBusy(true); setMessage(null); setProgress('')
    try {
      const { jobs: full, failed, cancelled: stopped } = await completeJobs(call, companyId, jobs, {
        isCancelled: () => cancelled.current,
        onProgress: (done, total) => setProgress(total ? `Reading the full text of job ${Math.min(done + 1, total)} of ${total}…` : ''),
      })
      if (stopped) return setMessage({ tone: 'info', text: 'Stopped. Nothing was saved.' })
      const stamp = new Date().toISOString().slice(0, 10)
      const files = buildFiles(full.map((j) => recordOf(j, { people })), { format, stamp, searched })
      const kind = FORMATS.find((f) => f.id === format)?.label.split(' ')[0] || format
      if (files.length === 1) save(files[0].name, files[0].text, files[0].type)
      else {
        const enc = new TextEncoder()
        save(`simpro-jobs-${stamp}.zip`, makeZip(files.map((f) => ({ name: f.name, bytes: enc.encode(f.text) }))), 'application/zip')
      }
      // One line in the activity log: how many, never what was in them.
      logActivity(null, `Exported ${full.length} Simpro ${full.length === 1 ? 'job' : 'jobs'} to a ${kind} file${people ? ' with customer and site names' : ''}`, { app: 'simprosearch' })
      setMessage({
        tone: failed ? 'warning' : 'success',
        text: `Saved ${full.length - failed} ${full.length - failed === 1 ? 'job' : 'jobs'}${files.length > 1 ? ` in ${files.length} files in a zip` : ''}.${failed ? ` ${failed} could not be read from Simpro and have only what the search showed.` : ''}`,
      })
    } catch (e) {
      setMessage({ tone: 'warning', text: e?.message || String(e) })
    } finally {
      setBusy(false); setProgress('')
    }
  }

  return (
    <div className="ds-card ds-export">
      <div className="ds-export-head">
        <h2 className="ds-h2">Export to a file</h2>
        <span className="ds-muted">{one ? 'This job' : `${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'} ticked`}: number, title, description and notes.</span>
      </div>
      <div className="ds-row">
        <label className="field">
          <span className="field-label">File type</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy}>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label className="ds-check-line">
          <input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} disabled={busy} />
          <span>Include customer and site names</span>
        </label>
        <Button onClick={run} disabled={busy || !jobs.length}>{busy ? 'Exporting…' : one ? 'Export this job' : `Export ${jobs.length} ${jobs.length === 1 ? 'job' : 'jobs'}`}</Button>
        {busy && <Button variant="ghost" onClick={() => { cancelled.current = true }}>Stop</Button>}
      </div>
      <p className="ds-muted">
        Customer and site names are left out unless you tick the box. The descriptions and notes themselves are as staff wrote them,
        so they can still mention people or places: check before sharing the file outside the company.
      </p>
      {progress && <p className="ds-note" role="status">{progress}</p>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </div>
  )
}
