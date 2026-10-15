/* An ask as a row in a list: what, who asked, who has it, when it's due. */

import { CalendarDays, Flame, Hand, MessageSquare, Camera } from 'lucide-react'
import { Badge } from '../../schedule/src/components/ui'
import { useStore } from './store.jsx'
import { useUi } from './App.jsx'
import { Avatar, Empty, StatusBadge, sentToText } from './ui.jsx'
import { canClaim, dueLabel, firstName, isOverdue, timeAgo } from './model.js'

export function AskRow({ ask: a, showClaim = false }) {
  const s = useStore()
  const ui = useUi()
  const { me } = s
  const done = a.status === 'done'
  const late = isOverdue(a, s.today)
  const fresh = s.isNew(a)
  const claim = async (e) => {
    e.stopPropagation()
    try {
      await s.claim(a)
      ui.toast('It’s yours. Everyone else can see you have it.')
    } catch (err) {
      ui.toast(err.message || String(err))
    }
  }
  const who = a.owner
    ? (a.owner === me.uid ? 'You have it' : `${firstName(a.ownerName)} has it`)
    : done ? 'Closed' : 'Nobody yet'
  return (
    <li className={`ak-item${done ? ' done' : ''}${ui.route.params.ask === a.id ? ' on' : ''}`}>
      <a href={ui.hrefFor({ ask: a.id })} className="ak-item-link">
        <span className="ak-item-main">
          <span className="ak-item-top">
            {fresh && <span className="ak-dot" title="New activity" aria-label="New activity" />}
            <span className="ak-item-title">{a.title}</span>
          </span>
          <span className="ak-item-meta">
            <span>{a.createdBy === me.uid ? 'You' : firstName(a.createdByName)} → {sentToText(a, s.userById, me.uid)}</span>
            <span aria-hidden="true">·</span>
            <span>{timeAgo(a.createdAtMs)}</span>
            {a.commentCount > 0 && <span className="ak-meta-icon" title={`${a.commentCount} comment${a.commentCount === 1 ? '' : 's'}`}><MessageSquare size={13} aria-hidden="true" /> {a.commentCount}</span>}
            {a.photoCount > 0 && <span className="ak-meta-icon" title={`${a.photoCount} photo${a.photoCount === 1 ? '' : 's'}`}><Camera size={13} aria-hidden="true" /> {a.photoCount}</span>}
          </span>
        </span>
        <span className="ak-item-side">
          <span className="ak-row ak-wrap ak-end">
            {a.urgent && !done && <Badge tone="critical"><Flame size={12} aria-hidden="true" /> Urgent</Badge>}
            {a.due && !done && <span className={`ak-due${late ? ' late' : ''}`}><CalendarDays size={13} aria-hidden="true" /> {dueLabel(a.due, s.today)}</span>}
            <StatusBadge status={a.status} />
          </span>
          <span className={`ak-who${a.owner ? '' : ' nobody'}`}>
            {a.owner && <Avatar name={a.ownerName} size={20} title="" />}
            {who}{a.status === 'waiting' && a.waitingOn ? ` · waiting on ${a.waitingOn}` : ''}
          </span>
        </span>
      </a>
      {showClaim && canClaim(a, me) && (
        <button type="button" className="btn btn-primary btn-sm ak-item-claim" onClick={claim}><Hand size={15} aria-hidden="true" /> I’ll take it</button>
      )}
    </li>
  )
}

export function AskList({ asks, empty, showClaim = false }) {
  if (!asks.length) return <Empty>{empty}</Empty>
  return <ul className="ak-list">{asks.map((a) => <AskRow key={a.id} ask={a} showClaim={showClaim} />)}</ul>
}
