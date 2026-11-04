/* The CHS Test Bench as a section of the one app: the hub (apps/hub/src/App.jsx) opens this at /testbench/, under its
   own header.

   The bench itself is one self-contained page (apps/testbench/bench/index.html, served at /bench-app/): it runs the
   ESA612 and ProSim over USB, keeps tests in progress on this laptop and works with no connection once it has been
   opened here once. It is shown in a frame so it stays exactly as it was built, and stays loaded (just hidden) while
   the Saved reports tab is open, so a test in progress and the USB connection aren't lost.

   Each file the bench saves (the PDF, the results file, the Ansur record) is handed up to this page, which keeps it in
   Saved reports (reports.js) on this laptop. From there a day's tests can be downloaded together (zip.js) or attached
   together to a Simpro job: files go into an outbox (outbox.js) and leave it only once Simpro has them, so with no
   connection they wait and go by themselves the next time the hub is open online. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { auth } from '../../schedule/src/firebase.js'
import { Badge, Button } from '../../../shared/ui/index.jsx'
import { PROXY_URL } from '../../../shared/proxy.js'
import { logActivity } from '../../../shared/activity.js'
import { COMPANY_KEY, DEFAULT_COMPANY, SendError, attachFile, listCompanies, makeCall } from './simpro-api.js'
import { drain, enqueueReplacing, idbStore, retryFailed } from './outbox.js'
import { groupReports, idbReports, markSent, saveReport } from './reports.js'
import Reports from './Reports.jsx'
import { loadTest, removeTest, saveTest, watchTests } from './bench-tests-firebase.js'
import { cleanAddress, peekDeviceLink, takeDeviceLink } from './device-link.js'
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
const safe = (fn) => { try { return fn() } catch { return null } }
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
  const { user, profile } = useAuth()
  const online = useOnline()
  const frame = useRef(null)
  const host = useRef(null)
  const outboxStore = useMemo(() => safe(() => idbStore()), [])
  const reportStore = useMemo(() => safe(() => idbReports()), [])
  const call = useMemo(() => makeCall({
    proxyUrl: PROXY_URL,
    getToken: async () => {
      if (!auth?.currentUser) throw new SendError('Sign in to the hub to send to Simpro.', true)
      return auth.currentUser.getIdToken()
    },
  }), [])

  const [tab, setTab] = useState('bench') // 'bench' | 'reports'
  const [top, setTop] = useState(0)
  const [reports, setReports] = useState([])
  const [fresh, setFresh] = useState(() => new Set()) // names saved since the hub was opened
  const [justSaved, setJustSaved] = useState([]) // names for the notice under the bench
  const [outbox, setOutbox] = useState([])
  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(savedCompany)
  const [access, setAccess] = useState('') // why Simpro can't be used, or ''
  const draining = useRef(false)
  const asks = useRef(new Map()) // requests to the bench waiting for an answer

  // The frame takes the rest of the window under the hub's header.
  useLayoutEffect(() => {
    const fit = () => setTop(Math.round((host.current?.getBoundingClientRect().top || 0) + window.scrollY))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const refreshReports = useCallback(async () => {
    if (!reportStore) return
    try { setReports(await reportStore.all()) } catch { /* storage blocked: nothing to show */ }
  }, [reportStore])
  const refreshOutbox = useCallback(async () => {
    if (!outboxStore) return
    try { setOutbox((await outboxStore.all()).sort((a, b) => a.queuedAt - b.queuedAt)) } catch { /* as above */ }
  }, [outboxStore])
  useEffect(() => { refreshReports(); refreshOutbox() }, [refreshReports, refreshOutbox])

  // The finished tests every engineer has shared (Firestore, bench-tests.js): watched while signed in and handed to the bench, which
  // lists them under Previous tests. A test the bench finishes is sent up from here too, and opened or removed on its request.
  const who = useRef({ email: '', name: '', admin: false })
  who.current = { email: (user?.email || '').toLowerCase(), name: profile?.displayName || user?.displayName || user?.email || '', admin: profile?.role === 'admin' }
  const shared = useRef({ list: [], ok: false })
  const toBench = useCallback((msg) => frame.current?.contentWindow?.postMessage(msg, location.origin), [])
  // A "Test this device" link (device-link.js): handed to the bench once it says hello, then taken out of the address bar.
  const sendDevice = useCallback(() => { const d = takeDeviceLink(); if (d) { toBench({ type: 'chs-bench:open-device', device: d }); try { history.replaceState(null, '', cleanAddress()) } catch { /* the address stays as it is */ } } }, [toBench])
  useEffect(() => { if (!peekDeviceLink()) return undefined; const t = setTimeout(sendDevice, 4000); return () => clearTimeout(t) }, [sendDevice])   // in case the hello was missed
  const sendShared = useCallback(() => toBench({ type: 'chs-bench:shared-list', me: who.current.email, admin: who.current.admin, ok: shared.current.ok, list: shared.current.list }), [toBench])
  useEffect(() => {
    if (!user) { shared.current = { list: [], ok: false }; sendShared(); return undefined }
    return watchTests(
      (list) => { shared.current = { list, ok: true }; sendShared() },
      () => { shared.current = { list: [], ok: false }; sendShared() },
    )
  }, [user, sendShared])
  useEffect(() => { sendShared() }, [profile, sendShared])

  // What the bench saves arrives here and is kept.
  useEffect(() => {
    const onMessage = async (e) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return
      const m = e.data
      if (m?.type === 'chs-bench:hello') { sendShared(); sendDevice(); return }
      if (m?.type === 'chs-bench:run' && typeof m.json === 'string') {   // a test finished or changed on this laptop: share it
        if (!user || (m.sharedBy && m.sharedBy !== who.current.email)) return
        try {
          const s = await saveTest(JSON.parse(m.json), who.current)
          if (s) logActivity(null, `Shared a finished test (${s.template || 'test'}, ${s.overall})`, { app: 'testbench' })
        } catch { /* signed out, not an engineer, or not the one who shared it: it stays on this laptop */ }
        return
      }
      if (m?.type === 'chs-bench:get-run') {   // someone opened a test from the shared list
        let reply
        try { const json = await loadTest(m.id); reply = json ? { json } : { error: 'That test is no longer shared.' } } catch (err) { reply = { error: err?.code === 'unavailable' ? 'No connection to fetch it. Try again when this laptop is online.' : (err?.message || 'Couldn’t fetch it.') } }
        toBench({ type: 'chs-bench:run-data', reqId: m.reqId, id: m.id, ...reply })
        return
      }
      if (m?.type === 'chs-bench:delete-run') {   // "Remove for everyone"
        let reply
        try { await removeTest(m.id); logActivity(null, 'Removed a shared test', { app: 'testbench' }); reply = { ok: true } } catch (err) { reply = { error: err?.code === 'permission-denied' ? 'Only the engineer who shared it, or an admin, can remove it.' : (err?.message || 'Couldn’t remove it.') } }
        toBench({ type: 'chs-bench:deleted', reqId: m.reqId, id: m.id, ...reply })
        return
      }
      if (m?.type === 'chs-bench:mtr' || m?.type === 'chs-bench:pdf') {   // the bench's answer to a request for an Ansur record or a PDF
        const p = asks.current.get(m.id); asks.current.delete(m.id)
        if (p) m.error || !(m.buffer instanceof ArrayBuffer) ? p.reject(new Error(m.error || 'The bench sent nothing back.')) : p.resolve({ buffer: m.buffer, mime: m.mime })
        return
      }
      if (m?.type !== 'chs-bench:file' || typeof m.name !== 'string' || !(m.buffer instanceof ArrayBuffer)) return
      if (!reportStore) return
      try {
        await saveReport(reportStore, { name: m.name, mime: m.mime, buffer: m.buffer, meta: m.meta })
        setFresh((s) => new Set(s).add(m.name))
        setJustSaved((l) => [...l.filter((n) => n !== m.name), m.name])
        refreshReports()
      } catch { /* the file is still saved where the bench put it */ }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [reportStore, refreshReports, user, sendShared, sendDevice, toBench])

  /** Asks the bench (still loaded behind this tab) to build a file from a saved one: an Ansur record (.mtr) from a results file, or a PDF from a results file or an Ansur record. */
  const askBench = useCallback((type, buffer, name) => new Promise((resolve, reject) => {
    const win = frame.current?.contentWindow
    if (!win) { reject(new Error('The Test Bench isn’t loaded yet. Open the Test Bench tab once, then try again.')); return }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const timer = setTimeout(() => { asks.current.delete(id); reject(new Error('The Test Bench didn’t answer. Reload the page and try again.')) }, 20000)
    asks.current.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
    win.postMessage({ type, id, name, buffer: buffer.slice(0) }, location.origin)
  }), [])
  const toMtr = useCallback((buffer) => askBench('chs-bench:build-mtr', buffer), [askBench])
  const toPdf = useCallback((buffer, name) => askBench('chs-bench:build-pdf', buffer, name), [askBench])

  /** An Ansur record for a saved test that has a results file but no .mtr: made by the bench, then kept with the others. */
  const makeMtr = useCallback(async (g) => {
    const src = g.files.find((f) => f.ext === 'json')
    if (!src || !reportStore) throw new Error('This test has no results file to make an Ansur record from.')
    const { buffer, mime } = await toMtr(src.buffer)
    const rec = await saveReport(reportStore, { name: src.name.replace(/\.json$/i, '.mtr'), mime, buffer, meta: src.meta })
    refreshReports()
    return { ...rec, ext: 'mtr', kind: 'Ansur record' }
  }, [reportStore, toMtr, refreshReports])

  /** A PDF for a saved test that has only a results file or an Ansur record: made by the bench, then kept with the others. */
  const makePdf = useCallback(async (g) => {
    const src = g.files.find((f) => f.ext === 'json') || g.files.find((f) => f.ext === 'mtr')
    if (!src || !reportStore) throw new Error('This test has no file to make a PDF from.')
    const { buffer, mime } = await toPdf(src.buffer, src.name)
    const rec = await saveReport(reportStore, { name: g.base + '.pdf', mime, buffer, meta: src.meta })
    refreshReports()
    return { ...rec, ext: 'pdf', kind: 'Report' }
  }, [reportStore, toPdf, refreshReports])

  /** Sends what is waiting. Safe to call whenever: one run at a time, and it only stops for a missing connection or sign-in. */
  const sendWaiting = useCallback(async (quiet = false) => {
    if (!outboxStore || draining.current) return null
    draining.current = true
    const byJob = new Map()
    try {
      const r = await drain(outboxStore, async (item) => {
        const res = await attachFile(call, { companyId: item.companyId, jobId: item.jobId, name: item.name, bytes: new Uint8Array(item.buffer) })
        byJob.set(item.jobLabel, (byJob.get(item.jobLabel) || 0) + 1)
        if (reportStore) await markSent(reportStore, item.name, item.jobLabel.split(' ')[0]).catch(() => {})
        return res
      }, refreshOutbox)
      for (const [label, n] of byJob) logActivity(null, `Sent ${n} test file${n === 1 ? '' : 's'} to Simpro job ${label.split(' ')[0]}`, { app: 'testbench' })
      const said = []
      if (r.sent) said.push(`${r.sent} sent to Simpro`)
      if (r.duplicate) said.push(`${r.duplicate} already on the job`)
      if (r.failed) said.push(`${r.failed} could not be sent`)
      if (r.stopped && !quiet) said.push(`${r.stopped}; the rest wait in the outbox`)
      return said.length ? { text: said.join(', ') + '.', tone: r.failed || r.stopped ? 'warning' : 'success' } : null
    } finally {
      draining.current = false
      refreshOutbox(); refreshReports()
    }
  }, [outboxStore, reportStore, call, refreshOutbox, refreshReports])

  // On opening, when the connection comes back and when someone signs in: send what is waiting.
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

  /** Puts the files in the outbox for the job and, if it can, sends them now. Returns the note to show. */
  const attach = useCallback(async (files, job) => {
    await enqueueReplacing(outboxStore, {
      companyId, jobId: job.id, jobLabel: job.label, by: user?.email || '',
      files: files.map((f) => ({ name: f.name, mime: f.mime, buffer: f.buffer })),
    })
    await refreshOutbox()
    if (online && user) {
      const done = await sendWaiting()
      if (done) return done
    }
    return { text: `${files.length} file${files.length === 1 ? '' : 's'} kept in the outbox. They go to Simpro by themselves when this laptop is online and signed in to the hub.`, tone: 'info' }
  }, [outboxStore, companyId, user, online, refreshOutbox, sendWaiting])

  const sim = { call, companies, companyId, setCompanyId, access }
  const tests = useMemo(() => groupReports(reports), [reports])
  const unsent = tests.filter((g) => g.unsent).length
  const waiting = outbox.filter((x) => x.status === 'waiting').length
  const failed = outbox.filter((x) => x.status === 'failed').length

  return (
    <div className="tb-host" ref={host} style={top ? { height: `calc(100dvh - ${top}px)` } : undefined}>
      <div className="tb-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'bench'} className={tab === 'bench' ? 'is-on' : ''} onClick={() => { if (tab === 'bench') toBench({ type: 'chs-bench:home' }); setTab('bench') }}>Test Bench</button>
        <button type="button" role="tab" aria-selected={tab === 'reports'} className={tab === 'reports' ? 'is-on' : ''} onClick={() => { setTab('reports'); setJustSaved([]); refreshReports(); refreshOutbox() }}>
          Saved reports
          {tests.length > 0 && <Badge tone="purple">{unsent ? `${unsent} not sent` : `${tests.length}`}</Badge>}
          {waiting > 0 && <Badge tone="orange">{waiting} waiting</Badge>}
          {failed > 0 && <Badge tone="red">{failed} failed</Badge>}
          {!online && <Badge tone="grey">Offline</Badge>}
        </button>
      </div>

      {/* Kept loaded while Saved reports is showing: a test in progress and the USB connection stay as they are. */}
      <iframe ref={frame} className="tb-frame" src={BENCH_URL} title="CHS Test Bench" allow="serial; clipboard-write; fullscreen" hidden={tab !== 'bench'} />
      {tab === 'bench' && justSaved.length > 0 && (
        <div className="tb-saved" role="status">
          <span>Saved to Saved reports: <strong>{justSaved[justSaved.length - 1]}</strong>{justSaved.length > 1 ? ` and ${justSaved.length - 1} more` : ''}.</span>
          <Button variant="secondary" size="sm" onClick={() => { setTab('reports'); setJustSaved([]) }}>Open Saved reports</Button>
          <Button variant="ghost" size="sm" onClick={() => setJustSaved([])}>Dismiss</Button>
        </div>
      )}
      {tab === 'reports' && (
        <Reports
          reports={reports} fresh={fresh} sim={sim} outbox={outbox} online={online} user={user}
          onAttach={attach} makeMtr={makeMtr} makePdf={makePdf}
          onDelete={async (ids) => { for (const id of ids) await reportStore.remove(id); await refreshReports() }}
          onRemoveOutbox={async (id) => { await outboxStore.remove(id); refreshOutbox() }}
          onSendWaiting={() => sendWaiting()}
          onRetryFailed={async () => { await retryFailed(outboxStore); await refreshOutbox(); sendWaiting() }}
        />
      )}
    </div>
  )
}
