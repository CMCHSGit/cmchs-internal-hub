/* Asks' shell: sign-in, the tabs (My asks, All, Company), the New ask
   button, the open ask's panel and the dialogs. The tab and the open ask
   live in the address (#/mine?ask=…), so a notification or a pasted link
   opens straight onto the ask, and the back button closes it. */

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Inbox, List, Building2, Plus } from 'lucide-react'
import { Alert, Button, Loading } from '../../schedule/src/components/ui'
import Toast, { useToast } from '../../schedule/src/components/Toast'
import { useStore } from './store.jsx'
import Mine from './views/Mine.jsx'
import All from './views/All.jsx'
import Company from './views/Company.jsx'
import AskPanel from './AskPanel.jsx'
import NewAsk from './NewAsk.jsx'

const TABS = [
  ['mine', 'My asks', Inbox],
  ['all', 'All', List],
  ['company', 'Company', Building2],
]

function parseHash() {
  const [v, q] = location.hash.replace(/^#\/?/, '').split('?')
  return { view: TABS.some((t) => t[0] === v) ? v : 'mine', params: Object.fromEntries(new URLSearchParams(q || '')) }
}
function hashFor(view, params = {}) {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString()
  return `#/${view}${q ? '?' + q : ''}`
}

const Ui = createContext(null)
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
  return <main className="ak-gate">{children}</main>
}

function SignIn() {
  const { signIn } = useStore()
  const [err, setErr] = useState(null)
  return (
    <Gate>
      <div className="card ak-gate-card">
        <h2 className="ak-h3">Sign in to see your asks</h2>
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
  const [editing, setEditing] = useState(null) // null | { ask } | { prefill }

  useEffect(() => {
    const f = () => setRoute(parseHash())
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])

  /** Filters replace the address rather than adding to history, so Back still leaves the page. */
  const go = useCallback((view, params = {}, { replace = true } = {}) => {
    const h = hashFor(view, params)
    if (replace) { history.replaceState(null, '', h); setRoute(parseHash()) } else location.hash = h
  }, [])
  const hrefFor = useCallback((params, view) => hashFor(view || route.view, view && view !== route.view ? params : { ...route.params, ...params }), [route])
  const closeAsk = useCallback(() => {
    // Opened from inside the app: go back, so Back and the X agree. From a notification or link: just close.
    if (history.state?.askOpenedHere) history.back()
    else go(route.view, { ...route.params, ask: '' })
  }, [go, route])

  // Mark in-app opens so closing can step back instead of piling up history.
  useEffect(() => {
    const click = (e) => {
      const a = e.target.closest?.('a[href^="#/"]')
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey) return
      const next = a.getAttribute('href')
      if (!/[?&]ask=/.test(next)) return
      e.preventDefault()
      history.pushState({ askOpenedHere: true }, '', next)
      setRoute(parseHash())
    }
    document.addEventListener('click', click)
    const pop = () => setRoute(parseHash())
    window.addEventListener('popstate', pop)
    return () => { document.removeEventListener('click', click); window.removeEventListener('popstate', pop) }
  }, [])

  const askId = route.params.ask
  const ask = askId ? s.askById.get(askId) : null

  const ui = {
    route, go, hrefFor, toast, closeAsk,
    newAsk: (prefill = {}) => setEditing({ prefill }),
    editAsk: (a) => setEditing({ ask: a }),
  }
  const View = { mine: Mine, all: All, company: Company }[route.view]

  return (
    <Ui.Provider value={ui}>
      <Who />
      <div className={`ak-shell${ask ? ' with-panel' : ''}`}>
        <div className="ak-bar">
          <nav className="ak-tabs" aria-label="Asks">
            {TABS.map(([id, label, Icon]) => (
              <a key={id} href={hashFor(id)} className={`ak-tab${route.view === id ? ' on' : ''}`} aria-current={route.view === id ? 'page' : undefined}>
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {id === 'mine' && s.counts.total > 0 && <span className={`ak-count${s.counts.overdue ? ' late' : ''}`} aria-label={`${s.counts.total} to do`}>{s.counts.total}</span>}
              </a>
            ))}
          </nav>
          <span className="ak-spacer" />
          <Button iconLeft={<Plus size={18} />} onClick={() => setEditing({ prefill: {} })}>New ask</Button>
        </div>
        {s.error && <div className="ak-pad"><Alert tone="critical" title="Not everything loaded">{s.error}</Alert></div>}
        <main className="ak-main">
          <View />
        </main>
      </div>
      {ask && <><div className="ak-panel-scrim" onClick={closeAsk} aria-hidden="true" /><AskPanel key={ask.id} ask={ask} onClose={closeAsk} /></>}
      {askId && !ask && <MissingAsk onClose={closeAsk} />}
      {editing && (
        <NewAsk ask={editing.ask} prefill={editing.prefill} onClose={() => setEditing(null)}
          onSaved={(id) => { if (!editing.ask) { toast('Sent. They’ve been notified.'); go(route.view, { ...route.params, ask: id }, { replace: false }) } else toast('Saved') }} />
      )}
      <button type="button" className="ak-fab" onClick={() => setEditing({ prefill: {} })} aria-label="New ask"><Plus size={26} /></button>
      <Toast message={toastMsg} />
    </Ui.Provider>
  )
}

/** The signed-in name, top right beside the light/dark switch (index.html's #who). */
function Who() {
  const { me } = useStore()
  const slot = document.getElementById('who')
  return slot ? createPortal(me.name, slot) : null
}

function MissingAsk({ onClose }) {
  return (
    <aside className="ak-panel" aria-label="Ask not found">
      <div className="ak-panel-body">
        <Alert tone="warning" title="That ask isn’t here">It may have been deleted, or it wasn’t sent to you or your team.</Alert>
        <div><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </aside>
  )
}
