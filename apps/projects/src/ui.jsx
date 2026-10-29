/* Small pieces every screen uses: pills, avatars, a modal, a popover, the
   staff picker. Buttons, tags, badges, alerts and switches are the staff
   schedule's design-system components (../../schedule/src/components/ui.jsx). */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { pillStyle, avatarStyle } from './model.js'
import { useStore } from './store.jsx'

export function StatusPill({ status, small = false }) {
  const { statusByName } = useStore()
  return <span className={`pt-pill${small ? ' pt-pill-sm' : ''}`} style={pillStyle(statusByName.get(status))}>{status || '—'}</span>
}

export function ActivityChip({ activity, who, title }) {
  const { activityByName } = useStore()
  const e = activityByName.get(activity)
  const s = pillStyle(e && { ...e, outline: false }) // solid, as in the workbook's legend
  return (
    <span className="pt-act" style={s} title={title || activity}>
      {who && <b>{who}</b>}{activity}
    </span>
  )
}

/**
 * A person's initials in a small rounded square, the same shape as the
 * Timeline's week chips. As wide as the initials need ("Jess B", "Chalky"),
 * never narrower than it is tall.
 */
export function Avatar({ person, size = 28, ring = false, title }) {
  const label = person?.initials || '?'
  return (
    <span className="pt-av" title={title || person?.name || ''}
      style={{ ...avatarStyle(person?.name || label), minWidth: size, height: size, fontSize: size < 26 ? 11 : 12, padding: `0 ${size < 26 ? 3 : 5}px`, ...(ring ? { boxShadow: '0 0 0 2px var(--surface-card)' } : {}) }}>
      {label}
    </span>
  )
}

export function AvatarStack({ ids, max = 4, size = 28 }) {
  const { staffById } = useStore()
  const people = ids.map((id) => staffById.get(id)).filter(Boolean)
  if (!people.length) return <span className="text-muted">—</span>
  return (
    <span className="pt-avstack">
      {people.slice(0, max).map((p) => <Avatar key={p.id} person={p} size={size} />)}
      {people.length > max && <span className="pt-more">+{people.length - max}</span>}
    </span>
  )
}

/**
 * A setting kept in this browser only (localStorage), e.g. Compact or Roomy.
 * Every screen using the same key stays in step.
 */
const prefListeners = new Set()
export function usePref(key, initial) {
  const read = () => { try { const v = localStorage.getItem(key); return v == null ? initial : JSON.parse(v) } catch { return initial } }
  const [v, setV] = useState(read)
  useEffect(() => {
    const on = (k) => { if (k === key) setV(read()) }
    prefListeners.add(on)
    return () => prefListeners.delete(on)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next) => {
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* private mode: this visit only */ }
    setV(next)
    for (const l of prefListeners) l(key)
  }
  return [v, set]
}

/** Compact fits a whole register or timeline on one screen; Roomy is the original spacing. */
export const useDense = () => usePref('projects_dense', true)

/**
 * Compact pages end at the bottom of the window, so their grid scrolls inside
 * and the headings and filters stay put. Measured, because the hub's header
 * above the tracker is only there on the live site.
 */
export function useFitHeight(on) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!on) { el.style.height = ''; return }
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY
      el.style.height = Math.max(460, document.documentElement.clientHeight - top) + 'px'
    }
    fit()
    window.addEventListener('resize', fit)
    return () => { window.removeEventListener('resize', fit); el.style.height = '' }
  }, [on])
  return ref
}

export function DensityToggle() {
  const [dense, setDense] = useDense()
  return (
    <div className="pt-seg" role="group" aria-label="Spacing">
      {[[true, 'Compact'], [false, 'Roomy']].map(([v, l]) => <button key={l} type="button" className={dense === v ? 'on' : ''} aria-pressed={dense === v} onClick={() => setDense(v)}>{l}</button>)}
    </div>
  )
}

export function Priority({ value, bare = false }) {
  const n = { Low: 1, Medium: 2, High: 3 }[value] || 0
  return (
    <span className="pt-prio" title={bare ? value || 'No priority' : undefined}>
      <span aria-hidden="true" className="pt-bars">
        {[6, 10, 14].map((h, i) => <span key={h} style={{ height: h, background: i < n ? 'var(--accent-fg)' : 'var(--border-hairline)' }} />)}
      </span>
      {bare ? (value === 'High' ? <b className="pt-bad">High</b> : null) : value || '—'}
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
/**
 * A small dialog under something. With `anchor` (a ref to the thing it opens
 * from) it floats over the whole page instead, so a table cell or a scrolling
 * grid can't clip it; it opens upwards when there's no room below, and
 * closes if the page scrolls out from under it.
 */
export function Popover({ open, onClose, children, className = '', style, anchor }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useEffect(() => {
    if (!open) return
    const down = (e) => {
      if (ref.current?.contains(e.target) || anchor?.current?.contains(e.target)) return
      onClose()
    }
    const key = (e) => { if (e.key === 'Escape') onClose() }
    const scroll = (e) => { if (anchor && !ref.current?.contains(e.target)) onClose() }
    setTimeout(() => document.addEventListener('mousedown', down), 0)
    document.addEventListener('keydown', key)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [open, onClose, anchor])
  useLayoutEffect(() => {
    if (!open || !anchor?.current || !ref.current) return
    const a = anchor.current.getBoundingClientRect()
    const h = ref.current.offsetHeight
    const w = ref.current.offsetWidth
    const below = a.bottom + 6
    const top = below + h > window.innerHeight - 8 && a.top - 6 - h > 8 ? a.top - 6 - h : Math.min(below, window.innerHeight - h - 8)
    setPos({ top: Math.max(8, top), left: Math.max(8, Math.min(a.left, window.innerWidth - w - 8)) })
  }, [open, anchor])
  if (!open) return null
  if (!anchor) return <div ref={ref} className={`pt-pop ${className}`} style={style} role="dialog">{children}</div>
  return createPortal(
    <div ref={ref} className={`pt-pop pt-pop-float ${className}`} role="dialog"
      style={{ ...style, ...(pos || { visibility: 'hidden', top: 0, left: 0 }) }}>{children}</div>,
    document.body,
  )
}

/**
 * Choose people from the staff list, by role. `compact` is the bare badges
 * for a table cell; `startOpen` opens the list straight away and `onClose`
 * says when it has been closed (the Table's cell editor uses both).
 */
export function StaffPicker({ value = [], onChange, roles, disabled, compact = false, startOpen = false, onClose }) {
  const { settings } = useStore()
  const [open, setOpen] = useState(startOpen)
  const btn = useRef(null)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current && !open) onClose?.()
    wasOpen.current = open
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const people = settings.staff.filter((p) => !roles || roles.includes(p.role))
  const toggle = (id) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id])
  const names = value.map((id) => settings.staff.find((p) => p.id === id)?.name).filter(Boolean).join(', ') || 'nobody yet'
  return (
    <span className={`pt-picker${compact ? ' compact' : ''}`}>
      <button ref={btn} type="button" className="pt-picker-btn" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}
        aria-label={`${roles ? roles.join(' / ') : 'Staff'}: ${names}${disabled ? '' : '. Change'}`}>
        <AvatarStack ids={value} size={compact ? 18 : 28} />
        {!disabled && !compact && <span className="pt-picker-edit">Edit</span>}
      </button>
      <Popover open={open} onClose={() => setOpen(false)} className="pt-picker-pop" anchor={btn}>
        {people.length === 0 && <p className="text-sm text-muted">No staff yet. Add them in Settings.</p>}
        {people.map((p) => (
          <label key={p.id} className="pt-check">
            <input type="checkbox" checked={value.includes(p.id)} onChange={() => toggle(p.id)} />
            <Avatar person={p} size={24} />
            <span>{p.name}</span>
            <span className="text-muted text-sm">{p.role}</span>
          </label>
        ))}
        <div className="pt-picker-foot"><button type="button" className="link-btn" onClick={() => setOpen(false)}>Done</button></div>
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
