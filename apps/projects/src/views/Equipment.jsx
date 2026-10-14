/* Equipment: the demo pool by week. Rows are device models, columns are
   weeks, each cell is units booked out of units owned, green while some are
   free, amber when all are taken, red when more are wanted than we own.
   Units owned and the loans out come from the demo tracker feed; jobs'
   reservations come from here. Click a cell for who holds them. */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { FeedStatus } from '../JobPanel.jsx'
import { Empty } from '../ui.jsx'
import { addDays, bookedInWeek, fmt, fmtRange, loadLevel, mondayOf, weeksFrom, dueBack, entryWho } from '../model.js'

export default function Equipment() {
  const s = useStore()
  const ui = useUi()
  const thisWeek = mondayOf(s.today)
  const [first, setFirst] = useState(thisWeek)
  const weeks = useMemo(() => weeksFrom(first, 12), [first])
  const [sel, setSel] = useState(null) // { model, week }

  const grid = useMemo(() => {
    const fams = new Map()
    for (const p of s.pool) {
      if (!fams.has(p.family)) fams.set(p.family, [])
      fams.get(p.family).push({
        ...p,
        cells: weeks.map((w) => {
          const b = bookedInWeek(s.jobs, p.model, w, s.today, s.loans)
          return { week: w, booked: b.total, entries: b.entries, level: loadLevel(b.total, p.total) }
        }),
      })
    }
    return [...fams]
  }, [s.pool, s.jobs, weeks, s.today, s.loans])

  const pick = sel && grid.flatMap(([, ms]) => ms).find((m) => m.model === sel.model)
  const cell = pick?.cells.find((c) => c.week === sel.week)
  const template = `200px 64px repeat(${weeks.length}, 84px)`

  return (
    <div className="pt-page">
      <div className="pt-pagehead">
        <div className="pt-col">
          <h1 className="pt-h2">Demo equipment</h1>
          <span className="text-sm text-muted">Units booked against the demo pool, by week: jobs' reservations and the demo tracker's loans. Click a cell to see who holds them.</span>
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
        <span className="pt-key"><span className="pt-ratio unknown">2/?</span> Pool size not known</span>
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
                  <div className="pt-cell pt-mono" title={m.fromFeed ? 'Units in the demo tracker' : m.total != null ? 'Typed in Settings: the demo tracker has none under this name' : 'Not known'}>{m.total ?? '?'}{m.total != null && !m.fromFeed && <sup className="text-muted">*</sup>}</div>
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
          {grid.some(([, ms]) => ms.some((m) => m.total != null && !m.fromFeed)) && <p className="text-sm text-muted pt-eq-foot">* Typed in Settings: the demo tracker has no units under this name.</p>}
        </div>

        <section className={`card pt-card pt-eq-detail${cell?.level === 'short' ? ' cap-orange' : ' cap-purple'}`}>
          {!cell ? <Empty>Click a cell to see which jobs hold those units.</Empty> : (
            <>
              <div className="overline">Week of {fmt(sel.week)}</div>
              <div className="pt-row"><b className="pt-mono pt-big">{pick.model}</b><span className="text-sm">{cell.booked} booked of {pick.total ?? 'an unknown number'} in the pool</span></div>
              {cell.level === 'short' && <p className="pt-bad text-sm"><b>Short by {cell.booked - pick.total}.</b> Someone needs to move a job, find units, or chase a return.</p>}
              {cell.entries.length === 0 && <Empty>Nothing holds this model this week.</Empty>}
              <ul className="pt-list">
                {cell.entries.map((e, i) => e.feed ? (
                  <li key={i} className="pt-row">
                    <b className="pt-mono pt-w-qty">{e.qty}x</b>
                    <span className="pt-grow pt-col">
                      <span>{entryWho(e)}</span>
                      <span className="text-sm text-muted">Demo tracker · {e.overdue ? `Overdue since ${fmt(e.loan.due)}` : fmtRange(e.loan.start, e.loan.due)}{e.loan.assets.length ? ` · ${e.loan.assets.join(', ')}` : ''}</span>
                    </span>
                    <span className={`pt-line pt-line-${e.overdue ? 'overdue' : e.loan.out ? 'atsite' : 'reserved'}`}>{e.overdue ? 'Overdue' : e.loan.out ? 'Out' : 'Booked'}</span>
                  </li>
                ) : (
                  <li key={i} className="pt-row">
                    <b className="pt-mono pt-w-qty">{e.qty}x</b>
                    <span className="pt-grow pt-col">
                      <button type="button" className="pt-joblink" onClick={() => ui.openJob(e.job.id, e.job.archived ? 'archive' : 'equipment')}>{e.job.name}{e.job.archived ? ' (archived)' : ''}</button>
                      <span className="text-sm text-muted">{e.overdue ? `Overdue since ${fmt(e.loan?.due || dueBack(e.job, e.line))}` : `${fmt(e.job.start)} – ${fmt(e.job.end)}`}{e.loan ? ' · linked to the demo tracker' : ''}{e.line.note ? ` · ${e.line.note}` : ''}</span>
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
