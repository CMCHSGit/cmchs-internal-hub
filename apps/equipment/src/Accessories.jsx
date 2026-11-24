/* A loan's accessories (cuffs, sensors, lead sets…) by code and quantity, in place of typing them into the
   notes. Optional: New loan and the loan form show this only once "Add accessories" is ticked, and a loan
   with none shows nothing anywhere.

   AccessoryEditor  the list being made or changed. "Choose an accessory" opens the accessory list (Manage ›
                    Accessories, s.accessoryList; model.js accessoryChoices): those that fit the loan's
                    monitors first, then by group; typing narrows it. Picking one adds its code and name; a
                    line from the list shows them as text, so nobody retypes them. Something not on the list
                    can still be added as typed (and then edited); saved with a name, it goes on the list too
                    (store.jsx listTypedAccessories), so it's there to choose next time. Quantities with − and +; "As the last ePM
                    12M loan" adds that loan's list; a set (Manage › Accessories, e.g. "ED monitoring") adds all
                    its accessories with their quantities in one tap.
   AccessoryList    the list on a loan card, read only.
   AccessoryNotesHint  under a notes box: accessories written in the notes (model.js accessoryWordsIn) belong
                    in the accessory list, so they're packed, printed and checked back; a button to go there. */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronDown, Minus, Plus, X } from 'lucide-react'
import { accessoryCatalogue, accessoryChoices, accessoryWordsIn, addSet, cleanAccessories, lastAccessoriesFor, listedAccessory, setSize } from './model.js'

const SHOW_MAX = 200 // options drawn at once; typing narrows the rest

export function AccessoryEditor({ value = [], onChange, s, models = [], notKey = '', withSets = true }) {
  const list = s.accessoryList || []
  const sets = withSets ? s.accessorySets || [] : []
  const catalogue = useMemo(() => accessoryCatalogue(s.loanDocs, list), [s.loanDocs, list])
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const box = useRef(null), input = useRef(null)
  const menuId = useId()
  const sections = useMemo(() => accessoryChoices(catalogue, q, { models }), [catalogue, q, models])
  const flat = useMemo(() => sections.flatMap((sec) => sec.items).slice(0, SHOW_MAX), [sections])
  const total = sections.reduce((n, sec) => n + sec.items.length, 0)
  // One button a model on the loan: the accessories the newest loan with that model had.
  const lastSets = useMemo(() => [...new Set(models.filter(Boolean))]
    .map((m) => ({ model: m, last: lastAccessoriesFor(m, s.loanDocs, { not: notKey }) })).filter((x) => x.last), [models, s.loanDocs, notKey])

  // A tap anywhere else closes the list.
  useEffect(() => {
    if (!open) return undefined
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', away)
    return () => document.removeEventListener('pointerdown', away)
  }, [open])

  const add = (lines) => { onChange(cleanAccessories([...value, ...lines])) }
  const pick = (a) => { add([{ code: a.code, name: a.name, qty: 1 }]); setQ(''); setOpen(false); setActive(0) }
  // Not on the list: what was typed, with a digit in it a code, else a name.
  const addTyped = () => { const t = q.trim(); if (!t) return; add([/\d/.test(t) ? { code: t, name: '' } : { code: '', name: t }]); setQ(''); setOpen(false) }
  const setRow = (i, patch) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const qty = (n) => Math.min(999, Math.max(1, Math.round(Number(n) || 1)))
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((i) => Math.min(flat.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Escape') { if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false) } }
    else if (e.key === 'Enter') { e.preventDefault(); if (open && flat[active]) pick(flat[active]); else if (q.trim()) addTyped(); else setOpen(true) }
  }
  let n = -1 // each option's place in `flat`, for the keyboard

  return (
    <div className="eq-acc">
      {sets.length > 0 && (
        <div className="eq-acc-sets" role="group" aria-label="Accessory sets">
          <span className="eq-small eq-acc-sets-label">Add a set:</span>
          {sets.map((set) => { const n = setSize(set); return (
            <button key={set.id} type="button" className="tag eq-acc-set" onClick={() => onChange(addSet(value, set, list))} title={`${n.lines} accessories, ${n.pieces} pieces`}>
              <Plus size={12} aria-hidden="true" /> {set.name} ({n.pieces})
            </button>
          ) })}
        </div>
      )}
      {lastSets.length > 0 && (
        <div className="eq-acc-sets">
          {lastSets.map((x) => (
            <button key={x.model} type="button" className="tag" onClick={() => add(x.last.accessories)} title={`From ${x.last.loanTo}`}>
              <Plus size={12} aria-hidden="true" /> As the last {x.model} loan ({x.last.accessories.length})
            </button>
          ))}
        </div>
      )}
      {value.length > 0 && (
        <table className="eq-acc-table">
          <thead><tr><th>Code</th><th>Accessory</th><th className="eq-acc-qty">Qty</th><th aria-label="Remove" /></tr></thead>
          <tbody>
            {value.map((a, i) => {
              const listed = listedAccessory(a, list)
              return (
                <tr key={i}>
                  {listed ? (
                    <>
                      <td className="eq-mono eq-acc-fixed">{a.code}</td>
                      <td className="eq-acc-fixed">{a.name || listed.name}</td>
                    </>
                  ) : (
                    <>
                      <td><input className="input eq-mono" value={a.code} onChange={(e) => setRow(i, { code: e.target.value })} aria-label={`Code, line ${i + 1}`} /></td>
                      <td><input className="input" value={a.name} onChange={(e) => setRow(i, { name: e.target.value })} aria-label={`Accessory, line ${i + 1}`} />
                        <span className="eq-small">{String(a.name || '').trim() ? 'New: it goes on the accessory list when this is saved' : 'New: give it a name and it goes on the accessory list'}</span></td>
                    </>
                  )}
                  <td className="eq-acc-qty">
                    <span className="eq-acc-step">
                      <button type="button" className="icon-btn icon-btn-sm" aria-label="One fewer" onClick={() => setRow(i, { qty: qty((a.qty || 1) - 1) })}><Minus size={14} /></button>
                      <input className="input" inputMode="numeric" value={a.qty} onChange={(e) => setRow(i, { qty: e.target.value.replace(/\D/g, '') })} onBlur={() => setRow(i, { qty: qty(a.qty) })} aria-label={`Quantity, line ${i + 1}`} />
                      <button type="button" className="icon-btn icon-btn-sm" aria-label="One more" onClick={() => setRow(i, { qty: qty((Number(a.qty) || 1) + 1) })}><Plus size={14} /></button>
                    </span>
                  </td>
                  <td><button type="button" className="icon-btn icon-btn-sm" aria-label={`Take ${a.code || a.name} off`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} /></button></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="eq-acc-pick" ref={box}>
        <div className="eq-acc-combo">
          <input ref={input} className="input" value={q} role="combobox" aria-expanded={open} aria-controls={menuId} aria-autocomplete="list"
            aria-activedescendant={open && flat[active] ? `${menuId}-${active}` : undefined}
            placeholder={list.length ? 'Choose an accessory…' : 'Accessory code or name, e.g. cuff'} aria-label="Add an accessory"
            onFocus={() => { if (list.length) setOpen(true) }} onClick={() => setOpen(true)}
            onChange={(e) => { setQ(e.target.value); setOpen(true); setActive(0) }} onKeyDown={onKey} />
          <button type="button" className="icon-btn eq-acc-toggle" aria-label={open ? 'Close the accessory list' : 'Open the accessory list'} onClick={() => { setOpen((o) => !o); input.current?.focus() }}>
            <ChevronDown size={18} className={open ? 'eq-kit-chev eq-kit-chev-open' : 'eq-kit-chev'} />
          </button>
        </div>
        {open && (
          <div className="eq-acc-menu" id={menuId} role="listbox" aria-label="Accessories">
            {sections.map((sec) => {
              const items = sec.items.filter(() => n + 1 < SHOW_MAX)
              if (!items.length) return null
              return (
                <div key={sec.title} role="group" aria-label={sec.title}>
                  <div className="eq-acc-menu-head">{sec.title}</div>
                  {items.map((a) => {
                    n++
                    const i = n
                    return (
                      <button key={a.code || a.name} id={`${menuId}-${i}`} type="button" role="option" aria-selected={i === active}
                        className={`eq-acc-opt${i === active ? ' eq-acc-opt-on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => pick(a)}>
                        <span className="eq-acc-opt-name">{a.name || a.code}</span>
                        <span className="eq-small">{[a.code, a.models?.length ? 'fits ' + a.models.join(', ') : '', a.uses ? `on ${a.uses} loan${a.uses === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}</span>
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {total > SHOW_MAX && <p className="eq-note eq-acc-menu-note">{total - SHOW_MAX} more: type to narrow the list.</p>}
            {!total && <p className="eq-note eq-acc-menu-note">{list.length ? 'Nothing on the list matches.' : 'There’s no accessory list yet: it’s kept in Manage, Accessories.'}</p>}
            {q.trim() && <button type="button" className="eq-acc-opt eq-acc-other" onClick={addTyped}>Not on the list: add “{q.trim()}” (it goes on the list too)</button>}
          </div>
        )}
      </div>
    </div>
  )
}

export function AccessoryList({ list = [] }) {
  const acc = cleanAccessories(list)
  if (!acc.length) return null
  return (
    <table className="eq-acc-table eq-acc-view">
      <thead><tr><th>Accessory code</th><th>Accessory</th><th className="eq-acc-qty">Qty</th></tr></thead>
      <tbody>{acc.map((a, i) => <tr key={i}><td className="eq-mono">{a.code}</td><td>{a.name}</td><td className="eq-acc-qty">{a.qty}</td></tr>)}</tbody>
    </table>
  )
}

/** Under a notes box. Always a short pointer; when the notes name accessories, which ones, and a button to add them properly. */
export function AccessoryNotesHint({ text, onUse, useLabel = 'Add them as accessories' }) {
  const words = accessoryWordsIn(text)
  if (!words.length) return <span className="eq-small">Accessories (cuffs, sensors, leads…) go in Accessories, by code and quantity, not here.</span>
  return (
    <span className="eq-small eq-acc-hint">
      These notes mention {words.join(', ')}. Accessories go in Accessories, by code and quantity, so they’re packed, printed and checked back.
      {onUse && <> <button type="button" className="eq-linkbtn" onClick={onUse}>{useLabel}</button></>}
    </span>
  )
}
