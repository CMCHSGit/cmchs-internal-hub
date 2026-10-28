/* A filter that takes several choices: a button showing what is chosen, and a list of tick boxes under it.
   Used for every filter on a checklist (facility, department, status, missing a step, software version), so
   "NSH and THM" is one filter with two ticks. Closes on a click elsewhere or Escape. */
import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * label: the field's name; all: what it says with nothing chosen ("All facilities"); noun: "facility" / "facilities" for "2 facilities";
 * options: [{ value, label }]; selected: [values]; onChange(newSelected).
 */
export default function MultiSelect({ label, all, noun = ['item', 'items'], options, selected, onChange }) {
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const id = useId()

  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (!box.current?.contains(e.target)) setOpen(false) }
    const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc, true)
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc, true) }
  }, [open])

  const chosen = options.filter((o) => selected.includes(o.value))
  const allOn = options.length > 0 && chosen.length === options.length
  const text = !chosen.length ? all : allOn && options.length > 2 ? `All ${options.length} ${noun[1]}` : chosen.length === 1 ? chosen[0].label.replace(/\s*\(.*\)$/, '') : chosen.length === 2 ? chosen.map((o) => o.label.replace(/\s*\(.*\)$/, '')).join(', ') : `${chosen.length} ${noun[1]}`
  const toggle = (v) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
  const allBox = useRef(null)
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = chosen.length > 0 && !allOn }, [chosen.length, allOn, open])

  return (
    <div className="field cl-ms" ref={box}>
      <span className="field-label" id={id}>{label}</span>
      <button type="button" className={`cl-ms-btn${chosen.length ? ' on' : ''}`} aria-haspopup="listbox" aria-expanded={open} aria-labelledby={id} onClick={() => setOpen(!open)}>
        <span className="cl-ms-text">{text}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="cl-ms-pop" role="group" aria-label={label}>
          <div className="cl-ms-head">
            <span>{chosen.length ? `${chosen.length} chosen` : 'Tick any number'}</span>
            {chosen.length > 0 && <button type="button" className="cl-link" onClick={() => onChange([])}>Clear</button>}
          </div>
          <label className="cl-ms-opt cl-ms-all">
            <input ref={allBox} type="checkbox" checked={allOn} onChange={() => onChange(allOn ? [] : options.map((o) => o.value))} />
            <span>Select all ({options.length})</span>
          </label>
          <div className="cl-ms-list">
            {options.map((o) => (
              <label key={o.value} className="cl-ms-opt">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
