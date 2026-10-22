/* The on-call roster under Service: who was (and is) on call each week, by year, from the Service
   team's old workbook (2017 to now), with weeks per person and the public holidays and notes
   (swaps, allowance submitted) from its sheets. Everyone signed in reads it; an admin imports the
   workbook (Import from Excel), edits a week, adds the next one and manages the people. The
   current year opens at this week, with the weeks that have passed a click away. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, Pencil, Plus, Users } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Dialog, Loading, Toast, useToast } from '../../../shared/ui/index.jsx'
import { loadHistory, saveImport, savePeople, saveWeek } from './store.js'
import { parseWorkbook, sheetsFromExcelJS } from './parse.js'
import { byYear, personOf, tally } from './roster.js'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAY = 86400000
const day = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : iso || '' }
const range = (a, b) => `${day(a)} – ${day(b)}`
/** A holiday entry as written, or a bare date as "19 Jan". */
const holiday = h => (/^\d{4}-\d{2}-\d{2}$/.test(h) ? day(h) : h)
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })
const plusDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10)

export default function App() {
  return (
    <AuthProvider>
      <Roster />
    </AuthProvider>
  )
}

function Roster() {
  const { user, profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const by = profile?.displayName || user?.email || ''
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [year, setYear] = useState(null)
  const [q, setQ] = useState('')
  const [showPast, setShowPast] = useState(false)
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState(null) // a week (existing, or new with isNew)
  const [managing, setManaging] = useState(false)
  const [toastMsg, toast] = useToast()

  const reload = () => loadHistory().then(setData).catch(e => setError(e.code === 'permission-denied'
    ? 'Firestore refused to read the on-call roster. Its security rule may not be published yet.'
    : 'Could not load the roster: ' + (e.message || e)))
  useEffect(() => { if (user) reload() }, [user])

  const years = useMemo(() => (data ? byYear(data.sheets) : []), [data])
  const today = todayISO()
  const thisYear = Number(today.slice(0, 4))
  const current = year ?? (years.find(y => y.year === thisYear) || years[0])?.year
  const shown = years.find(y => y.year === current)
  const people = useMemo(() => (shown ? tally(shown.weeks) : []), [shown])
  const names = useMemo(() => {
    const listed = (data?.engineers || []).map(personOf).filter(Boolean)
    return [...new Set([...listed, ...years.flatMap(y => y.weeks.map(w => personOf(w.engineer)))].filter(Boolean))]
  }, [data, years])

  // This year opens at this week; earlier years show everything.
  const hidePast = !!shown && shown.year === thisYear && !showPast
  const upcoming = (shown?.weeks || []).filter(w => !hidePast || w.end >= today)
  const hiddenCount = (shown?.weeks.length || 0) - upcoming.length
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const rows = upcoming.filter(w => {
    const hay = [w.engineer, w.notes, w.holidays, w.month, w.week].join(' ').toLowerCase()
    return words.every(x => hay.includes(x))
  })

  const sheetOf = w => data.sheets.find(s => s.name === w.source)
  async function saveEdit(week, patch) {
    const sheet = sheetOf(week)
    const { source, isNew, ...clean } = { ...week, ...patch }
    await saveWeek(sheet, week.start, clean, by)
    toast(isNew ? 'Week added.' : 'Saved.')
    setEditing(null); reload()
  }
  function nextWeek() {
    const last = shown.weeks.at(-1)
    const start = plusDays(last.start, 7)
    const num = Number(last.week) || shown.weeks.length
    setEditing({ month: MONTHS[new Date(Date.parse(start) + 3 * DAY).getUTCMonth()], week: String(num + 1), start, end: plusDays(start, 6), engineer: '', holidays: '', school: '', notes: '', source: last.source, isNew: true })
  }

  return (
    <div className="oc-page">
      <div className="oc-head">
        <div>
          <h1 className="oc-title">On-call roster</h1>
          <p className="oc-sub">One engineer on call per week, from the Service team’s roster (2017 onwards). Who is on call now is set in Schedule → On call.</p>
        </div>
        {isAdmin && (
          <div className="oc-head-actions">
            <Button variant="secondary" iconLeft={<Users size={16} />} onClick={() => setManaging(true)}>People</Button>
            <Button variant="secondary" iconLeft={<FileSpreadsheet size={16} />} onClick={() => setImporting(true)}>Import from Excel</Button>
          </div>
        )}
      </div>

      {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
      {!data && !error && <Loading />}

      {data && years.length === 0 && (
        <Alert tone="info" title="Nothing here yet">
          {isAdmin ? 'Use Import from Excel to load the on-call roster workbook (every year at once).' : 'An admin needs to import the on-call roster workbook.'}
        </Alert>
      )}

      {years.length > 0 && (
        <>
          <div className="oc-years" role="tablist" aria-label="Year">
            {years.map(y => (
              <button key={y.year} type="button" role="tab" aria-selected={y.year === current} className={`oc-year${y.year === current ? ' on' : ''}`} onClick={() => setYear(y.year)}>{y.year}</button>
            ))}
          </div>

          {shown && (
            <>
              <div className="oc-people" role="group" aria-label={`Filter ${shown.year} by person`}>
                <span className="oc-filter-label">Filter</span>
                {people.map(p => (
                  <button key={p.name} type="button" title={`${p.weeks} weeks in ${shown.year}`} className={`oc-person${words.includes(p.name.toLowerCase()) ? ' on' : ''}`} onClick={() => setQ(q.toLowerCase() === p.name.toLowerCase() ? '' : p.name)}>
                    <b>{p.weeks}</b><span>{p.name}</span>
                  </button>
                ))}
                <input className="input oc-search" placeholder="Name, swap, holiday…" aria-label="Filter this year" value={q} onChange={e => setQ(e.target.value)} />
                {q && <Button variant="ghost" size="sm" onClick={() => setQ('')}>Clear filter</Button>}
              </div>

              {shown.year === thisYear && (hiddenCount > 0 || showPast) && (
                <div className="oc-past">
                  <Button variant="ghost" size="sm" onClick={() => setShowPast(!showPast)}>{showPast ? 'Hide past weeks' : `Show ${hiddenCount} past ${hiddenCount === 1 ? 'week' : 'weeks'}`}</Button>
                  {!showPast && <span className="caption">Showing this week onwards.</span>}
                </div>
              )}

              <div className="oc-tablewrap">
                <table className="oc-table">
                  <thead><tr><th>Week</th><th>Dates</th><th>On call</th><th>Public holidays</th><th>Notes</th>{isAdmin && <th aria-label="Edit" />}</tr></thead>
                  <tbody>
                    {rows.map(w => {
                      const now = today >= w.start && today <= w.end
                      return (
                        <tr key={w.start} className={now ? 'now' : ''}>
                          <td className="oc-wk"><b>{w.week}</b><span>{w.month}</span></td>
                          <td className="oc-dates">{range(w.start, w.end)}{now && <Badge tone="purple">This week</Badge>}</td>
                          <td className="oc-eng">{w.engineer || <span className="oc-none">Not set</span>}</td>
                          <td>{holiday(w.holidays)}{w.school && <span className="oc-school">School holidays: {w.school}</span>}</td>
                          <td>{w.notes}</td>
                          {isAdmin && <td className="oc-edit"><button type="button" className="icon-btn" aria-label={`Edit week ${w.week}, ${range(w.start, w.end)}`} onClick={() => setEditing(w)}><Pencil size={15} /></button></td>}
                        </tr>
                      )
                    })}
                    {rows.length === 0 && <tr><td colSpan={isAdmin ? 6 : 5} className="oc-empty">{words.length ? 'No weeks match that filter.' : 'No weeks to show.'}</td></tr>}
                  </tbody>
                </table>
              </div>
              {isAdmin && <div><Button variant="ghost" size="sm" iconLeft={<Plus size={14} />} onClick={nextWeek}>Add the next week</Button></div>}
              {shown.extras.length > 0 && <p className="oc-extras">Also on the {shown.year} sheet: {shown.extras.join(' · ')}</p>}
              <p className="oc-foot">{shown.weeks.length} weeks{shown.sources.length > 1 || shown.sources[0] !== String(shown.year) ? ` · from the ${shown.sources.join(', ')} sheet${shown.sources.length > 1 ? 's' : ''}` : ''}{data.importedAt ? ` · imported ${new Date(data.importedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}${data.importedBy ? ' by ' + data.importedBy : ''}` : ''}</p>
            </>
          )}
        </>
      )}

      {importing && <ImportDialog by={by} onClose={done => { setImporting(false); if (done) { toast(done); reload() } }} />}
      {editing && <EditWeek week={editing} names={names} onSave={saveEdit} onClose={() => setEditing(null)} />}
      {managing && <PeopleDialog names={names} sheets={data.sheets} by={by} onClose={done => { setManaging(false); if (done) { toast(done); reload() } }} />}
      <Toast message={toastMsg} />
    </div>
  )
}

/** One week: who is on call, the public holidays and the notes. Clearing the engineer leaves the week unset. */
function EditWeek({ week, names, onSave, onClose }) {
  const [engineer, setEngineer] = useState(week.engineer)
  const [holidays, setHolidays] = useState(/^\d{4}-\d{2}-\d{2}$/.test(week.holidays) ? day(week.holidays) : week.holidays)
  const [notes, setNotes] = useState(week.notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function go(patch) {
    setBusy(true); setError('')
    try { await onSave(week, patch) }
    catch (e) { setError(e.code === 'permission-denied' ? 'Not saved: only an admin can change the roster.' : 'Not saved: ' + (e.message || e)); setBusy(false) }
  }
  return (
    <Dialog title={`${week.isNew ? 'Add' : 'Edit'} week ${week.week}`} description={range(week.start, week.end) + ' ' + week.start.slice(0, 4)} onClose={() => !busy && onClose()}>
      <div className="oc-form">
        <label className="field"><span className="field-label">On call</span>
          <input className="input" list="oc-names" value={engineer} onChange={e => setEngineer(e.target.value)} autoFocus />
          <datalist id="oc-names">{names.map(n => <option key={n} value={n} />)}</datalist>
        </label>
        <label className="field"><span className="field-label">Public holidays</span><input className="input" value={holidays} onChange={e => setHolidays(e.target.value)} /></label>
        <label className="field"><span className="field-label">Notes (swaps, allowance submitted…)</span><textarea className="input" rows={2} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
      </div>
      <div className="dialog-actions">
        {week.engineer && !week.isNew && <Button variant="ghost" disabled={busy} onClick={() => go({ engineer: '' })}>Remove {personOf(week.engineer) || 'engineer'}</Button>}
        <span className="oc-spacer" />
        <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button disabled={busy} onClick={() => go({ engineer: engineer.trim(), holidays: holidays.trim(), notes: notes.trim() })}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Dialog>
  )
}

/** Add, rename and remove the engineers. A rename changes them wherever they're on call; removing only takes them off the list (past weeks keep their name). */
function PeopleDialog({ names, sheets, by, onClose }) {
  const [rows, setRows] = useState(() => names.map(n => ({ orig: n, name: n })))
  const [added, setAdded] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const add = e => {
    e.preventDefault()
    const n = added.trim()
    if (!n) return
    if (rows.some(r => r.name.toLowerCase() === n.toLowerCase())) { setError(`${n} is already on the list.`); return }
    setRows([...rows, { orig: '', name: n }]); setAdded(''); setError('')
  }
  async function save() {
    setBusy(true); setError('')
    try {
      const keep = rows.map(r => ({ ...r, name: r.name.trim() })).filter(r => r.name)
      const renames = keep.filter(r => r.orig && r.name !== r.orig).map(r => [r.orig, r.name])
      await savePeople(sheets, keep.map(r => r.name), renames, by)
      onClose('People saved.')
    } catch (e) { setError(e.code === 'permission-denied' ? 'Not saved: only an admin can change the roster.' : 'Not saved: ' + (e.message || e)); setBusy(false) }
  }
  return (
    <Dialog title="People on the roster" description="Rename someone to change them on every week they are on call. Removing takes them off the list; the weeks they covered keep their name." onClose={() => !busy && onClose('')}>
      <ul className="oc-people-list">
        {rows.map((r, i) => (
          <li key={i}>
            <input className="input" aria-label={`Name ${i + 1}`} value={r.name} onChange={e => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button type="button" className="icon-btn" aria-label={`Remove ${r.name || 'this person'}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
      </ul>
      <form className="oc-add" onSubmit={add}>
        <input className="input" placeholder="Add a person" aria-label="Add a person" value={added} onChange={e => setAdded(e.target.value)} />
        <Button type="submit" variant="secondary">Add</Button>
      </form>
      {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
      <div className="dialog-actions">
        <Button variant="secondary" disabled={busy} onClick={() => onClose('')}>Cancel</Button>
        <Button disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</Button>
      </div>
    </Dialog>
  )
}

/** Pick the workbook, check what it holds, then save it (every sheet at once). */
function ImportDialog({ by, onClose }) {
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const input = useRef(null)

  async function pick(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setBusy(true); setError(''); setParsed(null)
    try {
      const { default: ExcelJS } = await import('exceljs')
      const wb = new ExcelJS.Workbook()
      await wb.xlsx.load(await file.arrayBuffer())
      const out = parseWorkbook(sheetsFromExcelJS(wb))
      if (!out.sheets.length) throw new Error('No year sheets (2017, 2018 … 2026) found in that file.')
      setParsed(out)
    } catch (err) { setError(err.message || String(err)) } finally { setBusy(false) }
  }
  async function save() {
    setBusy(true); setError('')
    try { await saveImport(parsed, by); onClose(`Imported ${parsed.sheets.length} sheets.`) }
    catch (err) { setError(err.code === 'permission-denied' ? 'Not saved: the on-call history rule isn’t published in Firebase yet.' : 'Not saved: ' + (err.message || err)); setBusy(false) }
  }

  return (
    <Dialog title="Import the on-call roster" description="Choose the on-call roster workbook. Every year sheet is read at once, and re-importing replaces what was imported before, including any edits made here." onClose={() => !busy && onClose('')}>
      <div className="oc-import">
        <input ref={input} type="file" accept=".xlsx" onChange={pick} disabled={busy} />
        {error && <Alert tone="critical" title="Something didn’t work">{error}</Alert>}
        {parsed && (
          <table className="oc-table oc-import-table">
            <thead><tr><th>Sheet</th><th>Weeks</th><th>First</th><th>Last</th></tr></thead>
            <tbody>
              {parsed.sheets.map(s => (
                <tr key={s.name}><td>{s.name}</td><td>{s.weeks.length}</td><td>{day(s.weeks[0]?.start)} {s.weeks[0]?.start.slice(0, 4)}</td><td>{day(s.weeks.at(-1)?.end)} {s.weeks.at(-1)?.end.slice(0, 4)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="dialog-actions">
        <Button variant="ghost" disabled={busy} onClick={() => onClose('')}>Cancel</Button>
        <Button disabled={!parsed || busy} onClick={save}>{busy ? 'Working…' : 'Save'}</Button>
      </div>
    </Dialog>
  )
}
