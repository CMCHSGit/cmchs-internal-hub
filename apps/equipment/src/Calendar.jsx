/* Calendar (old: the Calendar tab): loans and bookings as bars across the
   next weeks, so what's out, what's due back and what's coming are seen
   together. Long-term loans aren't drawn (they have no end). Coloured by
   state rather than per loan: active, overdue, scheduled, booked. A bar
   opens its loan in Loans. The customer column stays put while the days
   scroll sideways. */
import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '../../../shared/ui/index.jsx'
import { calendarRows, dayList, fmtDate, loanSections } from './model.js'

const DAY = 28
const SORTS = [['start-asc', 'Start, soonest'], ['start-desc', 'Start, latest'], ['end-asc', 'Due back, soonest'], ['end-desc', 'Due back, latest'], ['dur-desc', 'Longest'], ['dur-asc', 'Shortest'], ['name-asc', 'Customer A–Z'], ['name-desc', 'Customer Z–A']]
const STATE = { active: 'On loan', overdue: 'Overdue', scheduled: 'Scheduled', booking: 'Booked' }

export default function Calendar({ s, params, setParams, go }) {
  const weeks = [4, 8, 12, 26].includes(Number(params.weeks)) ? Number(params.weeks) : 8
  const sort = SORTS.some(([v]) => v === params.sort) ? params.sort : 'start-asc'
  const [start, setStart] = useState(s.today)
  const days = useMemo(() => dayList(start, weeks * 7), [start, weeks])
  const from = days[0], to = days[days.length - 1]
  const sections = useMemo(() => loanSections({ equipment: s.equipment, upcoming: s.upcoming, loanMeta: s.loanMeta, loanDocs: s.loanDocs, today: s.today, testMode: s.testMode }),
    [s.equipment, s.upcoming, s.loanMeta, s.loanDocs, s.today, s.testMode])
  const rows = useMemo(() => calendarRows(sections, { from, to, sort, today: s.today }), [sections, from, to, sort, s.today])
  const months = useMemo(() => {
    const out = []
    for (const d of days) {
      const m = d.slice(0, 7)
      if (out[out.length - 1]?.m === m) out[out.length - 1].n++
      else out.push({ m, n: 1, label: new Date(m + '-01T00:00:00').toLocaleDateString('en-NZ', { month: 'long', year: 'numeric' }) })
    }
    return out
  }, [days])
  const shift = (n) => setStart(dayList(start, n + 1)[n] || start)
  const back = (n) => { const t = Date.parse(start + 'T00:00:00Z') - n * 86400000; setStart(new Date(t).toISOString().slice(0, 10)) }
  const todayAt = days.indexOf(s.today)
  const width = days.length * DAY

  return (
    <div className="eq-cal-page">
      <div className="card eq-toolbar">
        <div className="eq-actions-row">
          <Button size="sm" variant="secondary" iconLeft={<ChevronLeft size={16} />} onClick={() => back(7)}>Week</Button>
          <Button size="sm" variant="secondary" onClick={() => setStart(s.today)}>Today</Button>
          <Button size="sm" variant="secondary" onClick={() => shift(7)}>Week <ChevronRight size={16} aria-hidden="true" /></Button>
        </div>
        <label className="field"><span className="field-label">Show</span>
          <select value={weeks} onChange={(e) => setParams({ ...params, weeks: e.target.value === '8' ? undefined : e.target.value })}>{[4, 8, 12, 26].map((w) => <option key={w} value={w}>{w} weeks</option>)}</select>
        </label>
        <label className="field"><span className="field-label">Sort</span>
          <select value={sort} onChange={(e) => setParams({ ...params, sort: e.target.value === 'start-asc' ? undefined : e.target.value })}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </label>
        <div className="eq-util-key eq-cal-key">{Object.entries(STATE).map(([k, l]) => <span key={k}><i className={`eq-cal-${k}`} />{l}</span>)}</div>
      </div>
      <p className="text-sm text-muted eq-shown">{rows.length} {rows.length === 1 ? 'loan' : 'loans'} from {fmtDate(from)} to {fmtDate(to)}{rows.length ? '' : ': nothing out or booked then.'}</p>
      {rows.length > 0 && (
        <div className="card eq-cal" role="grid" aria-label="Loans by day">
          <div className="eq-cal-inner" style={{ width: 220 + width }}>
            <div className="eq-cal-row eq-cal-months" role="row">
              <div className="eq-cal-label" />
              <div className="eq-cal-track" style={{ width }}>{months.map((m) => <div key={m.m} className="eq-cal-month" style={{ width: m.n * DAY }}>{m.label}</div>)}</div>
            </div>
            <div className="eq-cal-row eq-cal-days" role="row">
              <div className="eq-cal-label eq-small">Customer</div>
              <div className="eq-cal-track" style={{ width }}>
                {days.map((d) => { const dow = new Date(d + 'T00:00:00Z').getUTCDay(); return <div key={d} className={`eq-cal-day${d === s.today ? ' today' : ''}${dow === 0 || dow === 6 ? ' weekend' : ''}`} style={{ width: DAY }}>{Number(d.slice(8))}</div> })}
              </div>
            </div>
            {rows.map((g) => {
              const a = g.startDate && g.startDate > from ? days.indexOf(g.startDate) : 0
              const b = g.endDate && g.endDate < to ? days.indexOf(g.endDate) : days.length - 1
              const n = (g.kind === 'booking' ? g.pending : g.items).length
              const label = `${g.loanTo}: ${STATE[g.state]}, ${g.startDate ? fmtDate(g.startDate) : 'no start'} to ${g.endDate ? fmtDate(g.endDate) : 'no end'}, ${n} ${n === 1 ? 'device' : 'devices'}`
              return (
                <div key={g.kind + g.key} className="eq-cal-row" role="row">
                  <div className="eq-cal-label" title={g.location}><span className="eq-strong">{g.loanTo}</span><span className="eq-small">{g.am || g.location}</span></div>
                  <div className="eq-cal-track" style={{ width }}>
                    {todayAt >= 0 && <span className="eq-cal-now" style={{ left: todayAt * DAY + DAY / 2 }} aria-hidden="true" />}
                    <button type="button" className={`eq-cal-bar eq-cal-${g.state}`} style={{ left: Math.max(0, a) * DAY + 2, width: Math.max(1, b - Math.max(0, a) + 1) * DAY - 4 }}
                      title={label} aria-label={label} onClick={() => go('loans', { open: g.kind + ':' + g.key })}>
                      <span>{n} · {g.location || g.loanTo}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
