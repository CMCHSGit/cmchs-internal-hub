/* "Export every job": all the jobs in Simpro (or a stage, or those issued since a date) as files for building the knowledge base.
   Read only: it reads from Simpro and saves on this computer. Stop saves what has been read so far. */
import { useMemo, useRef, useState } from 'react'
import { Alert, Button } from '../../../shared/ui/index.jsx'
import { logActivity } from '../../../shared/activity.js'
import { PROXY_URL } from '../../../shared/proxy.js'
import { auth } from '../../schedule/src/firebase.js'
import { SendError } from '../../testbench/src/simpro-api.js'
import { FORMATS, buildFiles, recordOf } from './export.js'
import { exportAllJobs, makeBatchGet } from './bulk.js'
import { saveFiles } from './download.js'
import { STAGES } from './search.js'

const n = (v) => Number(v).toLocaleString('en-NZ')

export default function BulkExport({ call, companyId }) {
  const batchGet = useMemo(() => makeBatchGet({
    proxyUrl: PROXY_URL,
    getToken: async () => {
      if (!auth?.currentUser) throw new SendError('Sign in to the hub to use Simpro.', false)
      return auth.currentUser.getIdToken()
    },
  }), [])
  const [format, setFormat] = useState('md')
  const [stage, setStage] = useState('')
  const [issuedFrom, setIssuedFrom] = useState('')
  const [skipEmpty, setSkipEmpty] = useState(true)
  const [people, setPeople] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [message, setMessage] = useState(null)
  const stop = useRef(false)

  async function run() {
    stop.current = false
    setBusy(true); setMessage(null); setProgress('Asking Simpro for the list of jobs…')
    try {
      const { jobs, failed, cancelled, listed } = await exportAllJobs({
        call, batchGet, companyId, stage, issuedFrom, skipEmpty,
        isCancelled: () => stop.current,
        onProgress: ({ phase, done, total }) => setProgress(phase === 'list' ? `Listing jobs: ${n(done)} so far…` : `Reading the full text: ${n(done)} of ${n(total)}…`),
      })
      if (!jobs.length) return setMessage({ tone: 'info', text: cancelled ? 'Stopped before any job’s text was read, so nothing was saved.' : `Simpro listed ${n(listed)} jobs, but none had anything written in them${skipEmpty ? '' : ' to save'}.` })
      setProgress('Making the file…')
      const stamp = new Date().toISOString().slice(0, 10)
      const searched = ['all jobs', stage && `stage ${stage}`, issuedFrom && `issued from ${issuedFrom}`].filter(Boolean).join(', ')
      const files = buildFiles(jobs.map((j) => recordOf(j, { people })), { format, stamp, searched })
      const made = saveFiles(files, stamp)
      const kind = FORMATS.find((f) => f.id === format)?.label.split(' ')[0] || format
      logActivity(null, `Exported ${n(jobs.length)} Simpro jobs (${stage ? 'stage ' + stage : 'all stages'}${issuedFrom ? ', issued from ' + issuedFrom : ''}) to a ${kind} file${people ? ' with customer and site names' : ''}`, { app: 'simprosearch' })
      setMessage({
        tone: failed || cancelled ? 'warning' : 'success',
        text: `Saved ${n(jobs.length)} jobs${made > 1 ? ` in ${n(made)} files in a zip` : ''}. Simpro listed ${n(listed)}${!cancelled && skipEmpty && listed - failed - jobs.length > 0 ? `; ${n(listed - failed - jobs.length)} had nothing written and were left out` : ''}.` +
          (cancelled ? ' You stopped it, so this is only the jobs read before then.' : '') + (failed ? ` ${n(failed)} could not be read and are not in the file.` : ''),
      })
    } catch (e) {
      setMessage({ tone: 'warning', text: e?.message || String(e) })
    } finally {
      setBusy(false); setProgress('')
    }
  }

  return (
    <details className="ds-card ds-export">
      <summary>Export every job (for the knowledge base)</summary>
      <p className="ds-muted">
        Saves each job’s number, title, description and notes from Simpro, not just the ones you searched for. It reads the whole job
        list, so a large company takes a few minutes. Stop saves what has been read so far. Narrowing it to completed jobs, or to
        jobs since a date, makes it smaller.
      </p>
      <div className="ds-row">
        <label className="field">
          <span className="field-label">Stage</span>
          <select value={stage} onChange={(e) => setStage(e.target.value)} disabled={busy}>
            <option value="">Any stage</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Issued on or after (optional)</span>
          <input className="input" type="date" value={issuedFrom} onChange={(e) => setIssuedFrom(e.target.value)} disabled={busy} />
        </label>
        <label className="field">
          <span className="field-label">File type</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={busy}>
            {FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
      </div>
      <div className="ds-row">
        <label className="ds-check-line"><input type="checkbox" checked={skipEmpty} onChange={(e) => setSkipEmpty(e.target.checked)} disabled={busy} /><span>Leave out jobs with nothing written</span></label>
        <label className="ds-check-line"><input type="checkbox" checked={people} onChange={(e) => setPeople(e.target.checked)} disabled={busy} /><span>Include customer and site names</span></label>
      </div>
      <div className="ds-row">
        <Button onClick={run} disabled={busy}>{busy ? 'Exporting…' : 'Export every job'}</Button>
        {busy && <Button variant="ghost" onClick={() => { stop.current = true }}>Stop and save what’s read</Button>}
      </div>
      <p className="ds-muted">
        Long lists come as a zip of files of 100 jobs each. Customer and site names are left out unless you tick the box, but staff
        notes can still mention people or places: check before sharing the files outside the company. This adds one line to the
        activity log, with a count and nothing from the jobs.
      </p>
      {progress && <p className="ds-note" role="status">{progress}</p>}
      {message && <Alert tone={message.tone}>{message.text}</Alert>}
    </details>
  )
}
