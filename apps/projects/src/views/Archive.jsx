/* Archive: completed jobs, kept in full but out of the way of active work.
   Search here looks at archived jobs only; Ctrl+K searches everything. */

import { useMemo, useState } from 'react'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { AvatarStack, Empty, Highlight } from '../ui.jsx'
import { fmtY, jobStaff, searchJobs, tokens, highlight } from '../model.js'

/** "4x ePM12, 2x A9" — one entry per model, however many lines it was split over. */
function equipmentSummary(job) {
  const m = new Map()
  for (const l of job.equipment || []) m.set(l.model, (m.get(l.model) || 0) + (Number(l.qty) || 0))
  return [...m].map(([model, n]) => `${n}x ${model}`).join(', ')
}

const GROUPS =[['year', 'Year'], ['category', 'Category'], ['region', 'Region'], ['customer', 'Customer']]

export default function Archive({ params }) {
  const s = useStore()
  const ui = useUi()
  const [q, setQ] = useState('')
  const [groupBy, setGroupBy] = useState('year')
  const [f, setF] = useState({ year: '', category: '', region: '', customer: '' })
  const doneOn = (j) => j.completedAt || j.archivedAt || ''
  const yearOf = (j) => (doneOn(j) || j.end || '').slice(0, 4) || 'No date'
  const opts = useMemo(() => ({
    year: [...new Set(s.archived.map(yearOf))].sort().reverse(),
    region: [...new Set(s.archived.map((j) => j.region).filter(Boolean))].sort(),
    customer: [...new Set(s.archived.map((j) => j.customer).filter(Boolean))].sort(),
  }), [s.archived]) // eslint-disable-line react-hooks/exhaustive-deps

  const shown = useMemo(() => {
    let list = s.archived.filter((j) => (!f.year || yearOf(j) === f.year) && (!f.category || j.category === f.category) &&
      (!f.region || j.region === f.region) && (!f.customer || j.customer === f.customer))
    if (tokens(q).length) {
      const hits = new Map(searchJobs(q, list, { comments: s.comments, assignments: s.assignments, staff: s.settings.staff }).map((r) => [r.job.id, r]))
      list = list.filter((j) => hits.has(j.id))
    }
    return list.sort((a, b) => doneOn(b).localeCompare(doneOn(a)))
  }, [s.archived, f, q, s.comments, s.assignments, s.settings.staff]) // eslint-disable-line react-hooks/exhaustive-deps

  const keyOf = { year: yearOf, category: (j) => s.catById.get(j.category)?.name || 'No category', region: (j) => j.region || 'No region', customer: (j) => j.customer || 'No customer' }[groupBy]
  const groups = []
  for (const j of shown) {
    const k = keyOf(j)
    let g = groups.find((x) => x.k === k)
    if (!g) groups.push(g = { k, jobs: [] })
    g.jobs.push(j)
  }
  if (groupBy !== 'year') groups.sort((a, b) => a.k.localeCompare(b.k))
  const toks = tokens(q)
  const template = '300px 210px 130px 240px 130px 130px 200px'
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  return (
    <div className="pt-page">
      <div className="pt-pagehead">
        <div className="pt-col">
          <h1 className="pt-h2">Archive</h1>
          <span className="text-sm text-muted">Completed jobs, kept in full. They don't show on Home, Table, Timeline or Equipment.</span>
        </div>
      </div>
      <div className="pt-filters">
        <input className="input pt-f-q" type="search" placeholder="Search archived jobs only" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search archived jobs" />
        <span className="overline">Group by</span>
        <div className="pt-seg" role="group" aria-label="Group by">
          {GROUPS.map(([v, l]) => <button key={v} type="button" className={groupBy === v ? 'on' : ''} aria-pressed={groupBy === v} onClick={() => setGroupBy(v)}>{l}</button>)}
        </div>
      </div>
      <div className="pt-filters">
        <select value={f.year} onChange={set('year')} aria-label="Year"><option value="">Any year</option>{opts.year.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.category} onChange={set('category')} aria-label="Category"><option value="">Any category</option>{s.settings.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select value={f.region} onChange={set('region')} aria-label="Region"><option value="">Any region</option>{opts.region.map((x) => <option key={x}>{x}</option>)}</select>
        <select value={f.customer} onChange={set('customer')} aria-label="Customer"><option value="">Any customer</option>{opts.customer.map((x) => <option key={x}>{x}</option>)}</select>
        <span className="text-sm text-muted">{shown.length} of {s.archived.length} archived jobs</span>
      </div>

      <div className="pt-grid-wrap" role="table" aria-label="Archived jobs">
        <div className="pt-grow-row pt-grid-head" role="row" style={{ gridTemplateColumns: template }}>
          {['Job', 'Customer / hospital', 'Region', 'Category', 'Completed', 'Staff', 'Equipment used'].map((h, i) => (
            <div key={h} role="columnheader" className={`pt-hcell${i === 0 ? ' pt-frz' : ''}`}>{h}</div>
          ))}
        </div>
        {groups.map((g) => (
          <div key={g.k} role="rowgroup">
            <div className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}>
              <div className="pt-group" role="cell" style={{ borderTopColor: 'var(--text-muted)' }}><b>{g.k}</b><span className="pt-count">{g.jobs.length}</span></div>
            </div>
            {g.jobs.map((j) => {
              const cat = s.catById.get(j.category)
              return (
                <div key={j.id} className="pt-grow-row" role="row" style={{ gridTemplateColumns: template }}>
                  <div role="rowheader" className={`pt-cell pt-frz${params.job === j.id ? ' pt-selected' : ''}`}>
                    <button type="button" className="pt-rowbtn" onClick={() => ui.openJob(j.id, 'archive')}><Highlight parts={highlight(j.name, toks)} /></button>
                  </div>
                  <div role="cell" className="pt-cell pt-strong">{j.customer || '—'}</div>
                  <div role="cell" className="pt-cell">{j.region || '—'}</div>
                  <div role="cell" className="pt-cell"><span className="pt-swatch" style={{ background: cat?.color }} /><span className="pt-ellipsis">{cat?.name || '—'}</span></div>
                  <div role="cell" className="pt-cell pt-num">{fmtY(doneOn(j)) || '—'}</div>
                  <div role="cell" className="pt-cell"><AvatarStack ids={[...jobStaff(j, s.assignments)]} /></div>
                  <div role="cell" className="pt-cell pt-mono pt-ellipsis">{equipmentSummary(j) || '—'}</div>
                </div>
              )
            })}
          </div>
        ))}
        {!shown.length && <Empty>{s.archived.length ? 'No archived jobs match that search.' : 'Nothing archived yet. When a job is set to Complete you are asked whether to archive it.'}</Empty>}
      </div>
    </div>
  )
}
