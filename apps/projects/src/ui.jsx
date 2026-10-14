/* Small pieces every screen uses: pills, avatars, a modal, a popover, the
   staff picker. Buttons, tags, badges, alerts and switches are the staff
   schedule's design-system components (../../schedule/src/components/ui.jsx). */

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { pillStyle, avatarStyle } from './model.js'
import { useStore } from './store.jsx'

export function StatusPill({ status, small = false }) {
  const { statusByName } = useStore()
  return <span className={`pt-pill${small ? ' pt-pill-sm' : ''}`} style={pillStyle(statusByName.get(status))}>{status || '—'}</span>
}

export function ActivityChip({ activity, who, title }) {
  const { activityByName } = useStore()
  const s = pillStyle(activityByName.get(activity))
  return (
    <span className="pt-act" style={s} title={title || activity}>
      {who && <b>{who}</b>}{activity}
    </span>
  )
}

export function Avatar({ person, size = 28, ring = false, title }) {
  const label = person?.initials || '?'
  return (
    <span className="pt-av" title={title || person?.name || ''}
      style={{ ...avatarStyle(person?.name || label), width: size, height: size, fontSize: size < 26 ? 11 : 12, ...(ring ? { boxShadow: '0 0 0 2px var(--surface-card)' } : {}) }}>
      {label}
    </span>
  )
}

export function AvatarStack({ ids, max = 4 }) {
  const { staffById } = useStore()
  const people = ids.map((id) => staffById.get(id)).filter(Boolean)
  if (!people.length) return <span className="text-muted">—</span>
  return (
    <span className="pt-avstack">
      {people.slice(0, max).map((p) => <Avatar key={p.id} person={p} ring />)}
      {people.length > max && <span className="pt-more">+{people.length - max}</span>}
    </span>
  )
}

export function Priority({ value }) {
  const n = { Low: 1, Medium: 2, High: 3 }[value] || 0
  return (
    <span className="pt-prio">
      <span aria-hidden="true" className="pt-bars">
        {[6, 10, 14].map((h, i) => <span key={h} style={{ height: h, background: i < n ? 'var(--accent-fg)' : 'var(--border-hairline)' }} />)}
      </span>
      {value || '—'}
    </span>
  )
}

export function Highlight({ parts }) {
  return parts.map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))
}

/** A centred dialog over a dimmed page. Escape and the backdrop close it. */
export function Modal({ title, description, onClose, children, width = 560, className = '' }) {
  const box = useRef(null)
  useEffect(() => {
    const prev = document.activeElement
    const first = box.current?.querySelector('input, select, textarea, button:not(.pt-modal-x)')
    first?.focus()
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); prev?.focus?.() }
  }, [onClose])
  return (
    <div className="pt-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`pt-modal ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={box} style={{ width: `min(${width}px, calc(100vw - 24px))` }}>
        <div className="stripe-rule" style={{ height: 4 }} aria-hidden="true"><span /><span /><span /></div>
        <div className="pt-modal-head">
          <div>
            <h2 className="pt-modal-title">{title}</h2>
            {description && <p className="pt-modal-desc">{description}</p>}
          </div>
          <button type="button" className="icon-btn icon-btn-md pt-modal-x" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="pt-modal-body">{children}</div>
      </div>
    </div>
  )
}

/** A small floating box anchored under its trigger; closes on outside click or Escape. */
export function Popover({ open, onClose, children, className = '', style }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose() }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    setTimeout(() => document.addEventListener('mousedown', down), 0)
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key) }
  }, [open, onClose])
  if (!open) return null
  return <div ref={ref} className={`pt-pop ${className}`} style={style} role="dialog">{children}</div>
}

/** Choose people from the staff list, by role. */
export function StaffPicker({ value = [], onChange, roles, disabled }) {
  const { settings } = useStore()
  const [open, setOpen] = useState(false)
  const people = settings.staff.filter((p) => !roles || roles.includes(p.role))
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  const names = value.map((id) => settings.staff.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || 'nobody yet'
  return (
    <span className="pt-picker">
      <button type="button" className="pt-picker-btn" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label={`${roles ? roles.join(' / ') : 'Staff'}: ${names}${disabled ? '' : '. Change'}`}>
        <AvatarStack ids={value} />
        {!disabled && <span className="pt-picker-edit">Edit</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="pt-picker-pop">
        {people.length === 0 && <p className="text-sm text-muted">No staff yet. Add them in Settings.</p>}
        {people.map((p) => (
          <label key={p.id} className="pt-check">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
            <Avatar person={p} size={24} />
            <span>{p.name}</span>
            <span className="text-muted text-sm">{p.role}</span>
          </label>
        ))}
      </Popover>
    </span>
  )
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
  return <p className="pt-empty">{children}</p>
}
