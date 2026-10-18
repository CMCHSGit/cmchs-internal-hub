/* One ask: what's needed, who has it, the buttons to pick it up, hand it
   back or finish it, the photos and the conversation. A panel on the right
   on a computer; the whole screen on a phone. */

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Hand, Check, Clock, Undo2, UserPlus, Pencil, Trash2, RotateCcw, Send, Flame, CalendarDays, Play, MoreHorizontal } from 'lucide-react'
import { Alert, Badge, Button, Loading } from '../../schedule/src/components/ui'
import { useStore } from './store.jsx'
import { useUi } from './App.jsx'
import { Avatar, Empty, Lightbox, Popover, RichText, StatusBadge, ccText, sentToText } from './ui.jsx'
import { PhotoAdder } from './NewAsk.jsx'
import { canClaim, dueLabel, firstName, isOverdue, LIMITS, mentionAt, mentionMatches, sentTo, timeAgo } from './model.js'

const WAITING_PICKS = ['Mindray', 'the customer', 'parts', 'a reply']

export default function AskPanel({ ask: a, onClose }) {
  const s = useStore()
  const ui = useUi()
  const { me, userById } = s
  const [thread, setThread] = useState(null)
  const [threadErr, setThreadErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [menu, setMenu] = useState(null) // 'give' | 'wait' | 'more'
  const [waitText, setWaitText] = useState('')
  const [big, setBig] = useState(null)
  const box = useRef(null)

  useEffect(() => s.watchThread(a.id, setThread, (e) => setThreadErr(e?.message || String(e))), [a.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { s.markSeen(a.id) }, [a.id, a.event?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const key = (e) => { if (e.key === 'Escape' && !menu && !big && !e.defaultPrevented) onClose() }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [menu, big, onClose])
  useEffect(() => { box.current?.focus() }, [a.id])

  const run = (fn, done) => async () => {
    setErr('')
    setMenu(null)
    setBusy(true)
    try {
      await fn()
      if (done) ui.toast(done)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  const mine = a.owner === me.uid
  const asker = a.createdBy === me.uid
  const admin = me.role === 'admin'
  const boss = asker || admin // may edit, delete and reassign
  const done = a.status === 'done'
  const late = isOverdue(a, s.today)
  const photosTop = (thread?.photos || []).filter((p) => !p.commentId)
  const photoById = useMemo(() => new Map((thread?.photos || []).map((p) => [p.id, p])), [thread])
  const comments = useMemo(() => [...(thread?.comments || [])].sort((x, y) => x.atMs - y.atMs), [thread])
  const names = useMemo(() => s.users.map((u) => u.name), [s.users])

  const giveList = useMemo(() => {
    const first = new Set([...(a.assignees || []), ...s.users.filter((u) => a.teams.includes(u.team)).map((u) => u.uid)])
    return [...s.users].filter((u) => u.uid !== a.owner).sort((x, y) => first.has(y.uid) - first.has(x.uid) || x.name.localeCompare(y.name))
  }, [s.users, a])

  return (
    <aside className="ak-panel" aria-label={`Ask: ${a.title}`} ref={box} tabIndex={-1}>
      <div className="stripe-rule" style={{ height: 4, flex: '0 0 auto' }} aria-hidden="true"><span /><span /><span /></div>
      <div className="ak-panel-head">
        <div className="ak-panel-title">
          <div className="ak-row ak-wrap">
            <StatusBadge status={a.status} />
            {a.urgent && !done && <Badge tone="critical"><Flame size={12} aria-hidden="true" /> Urgent</Badge>}
            {a.due && !done && <span className={`ak-due${late ? ' late' : ''}`}><CalendarDays size={14} aria-hidden="true" /> {dueLabel(a.due, s.today)}</span>}
          </div>
          <h2 className="ak-h2">{a.title}</h2>
        </div>
        <button type="button" className="icon-btn icon-btn-md" aria-label="Close" onClick={onClose}><X size={20} /></button>
      </div>

      <dl className="ak-facts">
        <dt>Asked by</dt>
        <dd><Avatar name={a.createdByName} size={22} /> {asker ? 'You' : a.createdByName} <span className="text-muted">· {timeAgo(a.createdAtMs)}</span></dd>
        <dt>Sent to</dt>
        <dd>{sentToText(a, userById, me.uid)}</dd>
        {(a.cc || []).length > 0 && <><dt>CC</dt><dd>{ccText(a, userById, me.uid)}</dd></>}
        <dt>{done ? 'Done by' : 'Who has it'}</dt>
        <dd>
          {a.owner
            ? <><Avatar name={a.ownerName} size={22} /> <b>{mine ? 'You' : a.ownerName}</b>{a.status === 'waiting' && <span className="text-muted"> · waiting on {a.waitingOn || 'someone else'}</span>}{done && <span className="text-muted"> · {timeAgo(a.doneAtMs)}</span>}</>
            : <span className="ak-nobody">Nobody yet</span>}
        </dd>
      </dl>

      <div className="ak-actions">
        {!done && canClaim(a, me) && <Button iconLeft={<Hand size={16} />} disabled={busy} onClick={run(() => s.claim(a), 'It’s yours. Everyone else can see you have it.')}>I’ll take it</Button>}
        {!done && (mine || boss || (sentTo(a, me) && !a.owner)) && (
          <Button variant={mine ? 'primary' : 'secondary'} iconLeft={<Check size={16} />} disabled={busy} onClick={run(() => s.markDone(a), 'Marked done')}>Mark done</Button>
        )}
        {!done && mine && a.status === 'waiting' && <Button variant="secondary" iconLeft={<Play size={16} />} disabled={busy} onClick={run(() => s.resume(a))}>Back on it</Button>}
        {!done && (mine || (!a.owner && sentTo(a, me))) && a.status !== 'waiting' && (
          <span className="ak-popwrap">
            <Button variant="secondary" iconLeft={<Clock size={16} />} disabled={busy} onClick={() => setMenu(menu === 'wait' ? null : 'wait')} aria-expanded={menu === 'wait'}>Waiting on…</Button>
            <Popover open={menu === 'wait'} onClose={() => setMenu(null)} className="ak-waitpop">
              <form onSubmit={(e) => { e.preventDefault(); run(() => s.setWaiting(a, waitText), 'Marked as waiting')() }} className="ak-stack-sm">
                <span className="field-label">Waiting on</span>
                <div className="ak-row ak-wrap">{WAITING_PICKS.map((w) => <button key={w} type="button" className="tag" onClick={() => setWaitText(w)}>{w}</button>)}</div>
                <input className="input" value={waitText} maxLength={LIMITS.waitingOn} onChange={(e) => setWaitText(e.target.value)} placeholder="Who or what" autoFocus />
                <Button type="submit" size="sm">Save</Button>
              </form>
            </Popover>
          </span>
        )}
        {!done && a.owner && (mine || boss) && (
          <Button variant="ghost" iconLeft={<Undo2 size={16} />} disabled={busy}
            onClick={run(() => s.handBack(a), mine ? 'Handed back. It’s open for someone else.' : 'Back in the pool for someone to pick up')}>
            {mine ? 'Hand back' : 'Put back in the pool'}
          </Button>
        )}
        {!done && (mine || boss) && (
          <span className="ak-popwrap">
            <Button variant="ghost" iconLeft={<UserPlus size={16} />} disabled={busy} onClick={() => setMenu(menu === 'give' ? null : 'give')} aria-expanded={menu === 'give'}>Give to…</Button>
            <Popover open={menu === 'give'} onClose={() => setMenu(null)} className="ak-givepop">
              <span className="field-label">Give it to</span>
              <div className="ak-givelist">
                {giveList.map((u) => (
                  <button key={u.uid} type="button" className="ak-giveitem" onClick={run(() => s.giveTo(a, u), `Given to ${u.uid === me.uid ? 'you' : firstName(u.name)}`)}>
                    <Avatar name={u.name} size={24} title="" /> <span className="ak-grow">{u.uid === me.uid ? `${u.name} (me)` : u.name}</span> <span className="text-sm text-muted">{u.team}</span>
                  </button>
                ))}
              </div>
            </Popover>
          </span>
        )}
        {done && (mine || boss || sentTo(a, me)) && <Button variant="secondary" iconLeft={<RotateCcw size={16} />} disabled={busy} onClick={run(() => s.reopen(a), 'Reopened')}>Reopen</Button>}
        {boss && (
          <span className="ak-popwrap ak-more">
            <button type="button" className="icon-btn icon-btn-md" aria-label="More" aria-expanded={menu === 'more'} onClick={() => setMenu(menu === 'more' ? null : 'more')}><MoreHorizontal size={20} /></button>
            <Popover open={menu === 'more'} onClose={() => setMenu(null)} className="ak-menu">
              <button type="button" onClick={() => { setMenu(null); ui.editAsk(a) }}><Pencil size={16} aria-hidden="true" /> Edit</button>
              <button type="button" className="ak-danger" onClick={() => {
                setMenu(null)
                if (window.confirm('Delete this ask, its comments and photos? This can’t be undone.')) run(async () => { await s.remove(a); onClose() }, 'Ask deleted')()
              }}><Trash2 size={16} aria-hidden="true" /> Delete</button>
            </Popover>
          </span>
        )}
      </div>
      {err && <div className="ak-pad"><Alert tone="critical" title="That didn’t work">{err}</Alert></div>}

      <div className="ak-panel-body">
        {a.details && <p className="ak-details"><RichText text={a.details} /></p>}
        {photosTop.length > 0 && (
          <div className="ak-gallery">
            {photosTop.map((p) => <button key={p.id} type="button" className="ak-photo" onClick={() => setBig(p.data)} aria-label="Open photo"><img src={p.data} alt="" /></button>)}
          </div>
        )}

        <h3 className="ak-h4">Conversation</h3>
        {threadErr && <Alert tone="critical" title="Couldn’t load the conversation">{threadErr}</Alert>}
        {!thread && !threadErr && <Loading />}
        {thread && !comments.length && <Empty>No comments yet. Ask a question or post an update here: everyone involved sees it.</Empty>}
        <ol className="ak-thread">
          {comments.map((c) => (
            <li key={c.id} className={`ak-comment${c.uid === me.uid ? ' me' : ''}`}>
              <Avatar name={c.name} size={28} />
              <div className="ak-bubble">
                <div className="ak-comment-head">
                  <b>{c.uid === me.uid ? 'You' : c.name}</b>
                  <span className="text-sm text-muted">{timeAgo(c.atMs)}</span>
                  {(c.uid === me.uid || admin) && (
                    <button type="button" className="ak-comment-x" aria-label="Delete this comment"
                      onClick={() => { if (window.confirm('Delete this comment?')) run(() => s.removeComment(a, c))() }}><Trash2 size={14} /></button>
                  )}
                </div>
                {c.text && <p><RichText text={c.text} names={names} /></p>}
                {(c.photoIds || []).length > 0 && (
                  <div className="ak-gallery small">
                    {c.photoIds.map((id) => photoById.get(id)).filter(Boolean).map((p) => (
                      <button key={p.id} type="button" className="ak-photo" onClick={() => setBig(p.data)} aria-label="Open photo"><img src={p.data} alt="" /></button>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
      <Composer ask={a} />
      {big && <Lightbox src={big} onClose={() => setBig(null)} />}
    </aside>
  )
}

/** Write a comment. Typing @ suggests people; they're told, and can then see the ask. */
function Composer({ ask }) {
  const s = useStore()
  const [text, setText] = useState('')
  const [photos, setPhotos] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [at, setAt] = useState(null) // { start, query }
  const [pick, setPick] = useState(0)
  const ta = useRef(null)
  const matches = useMemo(() => (at ? mentionMatches(s.users.filter((u) => u.uid !== s.me.uid), at.query) : []), [at, s.users, s.me.uid])

  const onType = (e) => {
    setText(e.target.value)
    setAt(mentionAt(e.target.value, e.target.selectionStart))
    setPick(0)
  }
  const choose = (u) => {
    const caret = ta.current.selectionStart
    const next = text.slice(0, at.start) + '@' + u.name + ' ' + text.slice(caret)
    setText(next)
    setAt(null)
    requestAnimationFrame(() => {
      const pos = at.start + u.name.length + 2
      ta.current.focus()
      ta.current.setSelectionRange(pos, pos)
    })
  }
  const send = async () => {
    if (busy || (!text.trim() && !photos.length)) return
    setBusy(true)
    setErr('')
    try {
      await s.comment(ask, text, photos)
      setText('')
      setPhotos([])
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }
  const key = (e) => {
    if (at && matches.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setPick((p) => (p + 1) % matches.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setPick((p) => (p - 1 + matches.length) % matches.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); choose(matches[pick]); return }
      if (e.key === 'Escape') { e.preventDefault(); setAt(null); return }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send() }
  }

  return (
    <div className="ak-composer">
      {err && <Alert tone="critical" title="Not sent">{err}</Alert>}
      {at && matches.length > 0 && (
        <ul className="ak-mentions" role="listbox" aria-label="Mention someone">
          {matches.map((u, i) => (
            <li key={u.uid} role="option" aria-selected={i === pick}>
              <button type="button" className={i === pick ? 'on' : ''} onMouseDown={(e) => { e.preventDefault(); choose(u) }}>
                <Avatar name={u.name} size={22} title="" /> {u.name} <span className="text-sm text-muted">{u.team}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {photos.length > 0 && <PhotoAdder photos={photos} setPhotos={setPhotos} max={LIMITS.photos} onError={setErr} />}
      <div className="ak-composer-row">
        <textarea ref={ta} className="input" rows={2} value={text} onChange={onType} onKeyDown={key} onBlur={() => setTimeout(() => setAt(null), 150)}
          maxLength={LIMITS.comment} placeholder="Write a comment. Type @ to bring someone in." aria-label="Comment" />
        {photos.length === 0 && <PhotoAdder photos={photos} setPhotos={setPhotos} max={LIMITS.photos} onError={setErr} compact />}
        <button type="button" className="ak-send" onClick={send} disabled={busy || (!text.trim() && !photos.length)} aria-label="Send comment" title="Send (Ctrl Enter)">
          <Send size={18} />
        </button>
      </div>
    </div>
  )
}
