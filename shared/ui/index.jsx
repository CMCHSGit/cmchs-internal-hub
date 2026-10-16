import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The CHS design system components for every tool on internal.chsnz.co.nz:
 * Button, IconButton, Tag, Badge, Alert, Switch, StripeRule, Logo, Spinner,
 * Loading, Toast, useToast and Dialog. Plain CSS-class components (styles in
 * ui.css): hover and press come from CSS, only on devices that can hover,
 * so a tapped button on a phone doesn't stay stuck in its hover colour.
 *
 * Moved here from the staff schedule (apps/schedule/src/components/ui.jsx and
 * Toast.jsx, which re-export this file, so their importers didn't change).
 * New code imports from here. One kit: add a component here rather than
 * building one in a tool (INTEGRATION-PLAN.md).
 */

export function Button({ children, variant = 'primary', size = 'md', block = false, iconLeft, className = '', type = 'button', ...rest }) {
  return (
    <button type={type} className={`btn btn-${variant} btn-${size}${block ? ' btn-block' : ''} ${className}`} {...rest}>
      {iconLeft}{children}
    </button>
  )
}

export function IconButton({ children, label, size = 'md', className = '', ...rest }) {
  return (
    <button type="button" className={`icon-btn icon-btn-${size} ${className}`} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  )
}

export function Tag({ children, selected = false, onClick, className = '' }) {
  return (
    <button type="button" className={`tag${selected ? ' tag-selected' : ''} ${className}`} aria-pressed={selected} onClick={onClick}>
      {children}
    </button>
  )
}

export function Badge({ children, tone = 'purple', className = '' }) {
  return <span className={`badge badge-${tone} ${className}`}>{children}</span>
}

export function Alert({ tone = 'info', title, icon, children, action, className = '' }) {
  return (
    <div className={`alert alert-${tone} ${className}`} role={tone === 'critical' ? 'alert' : undefined}>
      {icon && <span className="alert-icon">{icon}</span>}
      <div className="alert-body">
        {title && <div className="alert-title">{title}</div>}
        {children && <div className="alert-text">{children}</div>}
      </div>
      {action && <div className="alert-action">{action}</div>}
    </div>
  )
}

export function Switch({ checked, onChange, label, className = '' }) {
  return (
    <label className={`switch ${className}`}>
      <input type="checkbox" role="switch" checked={checked} onChange={e => onChange(e.target.checked)} />
      <span className="switch-track"><span className="switch-knob" /></span>
      {label && <span className="switch-label">{label}</span>}
    </label>
  )
}

/** The three-stripe device: connect patients, lives and health. */
export function StripeRule({ thickness = 4 }) {
  return (
    <div className="stripe-rule" style={{ height: thickness }} aria-hidden="true">
      <span /><span /><span />
    </div>
  )
}

/**
 * Never re-typeset the logo, and never recolour the mark.
 *
 * The wordmark is the one sanctioned exception: dark mode uses logo-full-dark,
 * where the grey "connected healthcare systems" is lifted to the theme's text
 * colour and the mark is left exactly as drawn. That replaced sitting the
 * supplied artwork on a white plate, which is the honest way to show an
 * unaltered logo on a dark page but looked like a sticker. If a brand-approved
 * reversed logo ever turns up, drop it in as logo-full-dark and delete the
 * generator note in the commit that added this.
 *
 * Both files render, and CSS picks one — rather than reading the theme here —
 * so the right one is correct on the very first paint, before React runs.
 */
export function Logo({ variant = 'full-colour', width = 150 }) {
  // Through BASE_URL, not root-absolute: this app is served under /schedule/,
  // and /brand/… would reach for the hub's copy instead.
  const url = name => `${import.meta.env.BASE_URL}brand/${name}.png`
  // `display` deliberately lives in CSS, not here: an inline style outranks any
  // class selector, so setting display:block on both images would defeat the
  // rule that hides one of them and you'd see the logo twice.
  const style = { width, height: 'auto' }

  if (variant === 'mark') {
    return <img className="logo-img" src={url('logo-mark')} alt="Connected Healthcare Systems" width={width} style={style} />
  }
  return (
    <>
      <img className="logo-img logo-light" src={url('logo-full-colour')} alt="Connected Healthcare Systems" width={width} style={style} />
      <img className="logo-img logo-dark" src={url('logo-full-dark')} alt="" aria-hidden="true" width={width} style={style} />
    </>
  )
}

export function Spinner({ size = 24, light = false }) {
  return <span className={`spinner${light ? ' spinner-light' : ''}`} style={{ width: size, height: size }} aria-label="Loading" />
}

export function Loading() {
  return <div className="loading-block"><Spinner /></div>
}

/* ── Toast ── */
export function Toast({ message }) {
  if (!message) return null
  return <div className="toast" role="status">{message}</div>
}

/** [message, show] — each show() replaces the last and clears after a few seconds. */
export function useToast() {
  const [message, setMessage] = useState(null)
  const timer = useRef()
  const show = useCallback(msg => {
    clearTimeout(timer.current)
    setMessage(msg)
    timer.current = setTimeout(() => setMessage(null), 2800)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [message, show]
}

/* ── Dialog ── */
/**
 * A dialog over the page: the stripe, a title, an optional line under it, a
 * close button, and the content. Escape or a click outside closes it; focus
 * goes to its first field or button, and back where it was afterwards.
 * role="dialog", so the one app's update reload waits while it is open.
 */
export function Dialog({ title, description, onClose, children, width = 560, className = '', initialFocus }) {
  const box = useRef(null)
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    const prev = document.activeElement
    const first = initialFocus?.current || box.current?.querySelector('input, select, textarea, button:not(.dialog-x)')
    first?.focus()
    const key = e => { if (e.key === 'Escape') { e.stopPropagation(); close.current() } }
    window.addEventListener('keydown', key, true)
    return () => { window.removeEventListener('keydown', key, true); prev?.focus?.() }
  }, [initialFocus])
  return (
    <div className="dialog-scrim" onMouseDown={e => { if (e.target === e.currentTarget) close.current() }}>
      <div className={`dialog ${className}`} role="dialog" aria-modal="true" aria-label={title} ref={box}
        style={{ width: `min(${width}px, calc(100vw - 24px))` }}>
        <StripeRule thickness={4} />
        <div className="dialog-head">
          <div className="dialog-head-text">
            <h2 className="dialog-title">{title}</h2>
            {description && <p className="dialog-desc">{description}</p>}
          </div>
          <button type="button" className="icon-btn icon-btn-md dialog-x" aria-label="Close" onClick={() => close.current()}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="dialog-body">{children}</div>
      </div>
    </div>
  )
}
