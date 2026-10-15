import { useEffect, useRef, useState } from 'react'
import { initialsOf, signOutUser } from '../../../shared/session.js'
import Icon from './Icon.jsx'
import { markUsed, openPhoneApp, opensInTab, searchTools } from './tools.js'

function openTool(tool) {
  markUsed(tool)
  if (openPhoneApp(tool)) return
  if (opensInTab(tool)) window.open(tool.link, '_blank', 'noopener')
  else location.href = tool.link
}

function Search() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const hits = searchTools(q)

  useEffect(() => {
    const close = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className="search" ref={box}>
      <Icon name="search" size={16} className="search-icon" />
      <input
        type="search"
        value={q}
        placeholder="Search tools"
        aria-label="Search tools"
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
          if (e.key === 'Enter' && hits[0]) openTool(hits[0])
        }}
      />
      {open && q.trim() && (
        <div className="search-results" role="listbox">
          {hits.map(t => (
            <button key={t.id} className="search-hit" role="option" onClick={() => openTool(t)}>
              <span className="tile tile-32"><Icon name={t.icon} size={16} /></span>
              <span className="search-hit-text">
                <span className="search-hit-name">{t.name}</span>
                <span className="caption">{t.description}</span>
              </span>
            </button>
          ))}
          {!hits.length && <span className="search-empty">No tools match that search.</span>}
        </div>
      )}
    </div>
  )
}

function Account({ user }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)

  useEffect(() => {
    const close = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className="account" ref={box}>
      <button className="account-btn" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu">
        <span className="avatar">{initialsOf(user)}</span>
        <span className="account-text wide-only">
          <span className="account-name">{user.displayName || user.email}</span>
          <span className="caption">{user.email}</span>
        </span>
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-head narrow-only">
            <span className="account-name">{user.displayName || user.email}</span>
            <span className="caption">{user.email}</span>
          </div>
          <a className="menu-item" role="menuitem" href="/#/people/me" onClick={() => setOpen(false)}>
            <Icon name="user" size={16} /> My profile
          </a>
          <button className="menu-item" role="menuitem" onClick={() => signOutUser()}>
            <Icon name="log-out" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

// `search={false}` on Home, where the hero has the search box instead.
const NAV = [['home', 'Home', '/'], ['people', 'People', '/#/people'], ['manage', 'Manage', '/#/manage']]

export default function Header({ user, search = true, page = 'home' }) {
  return (
    <header className="header">
      <div className="header-row">
        <a className="brand" href="/" aria-label="Internal Hub home">
          <img className="wide-only brand-logo" src="/brand/logo-full-colour.png" alt="" />
          <span className="brand-divider wide-only" />
          <img className="narrow-only" src="/brand/logo-mark.png" alt="" width="32" height="32" />
          <span className="brand-name">Internal Hub</span>
        </a>
        <nav className="nav-tabs wide-only" aria-label="Hub">
          {NAV.map(([id, label, href]) => (
            <a key={id} href={href} className={`nav-tab ${page === id ? 'on' : ''}`} aria-current={page === id ? 'page' : undefined}>{label}</a>
          ))}
        </nav>
        <div className="spacer" />
        {search && <div className="wide-only"><Search /></div>}
        {/* Admin settings. Shown to everyone on purpose: the page asks for the
            admin password (and the admin role), so the gear is just the way
            in for the people who have it, not a tool everyone should see. */}
        <a className={`icon-btn narrow-only header-people ${page === 'people' ? 'on' : ''}`} href="/#/people" aria-label="People" title="People">
          <Icon name="users" size={20} />
        </a>
        <a className={`icon-btn narrow-only header-people ${page === 'manage' ? 'on' : ''}`} href="/#/manage" aria-label="Manage" title="Manage">
          <Icon name="clipboard-list" size={20} />
        </a>
        <a className="icon-btn header-admin" href="/admin/" aria-label="Admin settings" title="Admin settings">
          <Icon name="settings" size={20} />
        </a>
        <Account user={user} />
      </div>
      <div className="stripe-rule" aria-hidden="true"><span /><span /><span /></div>
    </header>
  )
}
