import { useEffect, useRef, useState } from 'react'
import { CalendarDays, ClipboardList, FolderKanban, Home as HomeIcon, Inbox, Moon, Sun, Users } from 'lucide-react'
import { initialsOf, signOutUser } from '../../../shared/session.js'
import { currentTheme, setTheme } from '../../../shared/tool-chrome.js'
import Icon from './Icon.jsx'
import { openSearch } from './Palette.jsx'

/** The search box: opens the one search (Palette.jsx), the same as Ctrl+K. */
function SearchButton() {
  return (
    <button type="button" className="search search-trigger" onClick={() => openSearch()} aria-label="Search (Ctrl K)" aria-haspopup="dialog">
      <Icon name="search" size={16} className="search-icon" />
      <span className="search-trigger-text">Search</span>
      <kbd className="search-kbd">{isMac ? '⌘' : 'Ctrl'} K</kbd>
    </button>
  )
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

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

/** Light/dark, the same choice as in every tool (shared/tool-chrome.js). Both
    icons render and CSS shows one, so it's right on the first paint. */
function ThemeButton() {
  const [, redraw] = useState(0)
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  return (
    <button type="button" className="icon-btn theme-btn" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
      onClick={() => { setTheme(next); redraw(n => n + 1) }}>
      <Moon className="moon" size={20} aria-hidden="true" />
      <Sun className="sun" size={20} aria-hidden="true" />
    </button>
  )
}

// `search={false}` on Home, where the hero has the search box instead (and
// Ctrl+K still opens the one search).
// All '/#/…', so switching between them stays on the page. A plain '/' from
// '/#/people' is a new page load: a white screen and signing-in check again.
const NAV = [['home', 'Home', '/#/', HomeIcon], ['schedule', 'Schedule', '/schedule/', CalendarDays], ['people', 'People', '/#/people', Users], ['asks', 'Asks', '/asks/', Inbox], ['projects', 'Projects', '/projects/', FolderKanban], ['manage', 'Manage', '/#/manage', ClipboardList]]

export default function Header({ user, search = true, page = 'home' }) {
  return (
    <>
    <header className="header">
      <div className="header-row">
        <a className="brand" href="/#/" aria-label="Internal Hub home">
          <img className="wide-only brand-logo brand-logo-light" src="/brand/logo-full-colour.png" alt="" />
          <img className="wide-only brand-logo brand-logo-dark" src="/brand/logo-full-dark.png" alt="" />
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
        {search && <div className="wide-only header-search"><SearchButton /></div>}
        {search && (
          <button type="button" className="icon-btn narrow-only header-search-icon" onClick={() => openSearch()} aria-label="Search" title="Search">
            <Icon name="search" size={20} />
          </button>
        )}
        {/* Admin settings. Shown to everyone on purpose: the page asks for the
            admin password (and the admin role), so the gear is just the way
            in for the people who have it, not a tool everyone should see. */}
        <ThemeButton />
        <a className={`icon-btn header-admin ${page === 'admin' ? 'on' : ''}`} href="/admin/" aria-label="Admin settings" title="Admin settings"
          aria-current={page === 'admin' ? 'page' : undefined}>
          <Icon name="settings" size={20} />
        </a>
        <Account user={user} />
      </div>
      <div className="stripe-rule" aria-hidden="true"><span /><span /><span /></div>
    </header>
    {/* Phones: the sections as bottom tabs, like the staff schedule's, instead of crowding the header. */}
    <nav className="bottom-nav" aria-label="Sections">
      {NAV.map(([id, label, href, Glyph]) => (
        <a key={id} href={href} className={`bottom-tab ${page === id ? 'on' : ''}`} aria-current={page === id ? 'page' : undefined}>
          <Glyph size={22} aria-hidden="true" />
          <span>{label}</span>
        </a>
      ))}
    </nav>
    </>
  )
}
