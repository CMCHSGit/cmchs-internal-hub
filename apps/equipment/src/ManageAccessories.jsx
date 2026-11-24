/* Manage › Accessories: the accessory list the loan picker offers (Accessories.jsx). Kept in its own
   Firestore document, settings/equipmentAccessories (db-firestore.js), not in the code: the team keeps it
   up to date here. Import a spreadsheet (Code, Name, Group, Fits; any other column, such as a price, is left
   out), add, change or remove one, and export it to edit and import again. Sets ("ED monitoring": these
   accessories, these many of each) are made here too, or imported from a sheet with Set and Qty columns
   (a workbook's first sheet, and a sheet called Sets); a loan's picker adds a set in one tap. Every change
   is one audit line, in counts. The rules are model.js's accessoryListFromRows, mergeAccessoryList,
   mergeAccessorySets and cleanAccessoryList. */
import { useMemo, useRef, useState } from 'react'
import { Alert, Button, Dialog, useConfirm } from '../../../shared/ui/index.jsx'
import { AccessoryEditor } from './Accessories.jsx'
import { accessoryKey, accessoryListFromRows, cleanAccessories, cleanAccessoryItem, fmtDate, mergeAccessoryList, mergeAccessorySets, setLines, setSize } from './model.js'

const HEADINGS = ['Code', 'Name', 'Group', 'Fits']
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

export default function ManageAccessories({ s, onDone, lib }) {
  const list = s.accessoryList || []
  const sets = s.accessorySets || []
  const [editingSet, setEditingSet] = useState(null) // a set being made ({ id: '' }) or changed
  const [q, setQ] = useState('')
  const [editing, setEditing] = useState(null) // { key: the item's key, or '' for a new one, item }
  const [incoming, setIncoming] = useState(null) // an import read and waiting: { items, skipped, columns, fileName }
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const file = useRef(null)
  const [confirmDialog, confirm] = useConfirm()
  const shown = useMemo(() => {
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return list.filter((a) => words.every((w) => `${a.code} ${a.name} ${a.group} ${a.models.join(' ')}`.toLowerCase().includes(w)))
  }, [list, q])

  const run = async (label, fn) => {
    setBusy(label); setError('')
    try { return await fn() } catch (e) { setError(e.message || String(e)); throw e } finally { setBusy('') }
  }

  async function readFile(ev) {
    const f = ev.target.files?.[0]
    if (!f) return
    try {
      await run('Reading…', async () => {
        const ext = f.name.split('.').pop().toLowerCase()
        let rows
        if (ext === 'csv' || ext === 'txt') { const Papa = await lib('papa'); rows = await new Promise((resolve, reject) => Papa.parse(f, { header: true, skipEmptyLines: true, complete: (r) => resolve(r.data), error: reject })) }
        else if (ext === 'xlsx' || ext === 'xls') {
          // The first sheet, and a sheet called Sets (as Export to Excel writes them).
          const XLSX = await lib('xlsx'); const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
          rows = wb.SheetNames.filter((n, i) => i === 0 || /^\s*(accessory\s*)?sets?\s*$/i.test(n)).flatMap((n) => XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '' }))
        }
        else throw new Error('Choose an Excel or CSV file.')
        const r = accessoryListFromRows(rows)
        if (r.problem) throw new Error(r.problem)
        if (!r.items.length) throw new Error('There are no accessories in that file.')
        setIncoming({ ...r, fileName: f.name })
      })
    } catch { /* shown */ } finally { if (file.current) file.current.value = '' }
  }

  async function exportList() {
    await run('Exporting…', async () => {
      const XLSX = await lib('xlsx')
      const ws = XLSX.utils.aoa_to_sheet([HEADINGS, ...list.map((a) => [a.code, a.name, a.group, a.models.join(', ')])])
      ws['!cols'] = [{ wch: 18 }, { wch: 48 }, { wch: 16 }, { wch: 30 }]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Accessories')
      // The sets on their own sheet, a row an accessory, to change and import again.
      const ss = XLSX.utils.aoa_to_sheet([['Set', 'Code', 'Name', 'Qty'], ...sets.flatMap((set) => setLines(set, list).map((l) => [set.name, l.code, l.name, l.qty]))])
      ss['!cols'] = [{ wch: 24 }, { wch: 18 }, { wch: 48 }, { wch: 6 }]
      XLSX.utils.book_append_sheet(wb, ss, 'Sets')
      XLSX.writeFile(wb, list.length ? `CHS-Demo-Accessories-${s.today}.xlsx` : 'CHS-Demo-Accessories-template.xlsx')
    }).catch(() => {})
  }

  async function importIt(replace) {
    const r = mergeAccessoryList(list, incoming.items, { replace })
    const ns = (incoming.sets || []).length
    if (replace && r.removed && !(await confirm({ title: 'Replace the whole list?', message: `${plural(r.removed, 'accessory', 'accessories')} not in this file will be taken off the list. Loans that already have them keep them.`, confirmLabel: 'Replace the list', danger: true }))) return
    const setsText = ns ? `; ${plural(ns, 'set')}` : ''
    try {
      await run('Saving…', () => s.changeAccessoryDoc((now) => ({ items: mergeAccessoryList(now.items, incoming.items, { replace }).items, ...(ns ? { sets: mergeAccessorySets(now.sets, incoming.sets).sets } : {}) }),
        ['accessory_list', (replace ? `Accessory list replaced from a spreadsheet: ${plural(r.items.length, 'item')}${r.removed ? `, ${r.removed} removed` : ''}` : `Accessory list imported: ${r.added} added, ${r.updated} updated`) + setsText, { added: r.added, updated: r.updated, removed: r.removed, total: r.items.length, sets: ns }]))
      setIncoming(null)
      onDone((replace ? `Accessory list replaced: ${plural(r.items.length, 'accessory', 'accessories')}` : `Imported: ${r.added} added, ${r.updated} updated${r.unchanged ? `, ${r.unchanged} already there` : ''}`) + setsText + '.')
    } catch { /* shown */ }
  }

  async function removeSet(set) {
    if (!(await confirm({ title: `Delete the set “${set.name}”?`, message: 'The accessories stay on the list, and loans it was added to keep theirs.', confirmLabel: 'Delete the set', danger: true }))) return
    try {
      await run('Saving…', () => s.changeAccessoryDoc((now) => ({ sets: now.sets.filter((x) => x.name.toLowerCase() !== set.name.toLowerCase()) }), ['accessory_list', 'Accessory set deleted', { setsRemoved: 1 }]))
      onDone('Set deleted.')
    } catch { /* shown */ }
  }

  async function remove(a) {
    if (!(await confirm({ title: `Take ${a.name || a.code} off the list?`, message: 'It stops being offered for new loans. Loans that already have it keep it.', confirmLabel: 'Take it off', danger: true }))) return
    const k = accessoryKey(a)
    try {
      await run('Saving…', () => s.changeAccessoryList((now) => now.filter((x) => accessoryKey(x) !== k), ['accessory_list', 'Accessory taken off the list', { removed: 1 }]))
      onDone('Taken off the list.')
    } catch { /* shown */ }
  }

  return (
    <>
      <p className="eq-note">What the accessory picker on a loan offers. Import a spreadsheet whose first row is the headings <b>Code</b>, <b>Name</b>, <b>Group</b> (SpO2, NIBP, ECG…) and <b>Fits</b> (the monitor models it goes with, separated by commas). Other columns, such as prices, are left out.</p>
      <div className="card eq-toolbar">
        <label className="field eq-grow"><span className="field-label">Search</span><input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Code, name, group or model" /></label>
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => setEditing({ key: '', item: { code: '', name: '', group: '', models: [] } })}>Add one</Button>
        <Button size="sm" variant="secondary" disabled={!!busy} onClick={exportList}>{list.length ? 'Export to Excel' : 'Download a template'}</Button>
        <Button size="sm" disabled={!!busy} onClick={() => file.current?.click()}>{busy === 'Reading…' ? 'Reading…' : 'Import a spreadsheet'}</Button>
        <input ref={file} type="file" accept=".xlsx,.xls,.csv,.txt" hidden onChange={readFile} />
      </div>
      {error && <Alert tone="critical" title="That didn’t work">{error}</Alert>}
      <section className="card eq-kit">
        <div className="eq-actions-row">
          <h3 className="eq-h3 eq-grow">Sets</h3>
          <Button size="sm" variant="secondary" disabled={!!busy || !s.accessoryListReady} onClick={() => setEditingSet({ id: '', name: '', lines: [] })}>New set</Button>
        </div>
        <p className="eq-note">A set is the accessories that usually go together, with how many of each (an ED monitoring set, a SCBU set). The accessory picker on a loan adds a whole set in one tap. To import sets, give the sheet a <b>Set</b> and a <b>Qty</b> column, one row per accessory in a set.</p>
        {sets.length ? (
          <ul className="eq-picklist">
            {sets.map((set) => { const n = setSize(set); return (
              <li key={set.id} className="eq-picked">
                <span className="eq-picked-main"><span className="eq-strong">{set.name}</span><span className="eq-small">{plural(n.lines, 'accessory', 'accessories')}, {plural(n.pieces, 'piece')}</span></span>
                <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditingSet(set)}>Change</Button>
                <Button size="sm" variant="ghost" className="eq-danger" disabled={!!busy} onClick={() => removeSet(set)}>Delete</Button>
              </li>
            ) })}
          </ul>
        ) : <p className="data-table-empty">No sets yet.</p>}
      </section>
      {!s.accessoryListReady ? <p className="eq-note">Loading the list…</p>
        : !list.length ? <p className="data-table-empty">No accessories yet. Import a spreadsheet, or add them one at a time.</p>
          : (
            <section className="card eq-kit">
              <p className="eq-note">{plural(list.length, 'accessory', 'accessories')}{s.accessoryListAt ? ` · last changed ${fmtDate(String(s.accessoryListAt).slice(0, 10))}${s.accessoryListBy ? ` by ${s.accessoryListBy}` : ''}` : ''}{q.trim() ? ` · ${shown.length} match` : ''}</p>
              <div className="eq-acclist-wrap">
                <table className="eq-acc-table eq-acclist">
                  <thead><tr><th>Code</th><th>Accessory</th><th>Group</th><th>Fits</th><th aria-label="Change or remove" /></tr></thead>
                  <tbody>
                    {shown.map((a) => (
                      <tr key={accessoryKey(a)}>
                        <td className="eq-mono">{a.code}</td>
                        <td>{a.name}</td>
                        <td>{a.group}</td>
                        <td>{a.models.join(', ')}</td>
                        <td className="eq-acclist-act">
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setEditing({ key: accessoryKey(a), item: a })}>Change</Button>
                          <Button size="sm" variant="ghost" className="eq-danger" disabled={!!busy} onClick={() => remove(a)}>Remove</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
      {editing && <EditAccessory s={s} editing={editing} busy={busy} onClose={() => setEditing(null)}
        onSave={async (item) => {
          const was = editing.key
          const k = accessoryKey(item)
          if (list.some((x) => accessoryKey(x) === k && k !== was)) throw new Error(`${item.code || item.name} is already on the list.`)
          await run('Saving…', () => s.changeAccessoryList((now) => [...now.filter((x) => accessoryKey(x) !== was), item],
            ['accessory_list', was ? 'Accessory changed in the list' : 'Accessory added to the list', { [was ? 'changed' : 'added']: 1 }]))
          setEditing(null)
          onDone(was ? 'Saved.' : 'Added to the list.')
        }} />}
      {editingSet && <EditSet s={s} set={editingSet} sets={sets} busy={busy} onClose={() => setEditingSet(null)}
        onSave={async (next) => {
          const was = (editingSet.name || '').toLowerCase()
          await run('Saving…', () => s.changeAccessoryDoc((now) => ({ sets: [...now.sets.filter((x) => x.name.toLowerCase() !== was && x.name.toLowerCase() !== next.name.toLowerCase()), next] }),
            ['accessory_list', editingSet.id ? 'Accessory set changed' : 'Accessory set added', { set: 1, lines: next.lines.length }]))
          setEditingSet(null)
          onDone(editingSet.id ? 'Set saved.' : 'Set added.')
        }} />}
      {incoming && <ImportPreview list={list} sets={sets} incoming={incoming} busy={busy} onImport={importIt} onClose={() => setIncoming(null)} />}
      {confirmDialog}
    </>
  )
}

function EditAccessory({ editing, busy, onClose, onSave }) {
  const [f, setF] = useState(() => ({ ...editing.item, models: (editing.item.models || []).join(', ') }))
  const [problem, setProblem] = useState('')
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  async function save(ev) {
    ev.preventDefault()
    const item = cleanAccessoryItem(f)
    if (!item) return setProblem('Give it a code or a name.')
    setProblem('')
    try { await onSave(item) } catch (e) { setProblem(e.message || String(e)) }
  }
  return (
    <Dialog title={editing.key ? 'Change an accessory' : 'Add an accessory'} onClose={onClose} width={520}>
      <form className="eq-form" onSubmit={save}>
        <div className="eq-form-row">
          <label className="field"><span className="field-label">Code</span><input className="input eq-mono" value={f.code} onChange={set('code')} placeholder="e.g. 0010-30-12257" autoFocus /></label>
          <label className="field"><span className="field-label">Group</span><input className="input" value={f.group} onChange={set('group')} placeholder="e.g. NIBP" /></label>
        </div>
        <label className="field"><span className="field-label">Name</span><input className="input" value={f.name} onChange={set('name')} placeholder="e.g. NIBP cuff, adult, reusable" /></label>
        <label className="field"><span className="field-label">Fits (monitor models, separated by commas)</span><input className="input" value={f.models} onChange={set('models')} placeholder="e.g. N17, ePM 12M" /></label>
        {problem && <p className="eq-note eq-problem">{problem}</p>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!!busy}>{busy || (editing.key ? 'Save' : 'Add')}</Button>
        </div>
      </form>
    </Dialog>
  )
}

function ImportPreview({ list, sets = [], incoming, busy, onImport, onClose }) {
  const add = mergeAccessoryList(list, incoming.items)
  const rep = mergeAccessoryList(list, incoming.items, { replace: true })
  const nSets = (incoming.sets || []).length
  const COLUMN = { code: 'Code', name: 'Name', group: 'Group', models: 'Fits', set: 'Set', qty: 'Qty' }
  const used = Object.entries(incoming.columns).filter(([f, h]) => h && COLUMN[f]).map(([f, h]) => `${COLUMN[f]} from “${h}”`)
  const what = plural(incoming.items.length, 'accessory', 'accessories')
  return (
    <Dialog title={nSets ? `Import ${plural(nSets, 'set')} (${what})` : `Import ${what}`} description={incoming.fileName} onClose={onClose} width={680}>
      <div className="eq-form">
        <p className="eq-note">Read {used.join(', ')}.{incoming.skipped ? ` ${plural(incoming.skipped, 'row')} with no code or name left out.` : ''}</p>
        <div className="eq-acclist-wrap">
          <table className="eq-acc-table eq-acclist">
            <thead><tr><th>Code</th><th>Accessory</th><th>Group</th><th>Fits</th></tr></thead>
            <tbody>{incoming.items.slice(0, 8).map((a) => <tr key={accessoryKey(a)}><td className="eq-mono">{a.code}</td><td>{a.name}</td><td>{a.group}</td><td>{a.models.join(', ')}</td></tr>)}</tbody>
          </table>
        </div>
        {incoming.items.length > 8 && <p className="eq-note">…and {incoming.items.length - 8} more.</p>}
        {(incoming.sets || []).length > 0 && (
          <p className="eq-note"><b>Sets:</b> {incoming.sets.map((set) => { const n = setSize(set); return `${set.name} (${plural(n.lines, 'accessory', 'accessories')}, ${plural(n.pieces, 'piece')})${sets.some((x) => x.name.toLowerCase() === set.name.toLowerCase()) ? ', replacing the set of that name' : ''}` }).join('; ')}.</p>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose} disabled={!!busy}>Cancel</Button>
          {/* A sheet of sets lists only what's in them: it never replaces the whole list. */}
          {list.length > 0 && !nSets && <Button variant="secondary" className="eq-danger" disabled={!!busy} onClick={() => onImport(true)}>Replace the whole list{rep.removed ? ` (${rep.removed} removed)` : ''}</Button>}
          <Button disabled={!!busy} onClick={() => onImport(false)}>{busy || ((list.length ? `Add to the list: ${add.added} new, ${add.updated} updated` : 'Import') + (nSets ? `, ${plural(nSets, 'set')}` : ''))}</Button>
        </div>
      </div>
    </Dialog>
  )
}

/** A set made or changed: its name, and its accessories with quantities, chosen as on a loan. */
function EditSet({ s, set, sets, busy, onClose, onSave }) {
  const [name, setName] = useState(set.name || '')
  const [lines, setLinesNow] = useState(() => setLines(set, s.accessoryList))
  const [problem, setProblem] = useState('')
  async function save(ev) {
    ev.preventDefault()
    const n = name.trim().replace(/\s+/g, ' ')
    if (!n) return setProblem('Give the set a name.')
    const acc = cleanAccessories(lines)
    if (!acc.length) return setProblem('Add at least one accessory.')
    if (sets.some((x) => x.name.toLowerCase() === n.toLowerCase() && x.name.toLowerCase() !== (set.name || '').toLowerCase())) return setProblem(`There’s already a set called ${n}.`)
    setProblem('')
    try { await onSave({ id: set.id || 'set_' + Date.now(), name: n, lines: acc }) } catch (e) { setProblem(e.message || String(e)) }
  }
  return (
    <Dialog title={set.id ? `Change the set: ${set.name}` : 'New accessory set'} onClose={onClose} width={720}>
      <form className="eq-form" onSubmit={save}>
        <label className="field"><span className="field-label">Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. ED monitoring" autoFocus={!set.id} /></label>
        <div className="field"><span className="field-label">Accessories and how many of each</span>
          <AccessoryEditor value={lines} onChange={setLinesNow} s={s} withSets={false} />
        </div>
        {problem && <p className="eq-note eq-problem">{problem}</p>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={!!busy}>{busy || (set.id ? 'Save' : 'Add the set')}</Button>
        </div>
      </form>
    </Dialog>
  )
}
