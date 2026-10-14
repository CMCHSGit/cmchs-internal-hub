/* Equipment: the demo pool by week. Rows are device models, columns are
   weeks, each cell is units booked out of units owned, green while some are
   free, amber when all are taken, red when more are wanted than we own.
   Click a cell for the jobs holding them. */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { FeedStatus } from '../JobPanel.jsx'
import { Empty } from '../ui.jsx'
import { addDays, bookedInWeek, fmt, loadLevel, mondayOf, weeksFrom, dueBack } from '../model.js'

export default function Equipment() {
  const s = useStore()
  const ui = useUi()
  const thisWeek = mondayOf(s.today)
  const [first, setFirst] = useState(thisWeek)
  const weeks = useMemo(() => weeksFrom(first, 12), [first])
  const [sel, setSel] = useState(null) // { model, week }

  const grid = useMemo(() => {
    const fams = new Map()
    for (const p of s.settings.pool) {
      if (!fams.has(p.family)) fams.set(p.family, [])
      fams.get(p.family).push({
        ...p,
        cells: weeks.map((w) => {
          const b = bookedInWeek(s.jobs, p.model, w, s.today)
          return { week: w, booked: b.total, entries: b.entries, level: loadLevel(b.total, p.total) }
        }),
      })
    }
    return [...fams]
  }, [s.settings.pool, s.jobs, weeks, s.today])

  const pick = sel && grid.flatMap(([, ms]) => ms).find((m) => m.model === sel.model)
  const cell = pick?.cells.find((c) => c.week === sel.week)
  const template = `200px 64px repeat(${weeks.length}, 84px)`

  return (
    <div className="pt-page">
      <div className="pt-pagehead">
        <div className="pt-col">
          <h1 className="pt-h2">Demo equipment</h1>
          <span className="text-sm text-muted">Units booked against the demo pool, by week. Click a cell to see which jobs hold them.</span>
        </div>
        <span className="pt-spacer" />
        <span className="pt-seg">
          <button type="button" aria-label="Earlier" onClick={() => setFirst(addDays(first, -28))}><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setFirst(thisWeek)}>This week</button>
          <button type="button" aria-label="Later" onClick={() => setFirst(addDays(first, 28))}><ChevronRight size={16} /></button>
        </span>
      </div>
      <FeedStatus />
      <div className="pt-legend">
        <span className="overline">Key</span>
        <span className="pt-key"><span className="pt-ratio free">2/4</span> Units free</span>
        <span className="pt-key"><span className="pt-ratio full">4/4</span> Fully booked</span>
        <span className="pt-key"><span className="pt-ratio short">5/4</span> Short</span>
        <span className="pt-key"><span className="pt-ratio unknown">2/?</span> Pool size not set</span>
        <span className="text-sm text-muted">booked / in pool</span>
      </div>

      <div className="pt-eq-layout">
        <div className="pt-grid-wrap pt-eq-grid" role="grid" aria-label="Demo pool bookings by week">
          <div className="pt-grow-row pt-grid-head" role="row" style={{ gridTemplateColumns: template }}>
            <div className="pt-hcell pt-frz" role="columnheader">Model</div>
            <div className="pt-hcell" role="columnheader">Pool</div>
            {weeks.map((w) => <div key={w} className={`pt-hcell pt-num${w === thisWeek ? ' pt-now' : ''}`} role="columnheader">{fmt(w)}</div>)}
          </div>
          {grid.map(([fam, models]) => (
            <div key={fam} role="rowgroup">
              <div className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}><div className="pt-group pt-group-plain overline" role="rowheader">{fam}</div></div>
              {models.map((m) => (
                <div key={m.model} className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}>
                  <div className="pt-cell pt-frz" role="rowheader"><b className="pt-mono pt-strong">{m.model}</b><span className="text-sm text-muted pt-ellipsis">{m.kind}</span></div>
                  <div className="pt-cell pt-mono">{m.total ?? '?'}</div>
                  {m.cells.map((c) => {
                    const on = sel?.model === m.model && sel?.week === c.week
                    return (
                      <div key={c.week} className="pt-cell pt-eq-cell" role="gridcell">
                        <button type="button" className={`pt-ratio ${c.level}${on ? ' on' : ''}`} aria-pressed={on}
                          aria-label={`${m.model}, week of ${fmt(c.week)}: ${c.booked} of ${m.total ?? 'unknown'} booked`}
                          onClick={() => setSel({ model: m.model, week: c.week })}>
                          {c.booked}/{m.total ?? '?'}
                        </button>
                      </div>
                    )
                  })}
                </div>
              ))}
            </div>
          ))}
          {!grid.length && <Empty>No device models yet. Add them under Demo pool in Settings.</Empty>}
        </div>

        <section className={`card pt-card pt-eq-detail${cell?.level === 'short' ? ' cap-orange' : ' cap-purple'}`}>
          {!cell ? <Empty>Click a cell to see which jobs hold those units.</Empty> : (
            <>
              <div className="overline">Week of {fmt(sel.week)}</div>
              <div className="pt-row"><b className="pt-mono pt-big">{pick.model}</b><span className="text-sm">{cell.booked} booked of {pick.total ?? 'an unknown number'} in the pool</span></div>
              {cell.level === 'short' && <p className="pt-bad text-sm"><b>Short by {cell.booked - pick.total}.</b> Someone needs to move a job, find units, or chase a return.</p>}
              {cell.entries.length === 0 && <Empty>No jobs hold this model this week.</Empty>}
              <ul className="pt-list">
                {cell.entries.map((e, i) => (
                  <li key={i} className="pt-row">
                    <b className="pt-mono pt-w-qty">{e.qty}x</b>
                    <span className="pt-grow pt-col">
                      <button type="button" className="pt-joblink" onClick={() => ui.openJob(e.job.id, e.job.archived ? 'archive' : 'equipment')}>{e.job.name}{e.job.archived ? ' (archived)' : ''}</button>
                      <span className="text-sm text-muted">{e.overdue ? `Overdue since ${fmt(dueBack(e.job, e.line))}` : `${fmt(e.job.start)} – ${fmt(e.job.end)}`}{e.line.note ? ` · ${e.line.note}` : ''}</span>
                    </span>
                    <span className={`pt-line pt-line-${e.overdue ? 'overdue' : e.line.line.replace(/\s/g, '').toLowerCase()}`}>{e.overdue ? 'Overdue' : e.line.line}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
