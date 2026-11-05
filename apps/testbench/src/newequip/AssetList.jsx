/* The customer's asset list on the new-equipment page: loaded straight from its stored link (Microsoft Graph, as the signed-in person,
   graph.js) or from a file chosen on this PC, then shown as one row per unit with what is known of it: its shared bench test and the
   report saved on this PC. READ ONLY: nothing is written to the workbook, to Simpro or anywhere else. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileSpreadsheet, RefreshCw } from 'lucide-react'
import { Alert, Badge, Button } from '../../../../shared/ui/index.jsx'
import { logActivity } from '../../../../shared/activity.js'
import { groupReports, idbReports } from '../reports.js'
import { watchTests } from '../bench-tests-firebase.js'
import { benchByUnit, duplicateSerials, filterUnits, readAssetList, reportsByUnit, summary } from './assetlist.js'
import { fetchWorkbook, GraphError } from './graph.js'
import { forgetGraphToken, graphToken } from './graph-auth.js'

const SHOWN = 150
const nz = (iso) => { const t = Date.parse(iso || ''); return t ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', timeZone: 'Pacific/Auckland' }).format(new Date(t)) : '' }
const nzFull = (iso) => { const t = Date.parse(iso || ''); return t ? new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Pacific/Auckland' }).format(new Date(t)) : '' }

export default function AssetList({ customer, listHref, user }) {
  const [state, setState] = useState('idle') // idle | loading | ready
  const [error, setError] = useState('')
  const [book, setBook] = useState(null) // { units, sheets, skipped, name, modified, via }
  const [text, setText] = useState('')
  const [sheet, setSheet] = useState('')
  const [all, setAll] = useState(false)
  const [tests, setTests] = useState({ list: [], ok: null }) // shared bench tests; ok null = not heard yet
  const [groups, setGroups] = useState([])
  const file = useRef(null)

  // A different customer: start again.
  useEffect(() => { setState('idle'); setError(''); setBook(null); setText(''); setSheet(''); setAll(false) }, [customer?.id])

  // What the bench has shared (Firestore) and what this PC has saved (IndexedDB): for the Bench and Report columns.
  useEffect(() => {
    if (!user) return undefined
    return watchTests((list) => setTests({ list, ok: true }), () => setTests({ list: [], ok: false }))
  }, [user])
  useEffect(() => {
    let live = true
    try { idbReports().all().then((r) => { if (live) setGroups(groupReports(r)) }).catch(() => {}) } catch { /* storage blocked: no saved reports to show */ }
    return () => { live = false }
  }, [customer?.id, book])

  const take = useCallback(async (buffer, name, modified, via) => {
    const got = await readAssetList(buffer, name)
    if (!got.units.length) throw new GraphError('notbook', got.sheets.length || got.skipped.length ? 'No sheet in that workbook has a Serial Number column with devices in it.' : 'That workbook has no sheets.')
    setBook({ ...got, name, modified, via })
    setState('ready'); setError('')
    logActivity(null, `Loaded an asset list (${got.units.length} units, ${got.sheets.length} sheet${got.sheets.length === 1 ? '' : 's'}, ${via})`, { app: 'new-equipment' })
  }, [])

  const fail = (e) => { setState(book ? 'ready' : 'idle'); if (e?.code === 'token' || e?.code === 'denied') forgetGraphToken(); setError(e?.message || 'Couldn’t read that file.') }

  const loadLink = async () => {
    setState('loading'); setError('')
    try {
      const w = await fetchWorkbook(listHref, () => graphToken())
      await take(w.buffer, w.name, w.modified, 'from the stored link')
    } catch (e) { fail(e) }
  }
  const loadFile = async (f) => {
    if (!f) return
    setState('loading'); setError('')
    try { await take(await f.arrayBuffer(), f.name, f.lastModified ? new Date(f.lastModified).toISOString() : '', 'from a file') } catch (e) { fail(e) } finally { if (file.current) file.current.value = '' }
  }

  const units = book?.units || []
  const bench = useMemo(() => benchByUnit(units, tests.list), [units, tests.list])
  const reports = useMemo(() => reportsByUnit(units, groups), [units, groups])
  const counts = useMemo(() => summary(units, bench, reports), [units, bench, reports])
  const dup = useMemo(() => duplicateSerials(units), [units])
  const rows = useMemo(() => filterUnits(units, { text, sheet }), [units, text, sheet])
  const shownRows = all ? rows : rows.slice(0, SHOWN)
  const loading = state === 'loading'

  return (
    <section className="card ne-card" aria-label="Asset list">
      <div className="ne-row">
        <div className="ne-grow">
          <h2 className="ne-h2">Asset list</h2>
          <p className="ne-note">{book
            ? <>{book.name}{book.modified ? `, saved ${nzFull(book.modified)}` : ''}: {units.length} unit{units.length === 1 ? '' : 's'} on {book.sheets.length} sheet{book.sheets.length === 1 ? '' : 's'}, read {book.via}.</>
            : 'Read from the customer’s stored link, as you. Nothing is written to the workbook.'}</p>
        </div>
        <div className="ne-links">
          {listHref && <Button iconLeft={book ? <RefreshCw size={15} aria-hidden="true" /> : <FileSpreadsheet size={15} aria-hidden="true" />} disabled={loading} onClick={loadLink}>{loading ? 'Reading…' : book?.via === 'from the stored link' ? 'Reload from the link' : 'Load from the stored link'}</Button>}
          <Button variant="secondary" disabled={loading} onClick={() => file.current?.click()}>Choose a file…</Button>
          <input ref={file} type="file" accept=".xlsx,.xlsm" hidden onChange={(e) => loadFile(e.target.files?.[0])} />
        </div>
      </div>
      {!listHref && !book && <p className="ne-note">This customer has no asset list link yet, so choose a file, or add the link with Edit links.</p>}
      {error && <Alert tone="warning" title="The asset list wasn’t loaded">{error}</Alert>}

      {book && (
        <>
          <div className="ne-tiles">
            <Tile n={counts.units} label="units" />
            <Tile n={tests.ok === false ? '–' : counts.tested} label={tests.ok === false ? 'bench tests (not available to you)' : `of ${counts.units} bench tested`} />
            <Tile n={tests.ok === false ? '–' : `${counts.passed} / ${counts.failed}`} label="passed / failed" />
            <Tile n={counts.saved} label="reports saved on this PC" />
          </div>
          {book.skipped.length > 0 && <p className="ne-note">Skipped, with no Serial Number column: {book.skipped.join(', ')}.</p>}
          {dup.length > 0 && <Alert tone="warning" title={`${dup.length} serial number${dup.length === 1 ? '' : 's'} appear more than once`}>{dup.slice(0, 5).join(', ')}{dup.length > 5 ? '…' : ''}. Each row is shown, and tests and reports are matched by serial number.</Alert>}

          <div className="ne-filters">
            <label className="field ne-grow"><span className="field-label">Find a unit</span>
              <input className="input" type="search" value={text} onChange={(e) => { setText(e.target.value); setAll(false) }} placeholder="Serial, model, asset number, ward…" autoComplete="off" /></label>
            {book.sheets.length > 1 && (
              <label className="field"><span className="field-label">Sheet</span>
                <select className="input" value={sheet} onChange={(e) => { setSheet(e.target.value); setAll(false) }}>
                  <option value="">All sheets</option>
                  {book.sheets.map((s) => <option key={s.name} value={s.name}>{s.name} ({s.count})</option>)}
                </select></label>
            )}
          </div>

          <div className="ne-table-wrap">
            <table className="ne-table">
              <thead><tr>
                <th scope="col">Serial number</th><th scope="col">Device</th><th scope="col">CHS asset no.</th><th scope="col">Ward</th>
                {book.sheets.length > 1 && <th scope="col">Sheet</th>}<th scope="col">Bench test</th><th scope="col">Report on this PC</th>
              </tr></thead>
              <tbody>
                {shownRows.map((u, i) => <Row key={`${u.sheet}-${u.row}-${i}`} u={u} b={bench.get(u.key)} r={reports.get(u.key)} benchOk={tests.ok} sheets={book.sheets.length > 1} />)}
                {rows.length === 0 && <tr><td colSpan={7} className="ne-none-row">No unit matches that search.</td></tr>}
              </tbody>
            </table>
          </div>
          {rows.length > SHOWN && !all && <div><Button variant="secondary" onClick={() => setAll(true)}>Show all {rows.length}</Button></div>}
        </>
      )}
    </section>
  )
}

const Tile = ({ n, label }) => <div className="ne-tile"><strong>{n}</strong><span>{label}</span></div>

function Row({ u, b, r, benchOk, sheets }) {
  const bench = b
    ? <Badge tone={b.overall === 'pass' ? 'green' : b.overall === 'fail' ? 'red' : 'orange'}>{b.overall === 'pass' ? 'Pass' : b.overall === 'fail' ? 'Fail' : 'Incomplete'}{nz(b.finished) ? ` ${nz(b.finished)}` : ''}</Badge>
    : <Badge tone="grey">{benchOk === false ? 'Not available' : 'Not tested'}</Badge>
  const report = !r ? <Badge tone="grey">None</Badge>
    : r.unsent ? <Badge tone="orange">Saved, not sent</Badge>
    : <Badge tone="green">{r.sentTo.length ? `Sent to job ${r.sentTo[0]}` : 'Saved'}</Badge>
  return (
    <tr>
      <td className="ne-mono">{u.serial}</td>
      <td>{[u.model || u.description, u.type && u.model ? u.type : ''].filter(Boolean).join(' · ') || '–'}</td>
      <td className="ne-mono">{u.asset || '–'}</td>
      <td>{u.ward || '–'}</td>
      {sheets && <td>{u.sheet}</td>}
      <td>{bench}</td>
      <td>{report}</td>
    </tr>
  )
}
