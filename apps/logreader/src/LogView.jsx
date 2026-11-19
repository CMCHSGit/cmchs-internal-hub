/* The timeline: every selected log merged in time order, with search, level
   and time filters, marked lines, and a detail strip for the line picked.
   Only the rows on screen are drawn, so a million lines scroll smoothly. */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Download, Search, X } from 'lucide-react'
import { Button } from '../../../shared/ui/index.jsx'
import { LEVELS, csvCell, fmtTime, parseLocalInput, toLocalInput } from './lines.js'
import { filterIndexes, makeMatcher } from './filter.js'
import { lowerBound } from './defib.js'
import { download } from './download.js'

const ROW = 22
const OVERSCAN = 12

export function LogView({ lines, famNames, profile, jump }) {
  const [q, setQ] = useState('')
  const [regex, setRegex] = useState(false)
  const [context, setContext] = useState(0)
  const [levels, setLevels] = useState(() => new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [markedOnly, setMarkedOnly] = useState(false)
  const [pick, setPick] = useState(-1) // index into `lines`
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(480)
  const box = useRef(null)
  const [goto, setGoto] = useState(null)

  const matcher = useMemo(() => makeMatcher(q, regex), [q, regex])
  const markFn = profile?.marker
  const fromT = parseLocalInput(from), toT = parseLocalInput(to)
  const rows = useMemo(() => filterIndexes(lines, {
    levels, from: fromT, to: toT, test: matcher.test, context, marked: markedOnly && markFn ? markFn : null,
  }), [lines, levels, fromT, toT, matcher, context, markedOnly, markFn])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const scrollToRow = useCallback((r) => {
    const el = box.current
    if (!el) return
    el.scrollTop = Math.max(0, r * ROW - el.clientHeight / 2)
    setScrollTop(el.scrollTop)
  }, [])

  // "Show in the log" from the shock table: clear the filters, then go to that time.
  useEffect(() => {
    if (!jump) return
    setQ(''); setLevels(new Set()); setFrom(''); setTo(''); setMarkedOnly(false); setContext(0)
    setGoto({ t: jump.t, line: jump.line })
  }, [jump])
  // Runs after the filters above have been applied (state changes are batched), so `rows` is the new list.
  useEffect(() => {
    if (!goto || !lines.length) return
    const at = goto.line ? lines.indexOf(goto.line) : -1 // the exact line when we have it, else the first one at that time
    const i = at >= 0 ? at : Math.min(lowerBound(lines, goto.t), lines.length - 1)
    let r = rows.indexOf(i)
    if (r < 0) r = rows.findIndex(x => x >= i)
    if (r < 0) r = rows.length - 1
    setGoto(null)
    setPick(i)
    if (r >= 0) scrollToRow(r)
  }, [goto, rows, lines, scrollToRow])

  // The browser pulls scrollTop back when the list gets shorter; clamp here too so a stale value never draws nothing.
  const top = Math.min(scrollTop, Math.max(0, rows.length * ROW - height))
  const start = Math.max(0, Math.floor(top / ROW) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((top + height) / ROW) + OVERSCAN)
  const cur = pick >= 0 ? lines[pick] : null

  const toggleLevel = (lv) => setLevels(s => { const n = new Set(s); n.has(lv) ? n.delete(lv) : n.add(lv); return n })
  const jumpTo = () => {
    const t = fromT
    if (!Number.isFinite(t)) return
    const i = lowerBound(lines, t)
    const r = rows.findIndex(x => x >= i)
    if (r >= 0) scrollToRow(r)
  }
  const around = (l) => {
    setQ(''); setLevels(new Set()); setMarkedOnly(false)
    setFrom(toLocalInput(l.t - 30e3)); setTo(toLocalInput(l.t + 30e3))
    setGoto({ t: l.t, line: l })
  }
  const exportCsv = () => {
    const out = ['Time,Log,Thread,Level,Message,Source']
    for (const i of rows) {
      const l = lines[i]
      out.push([l.early ? '' : fmtTime(l.t), l.fam, l.thr, l.lvl, l.msg, l.src].map(csvCell).join(','))
    }
    download('log-export.csv', out.join('\r\n') + '\r\n', 'text/csv')
  }

  const famIdx = useMemo(() => new Map(famNames.map((n, i) => [n, i])), [famNames])

  return (
    <div className="lr-logview">
      <div className="lr-bar">
        <label className="lr-search">
          <Search size={15} aria-hidden />
          <input className="input" type="search" placeholder={regex ? 'Pattern (regex)' : 'Search the messages'} value={q} onChange={e => setQ(e.target.value)} aria-label="Search" />
        </label>
        <label className="lr-check"><input type="checkbox" checked={regex} onChange={e => setRegex(e.target.checked)} /> Pattern</label>
        <label className="lr-field">Context
          <select className="input" value={context} onChange={e => setContext(+e.target.value)}>
            {[0, 2, 5, 10, 25].map(n => <option key={n} value={n}>{n ? `±${n} lines` : 'none'}</option>)}
          </select>
        </label>
        <div className="lr-levels" role="group" aria-label="Levels">
          {LEVELS.map(lv => (
            <button key={lv} type="button" className={'lr-lv lr-lv-' + lv + (levels.has(lv) ? ' on' : '')} aria-pressed={levels.has(lv)} onClick={() => toggleLevel(lv)}>{lv}</button>
          ))}
        </div>
        {markFn && <label className="lr-check"><input type="checkbox" checked={markedOnly} onChange={e => setMarkedOnly(e.target.checked)} /> Marked lines only</label>}
      </div>
      <div className="lr-bar">
        <label className="lr-field">From
          <input className="input" type="datetime-local" step="1" value={from} onChange={e => setFrom(e.target.value)} />
        </label>
        <label className="lr-field">To
          <input className="input" type="datetime-local" step="1" value={to} onChange={e => setTo(e.target.value)} />
        </label>
        <Button variant="secondary" size="sm" onClick={jumpTo} disabled={!Number.isFinite(fromT)}>Jump to “From”</Button>
        {(q || levels.size || from || to || markedOnly) && (
          <Button variant="ghost" size="sm" iconLeft={<X size={14} />} onClick={() => { setQ(''); setLevels(new Set()); setFrom(''); setTo(''); setMarkedOnly(false) }}>Clear filters</Button>
        )}
        <span className="lr-count" aria-live="polite">
          {matcher.error ? <b className="lr-bad">{matcher.error}</b> : <>{rows.length.toLocaleString('en-NZ')} of {lines.length.toLocaleString('en-NZ')} lines</>}
        </span>
        <Button variant="secondary" size="sm" iconLeft={<Download size={15} />} onClick={exportCsv} disabled={!rows.length}>Export CSV</Button>
      </div>

      <div className="lr-list" ref={box} onScroll={e => setScrollTop(e.currentTarget.scrollTop)} role="listbox" aria-label="Log lines" tabIndex={0}>
        {!lines.length && <p className="lr-empty">Tick a log on the left to read it.</p>}
        {lines.length > 0 && !rows.length && <p className="lr-empty">No lines match.</p>}
        <div style={{ height: rows.length * ROW, position: 'relative' }}>
          {rows.slice(start, end).map((li, k) => {
            const l = lines[li]
            const mk = markFn ? markFn(l) : null
            const hit = pick === li
            return (
              <div key={li} role="option" aria-selected={hit} className={`lr-row lr-l-${l.lvl}${hit ? ' sel' : ''}${mk ? ' mk mk-' + mk.kind : ''}`}
                style={{ top: (start + k) * ROW }} onClick={() => setPick(li)} title={mk ? mk.label : undefined}>
                <span className={'lr-t' + (l.early ? ' early' : '')} title={l.early ? 'The device clock was not set yet; this takes the time of the nearest dated line.' : undefined}>{l.early ? '~' : ''}{fmtTime(l.t)}</span>
                <span className={'lr-fam lr-f' + ((famIdx.get(l.fam) ?? 0) % 6)} title={l.fileName}>{l.fam}</span>
                <span className="lr-lvl">{l.lvl === 'ERROR' ? 'ERR' : l.lvl.slice(0, 4)}</span>
                <span className="lr-msg">{mk && <b className="lr-mk">{mk.label}</b>}{l.msg.split('\n')[0]}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="lr-detail">
        {cur ? (
          <>
            <div className="lr-detail-meta">
              <span>{cur.early ? 'Clock not set' : fmtTime(cur.t)}</span>
              <span>{cur.fileName} · line {cur.n.toLocaleString('en-NZ')}</span>
              {cur.thr && <span>thread {cur.thr}</span>}
              {cur.src && <span>{cur.src}</span>}
              <Button variant="ghost" size="sm" onClick={() => around(cur)}>Show ±30 s around this</Button>
            </div>
            <pre className="lr-detail-msg">{cur.msg}</pre>
          </>
        ) : <span className="lr-muted">Click a line to see all of it.</span>}
      </div>
    </div>
  )
}
