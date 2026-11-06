/* Adding and changing entries, and importing lists. Only drawn for admins and editors; the rules are what really decide. */
import { useRef, useState } from 'react'
import { Alert, Button, Dialog } from '../../../shared/ui/index.jsx'
import { buildRecord, cell, findHeaderRow, KINDS, rowsToRecords, parseCsv } from './model.js'
import { articlesFromDocx, buildArticles, readDocx } from './docx.js'
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
  article: ['Word guides', 'Word (.docx) how-to guides, as many as you like at once: one article each, with its text, bold, numbered steps and tables. Pictures stay in the Word file; “[Picture]” marks where each was. The same file again replaces its article.'],
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

/** Word guides: each file into its article(s). A file that can't be read is listed with why, and the rest carry on. */
async function readGuides(files, progress) {
  const articles = [], problems = []
  const seen = new Set()
  let pictures = 0
  for (const [i, f] of files.entries()) {
    progress(`Reading ${i + 1} of ${files.length}…`)
    if (!/\.docx$/i.test(f.name)) { problems.push([f.name, /\.doc$/i.test(f.name) ? 'An old .doc: open it in Word and Save As .docx.' : /\.pdf$/i.test(f.name) ? 'PDFs can’t be read yet.' : 'Not a Word .docx.']); continue }
    try {
      const r = articlesFromDocx(await readDocx(f), f.name)
      if (r.problem) { problems.push([f.name, r.problem]); continue }
      if (r.articles.some((a) => seen.has(a.id))) { problems.push([f.name, 'Has the same title as another file in this list.']); continue }
      r.articles.forEach((a) => seen.add(a.id))
      articles.push(...r.articles); pictures += r.pictures
    } catch (e) {
      console.error(e)
      problems.push([f.name, 'Could not read it as a Word document.'])
    }
  }
  return { articles, problems, pictures }
}

export function ImportDialog({ by, categories = [], existing = new Set(), onClose, onDone }) {
  const [kind, setKind] = useState('article')
  const [parsed, setParsed] = useState(null) // { records, skipped, left, problems?, pictures? }
  const [site, setSite] = useState('')
  const [category, setCategory] = useState('')
  const [where, setWhere] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const input = useRef(null)
  const file = files[0]

  async function parse(fs, k, siteName) {
    const f = fs[0]
    setBusy(true); setError(''); setParsed(null)
    if (k === 'article') {
      try {
        const r = await readGuides(fs, setProgress)
        if (!r.articles.length) setError('Nothing in those files could be made into an article.')
        setParsed({ records: r.articles, skipped: 0, left: 0, problems: r.problems, pictures: r.pictures })
      } finally { setBusy(false); setProgress('') }
      return
    }
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

  const pick = (e) => { const fs = [...(e.target.files || [])]; if (fs.length) { setFiles(fs); parse(fs, kind) } }
  const changeKind = (k) => {
    setKind(k); setParsed(null); setError('')
    if ((k === 'article') !== (kind === 'article')) { setFiles([]); if (input.current) input.current.value = '' } // Word files and spreadsheets don't mix
    else if (files.length) parse(files, k)
  }

  async function run() {
    if (kind === 'article' && where.trim() && !/^https?:\/\/\S+$/i.test(where.trim())) return setError('The link to the originals must start with https://')
    setBusy(true); setError('')
    try {
      const guides = kind === 'article'
      const records = guides ? buildArticles(parsed.records, { category, where: where.trim() }) : parsed.records
      const n = await importRecords(kind, records, by, guides ? parsed.records.map((a) => a.id) : [])
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
    <Dialog title="Import" description="From Word (.docx), Excel (.xlsx) or CSV files. Nothing is written until you press Import." onClose={onClose} width={680}>
      <div className="kb-form">
        <div className="kb-kinds" role="radiogroup" aria-label="What the file holds">
          {Object.entries(WHAT).map(([k, [label]]) => (
            <label key={k} className={`kb-kind${kind === k ? ' on' : ''}`}><input type="radio" name="kb-kind" checked={kind === k} onChange={() => changeKind(k)} />{label}</label>
          ))}
        </div>
        <p className="kb-hint">{WHAT[kind][1]}{kind === 'article' ? ' To write one yourself, use Add article.' : ' Articles are written one at a time with Add article, or imported from Word files.'}</p>
        <label className="field">
          <span className="field-label">{kind === 'article' ? 'Word files' : 'File'}</span>
          <input ref={input} type="file" accept={kind === 'article' ? '.docx' : '.xlsx,.csv'} multiple={kind === 'article'} onChange={pick} disabled={busy} />
        </label>
        {kind === 'device' && file && (
          <label className="field">
            <span className="field-label">Site or customer</span>
            <input className="input" value={site} onChange={(e) => setSite(e.target.value)} onBlur={() => parse(files, kind, site)} />
            <span className="kb-hint">Used for rows with no Site column. Taken from the file’s name; change it if it isn’t right.</span>
          </label>
        )}
        {kind === 'article' && parsed?.records.length > 0 && (<>
          <label className="field">
            <span className="field-label">Category (optional)</span>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} list="kb-import-cats" maxLength={80} placeholder="e.g. Mindray" />
            <datalist id="kb-import-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <span className="kb-hint">Put on every article in this import, so they can be found together.</span>
          </label>
          <label className="field">
            <span className="field-label">Link to where the Word files are kept (optional)</span>
            <input className="input" type="url" value={where} onChange={(e) => setWhere(e.target.value)} maxLength={300} placeholder="https://… the SharePoint folder" />
            <span className="kb-hint">Added to each article, so a reader can open the original for its pictures.</span>
          </label>
        </>)}
        {busy && !parsed && <p className="kb-hint">{progress || 'Reading the file…'}</p>}
        {error && <Alert tone="critical">{error}</Alert>}
        {parsed && parsed.records.length > 0 && (
          <div className="kb-preview">
            {kind === 'article' ? (<>
              <p><b>{parsed.records.length}</b> article{parsed.records.length === 1 ? '' : 's'} ready to import{parsed.records.filter((a) => existing.has(a.id)).length ? `; ${parsed.records.filter((a) => existing.has(a.id)).length} already here from the same file will be replaced` : ''}.</p>
              {parsed.pictures > 0 && <p className="kb-hint">{parsed.pictures} picture{parsed.pictures === 1 ? '' : 's'} in the Word files are not copied.</p>}
              <ul className="kb-sample">
                {parsed.records.slice(0, 6).map((a) => <li key={a.id}>{a.title}</li>)}
                {parsed.records.length > 6 && <li>and {parsed.records.length - 6} more</li>}
              </ul>
            </>) : (<>
              <p><b>{parsed.records.length}</b> ready to import{parsed.skipped ? `, ${parsed.skipped} row${parsed.skipped === 1 ? '' : 's'} with nothing usable skipped` : ''}{parsed.left ? `, ${parsed.left} sheet${parsed.left === 1 ? '' : 's'} with no heading row left out` : ''}.</p>
              {columns.length > 0 && <p className="kb-hint">Other columns kept and searchable: {columns.slice(0, 12).join(', ')}{columns.length > 12 ? ` and ${columns.length - 12} more` : ''}.</p>}
              <ul className="kb-sample">
                {sample.map((r, i) => <li key={i}>{kind === 'part' ? `${r.partNo} · ${r.name}` : kind === 'job' ? `${r.jobNo} · ${r.title}` : `${r.model || r.serial} · ${r.site} · ${r.dept}`}</li>)}
              </ul>
            </>)}
          </div>
        )}
        {parsed?.problems?.length > 0 && (
          <Alert tone="warning" title={`${parsed.problems.length} file${parsed.problems.length === 1 ? '' : 's'} left out`}>
            <ul className="kb-sample">{parsed.problems.map(([name, why]) => <li key={name}>{name}: {why}</li>)}</ul>
          </Alert>
        )}
        <div className="dialog-actions">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={run} disabled={busy || !parsed?.records.length}>{busy && parsed ? 'Importing…' : parsed?.records.length ? `Import ${parsed.records.length}` : 'Import'}</Button>
        </div>
      </div>
    </Dialog>
  )
}
