/* Company: how many asks everyone is carrying, from askStats (counts only,
   no text), so it's the same for everybody. The asks themselves stay
   visible only to the people involved. */

import { useMemo } from 'react'
import { useStore } from '../store.jsx'
import { useUi } from '../App.jsx'
import { Avatar, Empty } from '../ui.jsx'
import { companyCounts } from '../model.js'

export default function Company() {
  const s = useStore()
  const ui = useUi()
  const c = useMemo(() => companyCounts(s.stats, s.users, s.today), [s.stats, s.users, s.today])
  const t = c.totals
  const teams = c.teams.filter((x) => x.toPick)
  return (
    <div className="ak-page">
      <div className="ak-summary" role="group" aria-label="Across the company">
        <Tile n={t.outstanding} label="Not done" />
        <Tile n={t.open} label="Nobody has yet" tone={t.open ? 'purple' : ''} />
        <Tile n={t.waiting} label="Waiting on others" />
        <Tile n={t.overdue} label="Overdue" tone={t.overdue ? 'red' : ''} />
        <Tile n={t.doneWeek} label="Done this week" tone="green" />
      </div>

      <section className="ak-section">
        <h2 className="ak-h3">Who’s carrying what</h2>
        <p className="ak-sub">“On it” is what they’ve picked up. “To pick up” was sent to them by name and nobody has it yet.</p>
        {!c.people.length ? <Empty>Nobody has anything outstanding.</Empty> : (
          <div className="ak-tablewrap">
            <table className="ak-table">
              <thead>
                <tr><th scope="col">Person</th><th scope="col">On it</th><th scope="col">To pick up</th><th scope="col">Overdue</th><th scope="col" className="ak-hide-sm">Waiting on others</th><th scope="col" className="ak-hide-sm">Asked, still open</th></tr>
              </thead>
              <tbody>
                {c.people.map((r) => (
                  <tr key={r.uid}>
                    <th scope="row">
                      <a href={ui.hrefFor({ person: r.uid }, 'all')} className="ak-person">
                        <Avatar name={r.name} size={24} title="" />
                        <span><span className="ak-strong">{r.uid === s.me.uid ? `${r.name} (you)` : r.name}</span><span className="text-sm text-muted ak-block">{r.team}</span></span>
                      </a>
                    </th>
                    <td><Num n={r.onIt} /></td>
                    <td><Num n={r.toPick} /></td>
                    <td><Num n={r.overdue} bad /></td>
                    <td className="ak-hide-sm"><Num n={r.waiting} /></td>
                    <td className="ak-hide-sm"><Num n={r.asked} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="ak-section">
        <h2 className="ak-h3">Sent to a whole team, nobody has it yet</h2>
        {!teams.length ? <Empty>Nothing waiting on a team.</Empty> : (
          <ul className="ak-teamcounts">
            {teams.map((x) => (
              <li key={x.team}>
                <a href={ui.hrefFor({ team: x.team, show: 'open' }, 'all')}>
                  <b>{x.team} team</b> <span>{x.toPick} to pick up{x.overdue ? <>, <span className="ak-bad">{x.overdue} overdue</span></> : ''}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="ak-sub">Counts cover everyone. Opening a name shows only the asks you’re part of{s.me.role === 'admin' ? ' (as an admin, all of them)' : ''}.</p>
    </div>
  )
}

function Num({ n, bad = false }) {
  return <span className={`ak-num${n ? '' : ' zero'}${bad && n ? ' ak-bad' : ''}`}>{n || '–'}</span>
}

function Tile({ n, label, tone = '' }) {
  return (
    <div className={`ak-tile ${tone}`}>
      <span className="ak-tile-n">{n}</span>
      <span className="ak-tile-l">{label}</span>
    </div>
  )
}
