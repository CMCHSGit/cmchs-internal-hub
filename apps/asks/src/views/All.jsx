/* Every ask this person is part of, with filters. A link
   from the Company page arrives here filtered to one person or team. */

import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { AskList } from '../AskList.jsx'
import { sortAsks, TEAMS } from '../model.js'

const SHOW = [['outstanding', 'Not done'], ['open', 'Nobody yet'], ['waiting', 'Waiting'], ['done', 'Done'], ['all', 'All']]

export default function All() {
  const s = useStore()
  const ui = useUi()
  const p = ui.route.params
  const show = SHOW.some(([k]) => k === p.show) ? p.show : 'outstanding'
  const set = (patch) => ui.go('all', { ...p, ask: '', ...patch })

  const list = useMemo(() => {
    const q = (p.q || '').trim().toLowerCase()
    return sortAsks(s.asks.filter((a) => {
      if (show === 'outstanding' && a.status === 'done') return false
      if (show !== 'outstanding' && show !== 'all' && a.status !== show) return false
      if (p.person && a.owner !== p.person && a.createdBy !== p.person && !(a.assignees || []).includes(p.person)) return false
      if (p.team && !(a.teams || []).includes(p.team)) return false
      if (q && !`${a.title} ${a.details} ${a.createdByName} ${a.ownerName} ${a.waitingOn}`.toLowerCase().includes(q)) return false
      return true
    }), s.today)
  }, [s.asks, s.today, show, p.person, p.team, p.q])

  return (
    <div className="ak-page">
      <div className="ak-filters">
        <div className="ak-seg" role="group" aria-label="Show">
          {SHOW.map(([k, l]) => <button key={k} type="button" className={show === k ? 'on' : ''} aria-pressed={show === k} onClick={() => set({ show: k })}>{l}</button>)}
        </div>
        <div className="ak-search ak-grow">
          <Search size={16} aria-hidden="true" />
          <input className="input" type="search" value={p.q || ''} onChange={(e) => set({ q: e.target.value })} placeholder="Search asks" aria-label="Search asks" />
        </div>
        <select className="input ak-select" value={p.person || ''} onChange={(e) => set({ person: e.target.value })} aria-label="Person">
          <option value="">Anyone</option>
          {[...s.users].sort((a, b) => a.name.localeCompare(b.name)).map((u) => <option key={u.uid} value={u.uid}>{u.name}</option>)}
        </select>
        <select className="input ak-select" value={p.team || ''} onChange={(e) => set({ team: e.target.value })} aria-label="Sent to team">
          <option value="">Any team</option>
          {TEAMS.map((t) => <option key={t} value={t}>{t} team</option>)}
        </select>
      </div>
      <p className="ak-sub">
        Asks you’re part of, and ones sent to your team. Nobody else can see them. {list.length} shown.
      </p>
      <AskList asks={list} showClaim empty="No asks match." />
    </div>
  )
}
