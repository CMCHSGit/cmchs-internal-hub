/* A loan's accessories (cuffs, sensors, lead sets…) by code and quantity, in place of typing them into the
   notes. Optional: New loan and the loan form show this only once "Add accessories" is ticked, and a loan
   with none shows nothing anywhere.

   AccessoryEditor  the list being made or changed: type a code or a name, pick a suggestion (the catalogue in
                    accessories.js and every code used on an earlier loan, model.js accessoryCatalogue) or add
                    what was typed; quantities with − and +; "As the last ePM 12M loan" adds that loan's list.
   AccessoryList    the list on a loan card, read only. */
import { useMemo, useState } from 'react'
import { Minus, Plus, X } from 'lucide-react'
import { accessoryCatalogue, cleanAccessories, lastAccessoriesFor, searchAccessories } from './model.js'
import { ACCESSORY_LIST } from './accessories.js'

export function AccessoryEditor({ value = [], onChange, s, models = [], notKey = '' }) {
  const catalogue = useMemo(() => accessoryCatalogue(s.loanDocs, ACCESSORY_LIST), [s.loanDocs])
  const [q, setQ] = useState('')
  const hits = useMemo(() => searchAccessories(catalogue, q, { models }), [catalogue, q, models])
  // One button a model on the loan: the accessories the newest loan with that model had.
  const sets = useMemo(() => [...new Set(models.filter(Boolean))]
    .map((m) => ({ model: m, last: lastAccessoriesFor(m, s.loanDocs, { not: notKey }) })).filter((x) => x.last), [models, s.loanDocs, notKey])
  const add = (list) => { onChange(cleanAccessories([...value, ...list])); setQ('') }
  const addTyped = () => {
    const t = q.trim()
    if (!t) return
    // A suggestion if one matches; otherwise what was typed: with a digit in it, a code; else a name.
    add([hits[0] && (hits[0].code.toLowerCase() === t.toLowerCase() || hits.length === 1) ? hits[0] : /\d/.test(t) ? { code: t, name: '' } : { code: '', name: t }])
  }
  const setRow = (i, patch) => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  const qty = (n) => Math.min(999, Math.max(1, Math.round(Number(n) || 1)))

  return (
    <div className="eq-acc">
      {sets.length > 0 && (
        <div className="eq-acc-sets">
          {sets.map((x) => (
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
            {value.map((a, i) => (
              <tr key={i}>
                <td><input className="input eq-mono" value={a.code} onChange={(e) => setRow(i, { code: e.target.value })} aria-label={`Code, line ${i + 1}`} /></td>
                <td><input className="input" value={a.name} onChange={(e) => setRow(i, { name: e.target.value })} aria-label={`Accessory, line ${i + 1}`} /></td>
                <td className="eq-acc-qty">
                  <span className="eq-acc-step">
                    <button type="button" className="icon-btn icon-btn-sm" aria-label="One fewer" onClick={() => setRow(i, { qty: qty((a.qty || 1) - 1) })}><Minus size={14} /></button>
                    <input className="input" inputMode="numeric" value={a.qty} onChange={(e) => setRow(i, { qty: e.target.value.replace(/\D/g, '') })} onBlur={() => setRow(i, { qty: qty(a.qty) })} aria-label={`Quantity, line ${i + 1}`} />
                    <button type="button" className="icon-btn icon-btn-sm" aria-label="One more" onClick={() => setRow(i, { qty: qty((Number(a.qty) || 1) + 1) })}><Plus size={14} /></button>
                  </span>
                </td>
                <td><button type="button" className="icon-btn icon-btn-sm" aria-label={`Take ${a.code || a.name} off`} onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="eq-acc-add">
        <input className="input" value={q} placeholder="Accessory code or name, e.g. cuff" aria-label="Add an accessory"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped() } }} />
        <button type="button" className="btn btn-secondary btn-sm" onClick={addTyped} disabled={!q.trim()}>Add</button>
      </div>
      {q.trim() && hits.length > 0 && (
        <ul className="eq-acc-hits">
          {hits.map((h) => (
            <li key={h.code}><button type="button" onClick={() => add([h])}><span className="eq-mono">{h.code}</span> {h.name}{h.uses ? <span className="text-muted"> · on {h.uses} loan{h.uses === 1 ? '' : 's'}</span> : null}</button></li>
          ))}
        </ul>
      )}
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
