import { useEffect, useRef, useState } from 'react'
import { initialsOf, signOutUser } from '../../../shared/session.js'
import Icon from './Icon.jsx'
import { markUsed, opensInTab, searchTools } from './tools.js'

function openTool(tool) {
  markUsed(tool)
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
          <button className="menu-item" role="menuitem" onClick={() => signOutUser()}>
            <Icon name="log-out" size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  )
}

export default function Header({ user }) {
  return (
    <header className="header">
      <div className="header-row">
        <a className="brand" href="/" aria-label="Internal Hub home">
          <img className="wide-only brand-logo" src="/brand/logo-full-colour.png" alt="" />
          <span className="brand-divider wide-only" />
          <img className="narrow-only" src="/brand/logo-mark.png" alt="" width="32" height="32" />
          <span className="brand-name">Internal Hub</span>
        </a>
        <div className="spacer" />
        <div className="wide-only"><Search /></div>
        <Account user={user} />
      </div>
      <div className="stripe-rule" aria-hidden="true"><span /><span /><span /></div>
    </header>
  )
}
