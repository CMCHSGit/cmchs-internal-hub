/* The tracker's shell: sign-in, the left-hand tabs, the bar with search and
   who's online, the job side panel, and the dialogs. Which tab is showing,
   and which job is open, live in the address (#/table?job=…), so a link to a
   job can be shared and the browser's back button works. */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { LayoutDashboard, Table, CalendarRange, Presentation, Monitor, Archive as ArchiveIcon, Settings as SettingsIcon, Search, Plus, ChevronDown, Lock } from 'lucide-react'
import { Alert, Button, Loading } from '../../schedule/src/components/ui'
import Toast, { useToast } from '../../schedule/src/components/Toast'
import { useStore } from './store.jsx'
import { Avatar, Popover } from './ui.jsx'
import Home from './views/Home.jsx'
import TableView from './views/Table.jsx'
import Timeline from './views/Timeline.jsx'
import Conferences from './views/Conferences.jsx'
import Equipment from './views/Equipment.jsx'
import Archive from './views/Archive.jsx'
import { navigate } from '../../hub/src/router.js'
import JobPanel from './JobPanel.jsx'
import SearchPalette from './Search.jsx'
import { QuickAdd, ArchivePrompt, ImportDialog } from './dialogs.jsx'
import { PlanSyncDialog } from './plan-sync.jsx'
import { exportCSV, exportXLSX } from './io.js'

const NAV = [
  ['home', 'Home', LayoutDashboard],
  ['table', 'Table', Table],
  ['timeline', 'Timeline', CalendarRange],
  ['conferences', 'Conferences', Presentation],
  ['equipment', 'Equipment', Monitor],
  ['archive', 'Archive', ArchiveIcon],
  ['settings', 'Settings', SettingsIcon],
]

function parseHash() {
  const [v, q] = location.hash.replace(/^#\/?/, '').split('?')
  return { view: NAV.some((n) => n[0] === v) ? v : 'home', params: Object.fromEntries(new URLSearchParams(q || '')) }
}
function hashFor(view, params) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return `#/${view}${q ? '?' + q : ''}`
}

export const Ui = createContext(null)
export const useUi = () => useContext(Ui)

export default function App() {
  const s = useStore()
  if (s.error && !s.ready) return <Gate><Alert tone="critical" title="Something went wrong">{s.error}</Alert></Gate>
  if (s.user === undefined) return <Gate><Loading /></Gate>
  if (!s.user) return <SignIn />
  if (!s.ready) return <Gate><Loading /></Gate>
  return <Shell />
}

function Gate({ children }) {
  return <main className="pt-gate">{children}</main>
}

function SignIn() {
  const { signIn } = useStore()
  const [err, setErr] = useState(null)
  return (
    <Gate>
      <div className="card pt-gate-card">
        <h2 className="pt-h3">Sign in to see the project tracker</h2>
        <p className="text-sm text-muted">Use your Cass Medical Microsoft account, the same as every other tool here.</p>
        <Button onClick={() => signIn().catch((e) => {
          if (e?.code !== 'auth/popup-closed-by-user' && e?.code !== 'auth/cancelled-popup-request') setErr(e.message || String(e))
        })}>Sign in with Microsoft</Button>
        {err && <Alert tone="critical" title="Sign-in did not complete">{err}</Alert>}
      </div>
    </Gate>
  )
}

function Shell() {
  const s = useStore()
  const [route, setRoute] = useState(parseHash)
  const [toastMsg, toast] = useToast()
  const [searchOpen, setSearchOpen] = useState(false)
  const [adding, setAdding] = useState(null) // null | {} (prefill)
  const [prompt, setPrompt] = useState(null) // job to ask about archiving
  const [importing, setImporting] = useState(false)
  const [planSync, setPlanSync] = useState(false)
  const [ioOpen, setIoOpen] = useState(false)

  useEffect(() => {
    const f = () => setRoute(parseHash())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  const go = useCallback((view, params = {}) => { location.hash = hashFor(view, params) }, [])
  const openJob = useCallback((id, view) => {
    const job = s.jobById.get(id)
    const v = view || (job?.archived ? (route.view === 'archive' || route.view === 'home' ? 'archive' : route.view) : (route.view === 'archive' ? 'table' : route.view))
    location.hash = hashFor(v === 'settings' ? 'table' : v, { ...(v === route.view ? route.params : {}), job: id })
  }, [route, s.jobById])
  const closeJob = useCallback(() => { location.hash = hashFor(route.view, { ...route.params, job: '' }) }, [route])

  const jobId = route.params.job
  const job = jobId ? s.jobById.get(jobId) : null
  useEffect(() => { s.setViewing(job?.id || null) }, [job?.id, s])

  // N for a new job when not typing. (Ctrl+K is the one app's search, which
  // finds jobs too: apps/hub/src/Palette.jsx.)
  useEffect(() => {
    const key = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable
      if (typing || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key.toLowerCase() === 'n' && s.canEdit && !searchOpen && !adding) { e.preventDefault(); setAdding({}) }
      if (e.key === 'Escape' && job && !searchOpen && !adding && !prompt) closeJob()
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [s.canEdit, searchOpen, adding, prompt, job, closeJob])

  const ui = { route, go, openJob, closeJob, toast, askArchive: setPrompt, newJob: (prefill = {}) => setAdding(prefill), openSearch: () => setSearchOpen(true), openImport: () => setImporting(true) }

  // The tracker's settings are a page of the one app's Settings now
  // (settings-page.jsx); an old #/settings link goes on there.
  useEffect(() => { if (route.view === 'settings') navigate('/settings/projects', { replace: true }) }, [route.view])
  const View = { home: Home, table: TableView, timeline: Timeline, conferences: Conferences, equipment: Equipment, archive: Archive, settings: Loading }[route.view]

  return (
    <Ui.Provider value={ui}>
      <Who />
      <div className="pt-shell">
        <nav className="pt-nav" aria-label="Project tracker">
          {NAV.map(([id, label, Icon]) => (
            <a key={id} href={id === 'settings' ? '/settings/projects' : hashFor(id, {})} className={`pt-nav-link${route.view === id ? ' on' : ''}`} aria-current={route.view === id ? 'page' : undefined}>
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {id === 'archive' && s.archived.length > 0 && <span className="pt-nav-count">{s.archived.length}</span>}
            </a>
          ))}
        </nav>
        <div className="pt-main">
          <div className="pt-topbar">
            <button type="button" className="pt-searchbtn" onClick={() => setSearchOpen(true)} aria-label="Search all jobs">
              <Search size={18} aria-hidden="true" />
              <span className="pt-searchbtn-text">Search jobs, hospitals, staff, devices, tracking numbers</span>
            </button>
            <span className="pt-spacer" />
            <Online />
            <span className="pt-io">
              <Button variant="secondary" size="sm" onClick={() => setIoOpen((o) => !o)} aria-expanded={ioOpen}>Import / export <ChevronDown size={16} /></Button>
              <Popover open={ioOpen} onClose={() => setIoOpen(false)} className="pt-menu">
                {s.canEdit && <button type="button" onClick={() => { setIoOpen(false); setImporting(true) }}>Import from Excel or CSV…</button>}
                {s.canEdit && <button type="button" onClick={() => { setIoOpen(false); setPlanSync(true) }}>Update weeks from the planning workbook…</button>}
                <button type="button" onClick={() => { setIoOpen(false); exportXLSX(s).then(() => toast('Excel file downloaded')).catch((e) => toast('Export failed: ' + e.message)) }}>Export to Excel</button>
                <button type="button" onClick={() => { setIoOpen(false); exportCSV(s); toast('CSV downloaded') }}>Export to CSV</button>
                <button type="button" onClick={() => { setIoOpen(false); setTimeout(() => window.print(), 50) }}>Export this page to PDF</button>
              </Popover>
            </span>
            {s.canEdit && <Button size="sm" iconLeft={<Plus size={16} />} onClick={() => setAdding({})} title="New job (N)">New job</Button>}
          </div>
          {!s.canEdit && (
            <div className="pt-readonly"><Lock size={16} aria-hidden="true" /> You can view the tracker. Editing is for staff with a team, set in Settings → People and access.</div>
          )}
          {s.error && <div className="pt-pad"><Alert tone="critical" title="Not everything loaded">{s.error}</Alert></div>}
          <View params={route.params} />
        </div>
      </div>
      {job && <JobPanel key={job.id} job={job} onClose={closeJob} />}
      {jobId && !job && <MissingJob onClose={closeJob} />}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} scope={route.view === 'archive' ? 'archived' : 'all'} />}
      {adding && <QuickAdd prefill={adding} onClose={() => setAdding(null)} />}
      {prompt && <ArchivePrompt job={s.jobById.get(prompt.id) || prompt} onClose={() => setPrompt(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {planSync && <PlanSyncDialog onClose={() => setPlanSync(false)} />}
      <Toast message={toastMsg} />
    </Ui.Provider>
  )
}

/** The signed-in name, top right beside the light/dark switch (index.html's #who). */
function Who() {
  const { me, canEdit } = useStore()
  const slot = document.getElementById('who')
  return slot ? createPortal(`${me.name}${canEdit ? '' : ' · view only'}`, slot) : null
}

function Online() {
  const { online, me } = useStore()
  if (!online.length) return null
  const names = online.map((p) => (p.id === me.uid ? `${p.name} (you)` : p.name)).join(', ')
  return (
    <span className="pt-online" role="group" aria-label={`Online now: ${names}`} title={`Online now: ${names}`}>
      <span className="text-sm text-muted">{online.length} online</span>
      <span className="pt-avstack">
        {online.slice(0, 5).map((p) => (
          <span key={p.id} className="pt-online-av">
            <Avatar person={{ name: p.name, initials: p.initials }} ring />
            <span className="pt-online-dot" />
          </span>
        ))}
      </span>
    </span>
  )
}

function MissingJob({ onClose }) {
  return (
    <aside className="pt-panel" aria-label="Job not found">
      <div className="pt-panel-body">
        <Alert tone="warning" title="That job isn't here">It may have been deleted, or the link is from somewhere else.</Alert>
        <div><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </aside>
  )
}
