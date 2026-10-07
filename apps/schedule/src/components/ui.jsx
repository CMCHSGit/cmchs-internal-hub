/**
 * The CHS design system components this app uses (Button, IconButton, Tag,
 * Badge, Alert, Switch, StripeRule, Logo), rebuilt from the vendored
 * Staff-Schedule_v2 bundle as plain CSS-class components — same look and
 * props, but hover/press come from CSS (only on devices that can hover),
 * so a tapped button on a phone doesn't stay stuck in its hover colour.
 * Styles live in index.css under "Design system components".
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
