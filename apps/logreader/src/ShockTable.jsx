/* The defibrillator's "Shock events" table: one row per saved shock, with the
   start-up, recorder and report times side by side so slow prints stand out.
   It states what the logs say; it does not decide what caused a delay. */
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Alert, Button } from '../../../shared/ui/index.jsx'
import { SHOCK_COLUMNS, shockTable } from './defib.js'
import { csvCell, parseLocalInput } from './lines.js'
import { download } from './download.js'

const STATUS = { ok: 'Printed', slow: 'Slow', none: 'No report logged' }

const secs = (v, sign = false) => v == null ? '—' : (sign && v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toLocaleString('en-NZ') + ' s'
const plain = (v) => v == null ? '—' : typeof v === 'number' ? v.toLocaleString('en-NZ') : v

function cell(r, key) {
  switch (key) {
    case 'sinceBoot': return secs(r.sinceBoot)
    case 'recorderRel': return secs(r.recorderRel, true)
    case 'delay': return secs(r.delay)
    case 'nextIn': return secs(r.nextIn)
    case 'status': return <span className={'lr-pill lr-pill-' + r.status}>{STATUS[r.status]}</span>
    case 'report': return r.report || '—'
    default: return plain(r[key])
  }
}

export function ShockTable({ backend, print, onShow }) {
  const [slow, setSlow] = useState(5)
  const [win, setWin] = useState(120)
  const [show, setShow] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const all = useMemo(() => shockTable(backend, print, { slowSecs: slow, windowSecs: win }), [backend, print, slow, win])
  const fromT = parseLocalInput(from), toT = parseLocalInput(to)
  const inRange = all.filter(r => (!Number.isFinite(fromT) || r.t >= fromT) && (!Number.isFinite(toT) || r.t <= toT))
  const rows = show === 'all' ? inRange : inRange.filter(r => r.status === show)
  const n = (s) => inRange.filter(r => r.status === s).length

  const exportCsv = () => {
    const out = [SHOCK_COLUMNS.map(c => csvCell(c.label)).join(',')]
    for (const r of rows) out.push(SHOCK_COLUMNS.map(c => csvCell(c.key === 'status' ? STATUS[r.status] : r[c.key])).join(','))
    download('shock-events.csv', out.join('\r\n') + '\r\n', 'text/csv')
  }

  return (
    <div className="lr-shocks">
      <div className="lr-bar">
        <label className="lr-field">From
          <input className="input" type="datetime-local" step="1" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="lr-field">To
          <input className="input" type="datetime-local" step="1" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <label className="lr-field">Slow after
          <input className="input lr-num" type="number" min="1" max="600" value={slow} onChange={e => setSlow(Math.max(1, +e.target.value || 1))} /> s
        </label>
        <label className="lr-field">Wait up to
          <input className="input lr-num" type="number" min="5" max="1800" value={win} onChange={e => setWin(Math.max(5, +e.target.value || 5))} /> s
        </label>
        <label className="lr-field">Show
          <select className="input" value={show} onChange={e => setShow(e.target.value)}>
            <option value="all">All shocks</option>
            <option value="slow">Slow only</option>
            <option value="none">No report logged</option>
            <option value="ok">Printed</option>
          </select>
        </label>
        <Button variant="secondary" size="sm" iconLeft={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
      </div>

      <div className="lr-summary">
        <b>{inRange.length.toLocaleString('en-NZ')}</b> shocks saved: <b>{n('ok')}</b> with a report within {slow} s, <b>{n('slow')}</b> slower,
        <b> {n('none')}</b> with no report logged within {win} s.
      </div>
      <Alert tone="info" className="lr-note">
        “No report logged” is only what the print log shows. It can be the second shock of a pair, printing turned off, or a real failure, so look at each one
        (click a row to open that moment in both logs). What the “power-off type” numbers mean is not known, so they are shown as logged.
      </Alert>

      <div className="lr-table-wrap">
        <table className="lr-table">
          <thead><tr>{SHOCK_COLUMNS.map(c => <th key={c.key} scope="col">{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.t} className={'lr-tr-' + r.status} tabIndex={0} onClick={() => onShow(r.line)} onKeyDown={e => { if (e.key === 'Enter') onShow(r.line) }} title="Open this moment in the logs">
                {SHOCK_COLUMNS.map(c => <td key={c.key}>{cell(r, c.key)}</td>)}
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={SHOCK_COLUMNS.length} className="lr-muted">No shocks to show.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
