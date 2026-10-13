import { useState } from 'react'
import allEvents from '../../../events.json'
import { holidaysForYear } from '../../schedule/src/utils/holidays.js'
import Icon from './Icon.jsx'

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const pad = n => String(n).padStart(2, '0')
const isoOf = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`

/**
 * Everything on the calendar for one month: events.json, plus every NZ public
 * holiday (from the staff schedule's own list, so nobody has to type them in).
 * An events.json entry with kind "holiday" adds a one-off closure.
 */
function monthItems(y, m) {
  const prefix = `${y}-${pad(m + 1)}-`
  const items = allEvents
    .filter(e => typeof e.date === 'string' && e.date.startsWith(prefix))
    .map(e => ({
      date: e.date, title: e.title, time: e.time || '',
      tag: e.tag || (e.kind === 'holiday' ? 'Holiday' : 'Event'),
      holiday: e.kind === 'holiday',
    }))
  for (const [date, name] of holidaysForYear(y)) {
    if (date.startsWith(prefix) && !items.some(i => i.date === date && i.holiday)) {
      items.push({ date, title: `${name} · office closed`, time: 'Public holiday', tag: 'Holiday', holiday: true })
    }
  }
  return items.sort((a, b) => a.date.localeCompare(b.date))
}

export default function Calendar() {
  const now = new Date()
  const [offset, setOffset] = useState(0)
  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1)
  const y = base.getFullYear(), m = base.getMonth()
  const lead = (base.getDay() + 6) % 7 // Monday first
  const days = new Date(y, m + 1, 0).getDate()
  const todayIso = isoOf(now.getFullYear(), now.getMonth(), now.getDate())
  const items = monthItems(y, m)

  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= days; d++) {
    const iso = isoOf(y, m, d)
    const here = items.filter(i => i.date === iso)
    const kind = iso === todayIso ? 'today' : here.some(i => i.holiday) ? 'holiday' : here.length ? 'event' : ''
    cells.push({ d, kind, weekend: (lead + d - 1) % 7 > 4, tip: here.map(i => i.title).join(' · ') || (kind === 'today' ? 'Today' : ''), dot: here.length > 0 })
  }
  while (cells.length % 7) cells.push(null)

  return (
    <div className="card cal">
      <div className="cal-nav">
        <button className="icon-btn" onClick={() => setOffset(o => o - 1)} aria-label="Previous month" title="Previous month"><Icon name="chevron-left" size={18} /></button>
        <span className="cal-title">{MONTHS[m]} {y}</span>
        <button className="icon-btn" onClick={() => setOffset(o => o + 1)} aria-label="Next month" title="Next month"><Icon name="chevron-right" size={18} /></button>
      </div>
      <div className="cal-grid" role="grid" aria-label={`${MONTHS[m]} ${y}`}>
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="cal-head" aria-hidden="true">{d}</span>)}
        {cells.map((c, i) => c
          ? <span key={i} className={`cal-day ${c.kind ? 'cal-' + c.kind : ''} ${c.weekend ? 'cal-weekend' : ''}`} title={c.tip} role="gridcell">
              {c.d}<span className="cal-dot" aria-hidden="true" style={{ visibility: c.dot ? 'visible' : 'hidden' }} />
            </span>
          : <span key={i} aria-hidden="true" />)}
      </div>
      <div className="cal-legend">
        <span><span className="legend-dot" style={{ background: '#80bd01' }} />Training and events</span>
        <span><span className="legend-dot" style={{ background: '#ef7d00' }} />Public holiday</span>
      </div>
      <div className="hairline" />
      <div className="cal-events">
        {items.map(e => (
          <div key={e.date + e.title} className="cal-event-row">
            <div className="cal-event-date">
              <span className="cal-event-day">{Number(e.date.slice(8))}</span>
              <span className="cal-event-mon">{MON[m]}</span>
            </div>
            <div className="cal-event-text">
              <span className="cal-event-title">{e.title}</span>
              {e.time && <span className="caption">{e.time}</span>}
            </div>
            <span className={`badge badge-${e.holiday ? 'orange' : 'green'}`}>{e.tag}</span>
          </div>
        ))}
        {!items.length && <span className="body-sm muted">Nothing on the calendar this month.</span>}
      </div>
    </div>
  )
}
