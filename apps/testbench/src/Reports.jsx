/* Saved reports: every PDF, results file and Ansur record the bench has saved on this laptop, sorted by customer or by
   day, to download together (one zip) or attach together to a Simpro job. Plus the outbox of files waiting to go. */
import { useMemo, useState } from 'react'
import { Alert, Badge, Button } from '../../../shared/ui/index.jsx'
import { logActivity } from '../../../shared/activity.js'
import JobPicker from './JobPicker.jsx'
import { PERIODS, categorise, customersIn, filterGroups, groupReports, nzDay, pickFiles } from './reports.js'
import { makeZip } from './zip.js'

const KINDS = [['pdf', 'Reports (PDF)'], ['json', 'Results files'], ['mtr', 'Ansur records']]
const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')
const timeOf = (g) => new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }).format(new Date(g.testedAt || g.savedAt))

function saveBlob(name, blob) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export default function Reports({ reports, fresh, sim, outbox, online, onAttach, makeMtr, onDelete, onRemoveOutbox, onSendWaiting, onRetryFailed, user }) {
  const [by, setBy] = useState('customer')
  const [text, setText] = useState('')
  const [customer, setCustomer] = useState('')
  const [period, setPeriod] = useState('all')
  const [unsentOnly, setUnsentOnly] = useState(false)
  const [exts, setExts] = useState(['pdf', 'mtr']) // not the results file by default: Simpro won't take it, and the Ansur record says the same
  const [chosen, setChosen] = useState(() => new Set())
  const [job, setJob] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState({ text: '', tone: 'info' })

  const groups = useMemo(() => groupReports(reports), [reports])
  const customers = useMemo(() => customersIn(groups), [groups])
  const visible = useMemo(() => filterGroups(groups, { text, unsentOnly, customer, period }), [groups, text, unsentOnly, customer, period])
  const sections = useMemo(() => categorise(visible, by), [visible, by])
  const files = useMemo(() => pickFiles(visible, [...chosen], exts), [visible, chosen, exts])
  // Ticked tests that have a results file but no Ansur record: the bench makes the record when they are downloaded or attached.
  const needMtr = useMemo(() => (exts.includes('mtr') ? visible.filter((g) => chosen.has(g.base) && g.files.some((f) => f.ext === 'json') && !g.files.some((f) => f.ext === 'mtr')) : []), [visible, chosen, exts])
  const count = files.length + needMtr.length
  const picked = visible.filter((g) => chosen.has(g.base)).length
  const total = reports.reduce((n, r) => n + (r.size || 0), 0)
  const waiting = outbox.filter((x) => x.status === 'waiting').length
  const failed = outbox.filter((x) => x.status === 'failed').length

  const toggle = (bases, on) => setChosen((s) => { const n = new Set(s); for (const b of bases) on ? n.add(b) : n.delete(b); return n })
  const allOf = (list) => list.length > 0 && list.every((g) => chosen.has(g.base))

  /** The ticked files plus an Ansur record made for each ticked test that has none. `skipped` counts the ones that couldn't be made (older results files). */
  async function withMtr() {
    const made = []; let skipped = 0
    for (const g of needMtr) { try { made.push(await makeMtr(g)) } catch { skipped++ } }
    return { list: [...files, ...made], skipped }
  }
  const skippedNote = (n) => (n ? ` ${n} test${n === 1 ? '' : 's'} had no Ansur record made (an older results file).` : '')

  async function download() {
    if (!count) return
    setBusy(true)
    try {
      const { list, skipped } = await withMtr()
      if (!list.length) throw new Error('Nothing to download.' + skippedNote(skipped))
      if (list.length === 1) saveBlob(list[0].name, new Blob([list[0].buffer], { type: list[0].mime }))
      else saveBlob(`CHS Test Bench reports ${nzDay(Date.now())}.zip`, new Blob([makeZip(list.map((f) => ({ name: f.name, bytes: new Uint8Array(f.buffer) })))], { type: 'application/zip' }))
      logActivity(null, `Downloaded ${list.length} test file${list.length === 1 ? '' : 's'} from the Test Bench`, { app: 'testbench' })
      setNote({ text: (list.length === 1 ? `Downloaded ${list[0].name}.` : `Downloaded ${list.length} files as one zip.`) + skippedNote(skipped), tone: 'success' })
    } catch (e) { setNote({ text: 'Not downloaded: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false) }
  }

  async function attach() {
    if (!job || !count) return
    setBusy(true)
    try { const { list, skipped } = await withMtr(); const n = await onAttach(list, job); setNote(skipped ? { ...n, text: n.text + skippedNote(skipped) } : n) } catch (e) { setNote({ text: 'Not queued: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false) }
  }

  /** One test's Ansur record, made on the spot if it has only a results file. */
  async function downloadMtr(g) {
    setBusy(true)
    try {
      const rec = g.files.find((f) => f.ext === 'mtr') || await makeMtr(g)
      saveBlob(rec.name, new Blob([rec.buffer], { type: rec.mime || 'application/xml' }))
      logActivity(null, 'Downloaded an Ansur record from the Test Bench', { app: 'testbench' })
      setNote({ text: `Downloaded ${rec.name}.`, tone: 'success' })
    } catch (e) { setNote({ text: 'No Ansur record: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false) }
  }

  async function remove(list, label) {
    if (!list.length || !window.confirm(`Remove ${label} from this laptop? Reports already attached to Simpro stay there; this only clears them from this list.`)) return
    await onDelete(list.map((f) => f.id))
    setChosen(new Set())
  }
  const sentFiles = () => groups.flatMap((g) => g.files).filter((f) => f.sent.length)

  const online_ok = online && user
  return (
    <div className="tb-reports">
      <div className="tb-rhead">
        <div>
          <h2>Saved reports</h2>
          <p className="tb-muted">Every report the bench saves is also kept here on this laptop. Tick the tests you want, then download them together or attach them to a Simpro job.
            {reports.length > 0 && <> {groups.length} test{groups.length === 1 ? '' : 's'} · {kb(total)} kept.</>}</p>
        </div>
      </div>

      <div className="tb-filters">
        <label>Sort by
          <select value={by} onChange={(e) => setBy(e.target.value)}>
            <option value="customer">Customer</option><option value="day">Day</option><option value="none">No headings</option>
          </select>
        </label>
        <label>Customer
          <select value={customer} onChange={(e) => setCustomer(e.target.value)}>
            <option value="">All customers</option>
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>When
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>{PERIODS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
        <input type="search" value={text} onChange={(e) => setText(e.target.value)} placeholder="Search serial, model, customer" aria-label="Search saved reports" />
        <label className="tb-check"><input type="checkbox" checked={unsentOnly} onChange={(e) => setUnsentOnly(e.target.checked)} /> Not yet sent</label>
      </div>

      {groups.length === 0 ? (
        <p className="tb-empty">Nothing saved yet. Save a report in the Test Bench (Save PDF, Save results file or Ansur file) and it appears here.</p>
      ) : (
        <>
          <div className="tb-selbar">
            <label className="tb-check"><input type="checkbox" checked={allOf(visible)} onChange={(e) => toggle(visible.map((g) => g.base), e.target.checked)} /> Tick all shown ({visible.length})</label>
            <span className="tb-muted">{picked} ticked · {count} file{count === 1 ? '' : 's'}</span>
            <span className="tb-kinds">Include:
              {KINDS.map(([k, n]) => (
                <label key={k} className="tb-check"><input type="checkbox" checked={exts.includes(k)} onChange={(e) => setExts((l) => (e.target.checked ? [...l, k] : l.filter((x) => x !== k)))} /> {n}</label>
              ))}
            </span>
          </div>

          {visible.length === 0 && <p className="tb-empty">Nothing matches those filters.</p>}
          {sections.map((sec) => (
            <section key={sec.key} className="tb-sec">
              {sec.title && (
                <h3 className="tb-sec-title">
                  <label className="tb-check"><input type="checkbox" checked={allOf(sec.groups)} onChange={(e) => toggle(sec.groups.map((g) => g.base), e.target.checked)} aria-label={`Tick all for ${sec.title}`} /> {sec.title}</label>
                  <span className="tb-muted">{sec.groups.length} test{sec.groups.length === 1 ? '' : 's'}</span>
                </h3>
              )}
              {sec.groups.map((g) => (
                <div key={g.base} className={`tb-test${chosen.has(g.base) ? ' is-picked' : ''}`}>
                  <input type="checkbox" checked={chosen.has(g.base)} onChange={(e) => toggle([g.base], e.target.checked)} aria-label={`Tick ${g.base}`} />
                  <div className="tb-test-main">
                    <div className="tb-test-title"><strong>{g.serial}</strong>{g.model ? ` · ${g.model}` : ''}
                      {g.files.some((f) => fresh.has(f.name)) && <Badge tone="purple">New</Badge>}
                      {g.sentTo.length ? <Badge tone="green">Sent to {g.sentTo.join(', ')}</Badge> : <Badge tone="grey">Not sent</Badge>}
                    </div>
                    <div className="tb-muted">{[by !== 'customer' && g.customer !== 'No customer recorded' ? g.customer : '', by !== 'day' ? `${g.day} ${timeOf(g)}` : timeOf(g), g.template].filter(Boolean).join(' · ')}</div>
                    <div className="tb-chips">
                      {g.files.map((f) => (
                        <button key={f.id} type="button" className="tb-chip" title={`Download ${f.name}`} onClick={() => saveBlob(f.name, new Blob([f.buffer], { type: f.mime }))}>{f.kind} · {kb(f.size)}</button>
                      ))}
                      {g.files.some((f) => f.ext === 'json') && !g.files.some((f) => f.ext === 'mtr') && (
                        <button type="button" className="tb-chip" disabled={busy} title="Make the Ansur record (.mtr) from this test's results file and download it" onClick={() => downloadMtr(g)}>Ansur record (.mtr) · make</button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}

          <div className="tb-actionbar">
            <div className="tb-actionbar-row">
              <strong>{count ? `${count} file${count === 1 ? '' : 's'} from ${picked} test${picked === 1 ? '' : 's'}` : 'Tick tests above'}</strong>
              <Button variant="secondary" disabled={busy || !count} onClick={download}>{count > 1 ? 'Download as zip' : 'Download'}</Button>
              <Button variant="ghost" disabled={busy || !files.length} onClick={() => remove(files, `${files.length} file${files.length === 1 ? '' : 's'}`)}>Remove</Button>
            </div>
            <div className="tb-actionbar-row tb-attach">
              <span>Attach to Simpro job:</span>
              <JobPicker call={sim.call} online={online} user={user} companies={sim.companies} companyId={sim.companyId} onCompany={sim.setCompanyId} job={job} onJob={setJob} disabled={!!sim.access} />
              <Button disabled={busy || !job || !count} onClick={attach}>{online_ok ? `Attach ${count || ''} to ${job ? job.label.split(' ')[0] : 'job'}` : `Queue ${count || ''} for ${job ? job.label.split(' ')[0] : 'job'}`}</Button>
            </div>
            {note.text && <p className={`tb-note tb-note-${note.tone}`} role="status">{note.text}</p>}
            {sim.access && <Alert tone="warning" title="Simpro isn’t switched on for you">{sim.access} Ask an admin to turn on Simpro access for you in Settings → People and access. Files you queue wait in the outbox.</Alert>}
            {!user && <Alert tone="warning" title="Sign in to send">Sign in to the hub (while online) to send files to Simpro.</Alert>}
            {sentFiles().length > 0 && <button type="button" className="tb-link" onClick={() => remove(sentFiles(), `the ${sentFiles().length} files already sent`)}>Clear out the files already sent to Simpro</button>}
          </div>
        </>
      )}

      {outbox.length > 0 && (
        <section className="tb-sec">
          <h3 className="tb-sec-title">Waiting to go to Simpro {waiting > 0 && <Badge tone="orange">{waiting} waiting</Badge>} {failed > 0 && <Badge tone="red">{failed} failed</Badge>}</h3>
          {outbox.map((x) => (
            <div key={x.id} className="tb-out">
              <span className="tb-file-name">{x.name}</span>
              <span className="tb-muted">{x.jobLabel}</span>
              <span className={x.status === 'failed' ? 'tb-bad' : 'tb-muted'}>{x.status === 'failed' ? `Not sent: ${x.error}` : x.error ? `Waiting: ${x.error}` : 'Waiting'}</span>
              <Button variant="ghost" size="sm" onClick={() => onRemoveOutbox(x.id)}>Remove</Button>
            </div>
          ))}
          <div className="tb-actions">
            <Button variant="secondary" size="sm" disabled={!waiting || !online_ok} onClick={onSendWaiting}>Send now</Button>
            {failed > 0 && <Button variant="secondary" size="sm" onClick={onRetryFailed}>Try the failed ones again</Button>}
            {!online && <span className="tb-muted">Offline: they go by themselves when this laptop is back online.</span>}
          </div>
        </section>
      )}
    </div>
  )
}
