/* Small pieces every screen uses. Buttons, tags, badges, alerts and switches
   are the staff schedule's design-system components
   (../../schedule/src/components/ui.jsx); the modal and popover follow the
   project tracker's. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Users, Search } from 'lucide-react'
import { Badge } from '../../schedule/src/components/ui'
import { avatarStyle, initialsOf, statusOf, TEAMS } from './model.js'
import { useStore } from './store.jsx'

export function Avatar({ name, size = 28, title }) {
  return (
    <span className="ak-av" title={title ?? name ?? ''} aria-hidden={title === '' ? 'true' : undefined}
      style={{ ...avatarStyle(name), width: size, height: size, fontSize: size < 26 ? 11 : 12 }}>
      {initialsOf(name)}
    </span>
  )
}

export function StatusBadge({ status }) {
  const s = statusOf(status)
  return <Badge tone={s.tone}>{s.label}</Badge>
}

/** A centred dialog over a dimmed page (a full-height sheet on a phone). Escape and the backdrop close it. */
export function Modal({ title, description, onClose, children, width = 560 }) {
  const box = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    box.current?.querySelector('input, select, textarea, button:not(.ak-modal-x)')?.focus()
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="ak-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="ak-modal" role="dialog" aria-modal="true" aria-label={title} ref={box} style={{ width: `min(${width}px, 100vw)` }}>
        <div className="stripe-rule" style={{ height: 4 }} aria-hidden="true"><span /><span /><span /></div>
        <div className="ak-modal-head">
          <div>
            <h2 className="ak-modal-title">{title}</h2>
            {description && <p className="ak-modal-desc">{description}</p>}
          </div>
          <button type="button" className="icon-btn icon-btn-md ak-modal-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="ak-modal-body">{children}</div>
      </div>
    </div>
  )
}

/** A small box under its trigger; closes on an outside click or Escape. */
export function Popover({ open, onClose, children, className = '' }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (!ref.current?.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', down), 0)
    document.addEventListener('keydown', key)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, onClose])
  if (!open) return null
  return <div ref={ref} className={`ak-pop ${className}`} role="dialog">{children}</div>
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="text-sm text-muted">{hint}</span>}
    </label>
  )
}

export function Empty({ children }) {
  return <p className="ak-empty">{children}</p>
}

/** "Mike, Sam and the Engineers team" */
export function sentToText(a, userById, meUid) {
  const names = (a.assignees || []).map((u) => (u === meUid ? 'you' : userById.get(u)?.name || 'someone'))
  const teams = (a.teams || []).map((t) => `${t} team`)
  const all = [...names, ...teams]
  if (all.length <= 1) return all[0] || 'nobody'
  return all.slice(0, -1).join(', ') + ' and ' + all[all.length - 1]
}

/**
 * Choose who an ask goes to: whole teams first, then people, with a search
 * box. Picked ones show as chips above.
 */
export function SendToPicker({ assignees, teams, onChange }) {
  const { users, me } = useStore()
  const [q, setQ] = useState('')
  const people = useMemo(() => {
    const s = q.trim().toLowerCase()
    return [...users].sort((a, b) => (a.uid === me.uid) - (b.uid === me.uid) || a.name.localeCompare(b.name))
      .filter((u) => !s || u.name.toLowerCase().includes(s) || (u.team || '').toLowerCase().includes(s))
  }, [users, q, me.uid])
  const shownTeams = TEAMS.filter((t) => !q.trim() || t.toLowerCase().includes(q.trim().toLowerCase()))
  const togglePerson = (uid) => onChange({ assignees: assignees.includes(uid) ? assignees.filter((x) => x !== uid) : [...assignees, uid], teams })
  const toggleTeam = (t) => onChange({ assignees, teams: teams.includes(t) ? teams.filter((x) => x !== t) : [...teams, t] })
  const nameOf = (uid) => users.find((u) => u.uid === uid)?.name || 'Someone'
  return (
    <div className="ak-sendto">
      <div className="ak-chips" aria-live="polite">
        {!assignees.length && !teams.length && <span className="text-sm text-muted">Nobody picked yet</span>}
        {teams.map((t) => (
          <button key={t} type="button" className="ak-chip ak-chip-team" onClick={() => toggleTeam(t)} aria-label={`Remove the ${t} team`}>
            <Users size={14} aria-hidden="true" /> {t} team <X size={14} aria-hidden="true" />
          </button>
        ))}
        {assignees.map((uid) => (
          <button key={uid} type="button" className="ak-chip" onClick={() => togglePerson(uid)} aria-label={`Remove ${nameOf(uid)}`}>
            <Avatar name={nameOf(uid)} size={20} title="" /> {uid === me.uid ? 'Me' : nameOf(uid)} <X size={14} aria-hidden="true" />
          </button>
        ))}
      </div>
      <div className="ak-search">
        <Search size={16} aria-hidden="true" />
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or teams" aria-label="Search people or teams" />
      </div>
      <div className="ak-picklist" role="group" aria-label="People and teams">
        {shownTeams.map((t) => (
          <label key={t} className="ak-check">
            <input type="checkbox" checked={teams.includes(t)} onChange={() => toggleTeam(t)} aria-label={`Whole ${t} team`} />
            <span className="ak-teamicon" aria-hidden="true"><Users size={15} /></span>
            <span className="ak-grow">Whole {t} team</span>
            <span className="text-sm text-muted ak-hide-sm">anyone can pick it up</span>
          </label>
        ))}
        {people.map((u) => (
          <label key={u.uid} className="ak-check">
            <input type="checkbox" checked={assignees.includes(u.uid)} onChange={() => togglePerson(u.uid)} aria-label={u.name} />
            <Avatar name={u.name} size={24} title="" />
            <span className="ak-grow">{u.uid === me.uid ? `${u.name} (me)` : u.name}</span>
            <span className="text-sm text-muted">{u.team}</span>
          </label>
        ))}
        {!shownTeams.length && !people.length && <Empty>Nobody matches that.</Empty>}
      </div>
    </div>
  )
}

/** Turns links in plain text into links, and @Names into highlights. */
export function RichText({ text, names = [] }) {
  const parts = useMemo(() => {
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const alts = [...names].filter(Boolean).sort((a, b) => b.length - a.length).map((n) => '@' + esc(n))
    const re = new RegExp(`(https?://[^\\s<]+${alts.length ? '|' + alts.join('|') : ''})`, 'gi')
    return String(text || '').split(re)
  }, [text, names])
  return (
    <span className="ak-rich">
      {parts.map((p, i) => (i % 2 === 0 ? p
        : /^https?:/i.test(p) ? <a key={i} href={p} target="_blank" rel="noopener noreferrer">{p}</a>
          : <b key={i} className="ak-mention">{p}</b>))}
    </span>
  )
}

/** A photo, full size over the page. */
export function Lightbox({ src, onClose }) {
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [onClose])
  return (
    <div className="ak-lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      <img src={src} alt="" />
      <button type="button" className="icon-btn icon-btn-md ak-lightbox-x" aria-label="Close photo" onClick={onClose}><X size={20} /></button>
    </div>
  )
}
