/* The CHS Test Bench as a section of the one app: the hub (apps/hub/src/App.jsx) opens this at /testbench/, under its
   own header.

   The bench itself is one self-contained page (apps/testbench/bench/index.html, served at /bench-app/): it runs the
   ESA612 and ProSim over USB, keeps tests in progress on this laptop and works with no connection once it has been
   opened here once. It is shown in a frame so it stays exactly as it was built. Each file it saves (the PDF, the results
   file, the Ansur record) is also handed up to this page, which can send them to a Simpro job: straight away, or, with
   no connection, from the outbox (outbox.js) the next time the hub is open online. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { auth } from '../../schedule/src/firebase.js'
import { Alert, Badge, Button } from '../../../shared/ui/index.jsx'
import { PROXY_URL } from '../../../shared/proxy.js'
import { logActivity } from '../../../shared/activity.js'
import { COMPANY_KEY, DEFAULT_COMPANY, SendError, attachFile, findJobs, jobLabel, listCompanies, makeCall } from './simpro-api.js'
import { drain, enqueueReplacing, idbStore, retryFailed } from './outbox.js'
import './testbench.css'

const BENCH_URL = '/bench-app/index.html'

export default function TestBenchSection() {
  return (
    <AuthProvider>
      <TestBench />
    </AuthProvider>
  )
}

const savedCompany = () => { try { return +(localStorage.getItem(COMPANY_KEY) || DEFAULT_COMPANY) } catch { return DEFAULT_COMPANY } }
const useOnline = () => {
  const [on, setOn] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const up = () => setOn(true), down = () => setOn(false)
    window.addEventListener('online', up); window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])
  return on
}

function TestBench() {
  const { user } = useAuth()
  const online = useOnline()
  const frame = useRef(null)
  const host = useRef(null)
  const store = useMemo(() => { try { return idbStore() } catch { return null } }, [])
  const call = useMemo(() => makeCall({
    proxyUrl: PROXY_URL,
    getToken: async () => {
      if (!auth?.currentUser) throw new SendError('Sign in to the hub to send to Simpro.', true)
      return auth.currentUser.getIdToken()
    },
  }), [])

  const [top, setTop] = useState(0)
  const [offered, setOffered] = useState([]) // { name, mime, buffer, at, send } files the bench saved this session
  const [outbox, setOutbox] = useState([])
  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(savedCompany)
  const [access, setAccess] = useState('') // why Simpro can't be used, or ''
  const [q, setQ] = useState('')
  const [hits, setHits] = useState([])
  const [job, setJob] = useState(null) // { id, label }
  const [note, setNote] = useState({ text: '', tone: 'info' })
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const draining = useRef(false)

  // The frame takes the rest of the window under the hub's header.
  useLayoutEffect(() => {
    const fit = () => setTop(Math.round((host.current?.getBoundingClientRect().top || 0) + window.scrollY))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const refresh = useCallback(async () => {
    if (!store) return
    try { setOutbox((await store.all()).sort((a, b) => a.queuedAt - b.queuedAt)) } catch { /* storage blocked: nothing waiting that we can show */ }
  }, [store])

  // What the bench saves arrives here.
  useEffect(() => {
    const onMessage = (e) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return
      const m = e.data
      if (m?.type !== 'chs-bench:file' || typeof m.name !== 'string' || !(m.buffer instanceof ArrayBuffer)) return
      setOffered((list) => [...list.filter((f) => f.name !== m.name), { name: m.name, mime: m.mime || '', buffer: m.buffer, at: Date.now(), send: true }])
      setOpen(true)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const sendOne = useCallback((item) => attachFile(call, { companyId: item.companyId, jobId: item.jobId, name: item.name, bytes: new Uint8Array(item.buffer) }), [call])

  /** Sends what is waiting. Safe to call whenever: one run at a time, and it only stops for a missing connection or sign-in. */
  const sendWaiting = useCallback(async (quiet = false) => {
    if (!store || draining.current) return
    draining.current = true
    const byJob = new Map()
    try {
      const r = await drain(store, async (item) => {
        const res = await sendOne(item)
        byJob.set(item.jobLabel, (byJob.get(item.jobLabel) || 0) + 1)
        return res
      }, refresh)
      for (const [label, n] of byJob) logActivity(null, `Sent ${n} test file${n === 1 ? '' : 's'} to Simpro job ${label.split(' ')[0]}`, { app: 'testbench' })
      const said = []
      if (r.sent) said.push(`${r.sent} sent to Simpro`)
      if (r.duplicate) said.push(`${r.duplicate} already on the job`)
      if (r.failed) said.push(`${r.failed} could not be sent`)
      if (said.length) setNote({ text: said.join(', ') + '.', tone: r.failed ? 'warning' : 'success' })
      else if (r.stopped && !quiet) setNote({ text: `Kept in the outbox: ${r.stopped}`, tone: 'warning' })
    } finally {
      draining.current = false
      refresh()
    }
  }, [store, sendOne, refresh])

  // On opening, when the connection comes back and when someone signs in: send what is waiting.
  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { if (online && user) sendWaiting(true) }, [online, user, sendWaiting])

  // Who may use Simpro: the first call is the proxy's own access check. Skipped offline (the outbox waits).
  useEffect(() => {
    if (!online || !user) return
    let live = true
    listCompanies(call).then((list) => {
      if (!live) return
      setAccess('')
      setCompanies(list)
      if (list.length && !list.some((c) => c.ID === companyId)) setCompanyId(list[0].ID)
    }).catch((e) => { if (live && !e.retry) setAccess(e.message || String(e)) })
    return () => { live = false }
  }, [online, user, call]) // eslint-disable-line react-hooks/exhaustive-deps

  async function find() {
    const text = q.trim()
    if (!text) return setNote({ text: 'Type a job number, customer or description to search for.', tone: 'warning' })
    setBusy(true); setHits([]); setNote({ text: 'Searching…', tone: 'info' })
    try {
      const jobs = await findJobs(call, companyId, text)
      setHits(jobs)
      setNote({ text: jobs.length ? `${jobs.length} job${jobs.length === 1 ? '' : 's'} found.` : `Nothing matched “${text}”. Check the company, or try the job number.`, tone: jobs.length ? 'info' : 'warning' })
    } catch (e) { setNote({ text: e.message || String(e), tone: 'warning' }) } finally { setBusy(false) }
  }

  const pick = (j) => { setJob({ id: String(j.ID), label: jobLabel(j) }); setHits([]); setNote({ text: '', tone: 'info' }) }
  // Offline there is nothing to look up: a typed job number is taken as it is and checked when it is sent.
  const useNumber = () => { setJob({ id: q.trim(), label: `#${q.trim()}` }); setHits([]); setNote({ text: '', tone: 'info' }) }

  const chosen = offered.filter((f) => f.send)
  async function queue() {
    if (!job || !chosen.length || !store) return
    setBusy(true)
    try {
      await enqueueReplacing(store, {
        companyId, jobId: job.id, jobLabel: job.label, by: user?.email || '',
        files: chosen.map((f) => ({ name: f.name, mime: f.mime, buffer: f.buffer })),
      })
      setOffered((list) => list.filter((f) => !f.send))
      await refresh()
      if (online && user) await sendWaiting()
      else setNote({ text: `${chosen.length} file${chosen.length === 1 ? '' : 's'} kept in the outbox. They go to Simpro by themselves when this laptop is online and signed in to the hub.`, tone: 'info' })
    } catch (e) { setNote({ text: 'Not queued: ' + (e.message || e), tone: 'warning' }) } finally { setBusy(false) }
  }

  const waiting = outbox.filter((x) => x.status === 'waiting').length
  const failed = outbox.filter((x) => x.status === 'failed').length
  const canSimpro = !access // the proxy decides who may; this only stops asking once it has said no
  const count = chosen.length ? ` ${chosen.length}` : ''

  return (
    <div className="tb-host" ref={host} style={top ? { height: `calc(100dvh - ${top}px)` } : undefined}>
      <iframe ref={frame} className="tb-frame" src={BENCH_URL} title="CHS Test Bench" allow="serial; clipboard-write; fullscreen" />
      <div className={`tb-send${open ? ' is-open' : ''}`}>
        <button type="button" className="tb-send-bar" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="tb-send-title">Send to Simpro</span>
          {offered.length > 0 && <Badge tone="purple">{offered.length} new file{offered.length === 1 ? '' : 's'}</Badge>}
          {waiting > 0 && <Badge tone="orange">{waiting} waiting</Badge>}
          {failed > 0 && <Badge tone="red">{failed} failed</Badge>}
          {!online && <Badge tone="grey">Offline</Badge>}
          <span className="tb-send-chev" aria-hidden="true">{open ? '▾' : '▴'}</span>
        </button>
        {open && (
          <div className="tb-send-body">
            {access && <Alert tone="warning" title="Simpro isn’t switched on for you">{access} Ask an admin to turn on Simpro access for you in Settings → People and access. Files you queue wait in the outbox.</Alert>}
            {!user && <Alert tone="warning" title="Sign in to send">Sign in to the hub (while online) to send files to Simpro.</Alert>}
            {note.text && <p className={`tb-note tb-note-${note.tone}`} role="status">{note.text}</p>}

            <section className="tb-step">
              <h3>1 · Files from this test</h3>
              {offered.length === 0
                ? <p className="tb-muted">Save a report in the bench (PDF, results file or Ansur record) and it appears here ready to send.</p>
                : offered.map((f) => (
                  <label key={f.name} className="tb-file">
                    <input type="checkbox" checked={f.send} onChange={(e) => setOffered((l) => l.map((x) => (x.name === f.name ? { ...x, send: e.target.checked } : x)))} />
                    <span className="tb-file-name">{f.name}</span>
                    <span className="tb-muted">{Math.max(1, Math.round(f.buffer.byteLength / 1024))} KB</span>
                  </label>
                ))}
            </section>

            <section className="tb-step">
              <h3>2 · Simpro job</h3>
              {job ? (
                <div className="tb-job">
                  <strong>{job.label}</strong>
                  <Button variant="ghost" size="sm" onClick={() => setJob(null)}>Change</Button>
                </div>
              ) : (
                <>
                  <div className="tb-find">
                    {companies.length > 1 && (
                      <select aria-label="Simpro company" value={companyId} onChange={(e) => { setCompanyId(+e.target.value); try { localStorage.setItem(COMPANY_KEY, e.target.value) } catch { /* private mode */ } setHits([]) }}>
                        {companies.map((c) => <option key={c.ID} value={c.ID}>{c.Name}</option>)}
                      </select>
                    )}
                    <input type="search" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (online ? find() : /^\d+$/.test(q.trim()) && useNumber()) }}
                      placeholder={online ? 'Job number, customer or description' : 'Job number'} aria-label="Simpro job" />
                    <Button variant="secondary" disabled={busy || !online || !user || !canSimpro} onClick={find}>Find</Button>
                    {/^\d+$/.test(q.trim()) && <Button variant="ghost" onClick={useNumber}>Use job #{q.trim()}</Button>}
                  </div>
                  {!online && <p className="tb-muted">No connection: type the job number and use it. The job is checked when the files are sent.</p>}
                  {hits.map((j) => (
                    <button key={j.ID} type="button" className="tb-hit" onClick={() => pick(j)}>
                      <strong>#{j.ID}</strong> {j.Customer?.CompanyName || [j.Customer?.GivenName, j.Customer?.FamilyName].filter(Boolean).join(' ')}
                      <span>{[j.Site?.Name, j.Name || j.Description].filter(Boolean).join(' · ')}</span>
                    </button>
                  ))}
                </>
              )}
            </section>

            <div className="tb-actions">
              <Button disabled={busy || !job || !chosen.length || !store} onClick={queue}>
                {online && user ? `Send${count} to Simpro` : `Queue${count} for Simpro`}
              </Button>
              {!store && <span className="tb-muted">This browser won’t keep an outbox (private window?).</span>}
            </div>

            {outbox.length > 0 && (
              <section className="tb-step">
                <h3>Outbox</h3>
                {outbox.map((x) => (
                  <div key={x.id} className="tb-out">
                    <span className="tb-file-name">{x.name}</span>
                    <span className="tb-muted">{x.jobLabel}</span>
                    <span className={x.status === 'failed' ? 'tb-bad' : 'tb-muted'}>{x.status === 'failed' ? `Not sent: ${x.error}` : x.error ? `Waiting: ${x.error}` : 'Waiting'}</span>
                    <Button variant="ghost" size="sm" onClick={async () => { await store.remove(x.id); refresh() }}>Remove</Button>
                  </div>
                ))}
                <div className="tb-actions">
                  <Button variant="secondary" size="sm" disabled={!waiting || !online || !user} onClick={() => sendWaiting()}>Send now</Button>
                  {failed > 0 && <Button variant="secondary" size="sm" onClick={async () => { await retryFailed(store); await refresh(); sendWaiting() }}>Try the failed ones again</Button>}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
