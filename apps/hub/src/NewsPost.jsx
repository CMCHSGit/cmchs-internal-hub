// A company news post like a social feed: reactions on every card, and a page
// of its own (#/news/<id>) with the whole text, every photo and the comments.
// Data: social.js (reactions, comments, notifications), news.js (the posts).
import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { navigate } from './router.js'
import { TONE, canEdit, categoryOf, loadNews, loadPhotos, shortDate } from './news.js'
import {
  REACTIONS, addComment, deleteComment, editComment, initialsOf, loadMe, reactionSummary, setReaction, timeAgo,
  watchComments, watchPost,
} from './social.js'
import { Dialog, Linked } from './ui.jsx'

export const postUrl = id => `#/news/${encodeURIComponent(id)}`

// ── Reactions ─────────────────────────────────────────────────────────────

/**
 * The bar under a post: who reacted (emoji and count), how many comments, and
 * React / Comment / Share. Tapping React likes it (or takes yours back); the
 * smile, or holding the pointer over React, opens all six.
 */
export function ReactionBar({ post, uid, onComment, compact = false }) {
  const [reactions, setReactions] = useState(post.reactions || {})
  const [picker, setPicker] = useState(false)
  const [error, setError] = useState('')
  const hover = useRef(null)
  useEffect(() => { setReactions(post.reactions || {}) }, [post.reactions])
  const s = reactionSummary(reactions, uid)
  const mine = REACTIONS.find(r => r.id === s.mine)
  const comments = post.commentCount || 0

  async function react(id) {
    setPicker(false)
    const next = id === s.mine ? null : id
    const before = reactions
    setReactions(r => { const x = { ...r }; if (next) x[uid] = next; else delete x[uid]; return x })
    try { await setReaction(post.id, uid, next); setError('') }
    catch (e) { console.error(e); setReactions(before); setError('Couldn’t save that. Try again.') }
  }
  async function share() {
    const url = new URL(postUrl(post.id), location.origin + '/').href
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) await navigator.share({ title: post.title, url })
      else { await navigator.clipboard.writeText(url); setError('Link copied.') }
    } catch { /* closed the share sheet */ }
  }

  if (post.legacy) return null
  return (
    <div className={`rx ${compact ? 'rx-compact' : ''}`} onClick={e => e.stopPropagation()}>
      {(s.total > 0 || comments > 0) && (
        <div className="rx-summary">
          {s.total > 0 && (
            <span className="rx-faces" title={s.top.map(r => `${r.emoji} ${r.count}`).join('  ')}>
              <span className="rx-stack">{s.top.slice(0, 3).map(r => <span key={r.id} className="rx-face">{r.emoji}</span>)}</span>
              <span>{mine ? (s.total === 1 ? 'You' : `You and ${s.total - 1} other${s.total === 2 ? '' : 's'}`) : s.total}</span>
            </span>
          )}
          {comments > 0 && <button type="button" className="rx-count-link" onClick={onComment}>{comments} comment{comments === 1 ? '' : 's'}</button>}
        </div>
      )}
      <div className="rx-actions"
        onPointerLeave={() => { clearTimeout(hover.current); hover.current = setTimeout(() => setPicker(false), 350) }}
        onPointerEnter={() => clearTimeout(hover.current)}>
        {picker && (
          <div className="rx-picker" role="menu" aria-label="Choose a reaction">
            {REACTIONS.map((r, i) => (
              <button key={r.id} type="button" role="menuitem" className={`rx-pick ${s.mine === r.id ? 'on' : ''}`}
                style={{ animationDelay: `${i * 25}ms` }} onClick={() => react(r.id)} title={r.label} aria-label={r.label}>
                <span>{r.emoji}</span>
              </button>
            ))}
          </div>
        )}
        <button type="button" className={`rx-btn ${mine ? 'on' : ''}`} aria-pressed={!!mine}
          onClick={() => react(s.mine || 'like')}
          onPointerEnter={e => { if (e.pointerType === 'mouse') { clearTimeout(hover.current); hover.current = setTimeout(() => setPicker(true), 450) } }}
          onContextMenu={e => { e.preventDefault(); setPicker(true) }}>
          {mine ? <span className="rx-btn-emoji">{mine.emoji}</span> : <Icon name="thumbs-up" size={18} />}
          <span>{mine ? mine.label : 'Like'}</span>
        </button>
        <button type="button" className="rx-btn rx-more" onClick={() => setPicker(p => !p)} aria-label="More reactions" aria-expanded={picker} title="More reactions">
          <Icon name="smile" size={18} />
        </button>
        <button type="button" className="rx-btn" onClick={onComment}><Icon name="message-circle" size={18} /><span>Comment</span></button>
        {!compact && <button type="button" className="rx-btn" onClick={share}><Icon name="share" size={18} /><span>Share</span></button>}
      </div>
      {error && <span className="caption rx-note">{error}</span>}
    </div>
  )
}

// ── The post page ─────────────────────────────────────────────────────────

// The list from the last visit, so opening a post from the home page is instant.
let cached = null

export default function NewsPost({ user, id }) {
  const [post, setPost] = useState(() => cached?.find(a => a.id === id) || undefined)
  const [live, setLive] = useState(null)
  const [photos, setPhotos] = useState(null)
  const [comments, setComments] = useState(null)
  const [me, setMe] = useState({ uid: user.uid, name: user.displayName || '', admin: false })
  const [view, setView] = useState(-1)
  const composer = useRef(null)

  useEffect(() => { loadMe(user).then(setMe) }, [user.uid])
  useEffect(() => {
    loadNews().then(list => { cached = list; setPost(list.find(a => a.id === id) || null) })
  }, [id])
  useEffect(() => {
    let off = () => {}, on = true
    watchPost(id, p => on && setLive(p)).then(u => { if (on) off = u; else u() })
    let offC = () => {}
    watchComments(id, c => on && setComments(c)).then(u => { if (on) offC = u; else u() })
    return () => { on = false; off(); offC() }
  }, [id])
  useEffect(() => { if (post) loadPhotos(post).then(setPhotos) }, [post?.id, post?.photoCount])
  // Opened from a "commented" notification or the Comment button: go to the comments.
  useEffect(() => {
    if (comments && /[?&]c=1/.test(location.hash)) composer.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [comments === null])

  if (post === undefined) return <main className="np-page" aria-busy="true"><div className="card np-card np-skeleton" /></main>
  if (post === null || (live === null && !post.legacy)) {
    return (
      <main className="np-page">
        <a className="btn-ghost-sm" href="#/"><Icon name="chevron-left" size={16} /> Back to the hub</a>
        <div className="card pp-empty">This post has been taken down.</div>
      </main>
    )
  }

  const full = { ...post, ...(live || {}), id }
  const cat = categoryOf(full)
  const goComments = () => composer.current?.focus()
  const cover = photos?.length ? photos : full.image ? [full.image.startsWith('/') || /^https?:/.test(full.image) ? full.image : '/' + full.image] : []

  return (
    <main className="np-page">
      <button type="button" className="btn-ghost-sm self-start" onClick={() => (history.length > 1 ? history.back() : navigate('#/'))}>
        <Icon name="chevron-left" size={16} /> Back
      </button>
      <article className="card np-card">
        <header className="np-head">
          <span className={`np-avatar np-avatar-${TONE[cat]}`}>{initialsOf(full.author)}</span>
          <div className="np-who">
            <span className="np-author">{full.author || 'CMCHS'}</span>
            <span className="caption">{shortDate(full.date)}</span>
          </div>
          <div className="np-badges">
            {full.pinned && <span className="badge badge-orange-solid">Pinned</span>}
            <span className={`badge badge-${TONE[cat]}`}>{cat}</span>
          </div>
        </header>
        <h1 className="np-title">{full.title}</h1>
        {full.body && <p className="np-text"><Linked text={full.body} /></p>}
        {cover.length > 0 && (
          <div className={`np-photos np-photos-${Math.min(cover.length, 3)}`}>
            {cover.slice(0, 4).map((p, i) => (
              <button key={i} type="button" className="np-photo" onClick={() => setView(i)} aria-label={`Open photo ${i + 1}`}>
                <img src={p} alt="" />
                {i === 3 && cover.length > 4 && <span className="np-photo-more">+{cover.length - 4}</span>}
              </button>
            ))}
          </div>
        )}
        {photos === null && full.photoCount > 0 && <div className="np-photos-loading" aria-busy="true" />}
        {full.legacy
          ? <span className="caption np-legacy">Reactions and comments open once an admin moves this older post into Manage.</span>
          : <ReactionBar post={full} uid={user.uid} onComment={goComments} />}
        {canEdit(me.admin ? { ...me, role: 'admin' } : me, full) && (
          <a className="btn-ghost-sm self-start np-edit" href="#/manage"><Icon name="pencil" size={16} /> Edit in Manage</a>
        )}
      </article>

      {!full.legacy && (
        <section className="card np-comments" aria-label="Comments">
          <h3 className="np-comments-head">Comments {comments?.length ? <span className="np-count">{comments.length}</span> : null}</h3>
          {comments === null
            ? <span className="caption">Loading…</span>
            : comments.length === 0
              ? <span className="body-sm muted np-first">No comments yet. Say something nice.</span>
              : <ul className="np-thread">{comments.map(c => <Comment key={c.id} c={c} me={me} postId={id} postAuthor={full.authorUid} />)}</ul>}
          <Composer inputRef={composer} me={me} postId={id} />
        </section>
      )}

      {view >= 0 && cover[view] && (
        <Dialog title={`Photo ${view + 1} of ${cover.length}`} onClose={() => setView(-1)} wide>
          <div className="np-viewer">
            <img src={cover[view]} alt="" />
            {cover.length > 1 && (
              <div className="np-viewer-nav">
                <button type="button" className="btn btn-secondary" disabled={view === 0} onClick={() => setView(v => v - 1)}><Icon name="chevron-left" size={16} /> Previous</button>
                <button type="button" className="btn btn-secondary" disabled={view === cover.length - 1} onClick={() => setView(v => v + 1)}>Next <Icon name="chevron-right" size={16} /></button>
              </div>
            )}
          </div>
          <div className="pp-section-foot"><button className="btn btn-primary" onClick={() => setView(-1)}>Close</button></div>
        </Dialog>
      )}
    </main>
  )
}

function Comment({ c, me, postId, postAuthor }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(c.text)
  const [busy, setBusy] = useState(false)
  const mine = c.uid === me.uid
  const canDelete = mine || me.admin || postAuthor === me.uid

  async function save() {
    if (!text.trim() || text.trim() === c.text) { setEditing(false); return }
    setBusy(true)
    try { await editComment(postId, c.id, text); setEditing(false) } catch (e) { console.error(e) } finally { setBusy(false) }
  }
  async function remove() {
    if (!confirm('Delete this comment?')) return
    setBusy(true)
    try { await deleteComment(postId, c.id) } catch (e) { console.error(e); setBusy(false) }
  }

  return (
    <li className="np-comment">
      <span className="np-avatar np-avatar-sm">{initialsOf(c.name)}</span>
      <div className="np-comment-main">
        {editing
          ? <div className="np-edit-box">
              <textarea className="pp-input" rows={2} value={text} autoFocus onChange={e => setText(e.target.value)} maxLength={2000}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() } if (e.key === 'Escape') setEditing(false) }} />
              <div className="tag-row">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>Save</button>
                <button type="button" className="btn-ghost-sm" onClick={() => { setText(c.text); setEditing(false) }}>Cancel</button>
              </div>
            </div>
          : <div className="np-bubble">
              <span className="np-bubble-name">{c.name || 'Someone'}</span>
              <span className="np-bubble-text"><Linked text={c.text} /></span>
            </div>}
        <div className="np-comment-meta">
          <span title={new Date(c.atMs).toLocaleString('en-NZ')}>{timeAgo(c.atMs)}</span>
          {c.editedAtMs && <span>Edited</span>}
          {mine && !editing && <button type="button" onClick={() => setEditing(true)}>Edit</button>}
          {canDelete && !editing && <button type="button" onClick={remove} disabled={busy}>Delete</button>}
        </div>
      </div>
    </li>
  )
}

function Composer({ inputRef, me, postId }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const box = useRef(null)
  useEffect(() => { if (inputRef) inputRef.current = box.current }, [])
  // Grows with what's typed, up to a point.
  useEffect(() => { const t = box.current; if (t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 180) + 'px' } }, [text])

  async function send() {
    if (!text.trim() || busy) return
    setBusy(true); setError('')
    try { await addComment(postId, me, text); setText('') }
    catch (e) { console.error(e); setError('Couldn’t post that. Check your connection and try again.') }
    finally { setBusy(false) }
  }
  return (
    <div className="np-composer">
      <span className="np-avatar np-avatar-sm">{initialsOf(me.name)}</span>
      <div className="np-composer-box">
        <textarea ref={box} rows={1} placeholder="Write a comment…" value={text} maxLength={2000} aria-label="Write a comment"
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send() } }} />
        <button type="button" className="np-send" onClick={send} disabled={!text.trim() || busy} aria-label="Post comment" title="Post comment">
          <Icon name="send" size={18} />
        </button>
      </div>
      {error && <span className="caption np-error">{error}</span>}
    </div>
  )
}
