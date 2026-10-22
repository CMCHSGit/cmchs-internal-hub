import { useEffect, useRef, useState } from 'react'
import { Boxes, CalendarDays, ClipboardList, Ellipsis, FolderKanban, Home as HomeIcon, Inbox, Moon, Settings, Sun, Users, Wrench } from 'lucide-react'
import { initialsOf, signOutUser } from '../../../shared/session.js'
import { currentTheme, setTheme } from '../../../shared/tool-chrome.js'
import Icon from './Icon.jsx'
import { openSearch } from './Palette.jsx'
import { EVENT, KEY, badgeText, readAll } from '../../../shared/badges.js'

/** A section's count of things needing you (shared/badges.js), kept up to date across this browser's tabs. */
function useBadge(id) {
  const [n, setN] = useState(() => readAll()[id] || 0)
  useEffect(() => {
    const update = () => setN(readAll()[id] || 0)
    const other = (e) => { if (e.key === KEY) update() }
    window.addEventListener(EVENT, update)
    window.addEventListener('storage', other)
    update()
    return () => { window.removeEventListener(EVENT, update); window.removeEventListener('storage', other) }
  }, [id])
  return n
}

/** The red count on a section's tab (old: the demo tracker's tab badge). */
function TabBadge({ id }) {
  const n = useBadge(id)
  return n > 0 ? <span className="tab-badge" aria-label={`, ${n} need${n === 1 ? 's' : ''} you`}>{badgeText(n)}</span> : null
}

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
          <a className="menu-item" role="menuitem" href="/settings/" onClick={() => setOpen(false)}>
            <Icon name="settings" size={16} /> Settings
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
    <button type="button" className="icon-btn theme-btn wide-only" aria-label={`Switch to ${next} mode`} title={`Switch to ${next} mode`}
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
const NAV = [['home', 'Home', '/#/', HomeIcon], ['schedule', 'Schedule', '/schedule/', CalendarDays], ['people', 'People', '/#/people', Users], ['asks', 'Asks', '/asks/', Inbox], ['projects', 'Projects', '/projects/', FolderKanban], ['service', 'Service', '/service/', Wrench], ['equipment', 'Demo', '/equipment/', Boxes], ['manage', 'Manage', '/#/manage', ClipboardList]]
// Phones: the sections used most on a phone as bottom tabs; the rest, and
// Settings, under More. Projects is mostly used at a desk.
const BAR = ['home', 'schedule', 'asks', 'equipment']
const MORE = [...NAV.filter(([id]) => !BAR.includes(id)), ['settings', 'Settings', '/settings/', Settings]]

function BottomNav({ page }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    const esc = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc) }
  }, [open])
  const inMore = MORE.some(([id]) => id === page)
  return (
    <nav className="bottom-nav" aria-label="Sections" ref={box}>
      {NAV.filter(([id]) => BAR.includes(id)).map(([id, label, href, Glyph]) => (
        <a key={id} href={href} className={`bottom-tab ${page === id ? 'on' : ''}`} aria-current={page === id ? 'page' : undefined}>
          <span className="bottom-tab-icon"><Glyph size={22} aria-hidden="true" /><TabBadge id={id} /></span>
          <span>{label}</span>
        </a>
      ))}
      <button type="button" className={`bottom-tab ${inMore || open ? 'on' : ''}`} aria-expanded={open} aria-controls="more-sheet" onClick={() => setOpen(o => !o)}>
        <Ellipsis size={22} aria-hidden="true" />
        <span>More</span>
      </button>
      {open && (
        <div id="more-sheet" className="more-sheet">
          {MORE.map(([id, label, href, Glyph]) => (
            <a key={id} href={href} className={`more-item ${page === id ? 'on' : ''}`} aria-current={page === id ? 'page' : undefined} onClick={() => setOpen(false)}>
              <Glyph size={20} aria-hidden="true" />{label}
            </a>
          ))}
        </div>
      )}
    </nav>
  )
}

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
            <a key={id} href={href} className={`nav-tab ${page === id ? 'on' : ''}`} aria-current={page === id ? 'page' : undefined}>{label}<TabBadge id={id} /></a>
          ))}
        </nav>
        <div className="spacer" />
        {search && <div className="wide-only header-search"><SearchButton /></div>}
        {search && (
          <button type="button" className="icon-btn narrow-only header-search-icon" onClick={() => openSearch()} aria-label="Search" title="Search">
            <Icon name="search" size={20} />
          </button>
        )}
        {/* Settings: everyone's own (appearance, notifications), and for
            admins the admin pages behind the admin password. On a phone
            both are under More (light or dark in Settings, Appearance). */}
        <ThemeButton />
        <a className={`icon-btn header-admin wide-only ${page === 'settings' ? 'on' : ''}`} href="/settings/" aria-label="Settings" title="Settings"
          aria-current={page === 'settings' ? 'page' : undefined}>
          <Icon name="settings" size={20} />
        </a>
        <Account user={user} />
      </div>
      <div className="stripe-rule" aria-hidden="true"><span /><span /><span /></div>
    </header>
    {/* Phones: the sections as bottom tabs, like the staff schedule's, instead of crowding the header. */}
    <BottomNav page={page} />
    </>
  )
}
