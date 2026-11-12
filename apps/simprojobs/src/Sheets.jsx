/* The pickers of the new-job form. On a phone each one is a full screen (a big search box and big rows, thumb-sized, with the phone's
   back button to leave); on a wider screen the same thing is a panel over the page. Which one is open lives in the address
   (#/pick/customer), so Back closes it and nothing here has to touch the browser's history itself. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Spinner } from '../../../shared/ui/index.jsx'
import { friendly, loadCustomers, loadSites } from './lookups.js'

const Chevron = ({ dir = 'right' }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={dir === 'left' ? { transform: 'rotate(180deg)' } : undefined}><path d="m9 6 6 6-6 6" /></svg>
)

export function Sheet({ title, onClose, search, children }) {
  const close = useRef(onClose)
  close.current = onClose
  const box = useRef(null)
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close.current() } }
    window.addEventListener('keydown', key, true)
    document.body.classList.add('sj-lock') // the page behind doesn't scroll under a finger
    return () => { window.removeEventListener('keydown', key, true); document.body.classList.remove('sj-lock') }
  }, [])
  return (
    <div className="sj-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close.current() }}>
      <div className="sj-sheet" role="dialog" aria-modal="true" aria-label={title} ref={box}>
        <div className="sj-sheet-head">
          <button type="button" className="sj-sheet-back" aria-label="Back to the form" onClick={() => close.current()}><Chevron dir="left" /></button>
          <h2 className="sj-sheet-title">{title}</h2>
        </div>
        {search && (
          <div className="sj-sheet-search">
            <input
              className="input" type="search" inputMode="search" enterKeyHint="search" autoComplete="off" autoCorrect="off" spellCheck="false"
              value={search.value} onChange={(e) => search.onChange(e.target.value)} placeholder={search.placeholder} aria-label={search.placeholder}
              autoFocus={search.autoFocus}
            />
          </div>
        )}
        <div className="sj-sheet-body">{children}</div>
      </div>
    </div>
  )
}

/** One tappable row. `selected` shows a tick; `sub` is the smaller line under the name. */
export function Row({ primary, sub, selected, onClick }) {
  return (
    <li>
      <button type="button" className={`sj-row${selected ? ' sj-row-selected' : ''}`} onClick={onClick} aria-pressed={selected || undefined}>
        <span className="sj-row-text">
          <span className="sj-row-primary">{primary}</span>
          {sub && <span className="sj-row-sub">{sub}</span>}
        </span>
        {selected ? <span className="sj-tick" aria-label="Chosen">✓</span> : <Chevron />}
      </button>
    </li>
  )
}

const Busy = ({ children }) => <div className="sj-busy" role="status"><Spinner size={20} /> {children}</div>

// ── Customer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Browse every customer A to Z, or type to narrow it; Show more for the next page. Only the newest question's answer is used. */
export function CustomerSheet({ call, companyId, selected, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const variant = useRef(0)
  const ask = useRef(0)
  const page = useRef(1)

  const run = useCallback(async (text, nextPage) => {
    const mine = ++ask.current
    setBusy(true); setError('')
    try {
      const r = await loadCustomers(call, companyId, text, nextPage, variant.current)
      if (mine !== ask.current) return
      variant.current = r.variant
      page.current = nextPage
      setRows((old) => (nextPage === 1 ? r.rows : [...old, ...r.rows.filter((n) => !old.some((o) => o.ID === n.ID))]))
      setMore(r.more)
    } catch (e) {
      if (mine === ask.current) setError(friendly(e))
    } finally {
      if (mine === ask.current) setBusy(false)
    }
  }, [call, companyId])

  // The first page at once; then a short pause after the last key press, so typing doesn't ask Simpro for every letter.
  const first = useRef(true)
  useEffect(() => {
    if (first.current) { first.current = false; run('', 1); return }
    const t = setTimeout(() => run(q, 1), 350)
    return () => clearTimeout(t)
  }, [q, run])

  const searching = q.trim().length > 0
  return (
    <Sheet title="Customer" onClose={onClose} search={{ value: q, onChange: setQ, placeholder: 'Search customers by name', autoFocus: false }}>
      {error && <Alert tone="critical" title="Couldn’t load customers" action={<Button size="sm" variant="secondary" onClick={() => run(q, 1)}>Try again</Button>}>{error}</Alert>}
      <ul className="sj-list">
        {rows.map((c) => <Row key={c.ID} primary={c.name} sub={c.individual ? 'Individual' : ''} selected={selected?.ID === c.ID} onClick={() => onPick(c)} />)}
      </ul>
      {busy && <Busy>{rows.length ? 'Loading more…' : searching ? 'Searching Simpro…' : 'Loading customers…'}</Busy>}
      {!busy && !error && !rows.length && <p className="sj-empty">{searching ? `No customer matches “${q.trim()}”.` : 'Simpro has no customers to show.'}</p>}
      {!busy && more && <Button variant="secondary" block onClick={() => run(q, page.current + 1)}>Show more customers</Button>}
      {!busy && !more && rows.length > 0 && <p className="sj-end">{rows.length === 1 ? '1 customer' : `${rows.length} customers`}{searching ? ' match' : ''}. Type to narrow it down.</p>}
    </Sheet>
  )
}

// ── Site ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** The sites linked to the chosen customer, filtered as you type (a customer has tens of sites, not thousands). */
export function SiteSheet({ call, companyId, customer, selected, onPick, onClose }) {
  const [q, setQ] = useState('')
  const [state, setState] = useState({ busy: true, sites: [], error: '' })
  const load = useCallback(() => {
    let live = true
    setState({ busy: true, sites: [], error: '' })
    loadSites(call, companyId, customer)
      .then((r) => { if (live) setState({ busy: false, sites: r.sites, error: '' }) })
      .catch((e) => { if (live) setState({ busy: false, sites: [], error: friendly(e) }) })
    return () => { live = false }
  }, [call, companyId, customer])
  useEffect(() => load(), [load])

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? state.sites.filter((s) => s.name.toLowerCase().includes(t)) : state.sites
  }, [q, state.sites])

  return (
    <Sheet title={`Site · ${customer.name}`} onClose={onClose} search={state.sites.length > 6 ? { value: q, onChange: setQ, placeholder: 'Filter this customer’s sites', autoFocus: false } : null}>
      {state.error && <Alert tone="critical" title="Couldn’t load sites" action={<Button size="sm" variant="secondary" onClick={load}>Try again</Button>}>{state.error}</Alert>}
      {state.busy && <Busy>Loading sites…</Busy>}
      <ul className="sj-list">
        {shown.map((s) => <Row key={s.id} primary={s.name} selected={selected?.id === s.id} onClick={() => onPick(s)} />)}
      </ul>
      {!state.busy && !state.error && !state.sites.length && <p className="sj-empty">This customer has no sites in Simpro. A job needs a site, so add one in Simpro first.</p>}
      {!state.busy && state.sites.length > 0 && !shown.length && <p className="sj-empty">No site matches “{q.trim()}”.</p>}
    </Sheet>
  )
}

// ── A short list of choices (cost centre, job type, charge category, priority) ────────────────────────────────

export function OptionSheet({ title, options, selected, onPick, onClose, defaultName }) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return t ? options.filter((o) => o.name.toLowerCase().includes(t)) : options
  }, [q, options])
  return (
    <Sheet title={title} onClose={onClose} search={options.length > 10 ? { value: q, onChange: setQ, placeholder: `Filter ${title.toLowerCase()}`, autoFocus: false } : null}>
      <ul className="sj-list">
        {shown.map((o) => <Row key={o.id} primary={o.name} sub={defaultName && o.name === defaultName ? 'Usual choice' : ''} selected={selected?.id === o.id} onClick={() => onPick(o)} />)}
      </ul>
      {!shown.length && <p className="sj-empty">{options.length ? `Nothing matches “${q.trim()}”.` : 'Simpro has nothing to choose from here.'}</p>}
    </Sheet>
  )
}
