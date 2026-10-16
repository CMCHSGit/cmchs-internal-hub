// "Asks for you" on the home page: what's waiting for you in Asks, and the
// latest activity on asks you're part of. Each line opens that ask in Asks.
// Data and wording: asks.js (and apps/asks/src/model.js).
import { dueLabel, firstName, isOverdue, timeAgo } from '../../asks/src/model.js'
import { ASKS_URL, askUrl } from './asks.js'
import Icon from './Icon.jsx'

export default function AsksPanel({ summary, SectionHead }) {
  const s = summary
  const n = s.mine.length
  const title = n ? `${n} ask${n === 1 ? '' : 's'} for you` : 'Nothing waiting for you'
  return (
    <section className="stack-16" aria-label="Asks for you">
      <SectionHead c1="#554596" c2="#ef7d00" overline="Asks" title={title}>
        <span className="asks-head-links">
          <a className="btn-ghost-sm" href={`${ASKS_URL}#/mine`}>Open Asks <Icon name="arrow-right" size={16} /></a>
        </span>
      </SectionHead>
      <div className="asks-cols">
        <div className="card asks-card">
          <div className="asks-card-head">
            <span className="chs-overline">Waiting on you</span>
            {n > 0 && (
              <span className="caption">
                {[s.toPick && `${s.toPick} to pick up`, s.onIt && `${s.onIt} you’re on`, s.overdue && `${s.overdue} overdue`].filter(Boolean).join(' · ')}
              </span>
            )}
          </div>
          {n === 0
            ? <p className="body-sm asks-empty">Nothing sent to you or your team needs picking up. <a href={`${ASKS_URL}#/mine`}>Ask a colleague for something</a></p>
            : <ul className="asks-list">
                {s.mine.slice(0, 5).map(a => {
                  const late = isOverdue(a, s.today)
                  return (
                    <li key={a.id}>
                      <a className="asks-item" href={askUrl(a.id)}>
                        <span className="asks-item-title">{a.urgent && <span className="asks-urgent">Urgent</span>}{a.title}</span>
                        <span className="caption asks-item-meta">
                          <span className={a.owner ? '' : 'asks-nobody'}>{a.owner ? 'You have it' : 'Nobody has it yet'}</span>
                          <span aria-hidden="true"> · </span>from {firstName(a.createdByName) || 'someone'}
                          {a.due && <><span aria-hidden="true"> · </span><span className={late ? 'asks-late' : ''}>{dueLabel(a.due, s.today)}</span></>}
                        </span>
                      </a>
                    </li>
                  )
                })}
                {n > 5 && <li><a className="btn-ghost-sm" href={`${ASKS_URL}#/mine`}>See all {n} <Icon name="arrow-right" size={16} /></a></li>}
              </ul>}
        </div>
        <div className="card asks-card">
          <div className="asks-card-head">
            <span className="chs-overline"><Icon name="bell" size={14} /> Latest</span>
            {s.unread > 0 && <span className="asks-badge">{s.unread} new</span>}
          </div>
          {s.activity.length === 0
            ? <p className="body-sm asks-empty">No activity on your asks in the last two weeks.</p>
            : <ul className="asks-list">
                {s.activity.slice(0, 6).map(x => (
                  <li key={x.id}>
                    <a className={`asks-item${x.unread ? ' unread' : ''}`} href={askUrl(x.id)}>
                      <span className="asks-item-title">{x.unread && <span className="asks-dot" aria-label="New" />}{x.text}</span>
                      <span className="caption asks-item-meta"><span className="ellipsis">{x.title}</span><span aria-hidden="true"> · </span>{timeAgo(x.atMs)}</span>
                    </a>
                  </li>
                ))}
              </ul>}
        </div>
      </div>
    </section>
  )
}
