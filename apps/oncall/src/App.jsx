/* The on-call roster under Service: who was (and is) on call each week, by year, from the Service
   team's old workbook (2017 to now), with weeks per person and the public holidays and notes
   (swaps, allowance submitted) from its sheets. Everyone signed in reads it; an admin imports the
   workbook (Import from Excel). Who is on call from now on is still set in Schedule → On call; this
   is the record. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { AuthProvider, useAuth } from '../../schedule/src/contexts/AuthContext'
import { Alert, Badge, Button, Dialog, Loading, Toast, useToast } from '../../../shared/ui/index.jsx'
import { loadHistory, saveImport } from './store.js'
import { parseWorkbook, sheetsFromExcelJS } from './parse.js'
import { byYear, personOf, tally } from './roster.js'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const day = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? `${Number(m[3])} ${MON[Number(m[2]) - 1]}` : iso || '' }
const range = (a, b) => `${day(a)} – ${day(b)}`
/** A holiday entry as written, or a bare date as "19 Jan". */
const holiday = h => (/^\d{4}-\d{2}-\d{2}$/.test(h) ? day(h) : h)
const todayISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })

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
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [year, setYear] = useState(null)
  const [q, setQ] = useState('')
  const [importing, setImporting] = useState(false)
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
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const rows = (shown?.weeks || []).filter(w => {
    const hay = [w.engineer, w.notes, w.holidays, w.month, w.week].join(' ').toLowerCase()
    return words.every(x => hay.includes(x))
  })

  return (
    <div className="oc-page">
      <div className="oc-head">
        <div>
          <h1 className="oc-title">On-call roster</h1>
          <p className="oc-sub">One engineer on call per week, from the Service team’s roster (2017 onwards). Who is on call now is set in Schedule → On call.</p>
        </div>
        {isAdmin && <Button variant="secondary" iconLeft={<FileSpreadsheet size={16} />} onClick={() => setImporting(true)}>Import from Excel</Button>}
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
              <div className="oc-people" aria-label={`Weeks on call in ${shown.year}`}>
                {people.map(p => (
                  <button key={p.name} type="button" className={`oc-person${words.includes(p.name.toLowerCase()) ? ' on' : ''}`} onClick={() => setQ(q.toLowerCase() === p.name.toLowerCase() ? '' : p.name)}>
                    <b>{p.weeks}</b><span>{p.name}</span>
                  </button>
                ))}
                <input className="input oc-search" placeholder="Search this year (name, swap, holiday…)" aria-label="Search this year" value={q} onChange={e => setQ(e.target.value)} />
              </div>

              <div className="oc-tablewrap">
                <table className="oc-table">
                  <thead><tr><th>Week</th><th>Dates</th><th>On call</th><th>Public holidays</th><th>Notes</th></tr></thead>
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
                        </tr>
                      )
                    })}
                    {rows.length === 0 && <tr><td colSpan={5} className="oc-empty">No weeks match that search.</td></tr>}
                  </tbody>
                </table>
              </div>
              {shown.extras.length > 0 && <p className="oc-extras">Also on the {shown.year} sheet: {shown.extras.join(' · ')}</p>}
              <p className="oc-foot">{shown.weeks.length} weeks{shown.sources.length > 1 || shown.sources[0] !== String(shown.year) ? ` · from the ${shown.sources.join(', ')} sheet${shown.sources.length > 1 ? 's' : ''}` : ''}{data.importedAt ? ` · imported ${new Date(data.importedAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })}${data.importedBy ? ' by ' + data.importedBy : ''}` : ''}</p>
              {data.engineers.length > 0 && <p className="oc-foot">Engineers on the roster: {data.engineers.map(personOf).join(', ')}.</p>}
            </>
          )}
        </>
      )}

      {importing && <ImportDialog by={profile?.displayName || user?.email || ''} onClose={done => { setImporting(false); if (done) { toast(done); reload() } }} />}
      <Toast message={toastMsg} />
    </div>
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
    <Dialog title="Import the on-call roster" description="Choose the on-call roster workbook. Every year sheet is read at once, and re-importing replaces what was imported before." onClose={() => !busy && onClose('')}>
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
