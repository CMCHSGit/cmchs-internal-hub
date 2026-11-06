/* Adding and changing entries, and importing lists. Only drawn for admins and editors; the rules are what really decide. */
import { useRef, useState } from 'react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { buildRecord, cell, findHeaderRow, KINDS, rowsToRecords, parseCsv } from './model.js'
import { importRecords, saveRecord } from './store.js'

const FIELDS = {
  article: [['title', 'Title', 'text'], ['category', 'Category', 'category'], ['body', 'Answer', 'area', 'Plain text. **Bold**, “- ” for bullet points, and https:// links work.'],
    ['tags', 'Tags', 'list', 'Separate with commas: n17, display, software'], ['parts', 'Part numbers it mentions', 'list', 'Separate with commas. Each links to the part.'], ['reviewedAt', 'Last checked', 'date']],
  part: [['partNo', 'Part number', 'text'], ['name', 'Name', 'text'], ['aliases', 'Other names people use for it', 'list', 'Separate with commas: PSU, power board'], ['fits', 'Fits (models)', 'list', 'Separate with commas: N17, N12'],
    ['notes', 'Notes', 'area'], ['diagram', 'Diagram', 'text', 'A link to the manual page or picture, or where to find it.']],
  device: [['site', 'Site', 'text'], ['dept', 'Department', 'text'], ['model', 'Model', 'text'], ['serial', 'Serial number', 'text'], ['version', 'Software version', 'text'], ['options', 'Options', 'text'], ['notes', 'Notes', 'area']],
  job: [['jobNo', 'Job number', 'text'], ['title', 'Title', 'text'], ['site', 'Site', 'text'], ['date', 'Date', 'date'], ['model', 'Models', 'list', 'Separate with commas'], ['parts', 'Part numbers used', 'list', 'Separate with commas'], ['notes', 'What was done', 'area']],
}
const NEEDS = { article: ['title'], part: ['partNo'], device: ['model', 'serial'], job: ['jobNo', 'title'] }
const TITLE = { article: 'article', part: 'part', device: 'device', job: 'past job' }

export function Editor({ kind, record, categories, by, onClose, onSaved }) {
  const [vals, setVals] = useState(() => Object.fromEntries(FIELDS[kind].map(([k, , type]) => [k, type === 'list' ? (record?.[k] || []).join(', ') : record?.[k] || ''])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (k) => (e) => setVals((v) => ({ ...v, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    const input = { ...vals, extra: record?.extra }
    const built = buildRecord(kind, input)
    if (!NEEDS[kind].some((k) => built[k])) return setError('Fill in ' + NEEDS[kind].map((k) => FIELDS[kind].find(([f]) => f === k)[1].toLowerCase()).join(' or ') + '.')
    setBusy(true); setError('')
    try {
      const id = await saveRecord(kind, record?.id, input, by)
      onSaved(kind, id, record ? 'Saved.' : 'Added.')
    } catch (err) {
      console.error(err)
      setError(err.code === 'permission-denied' ? 'You can’t change the knowledge base. An admin can give you the editor switch in Settings → People and access.' : 'Could not save: ' + (err.message || err))
      setBusy(false)
    }
  }

  return (
    <Dialog title={`${record ? 'Change' : 'Add'} ${/^[aeiou]/.test(TITLE[kind]) ? 'an' : 'a'} ${TITLE[kind]}`} onClose={onClose} width={640}>
      <form className="kb-form" onSubmit={save}>
        {FIELDS[kind].map(([k, label, type, hint]) => (
          <label key={k} className="field">
            <span className="field-label">{label}</span>
            {type === 'area'
              ? <textarea className="input" rows={k === 'body' ? 10 : 4} value={vals[k]} onChange={set(k)} maxLength={k === 'body' || (kind === 'job' && k === 'notes') ? 20000 : 4000} />
              : <input className="input" type={type === 'date' ? 'date' : 'text'} value={vals[k]} onChange={set(k)} list={type === 'category' ? 'kb-cats' : undefined} maxLength={300} />}
            {hint && <span className="kb-hint">{hint}</span>}
          </label>
        ))}
        <datalist id="kb-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        {error && <Alert tone="critical">{error}</Alert>}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </div>
      </form>
    </Dialog>
  )
}

// ── Import ────────────────────────────────────────────────────────────────────────────────────────

const WHAT = {
  part: ['Parts list', 'Part number, name, other names, models it fits, notes, diagram. One row a part; a part number already here is replaced.'],
  device: ['Asset list', 'A customer’s device list: site or ward, model, serial, software version, and any other columns (SpO2 type, WiFi, …), which become searchable and countable.'],
  job: ['Past jobs', 'From a Simpro export: job number, title, notes, models, parts used, site, date. A job number already here is replaced.'],
}

/** A workbook's sheets (or a CSV's one) as arrays of rows. Sheets with no recognisable heading row are left out. */
async function readFile(file, kind) {
  if (/\.csv$/i.test(file.name)) return [{ name: '', rows: parseCsv(await file.text()) }]
  const { default: ExcelJS } = await import('exceljs')
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await file.arrayBuffer())
  const sheets = []
  wb.eachSheet((ws) => {
    if (kind === 'device' && /retired|sold|disposed/i.test(ws.name)) return // retired assets are not installed
    const rows = []
    ws.eachRow({ includeEmpty: false }, (row) => rows.push(Array.from(row.values).slice(1).map(cell)))
    sheets.push({ name: ws.name, rows })
  })
  return sheets
}

export function ImportDialog({ by, onClose, onDone }) {
  const [kind, setKind] = useState('part')
  const [parsed, setParsed] = useState(null) // { records, skipped, sheets, left, fileName }
  const [site, setSite] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  async function parse(f, k, siteName) {
    setBusy(true); setError(''); setParsed(null)
    try {
      const base = siteName ?? (f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').replace(/\b(asset|assets|list|register|equipment)\b/gi, '').replace(/\s+/g, ' ').trim() || f.name)
      if (siteName == null) setSite(base)
      const sheets = await readFile(f, k)
      const records = []
      let skipped = 0, left = 0
      for (const s of sheets) {
        if (findHeaderRow(k, s.rows) < 0) { left++; continue }
        const r = rowsToRecords(k, s.rows, k === 'device' ? { site: base, extra: s.name ? { Sheet: s.name } : {} } : {})
        records.push(...r.records); skipped += r.skipped
      }
      if (!records.length) setError(sheets.length > 1 || left ? 'No sheet had a heading row I recognise for this kind of list. ' + (rowsToRecords(k, sheets[0]?.rows || []).error || '') : (rowsToRecords(k, sheets[0]?.rows || []).error || 'Nothing to import in that file.'))
      setParsed({ records, skipped, left })
    } catch (e) {
      console.error(e)
      setError('Could not read that file. Use an .xlsx or .csv.')
    } finally { setBusy(false) }
  }

  const pick = (e) => { const f = e.target.files?.[0]; if (f) { setFile(f); parse(f, kind) } }
  const changeKind = (k) => { setKind(k); setParsed(null); setError(''); if (file) parse(file, k) }

  async function run() {
    setBusy(true); setError('')
    try {
      const n = await importRecords(kind, parsed.records, by)
      onDone(`Imported ${n} ${n === 1 ? 'entry' : KINDS[kind].label.toLowerCase()}.`)
    } catch (e) {
      console.error(e)
      setError(e.code === 'permission-denied' ? 'You can’t change the knowledge base. An admin can give you the editor switch in Settings → People and access.' : 'The import stopped part-way: ' + (e.message || e) + '. Importing the same file again is safe: each entry replaces itself.')
      setBusy(false)
    }
  }

  const sample = parsed?.records.slice(0, 4) || []
  const columns = kind === 'device' ? [...new Set(parsed?.records.flatMap((r) => Object.keys(r.extra || {})) || [])] : []

  return (
    <Dialog title="Import" description="From an Excel (.xlsx) or CSV file. Nothing is written until you press Import." onClose={onClose} width={680}>
      <div className="kb-form">
        <div className="kb-kinds" role="radiogroup" aria-label="What the file holds">
          {Object.entries(WHAT).map(([k, [label]]) => (
            <label key={k} className={`kb-kind${kind === k ? ' on' : ''}`}><input type="radio" name="kb-kind" checked={kind === k} onChange={() => changeKind(k)} />{label}</label>
          ))}
        </div>
        <p className="kb-hint">{WHAT[kind][1]} Articles are added one at a time, with Add article.</p>
        <label className="field">
          <span className="field-label">File</span>
          <input ref={input} type="file" accept=".xlsx,.csv" onChange={pick} disabled={busy} />
        </label>
        {kind === 'device' && file && (
          <label className="field">
            <span className="field-label">Site or customer</span>
            <input className="input" value={site} onChange={(e) => setSite(e.target.value)} onBlur={() => file && parse(file, kind, site)} />
            <span className="kb-hint">Used for rows with no Site column. Taken from the file’s name; change it if it isn’t right.</span>
          </label>
        )}
        {busy && !parsed && <p className="kb-hint">Reading the file…</p>}
        {error && <Alert tone="critical">{error}</Alert>}
        {parsed && parsed.records.length > 0 && (
          <div className="kb-preview">
            <p><b>{parsed.records.length}</b> ready to import{parsed.skipped ? `, ${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} with nothing usable skipped` : ''}{parsed.left ? `, ${parsed.left} sheet${parsed.left === 1 ? '' : 's'} with no heading row left out` : ''}.</p>
            {columns.length > 0 && <p className="kb-hint">Other columns kept and searchable: {columns.slice(0, 12).join(', ')}{columns.length > 12 ? ` and ${columns.length - 12} more` : ''}.</p>}
            <ul className="kb-sample">
              {sample.map((r, i) => <li key={i}>{kind === 'part' ? `${r.partNo} · ${r.name}` : kind === 'job' ? `${r.jobNo} · ${r.title}` : `${r.model || r.serial} · ${r.site} · ${r.dept}`}</li>)}
            </ul>
          </div>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || !parsed?.records.length}>{busy && parsed ? 'Importing…' : parsed?.records.length ? `Import ${parsed.records.length}` : 'Import'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
