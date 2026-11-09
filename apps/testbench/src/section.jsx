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
import { COMPANY_KEY, DEFAULT_COMPANY, SendError, attachFile, customerOf, getJob, listCompanies, listJobFiles, makeCall } from './simpro-api.js'
import { drain, enqueueReplacing, idbStore, retryFailed } from './outbox.js'
import { addOnJob, loadOnJob, saveOnJob, withOnJob, groupReports, idbReports, markDownloaded, markSent, modelOf, reportsFromSearch, saveReport, saveUpload, sharedFileBase } from './reports.js'
import Reports from './Reports.jsx'
import Orders from './Orders.jsx'
import { saveOrder, watchOrders } from './orders-firebase.js'
import { jobClosesOrder, jobNumber, summaryLine } from './orders.js'
import { splitSerials } from './bench-tests.js'
import { loadTest, removeTest, saveTest, watchTests } from './bench-tests-firebase.js'
import { cleanAddress, peekDeviceLink, takeDeviceLink } from './device-link.js'
import { handoffUrl, idbHandoff, putHandoff } from './newequip/handoff.js'
import { watchCustomers } from './newequip/customers-firebase.js'
import { addPendingQueued, listPending } from './newequip/pending-firebase.js'
import { clashes } from './newequip/pending.js'
import { matchCustomer, rowFromBench } from './newequip/from-bench.js'
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
const PENDING_FOR_FILE = 'testbench.pendingCustomer' // { asset list file name: New equipment customer id }, this laptop only
const rememberedCustomers = () => { try { return JSON.parse(localStorage.getItem(PENDING_FOR_FILE) || '{}') || {} } catch { return {} } }
const rememberCustomer = (file, id) => { try { localStorage.setItem(PENDING_FOR_FILE, JSON.stringify({ ...rememberedCustomers(), [file]: id })) } catch { /* asked again next time */ } }
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

  // Opened from Simpro Asset Sync's "Reports to add" (reports.js, reportsLink): straight onto Saved reports, showing that asset list's devices.
  const link = useMemo(() => reportsFromSearch(location.search), [])
  const [tab, setTab] = useState(link.open ? 'reports' : 'bench') // 'bench' | 'reports' | 'orders'
  const [orders, setOrders] = useState([])
  const [ordersError, setOrdersError] = useState('')
  const [testsList, setTestsList] = useState([]) // the shared finished tests (what the orders count)
  const [sheet, setSheet] = useState(null) // the asset list loaded in the bench: { name, state, devices }
  const [startJob, setStartJob] = useState(null) // the Simpro job Saved reports opens with (from an order)
  const [onlySerials, setOnlySerials] = useState(link.serials)
  const [top, setTop] = useState(0)
  const [reports, setReports] = useState([])
  const [fresh, setFresh] = useState(() => new Set()) // names saved since the hub was opened
  const [justSaved, setJustSaved] = useState([]) // names for the notice under the bench
  const [outbox, setOutbox] = useState([])
  const [companies, setCompanies] = useState([])
  const [companyId, setCompanyId] = useState(savedCompany)
  const [access, setAccess] = useState('') // why Simpro can't be used, or ''
  const draining = useRef(false)
  const [colours, setColours] = useState(null) // { map: model -> { color, template }, hex } from the bench: each model in its template's colour
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
  const askColours = useRef(() => {})
  const toBench = useCallback((msg) => frame.current?.contentWindow?.postMessage(msg, location.origin), [])
  // A "Test this device" link (device-link.js): handed to the bench once it says hello, then taken out of the address bar.
  const sendDevice = useCallback(() => { const d = takeDeviceLink(); if (d) { toBench({ type: 'chs-bench:open-device', device: d }); try { history.replaceState(null, '', cleanAddress()) } catch { /* the address stays as it is */ } } }, [toBench])
  useEffect(() => { if (!peekDeviceLink()) return undefined; const t = setTimeout(sendDevice, 4000); return () => clearTimeout(t) }, [sendDevice])   // in case the hello was missed
  // The open orders go to the bench, which offers them when a test is started and says how far each one is.
  const ordersRef = useRef({ orders: [], tests: [] })
  const sendOrders = useCallback(() => {
    const { orders: os, tests } = ordersRef.current
    toBench({ type: 'chs-bench:orders', list: os.filter((o) => o.status !== 'closed').map((o) => ({ number: o.number, customer: o.customer, label: `#${o.number} · ${o.customer}`, summary: summaryLine(o, tests) })) })
  }, [toBench])
  const sendShared = useCallback(() => toBench({ type: 'chs-bench:shared-list', me: who.current.email, admin: who.current.admin, ok: shared.current.ok, list: shared.current.list }), [toBench])
  useEffect(() => {
    if (!user) { shared.current = { list: [], ok: false }; sendShared(); return undefined }
    return watchTests(
      (list) => { shared.current = { list, ok: true }; setTestsList(list); sendShared() },
      () => { shared.current = { list: [], ok: false }; setTestsList([]); sendShared() },
    )
  }, [user, sendShared])
  useEffect(() => { sendShared() }, [profile, sendShared])
  // Orders: watched while signed in. Until their rules are published Firestore refuses; the tab says so rather than failing quietly.
  useEffect(() => {
    if (!user) { setOrders([]); setOrdersError(''); return undefined }
    return watchOrders(
      (list) => { setOrders(list); setOrdersError('') },
      (e) => { setOrders([]); setOrdersError(e?.code === 'permission-denied' ? 'The database rules for orders haven’t been published yet (rules/README.md), or you aren’t on a team that can use the Test Bench.' : (e?.message || 'Orders couldn’t be loaded.')) },
    )
  }, [user])
  useEffect(() => { ordersRef.current = { orders, tests: testsList }; sendOrders() }, [orders, testsList, sendOrders])
  // The New equipment customers, for a device the bench didn't find in the asset list ("Add to the asset list…": a pending row).
  const customersRef = useRef({ list: [], error: '' })
  useEffect(() => {
    if (!user) { customersRef.current = { list: [], error: '' }; return undefined }
    return watchCustomers(({ customers }) => { customersRef.current = { list: customers, error: '' } }, (e) => { customersRef.current = { list: [], error: e?.message || 'The customers couldn’t be loaded.' } })
  }, [user])

  // What the bench saves arrives here and is kept.
  useEffect(() => {
    const onMessage = async (e) => {
      if (e.origin !== location.origin || e.source !== frame.current?.contentWindow) return
      const m = e.data
      if (m?.type === 'chs-bench:hello') { sendShared(); sendDevice(); sendOrders(); askColours.current(); return }
      if (m?.type === 'chs-bench:model-colours-reply' && m.map && m.hex) { setColours({ map: m.map, hex: m.hex }); return }
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
      if (m?.type === 'chs-bench:pending-customers' || m?.type === 'chs-bench:add-pending') {   // a device not in the asset list, added as a pending row
        const reply = (x) => toBench({ type: 'chs-bench:pending-reply', reqId: m.reqId, ...x })
        if (!user) return reply({ error: 'Sign in to the hub to add devices to the asset list.' })
        const { list, error } = customersRef.current
        if (m.type === 'chs-bench:pending-customers') {
          if (!list.length) return reply({ error: error || 'There are no New equipment customers yet. Add the customer on the New equipment page first.' })
          return reply(matchCustomer(list, { customer: m.customer, file: m.file }, rememberedCustomers()))
        }
        const c = list.find((x) => String(x.id) === String(m.customerId))
        if (!c) return reply({ error: 'Choose the customer this device belongs to.' })
        const { row, errors } = rowFromBench(m.row)
        if (errors.length) return reply({ error: errors.join(' ') })
        try {
          let waiting = []
          try { waiting = await listPending(c.id) } catch { /* offline: checked again on the New equipment page */ }
          const clash = clashes(row, [], waiting)
          if (clash.length) return reply({ error: clash.join(' '), customer: c.name, already: true })
          const { queued } = await addPendingQueued(c.id, row)
          if (m.file) rememberCustomer(m.file, c.id)
          logActivity(null, 'Added a device to a customer’s pending asset rows (from the Test Bench)', { app: 'testbench' })
          return reply({ ok: true, customer: c.name, queued })
        } catch (err) {
          return reply({ error: err?.code === 'permission-denied' ? 'The database refused it: the rules for pending rows (pendingAssets) haven’t been published yet (rules/README.md), or you aren’t on a team that can use the Test Bench.' : (err?.message || 'Couldn’t add it.') })
        }
      }
      if (m?.type === 'chs-bench:sheet-state') { setSheet({ name: m.name, state: m.state, devices: m.devices }); return }
      if (m?.type === 'chs-bench:sheet-file') {   // the bench's answer to a request for the loaded asset list
        const p = asks.current.get(m.id); asks.current.delete(m.id)
        if (p) m.error || !(m.buffer instanceof ArrayBuffer) ? p.reject(new Error(m.error || 'The bench sent nothing back.')) : p.resolve({ name: m.name, mime: m.mime, buffer: m.buffer, devices: m.devices })
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
  }, [reportStore, refreshReports, user, sendShared, sendDevice, sendOrders, toBench])

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

  /** Files someone adds in Saved reports: kept like the bench's own (an Ansur record is read for its serial, model, customer and date). */
  const addFiles = useCallback(async (items) => {
    const saved = [], failed = []
    for (const it of items) {
      try { const r = await saveUpload(reportStore, it); saved.push(r.name) } catch (e) { failed.push({ name: it.name, why: e?.message || 'could not be read' }) }
    }
    if (saved.length) { setFresh((s) => { const n = new Set(s); saved.forEach((x) => n.add(x)); return n }); logActivity(null, `Added ${saved.length} file${saved.length === 1 ? '' : 's'} to the Test Bench's saved reports`, { app: 'testbench' }) }
    await refreshReports()
    return { saved, failed }
  }, [reportStore, refreshReports])

  /** Marks files as downloaded, so Saved reports can say which tests have been. */
  const downloaded = useCallback(async (names) => {
    try { await markDownloaded(reportStore, names) } catch { /* the list just doesn't show it */ }
    await refreshReports()
  }, [reportStore, refreshReports])

  /** Another engineer's finished test: its whole record is fetched and kept here as a results file, so its report and Ansur record can be made (makePdf, makeMtr) like any other. */
  const fetchShared = useCallback(async (g) => {
    if (!reportStore) throw new Error('Saved reports can’t be kept on this laptop.')
    const json = await loadTest(g.sharedId)
    if (!json) throw new Error('That test is no longer shared.')
    const run = JSON.parse(json)
    let base = sharedFileBase(g)
    const clash = await reportStore.get(base + '.json')   // the same device twice in a day (a rerun): the second keeps its time in the name
    if (clash && clash.meta && clash.meta.testedAt && clash.meta.testedAt !== (run.started || g.started)) base += ` (${new Intl.DateTimeFormat('en-NZ', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Pacific/Auckland' }).format(new Date(g.started)).replace(':', '.')})`
    const buffer = new TextEncoder().encode(JSON.stringify({ format: 'chs-test-bench-results', version: 1, run })).buffer
    const rec = await saveReport(reportStore, { name: base + '.json', mime: 'application/json', buffer, meta: { customer: g.customer === 'No customer recorded' ? '' : g.customer, serial: g.serial, model: g.model, template: g.template, testedAt: run.started || g.started || '' } })
    logActivity(null, 'Fetched a test another engineer finished, to download or attach it', { app: 'testbench' })
    return { ...rec, ext: 'json', kind: 'Results file' }
  }, [reportStore])

  /** The asset list loaded in the bench, read again first (the bench does that), left for Simpro Asset Sync, which is then opened: it shows the preview and waits for Apply. */
  const syncSheet = useCallback(async () => {
    const win = frame.current?.contentWindow
    if (!win) throw new Error('The Test Bench isn’t loaded yet. Open the Test Bench tab once, then try again.')
    const f = await new Promise((resolve, reject) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const timer = setTimeout(() => { asks.current.delete(id); reject(new Error('The Test Bench didn’t answer. Reload the page and try again.')) }, 30000)
      asks.current.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v) }, reject: (e) => { clearTimeout(timer); reject(e) } })
      win.postMessage({ type: 'chs-bench:get-sheet', id }, location.origin)
    })
    await putHandoff(idbHandoff(), { name: f.name, mime: f.mime, buffer: f.buffer })
    logActivity(null, `Handed the asset list (${f.devices} devices) to Simpro Asset Sync from Saved reports`, { app: 'testbench' })
    location.assign(handoffUrl())
  }, [])

  const sim = { call, companies, companyId, setCompanyId, access }

  // An order closes by itself once its Simpro job is marked Complete (or Archived): each open order's job is looked at once each time
  // the hub opens with Simpro access, and again straight after its stage is changed from Saved reports (onJobUpdated).
  const checkedJobs = useRef(new Set())
  // The files a job has in Simpro, however they got there (another laptop, Simpro itself): those tests count as sent to it here.
  const [onJob, setOnJob] = useState(loadOnJob)
  const noteJobFiles = useCallback(async (jobId) => {
    const names = await listJobFiles(call, companyId, jobId)
    setOnJob((k) => { const n = addOnJob(k, `#${jobId}`, names); saveOnJob(n); return n })
    return names.length
  }, [call, companyId])
  const closeDoneOrders = useCallback(async (list, again = false) => {
    for (const o of list.slice(0, 40)) {
      if (!again && checkedJobs.current.has(o.id)) continue
      checkedJobs.current.add(o.id)
      const id = jobNumber(o.number); if (!/^\d+$/.test(id)) continue
      let job = null
      try { job = await getJob(call, companyId, id) } catch { continue }
      if (job && String(job.ID) === id) await noteJobFiles(id).catch(() => {})   // its reports already on the job show as sent
      if (!jobClosesOrder(o, job, job ? customerOf(job) : '')) continue
      try {
        await saveOrder({ ...o, status: 'closed', closedAt: Date.now(), closedBy: who.current.email }, who.current)
        logActivity(null, `Closed a Test Bench order (its Simpro job is ${String(job.Stage).toLowerCase()})`, { app: 'testbench' })
      } catch { /* not allowed or offline: it stays open, and is looked at again next time */ }
    }
  }, [call, companyId, noteJobFiles])
  useEffect(() => {
    if (!online || !user || access || !companies.length) return
    closeDoneOrders(orders.filter((o) => o.status !== 'closed' || Date.now() - (+o.closedAt || 0) < 30 * 864e5))   // closed in the last 30 days: only its files are looked at
  }, [orders, online, user, access, companies, closeDoneOrders])
  const tests = useMemo(() => withOnJob(groupReports(reports), onJob), [reports, onJob])
  const unsent = tests.filter((g) => g.unsent).length
  // The bench (loaded behind this tab) knows each template's colour: ask it for the models in the list when Saved reports opens or the models change.
  const modelKey = useMemo(() => [...new Set(tests.map(modelOf))].sort().join('\n'), [tests])
  askColours.current = () => { if (modelKey) toBench({ type: 'chs-bench:model-colours', id: String(Date.now()), models: modelKey.split('\n') }) }
  useEffect(() => { if (tab === 'reports') { askColours.current(); const t = setTimeout(() => askColours.current(), 2500); return () => clearTimeout(t) } return undefined }, [tab, modelKey])   // again a moment later, in case the bench was still loading
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
        <button type="button" role="tab" aria-selected={tab === 'orders'} className={tab === 'orders' ? 'is-on' : ''} onClick={() => setTab('orders')}>
          Orders
          {orders.some((o) => o.status !== 'closed') && <Badge tone="purple">{orders.filter((o) => o.status !== 'closed').length} open</Badge>}
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
      {tab === 'orders' && (
        <Orders
          orders={orders} ordersError={ordersError} tests={testsList} who={who.current} user={user} online={online} sim={sim}
          onReview={(order, p) => { setOnlySerials(p.devices.flatMap((d) => splitSerials(d.serial))); setStartJob(order.number ? { id: order.number, label: order.jobLabel || `#${order.number}` } : null); setTab('reports') }}
        />
      )}
      {tab === 'reports' && (
        <Reports
          reports={reports} fresh={fresh} sim={sim} outbox={outbox} online={online} user={user}
          onJob={onJob} onJobFiles={noteJobFiles}
          onJobUpdated={(jobId) => closeDoneOrders(orders.filter((o) => jobNumber(o.number) === String(jobId)), true)}
          onlySerials={onlySerials} onShowAll={() => { setOnlySerials([]); setStartJob(null) }} startUnsent={link.unsent} startJob={startJob}
          sharedTests={testsList} onFetchShared={fetchShared} sheet={sheet} onSyncSheet={syncSheet} onAttach={attach} onAddFiles={addFiles} onMarkDownloaded={downloaded} modelColours={colours} makeMtr={makeMtr} makePdf={makePdf}
          onDelete={async (ids) => { for (const id of ids) await reportStore.remove(id); await refreshReports() }}
          onRemoveOutbox={async (id) => { await outboxStore.remove(id); refreshOutbox() }}
          onSendWaiting={() => sendWaiting()}
          onRetryFailed={async () => { await retryFailed(outboxStore); await refreshOutbox(); sendWaiting() }}
        />
      )}
    </div>
  )
}
