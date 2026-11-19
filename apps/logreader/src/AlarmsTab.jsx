/* The Alarms tab: every alarm the device recorded (from its BackendLog), with
   filters for priority (High is the red alarm), type (Technical or
   Physiological), name and time. Click a row to open that moment in the log. */
import { useMemo, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../../../shared/ui/index.jsx'
import { PRIORITIES, PRIORITY_LABEL, TYPES, alarmEvents, alarmSummary, filterEvents } from './alarms.js'
import { csvCell, fmtTime, parseLocalInput } from './lines.js'
import { download } from './download.js'

const STATUS = { cleared: 'Cleared', open: 'No end logged', noBegin: 'Start not in these logs' }
const dur = (s) => s == null ? '—' : s < 60 ? `${Math.round(s * 10) / 10} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`

export function AlarmsTab({ lines, onShow }) {
  const [priorities, setPriorities] = useState(() => new Set())
  const [types, setTypes] = useState(() => new Set())
  const [text, setText] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [view, setView] = useState('events')
  const [order, setOrder] = useState('old')

  const events = useMemo(() => alarmEvents(lines), [lines])
  const fromT = parseLocalInput(from), toT = parseLocalInput(to)
  const rows = useMemo(() => {
    const r = filterEvents(events, { priorities, types, text, from: fromT, to: toT })
    if (order === 'new') return [...r].reverse()
    if (order === 'long') return [...r].sort((a, b) => (b.secs ?? -1) - (a.secs ?? -1))
    return r
  }, [events, priorities, types, text, fromT, toT, order])
  const summary = useMemo(() => alarmSummary(rows), [rows])

  // How many of each, among the alarms passing the other filters (so the chips say what ticking them would show)
  const countBy = (key, values, ignore) => {
    const base = filterEvents(events, { priorities: ignore === 'priority' ? null : priorities, types: ignore === 'type' ? null : types, text, from: fromT, to: toT })
    return Object.fromEntries(values.map(v => [v, base.filter(e => e[key] === v).length]))
  }
  const pc = useMemo(() => countBy('priority', PRIORITIES, 'priority'), [events, types, text, fromT, toT]) // eslint-disable-line react-hooks/exhaustive-deps
  const tc = useMemo(() => countBy('type', TYPES, 'type'), [events, priorities, text, fromT, toT]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (set, setSet, v) => setSet(s => { const n = new Set(s); n.has(v) ? n.delete(v) : n.add(v); return n })
  const anyFilter = priorities.size || types.size || text || from || to

  const exportCsv = () => {
    const out = [view === 'events'
      ? 'Alarm,Priority,Type,Started,Ended,Seconds,Status'
      : 'Alarm,Priority,Type,Times,Longest (s),First,Last']
    if (view === 'events') for (const e of rows) out.push([e.name, e.priority, e.type, fmtTime(e.start), fmtTime(e.ended), e.secs, STATUS[e.status]].map(csvCell).join(','))
    else for (const s of summary) out.push([s.name, s.priority, s.type, s.count, s.longest, fmtTime(s.first), fmtTime(s.last)].map(csvCell).join(','))
    download(view === 'events' ? 'alarms.csv' : 'alarm-summary.csv', out.join('\r\n') + '\r\n', 'text/csv')
  }

  return (
    <div className="lr-shocks">
      <div className="lr-bar">
        <div className="lr-levels" role="group" aria-label="Priority">
          {PRIORITIES.map(p => (
            <button key={p} type="button" className={`lr-lv lr-pr-${p}` + (priorities.has(p) ? ' on' : '')} aria-pressed={priorities.has(p)} onClick={() => toggle(priorities, setPriorities, p)}>
              {PRIORITY_LABEL[p]} · {pc[p]}
            </button>
          ))}
        </div>
        <div className="lr-levels" role="group" aria-label="Type">
          {TYPES.map(t => (
            <button key={t} type="button" className={'lr-lv' + (types.has(t) ? ' on' : '')} aria-pressed={types.has(t)} onClick={() => toggle(types, setTypes, t)}>
              {t} · {tc[t]}
            </button>
          ))}
        </div>
      </div>
      <div className="lr-bar">
        <label className="lr-field">Alarm
          <input className="input" type="search" placeholder="Part of the name" value={text} onChange={e => setText(e.target.value)} aria-label="Alarm name" />
        </label>
        <label className="lr-field">From
          <input className="input" type="datetime-local" step="1" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="lr-field">To
          <input className="input" type="datetime-local" step="1" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <label className="lr-field">View
          <select className="input" value={view} onChange={e => setView(e.target.value)}>
            <option value="events">Every alarm</option>
            <option value="summary">Count by alarm</option>
          </select>
        </label>
        {view === 'events' && (
          <label className="lr-field">Order
            <select className="input" value={order} onChange={e => setOrder(e.target.value)}>
              <option value="old">Oldest first</option>
              <option value="new">Newest first</option>
              <option value="long">Longest first</option>
            </select>
          </label>
        )}
        {anyFilter ? <Button variant="ghost" size="sm" onClick={() => { setPriorities(new Set()); setTypes(new Set()); setText(''); setFrom(''); setTo('') }}>Clear filters</Button> : null}
        <Button variant="secondary" size="sm" iconLeft={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
      </div>

      <div className="lr-summary">
        <b>{rows.length.toLocaleString('en-NZ')}</b> of {events.length.toLocaleString('en-NZ')} alarms.
        {' '}<span className="lr-muted">Priority and type are as the device logs them; “red” and “yellow” are the usual names for High and Medium, not written in the log. “No end logged” means the log has no End line for it.</span>
      </div>

      <div className="lr-table-wrap">
        {view === 'events' ? (
          <table className="lr-table">
            <thead><tr><th>Alarm</th><th>Priority</th><th>Type</th><th>Started</th><th>Ended</th><th>Lasted</th><th>Result</th></tr></thead>
            <tbody>
              {rows.map((e, i) => (
                <tr key={i} tabIndex={0} onClick={() => onShow(e.line)} onKeyDown={ev => { if (ev.key === 'Enter') onShow(e.line) }} title="Open this moment in the log">
                  <td>{e.name}</td>
                  <td><span className={'lr-pill lr-prp-' + e.priority}>{PRIORITY_LABEL[e.priority] || e.priority}</span></td>
                  <td>{e.type}</td>
                  <td>{fmtTime(e.start)}</td>
                  <td>{e.ended ? fmtTime(e.ended) : '—'}</td>
                  <td>{dur(e.secs)}</td>
                  <td>{STATUS[e.status]}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="lr-muted">No alarms to show.</td></tr>}
            </tbody>
          </table>
        ) : (
          <table className="lr-table">
            <thead><tr><th>Alarm</th><th>Priority</th><th>Type</th><th>Times</th><th>Longest</th><th>First</th><th>Last</th></tr></thead>
            <tbody>
              {summary.map((s, i) => (
                <tr key={i} tabIndex={0} onClick={() => onShow(s.line)} onKeyDown={ev => { if (ev.key === 'Enter') onShow(s.line) }} title="Open the first one in the log">
                  <td>{s.name}</td>
                  <td><span className={'lr-pill lr-prp-' + s.priority}>{PRIORITY_LABEL[s.priority] || s.priority}</span></td>
                  <td>{s.type}</td>
                  <td>{s.count.toLocaleString('en-NZ')}</td>
                  <td>{dur(s.longest)}</td>
                  <td>{fmtTime(s.first)}</td>
                  <td>{fmtTime(s.last)}</td>
                </tr>
              ))}
              {!summary.length && <tr><td colSpan={7} className="lr-muted">No alarms to show.</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
