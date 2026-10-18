// Manage (#/manage): company news, tool requests and feedback.
//
//   News           post announcements for the home page; paste the project
//                  team's weekly email and get one announcement per item;
//                  suggestions from the project tracker; export a selection
//                  as the team-wide email (copies into Outlook formatted)
//   Tool requests  anyone asks for a tool; others +1; engineering replies
//   Feedback       a short survey per tool; engineering sees the averages
//
// Data and who-can-do-what: news.js, requests.js, suggest.js, emailSplit.js.
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from './Icon.jsx'
import { Dialog, Linked, Toast, failMsg, useToast } from './ui.jsx'
import { loadDirectory } from './people.js'
import { tools } from './tools.js'
import { splitEmail } from './emailSplit.js'
import { loadProjectSuggestions } from './suggest.js'
import { notifyNews } from './social.js'
import {
  CATEGORIES, REGIONS, SECTIONS, TONE, buildEmail, canEdit, canPost, categoryOf, deleteAnnouncement, findSimilar, isoToday,
  MAX_NEWS_PHOTOS, loadNews, loadPhoto, loadPhotos, mondayOf, moveLegacy, newsPhotoFromFile, photoCountOf, postDrafts, saveAnnouncement, shortDate, addDays,
} from './news.js'
import {
  STATUSES, URGENCY, deleteRequest, feedbackSummary, isEngineering, loadRequests, respond, sendRequest, statusOf, toggleVote,
} from './requests.js'

// New posts in these categories notify everyone's phones unless unticked.
const NOTIFY_BY_DEFAULT = ['Announcements', 'Events']

const TABS = [['news', 'News'], ['requests', 'Tool requests'], ['feedback', 'Feedback']]
const TOOL_NAMES = { hub: 'The Internal Hub overall', ...Object.fromEntries(tools.map(t => [t.id, t.name])) }

export default function Manage({ user, route }) {
  const tab = TABS.some(([id]) => id === route.tab) ? route.tab : 'news'
  const [dir, setDir] = useState(null)
  const [toast, showToast] = useToast()
  useEffect(() => { loadDirectory(user, async () => null).then(setDir).catch(e => { console.error(e); setDir({ users: [], directory: [] }) }) }, [])

  if (!dir) return <main className="pp-page" aria-busy="true"><span className="caption">Loading…</span></main>
  const me = dir.users.find(u => u.uid === user.uid) || { uid: user.uid, displayName: user.displayName, email: user.email }
  const people = dir.users.map(u => ({ uid: u.uid, names: [u.displayName?.split(/\s+/)[0], u.displayName, u.excelName].filter(Boolean) }))
  const ctx = { user, me: { ...me, uid: user.uid }, people, directory: dir.directory, showToast }

  return (
    <main className="pp-page">
      <div className="pp-head">
        <div className="section-head-text">
          <span className="section-stripes" aria-hidden="true"><span style={{ background: '#ef7d00' }} /><span style={{ background: '#554596' }} /></span>
          <span className="chs-overline">Manage</span>
          <h2>{tab === 'news' ? 'News and announcements' : tab === 'requests' ? 'Tool requests' : 'Feedback'}</h2>
        </div>
      </div>
      <div className="pp-tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <a key={id} role="tab" aria-selected={tab === id} className={`pp-tab ${tab === id ? 'on' : ''}`} href={id === 'news' ? '#/manage' : `#/manage/${id}`}>{label}</a>
        ))}
      </div>
      {tab === 'news' && <NewsTab ctx={ctx} />}
      {tab === 'requests' && <RequestsTab ctx={ctx} />}
      {tab === 'feedback' && <FeedbackTab ctx={ctx} />}
      <Toast text={toast} />
    </main>
  )
}

// ── News ──────────────────────────────────────────────────────────────────

function NewsTab({ ctx }) {
  const [list, setList] = useState(null)
  const [mode, setMode] = useState('list') // list | paste | export
  const [editing, setEditing] = useState(null)
  const [cat, setCat] = useState('All')
  const [region, setRegion] = useState('')
  const poster = canPost(ctx.me)
  const reload = () => loadNews().then(setList)
  useEffect(() => { reload() }, [])

  if (!list) return <span className="caption">Loading…</span>
  if (mode === 'paste') return <PasteEmail ctx={ctx} list={list} onDone={() => { setMode('list'); reload() }} />
  if (mode === 'export') return <ExportEmail ctx={ctx} list={list} onDone={() => setMode('list')} />

  const legacy = list.filter(a => a.legacy)
  const shown = list.filter(a => (cat === 'All' || categoryOf(a) === cat) && (!region || (a.regions || []).includes(region)))

  async function moveAll() {
    try {
      await moveLegacy(ctx.me, legacy)
      ctx.showToast(`Moved ${legacy.length} into Manage.`)
      reload()
    } catch (e) { ctx.showToast(failMsg(e)) }
  }

  return (
    <div className="stack-16">
      <div className="mg-actions">
        {poster && <button className="btn btn-primary" onClick={() => setEditing({ category: 'Announcements', date: isoToday(), regions: [] })}><Icon name="plus" size={16} /> New announcement</button>}
        {poster && <button className="btn btn-secondary" onClick={() => setMode('paste')}><Icon name="clipboard-paste" size={16} /> Paste an email</button>}
        <button className="btn btn-secondary" onClick={() => setMode('export')}><Icon name="mail" size={16} /> Export for email</button>
      </div>
      {!poster && <div className="alert">Posting is for people on a team. Pick your team in the staff schedule, or ask an admin.</div>}
      {ctx.me.role === 'admin' && legacy.length > 0 && (
        <div className="card mg-note">
          <span className="body-sm">{legacy.length} older announcement{legacy.length === 1 ? ' is' : 's are'} still in <code>announcements.json</code>, so {legacy.length === 1 ? 'it' : 'they'} can only be changed in Git.</span>
          <button className="btn btn-secondary" onClick={moveAll}>Move into Manage</button>
        </div>
      )}
      <div className="dir-filters">
        <div className="tag-row">
          {['All', ...CATEGORIES].map(c => <button key={c} className={`tag ${cat === c ? 'tag-on' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <select className="pp-input mg-select" value={region} onChange={e => setRegion(e.target.value)} aria-label="Region">
          <option value="">Any region</option>
          {REGIONS.map(r => <option key={r}>{r}</option>)}
        </select>
      </div>
      {shown.length
        ? <div className="mg-list">{shown.map(a => <NewsRow key={a.id} a={a} ctx={ctx} onEdit={() => setEditing(a)} />)}</div>
        : <div className="card pp-empty">Nothing here yet.</div>}
      {editing && <AnnouncementEditor ctx={ctx} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload() }} />}
    </div>
  )
}

function NewsRow({ a, ctx, onEdit }) {
  const [photo, setPhoto] = useState('')
  useEffect(() => { if (a.hasPhoto) loadPhoto(a.id).then(setPhoto) }, [a.id, a.hasPhoto])
  const img = photo || (a.image ? (/^(https?:)?\/\//.test(a.image) || a.image.startsWith('/') ? a.image : '/' + a.image) : '')
  return (
    <article className="card mg-row">
      {img ? <img className="mg-thumb" src={img} alt="" /> : <span className="mg-thumb mg-thumb-empty"><Icon name="file-text" size={20} /></span>}
      <div className="mg-row-text">
        <div className="news-meta">
          {a.pinned && <span className="badge badge-orange-solid">Pinned</span>}
          <span className={`badge badge-${TONE[categoryOf(a)]}`}>{categoryOf(a)}</span>
          {a.section && <span className="caption">{SECTIONS[a.section]}</span>}
          {(a.regions || []).map(r => <span key={r} className="mg-region">{r}</span>)}
        </div>
        <span className="person-name">{a.title}</span>
        {a.body && <span className="body-sm mg-clamp"><Linked text={a.body} /></span>}
        <span className="caption">{[shortDate(a.date), a.author].filter(Boolean).join(' · ')}{a.legacy ? ' · in announcements.json' : ''}</span>
      </div>
      {canEdit(ctx.me, a) && <button className="icon-btn" onClick={onEdit} aria-label={`Edit ${a.title}`} title="Edit"><Icon name="pencil" size={18} /></button>}
    </article>
  )
}

function RegionPicker({ value, onChange }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="mg-regions">
      {value.map(r => (
        <button key={r} type="button" className="mg-region mg-region-on" onClick={() => onChange(value.filter(x => x !== r))} aria-label={`Remove ${r}`}>{r} ×</button>
      ))}
      {adding
        ? <select className="pp-input mg-select-sm" autoFocus value="" onBlur={() => setAdding(false)}
            onChange={e => { if (e.target.value) onChange([...value, e.target.value]); setAdding(false) }} aria-label="Add a region">
            <option value="">Region…</option>
            {REGIONS.filter(r => !value.includes(r)).map(r => <option key={r}>{r}</option>)}
          </select>
        : <button type="button" className="mg-region mg-region-add" onClick={() => setAdding(true)}>+ Region</button>}
    </div>
  )
}

function AnnouncementEditor({ ctx, initial, onClose, onSaved }) {
  const [a, setA] = useState({ title: '', body: '', section: '', pinned: false, ...initial, regions: initial.regions || [] })
  const [photos, setPhotos] = useState(initial.id && photoCountOf(initial) ? null : []) // null = still loading
  const [changed, setChanged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const file = useRef(null)
  const set = k => v => setA(x => ({ ...x, [k]: v }))
  useEffect(() => { if (photos === null) loadPhotos(initial).then(setPhotos) }, [])
  const setList = fn => { setPhotos(p => fn(p || [])); setChanged(true) }
  // A new post: tell everyone's phones? On by default for Announcements and Events, until touched.
  const [notify, setNotify] = useState(null)
  const notifyOn = notify ?? NOTIFY_BY_DEFAULT.includes(categoryOf(a))

  async function pick(e) {
    const files = [...(e.target.files || [])]
    e.target.value = ''
    const room = MAX_NEWS_PHOTOS - (photos || []).length
    if (files.length > room) setError(`Up to ${MAX_NEWS_PHOTOS} photos, so only the first ${room} were added.`)
    else setError('')
    try {
      const added = []
      for (const f of files.slice(0, room)) added.push(await newsPhotoFromFile(f))
      if (added.length) setList(p => [...p, ...added])
    } catch (err) { setError(err.message) }
  }
  async function save(e) {
    e.preventDefault()
    if (photos === null) return
    setBusy(true); setError('')
    try {
      const notifyTeam = !initial.id && notifyOn
      const saved = await saveAnnouncement(ctx.me, { ...a, notifyTeam }, changed ? photos : undefined)
      if (notifyTeam) notifyNews({ id: saved.id })
      ctx.showToast(initial.id ? 'Saved.' : notifyTeam ? 'Posted, and on its way to everyone’s phones.' : 'Posted. It’s on the home page now.')
      onSaved()
    } catch (err) { console.error(err); setError(failMsg(err)); setBusy(false) }
  }
  async function remove() {
    if (!confirm(`Delete “${a.title}”? It comes off the home page straight away.`)) return
    setBusy(true)
    try { await deleteAnnouncement(a); ctx.showToast('Deleted.'); onSaved() } catch (err) { setError(failMsg(err)); setBusy(false) }
  }

  return (
    <Dialog title={initial.id ? 'Edit announcement' : 'New announcement'} onClose={onClose} wide>
      <form className="stack-16" onSubmit={save}>
        <label className="pp-label">Title<input className="pp-input" value={a.title} onChange={e => set('title')(e.target.value)} required maxLength={200} autoFocus /></label>
        <label className="pp-label">Message<textarea className="pp-input mg-textarea" rows={5} value={a.body} onChange={e => set('body')(e.target.value)} maxLength={4000} /></label>
        <div className="pp-two">
          <label className="pp-label">Category
            <select className="pp-input" value={categoryOf(a)} onChange={e => set('category')(e.target.value)}>
              {CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          {categoryOf(a) === 'Team news'
            ? <label className="pp-label">Section
                <select className="pp-input" value={a.section || ''} onChange={e => set('section')(e.target.value)}>
                  <option value="">Neither</option><option value="been">{SECTIONS.been}</option><option value="next">{SECTIONS.next}</option>
                </select>
              </label>
            : <label className="pp-label">Date<input className="pp-input" type="date" value={a.date || ''} onChange={e => set('date')(e.target.value)} /></label>}
        </div>
        <div className="pp-label">Regions<RegionPicker value={a.regions} onChange={set('regions')} /></div>
        <div className="mg-photo">
          {photos === null
            ? <span className="caption">Loading photos…</span>
            : photos.length
              ? <div className="mg-photos">
                  {photos.map((p, i) => (
                    <figure key={i} className="mg-photo-item">
                      <img src={p} alt="" />
                      {i === 0 && photos.length > 1 && <span className="badge badge-purple mg-photo-cover">Cover</span>}
                      <div className="mg-photo-tools">
                        {i > 0 && <button type="button" className="icon-btn" title="Make this the cover" aria-label="Make this the cover"
                          onClick={() => setList(l => [l[i], ...l.filter((_, j) => j !== i)])}><Icon name="chevron-left" size={14} /></button>}
                        <button type="button" className="icon-btn" title="Remove" aria-label="Remove this photo"
                          onClick={() => setList(l => l.filter((_, j) => j !== i))}><Icon name="trash" size={14} /></button>
                      </div>
                    </figure>
                  ))}
                </div>
              : <span className="caption">No photos. The first one shows on the home page card; all of them go in the email.</span>}
          <input ref={file} type="file" accept="image/*" multiple hidden onChange={pick} />
          {photos !== null && photos.length < MAX_NEWS_PHOTOS && (
            <button type="button" className="btn-ghost-sm self-start" onClick={() => file.current.click()}>
              <Icon name="camera" size={16} /> {photos.length ? 'Add more photos' : 'Add photos'}
            </button>
          )}
        </div>
        <label className="mg-check"><input type="checkbox" checked={!!a.pinned} onChange={e => set('pinned')(e.target.checked)} /> Pin to the top of the home page</label>
        {!initial.id && (
          <label className="mg-check"><input type="checkbox" checked={notifyOn} onChange={e => setNotify(e.target.checked)} /> <Icon name="bell" size={16} /> Notify everyone’s phones</label>
        )}
        {!initial.id && (
          <div className="mg-suggest-box">
            <button type="button" className="btn-ghost-sm" onClick={() => setSuggesting(s => !s)}><Icon name="folder-kanban" size={16} /> {suggesting ? 'Hide' : 'Suggestions from the project tracker'}</button>
            {suggesting && <Suggestions ctx={ctx} onPick={s => setA(x => ({ ...x, title: s.title, category: 'Team news', section: s.section, regions: s.regions, people: s.people }))} />}
          </div>
        )}
        {error && <div className="alert">{error}</div>}
        <div className="pp-section-foot">
          {initial.id && <button type="button" className="btn btn-danger-ghost mg-left" onClick={remove} disabled={busy}>Delete</button>}
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || photos === null}>{busy ? 'Saving…' : initial.id ? 'Save' : 'Post'}</button>
        </div>
      </form>
    </Dialog>
  )
}

/** This week's and next week's work from the project tracker, as ready-made lines. */
function Suggestions({ ctx, onPick, exclude = [] }) {
  const [s, setS] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    loadProjectSuggestions(ctx.people).then(setS).catch(e => { console.error(e); setError('Couldn’t read the project tracker.') })
  }, [])
  if (error) return <span className="caption">{error}</span>
  if (!s) return <span className="caption">Looking at the project tracker…</span>
  const groups = [['been', SECTIONS.been], ['next', SECTIONS.next]].map(([k, label]) => [label, s[k].filter(x => !exclude.includes(x.key))])
  if (!groups.some(([, xs]) => xs.length)) return <span className="caption">Nothing in the project tracker for this week or next.</span>
  return (
    <div className="mg-suggestions">
      {groups.map(([label, xs]) => xs.length > 0 && (
        <div key={label} className="stack-10">
          <span className="chs-overline">{label}</span>
          {xs.map(x => (
            <button key={x.key} type="button" className="mg-suggestion" onClick={() => onPick(x)}>
              <Icon name="plus" size={14} /><span>{x.title}</span>
              {x.regions.map(r => <span key={r} className="mg-region">{r}</span>)}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ── Paste an email ────────────────────────────────────────────────────────

/** "Post 3 announcements", "Update 1", "Post 3 announcements · update 1". */
function postLabel(posts, updates, [post, update]) {
  const p = posts || !updates ? `${post} ${posts} announcement${posts === 1 ? '' : 's'}` : ''
  const u = updates ? `${update} ${updates}` : ''
  const s = [p, u].filter(Boolean).join(' · ')
  return s[0].toUpperCase() + s.slice(1)
}

function PasteEmail({ ctx, list, onDone }) {
  const [paste, setPaste] = useState({ html: '', text: '' })
  const [drafts, setDrafts] = useState(null)
  const [date, setDate] = useState(isoToday())
  const [notify, setNotify] = useState(true) // one "Team update" push for everything posted
  const [busy, setBusy] = useState(false)
  const [suggesting, setSuggesting] = useState(false)
  const [added, setAdded] = useState([])
  const names = useMemo(() => new Map(ctx.directory.map(p => [p.uid, p.shortName || p.name])), [ctx.directory])

  function onPaste(e) {
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    if (html) { e.preventDefault(); setPaste({ html, text }) }
    else setPaste({ html: '', text })
  }
  // A repeat of an existing post (a running event) starts unticked, with the option to update that post instead.
  const split = () => setDrafts(splitEmail(paste, { people: ctx.people }).map(d => {
    const match = findSimilar(d, list)
    return match ? { ...d, include: false, match } : d
  }))
  const update = (i, patch) => setDrafts(d => d.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const remove = i => setDrafts(d => d.filter((_, j) => j !== i))
  const merge = i => setDrafts(d => {
    const [a, b] = [d[i], d[i + 1]]
    const m = { ...a, body: [a.body, b.title, b.body].filter(Boolean).join('\n'), regions: [...new Set([...a.regions, ...b.regions])], people: [...new Set([...a.people, ...b.people])] }
    return [...d.slice(0, i), m, ...d.slice(i + 2)]
  })
  const splitBody = i => setDrafts(d => {
    const a = d[i]
    const parts = [a.title, ...a.body.split('\n')].map(x => x.trim()).filter(Boolean)
    return [...d.slice(0, i), ...parts.map((t, k) => ({ ...a, key: a.key + k, title: t, body: '' })), ...d.slice(i + 1)]
  })
  const chosen = (drafts || []).filter(d => d.include && d.title.trim())
  const fresh = chosen.filter(d => !d.updating)
  const updates = chosen.filter(d => d.updating)

  async function post() {
    setBusy(true)
    try {
      const res = fresh.length ? await postDrafts(ctx.me, fresh, { date, weekOf: mondayOf(date), notifyTeam: notify }) : { count: 0 }
      const n = res.count
      if (notify && res.firstId) notifyNews({ id: res.firstId })
      for (const d of updates) {
        const m = d.match
        await saveAnnouncement(ctx.me, {
          ...m, title: d.title, body: d.body || m.body, date, weekOf: mondayOf(date),
          regions: [...new Set([...(m.regions || []), ...d.regions])], people: [...new Set([...(m.people || []), ...d.people])],
        })
      }
      ctx.showToast(postLabel(n, updates.length, ['Posted', 'updated']) + '.')
      onDone()
    } catch (e) { console.error(e); ctx.showToast(failMsg(e)); setBusy(false) }
  }

  if (!drafts) {
    return (
      <div className="stack-16">
        <button className="btn-ghost-sm self-start" onClick={onDone}><Icon name="chevron-left" size={16} /> Back to news</button>
        <section className="card pp-section">
          <h3>Paste the team update email</h3>
          <span className="body-sm">
            Open the email in Outlook, select it all (Ctrl+A), copy (Ctrl+C) and paste it here. Each bullet becomes its own
            announcement under “{SECTIONS.been}” or “{SECTIONS.next}”, with the regions and people it mentions. You check them all before anything is posted.
          </span>
          <textarea className="pp-input mg-textarea mg-paste" rows={12} placeholder="Paste the email here…" onPaste={onPaste}
            value={paste.text} onChange={e => setPaste({ html: '', text: e.target.value })} aria-label="The email" />
          {paste.html && <span className="caption">Pasted with its formatting, so links and bullets are kept.</span>}
          <div className="pp-section-foot">
            <button className="btn btn-secondary" onClick={onDone}>Cancel</button>
            <button className="btn btn-primary" disabled={!paste.text.trim()} onClick={split}>Split into announcements</button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="stack-16">
      <button className="btn-ghost-sm self-start" onClick={() => setDrafts(null)}><Icon name="chevron-left" size={16} /> Back to the email</button>
      <div className="card mg-review-head">
        <div className="stack-10">
          <strong>{drafts.length} found · {chosen.length} ticked</strong>
          <span className="caption">Untick anything you don’t want, fix titles, merge or split, and set regions. Only ticked ones are posted.</span>
        </div>
        <label className="pp-label mg-date">Email date<input className="pp-input" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label className="mg-check"><input type="checkbox" checked={notify} onChange={e => setNotify(e.target.checked)} /> <Icon name="bell" size={16} /> One notification to everyone’s phones</label>
        <button className="btn btn-secondary" onClick={() => setSuggesting(s => !s)}><Icon name="folder-kanban" size={16} /> {suggesting ? 'Hide project tracker' : 'Add from project tracker'}</button>
      </div>
      {suggesting && (
        <div className="card pp-section">
          <span className="caption">Click one to add it as an announcement.</span>
          <Suggestions ctx={ctx} exclude={added} onPick={s => {
            setAdded(a => [...a, s.key])
            setDrafts(d => [...d, { ...s, key: s.key, include: true, body: '' }])
          }} />
        </div>
      )}
      <div className="mg-drafts">
        {drafts.map((d, i) => (
          <article key={d.key} className={`card mg-draft ${d.include ? '' : 'off'}`}>
            <input type="checkbox" className="mg-draft-check" checked={d.include} onChange={e => update(i, { include: e.target.checked })} aria-label="Post this one" />
            <div className="mg-draft-main">
              <input className="pp-input mg-draft-title" value={d.title} onChange={e => update(i, { title: e.target.value })} aria-label="Title" />
              {(d.body || d.showBody) && <textarea className="pp-input mg-textarea" rows={Math.min(8, Math.max(2, d.body.split('\n').length))} value={d.body} onChange={e => update(i, { body: e.target.value })} aria-label="Message" />}
              <div className="mg-draft-meta">
                <select className="pp-input mg-select-sm" value={d.category} onChange={e => update(i, { category: e.target.value })} aria-label="Category">
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
                {d.category === 'Team news' && (
                  <select className="pp-input mg-select-sm" value={d.section} onChange={e => update(i, { section: e.target.value })} aria-label="Section">
                    <option value="">No section</option><option value="been">{SECTIONS.been}</option><option value="next">{SECTIONS.next}</option>
                  </select>
                )}
                <RegionPicker value={d.regions} onChange={r => update(i, { regions: r })} />
              </div>
              {(d.people.length > 0 || d.note) && (
                <span className="caption">{d.note}{d.note && d.people.length ? ' · ' : ''}{d.people.length ? `People: ${d.people.map(u => names.get(u)).filter(Boolean).join(', ')}` : ''}</span>
              )}
              {d.match && (
                <div className="mg-match">
                  <span className="caption">
                    {d.updating
                      ? <>Will update “{d.match.title}” ({shortDate(d.match.date)}) with this text. Its pin and photos stay.</>
                      : <>Looks like “{d.match.title}”, posted {shortDate(d.match.date)}.</>}
                  </span>
                  {d.updating
                    ? <button type="button" className="btn-ghost-sm" onClick={() => update(i, { updating: false, include: false })}>Don’t update it</button>
                    : canEdit(ctx.me, d.match) && <button type="button" className="btn-ghost-sm" onClick={() => update(i, { updating: true, include: true })}>Update that one instead</button>}
                </div>
              )}
            </div>
            <div className="mg-draft-tools">
              {!d.body && !d.showBody && <button className="icon-btn" title="Add a message" aria-label="Add a message" onClick={() => update(i, { showBody: true })}><Icon name="file-text" size={16} /></button>}
              {d.body.includes('\n') && <button className="icon-btn" title="Split into one per line" aria-label="Split into one per line" onClick={() => splitBody(i)}><Icon name="split" size={16} /></button>}
              {i < drafts.length - 1 && <button className="icon-btn" title="Merge with the next one" aria-label="Merge with the next one" onClick={() => merge(i)}><Icon name="merge" size={16} /></button>}
              <button className="icon-btn" title="Remove" aria-label="Remove" onClick={() => remove(i)}><Icon name="trash" size={16} /></button>
            </div>
          </article>
        ))}
      </div>
      <div className="pp-section-foot mg-sticky">
        <button className="btn btn-secondary" onClick={onDone}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !chosen.length} onClick={post}>{busy ? 'Posting…' : postLabel(fresh.length, updates.length, ['Post', 'update'])}</button>
      </div>
    </div>
  )
}

// ── Export ────────────────────────────────────────────────────────────────

const RANGES = [['latest', 'Latest team update'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['31', 'Last month']]

function ExportEmail({ ctx, list, onDone }) {
  const [range, setRange] = useState('latest')
  const [groupBy, setGroupBy] = useState('section')
  const [greeting, setGreeting] = useState('Hi All,')
  const [signoff, setSignoff] = useState(`Thanks everyone for all that you do.\n\nCheers\n${ctx.me.displayName || ''}`)
  const [off, setOff] = useState([])
  const [photos, setPhotos] = useState({})
  const [withPhotos, setWithPhotos] = useState(true)
  const preview = useRef(null)

  const inRange = useMemo(() => {
    const items = list
    if (range === 'latest') {
      const team = items.filter(a => categoryOf(a) === 'Team news')
      const week = team.reduce((m, a) => ((a.weekOf || mondayOf(a.date)) > m ? (a.weekOf || mondayOf(a.date)) : m), '')
      if (!week) return items.filter(a => a.date >= addDays(isoToday(), -7))
      return items.filter(a => (a.weekOf || mondayOf(a.date)) === week || (categoryOf(a) !== 'Team news' && a.date >= week))
    }
    return items.filter(a => (a.date || '') >= addDays(isoToday(), -Number(range)))
  }, [list, range])
  const chosen = inRange.filter(a => !off.includes(a.id))

  useEffect(() => {
    for (const a of chosen) if (photoCountOf(a) && !(a.id in photos)) loadPhotos(a).then(p => setPhotos(x => ({ ...x, [a.id]: p })))
  }, [chosen.map(a => a.id).join()])

  const email = buildEmail(chosen, { groupBy, greeting, signoff, photos: withPhotos ? photos : {} })

  async function copy(kind) {
    try {
      if (kind === 'html' && window.ClipboardItem) {
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': new Blob([email.html], { type: 'text/html' }),
          'text/plain': new Blob([email.text], { type: 'text/plain' }),
        })])
      } else if (kind === 'html') {
        // Older browsers: copy the rendered preview itself
        const sel = window.getSelection()
        const r = document.createRange()
        r.selectNodeContents(preview.current)
        sel.removeAllRanges(); sel.addRange(r)
        document.execCommand('copy')
        sel.removeAllRanges()
      } else {
        await navigator.clipboard.writeText(email.text)
      }
      ctx.showToast(kind === 'html' ? 'Copied. Paste it into a new Outlook email.' : 'Copied as plain text.')
    } catch (e) {
      console.error(e)
      ctx.showToast('Couldn’t copy. Select the preview and copy it instead.')
    }
  }

  return (
    <div className="stack-16">
      <button className="btn-ghost-sm self-start" onClick={onDone}><Icon name="chevron-left" size={16} /> Back to news</button>
      <div className="mg-export">
        <section className="card pp-section mg-export-pick">
          <h3>What goes in</h3>
          <div className="pp-two">
            <label className="pp-label">From
              <select className="pp-input" value={range} onChange={e => { setRange(e.target.value); setOff([]) }}>
                {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="pp-label">Group team news by
              <select className="pp-input" value={groupBy} onChange={e => setGroupBy(e.target.value)}>
                <option value="section">Week that’s been / next week</option>
                <option value="region">Region</option>
              </select>
            </label>
          </div>
          <div className="mg-export-list">
            {inRange.length === 0 && <span className="caption">Nothing posted in that time.</span>}
            {inRange.map(a => (
              <label key={a.id} className="mg-check">
                <input type="checkbox" checked={!off.includes(a.id)} onChange={e => setOff(o => (e.target.checked ? o.filter(x => x !== a.id) : [...o, a.id]))} />
                <span><span className={`badge badge-${TONE[categoryOf(a)]}`}>{a.section ? SECTIONS[a.section] : categoryOf(a)}</span> {a.title}</span>
              </label>
            ))}
          </div>
          <label className="pp-label">Greeting<input className="pp-input" value={greeting} onChange={e => setGreeting(e.target.value)} /></label>
          <label className="pp-label">Sign-off<textarea className="pp-input mg-textarea" rows={4} value={signoff} onChange={e => setSignoff(e.target.value)} /></label>
          <label className="mg-check"><input type="checkbox" checked={withPhotos} onChange={e => setWithPhotos(e.target.checked)} /> Include photos</label>
        </section>
        <section className="card pp-section mg-export-preview">
          <div className="pp-section-head">
            <h3>Preview</h3>
            <div className="tag-row">
              <button className="btn btn-secondary" onClick={() => copy('text')}>Copy as text</button>
              <button className="btn btn-primary" onClick={() => copy('html')} disabled={!chosen.length}><Icon name="mail" size={16} /> Copy for Outlook</button>
            </div>
          </div>
          {/* buildEmail escapes everything it's given, so this is our own markup */}
          <div ref={preview} className="mg-email" dangerouslySetInnerHTML={{ __html: email.html }} />
        </section>
      </div>
    </div>
  )
}

// ── Tool requests ─────────────────────────────────────────────────────────

function useRequests(ctx) {
  const [list, setList] = useState(null)
  const [error, setError] = useState('')
  const reload = () => loadRequests(ctx.me).then(setList).catch(e => {
    console.error(e)
    setError(e?.code === 'permission-denied' ? 'Requests can’t be read yet: the Firestore rules for them haven’t been published.' : 'Couldn’t load them. Refresh to try again.')
    setList([])
  })
  useEffect(() => { reload() }, [])
  return { list, setList, reload, error }
}

function RequestsTab({ ctx }) {
  const { list, setList, reload, error } = useRequests(ctx)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!list) return <span className="caption">Loading…</span>
  const requests = list.filter(r => r.kind === 'tool')
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await sendRequest(ctx.user, { kind: 'tool', ...form })
      ctx.showToast('Sent to the engineering team.')
      setForm(null)
      reload()
    } catch (err) { ctx.showToast(failMsg(err)) } finally { setBusy(false) }
  }

  return (
    <div className="stack-16">
      <div className="card mg-note">
        <span className="body-sm">Is there something you do by hand, in a spreadsheet or on paper that a tool could do? Tell the engineering team. Others can +1 it, and the team replies here.</span>
        {!form && <button className="btn btn-primary" onClick={() => setForm({ title: '', details: '', who: '', urgency: URGENCY[0] })}><Icon name="plus" size={16} /> Request a tool</button>}
      </div>
      {form && (
        <form className="card pp-section" onSubmit={submit}>
          <h3>Request a tool</h3>
          <label className="pp-label">What should it be called, or what’s it for?<input className="pp-input" value={form.title} onChange={set('title')} required maxLength={120} placeholder="Loan return checklist" autoFocus /></label>
          <label className="pp-label">What should it do? What do you do now instead?<textarea className="pp-input mg-textarea" rows={5} value={form.details} onChange={set('details')} required maxLength={3000} /></label>
          <div className="pp-two">
            <label className="pp-label">Who would use it, and how often?<input className="pp-input" value={form.who} onChange={set('who')} maxLength={300} placeholder="Service team, every install" /></label>
            <label className="pp-label">How much would it help?
              <select className="pp-input" value={form.urgency} onChange={set('urgency')}>{URGENCY.map(u => <option key={u}>{u}</option>)}</select>
            </label>
          </div>
          <div className="pp-section-foot">
            <button type="button" className="btn btn-secondary" onClick={() => setForm(null)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send request'}</button>
          </div>
        </form>
      )}
      {error && <div className="alert">{error}</div>}
      {requests.length
        ? <div className="mg-list">{requests.map(r => <RequestCard key={r.id} r={r} ctx={ctx} onChange={x => setList(l => l.map(y => (y.id === r.id ? { ...y, ...x } : y)))} onDeleted={reload} />)}</div>
        : !error && <div className="card pp-empty">No requests yet. Be the first.</div>}
    </div>
  )
}

function StatusBadge({ id }) {
  const s = statusOf(id)
  return <span className={`badge mg-status-${s.tone}`}>{s.label}</span>
}

function EngineeringReply({ ctx, r, onChange }) {
  const [status, setStatus] = useState(r.status || 'new')
  const [response, setResponse] = useState(r.response || '')
  const [busy, setBusy] = useState(false)
  const dirty = status !== (r.status || 'new') || response !== (r.response || '')
  async function save() {
    setBusy(true)
    try { onChange(await respond(ctx.user, r, { status, response })); ctx.showToast('Saved.') } catch (e) { ctx.showToast(failMsg(e)) } finally { setBusy(false) }
  }
  return (
    <div className="mg-reply">
      <span className="chs-overline">Engineering team</span>
      <div className="mg-reply-row">
        <select className="pp-input mg-select-sm" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <input className="pp-input" value={response} onChange={e => setResponse(e.target.value)} placeholder="Reply to them (they see this)" aria-label="Reply" maxLength={2000} />
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>Save</button>
      </div>
    </div>
  )
}

function RequestCard({ r, ctx, onChange, onDeleted }) {
  const voted = (r.votes || []).includes(ctx.user.uid)
  const eng = isEngineering(ctx.me)
  const mine = r.uid === ctx.user.uid
  async function vote() {
    try { onChange({ votes: await toggleVote(ctx.user, r) }) } catch (e) { ctx.showToast(failMsg(e)) }
  }
  async function remove() {
    if (!confirm(`Delete “${r.title || 'this feedback'}”?`)) return
    try { await deleteRequest(r); onDeleted() } catch (e) { ctx.showToast(failMsg(e)) }
  }
  return (
    <article className="card mg-request">
      {r.kind === 'tool' && (
        <button className={`mg-vote ${voted ? 'on' : ''}`} onClick={vote} aria-pressed={voted} title={voted ? 'Take back your +1' : '+1 this'}>
          <Icon name="thumbs-up" size={16} /><span>{r.votes?.length || 0}</span>
        </button>
      )}
      <div className="mg-row-text">
        <div className="news-meta">
          <StatusBadge id={r.status} />
          {r.kind === 'tool' && r.urgency && <span className="caption">{r.urgency}</span>}
          {r.kind === 'feedback' && <span className="mg-stars" aria-label={`${r.rating} out of 5`}>{'★'.repeat(r.rating)}<span>{'★'.repeat(5 - r.rating)}</span></span>}
          {r.kind === 'feedback' && <span className="caption">{TOOL_NAMES[r.tool] || r.tool}</span>}
        </div>
        {r.title && <span className="person-name">{r.title}</span>}
        {r.details && <span className="body-sm mg-pre">{r.details}</span>}
        {r.who && <span className="caption">Who’d use it: {r.who}</span>}
        {r.good && <span className="body-sm mg-pre"><strong>Works well:</strong> {r.good}</span>}
        {r.change && <span className="body-sm mg-pre"><strong>Should change:</strong> {r.change}</span>}
        <span className="caption">{r.name}{r.createdMs ? ` · ${shortDate(isoToday(new Date(r.createdMs)))}` : ''}</span>
        {r.response && !eng && <div className="mg-response"><strong>{r.respondedBy || 'Engineering team'}:</strong> {r.response}</div>}
        {eng && <EngineeringReply ctx={ctx} r={r} onChange={onChange} />}
      </div>
      {(ctx.me.role === 'admin' || (mine && (r.status || 'new') === 'new')) && (
        <button className="icon-btn" onClick={remove} aria-label="Delete" title="Delete"><Icon name="trash" size={16} /></button>
      )}
    </article>
  )
}

// ── Feedback ──────────────────────────────────────────────────────────────

function Stars({ value, onChange }) {
  return (
    <div className="mg-star-input" role="radiogroup" aria-label="Rating">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} out of 5`} className={n <= value ? 'on' : ''} onClick={() => onChange(n)}>★</button>
      ))}
    </div>
  )
}

function FeedbackTab({ ctx }) {
  const { list, setList, reload, error } = useRequests(ctx)
  const [form, setForm] = useState({ tool: 'hub', rating: 0, good: '', change: '' })
  const [busy, setBusy] = useState(false)
  if (!list) return <span className="caption">Loading…</span>
  const eng = isEngineering(ctx.me)
  const feedback = list.filter(r => r.kind === 'feedback')
  const summary = feedbackSummary(feedback)
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    try {
      await sendRequest(ctx.user, { kind: 'feedback', ...form })
      ctx.showToast('Thanks! Sent to the engineering team.')
      setForm({ tool: form.tool, rating: 0, good: '', change: '' })
      reload()
    } catch (err) { ctx.showToast(failMsg(err)) } finally { setBusy(false) }
  }

  return (
    <div className="stack-16">
      <form className="card pp-section" onSubmit={submit}>
        <h3>How are the tools working for you?</h3>
        <span className="caption">Two minutes. Only the engineering team sees what you write.</span>
        <div className="pp-two">
          <label className="pp-label">Which tool?
            <select className="pp-input" value={form.tool} onChange={set('tool')}>
              {Object.entries(TOOL_NAMES).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
            </select>
          </label>
          <div className="pp-label">Overall<Stars value={form.rating} onChange={n => setForm(f => ({ ...f, rating: n }))} /></div>
        </div>
        <label className="pp-label">What works well?<textarea className="pp-input mg-textarea" rows={3} value={form.good} onChange={set('good')} maxLength={2000} /></label>
        <label className="pp-label">What should change, or what’s missing?<textarea className="pp-input mg-textarea" rows={3} value={form.change} onChange={set('change')} maxLength={2000} /></label>
        <div className="pp-section-foot"><button type="submit" className="btn btn-primary" disabled={busy || !form.rating}>{busy ? 'Sending…' : 'Send feedback'}</button></div>
      </form>
      {error && <div className="alert">{error}</div>}
      {eng && summary.length > 0 && (
        <section className="card pp-section">
          <h3>Ratings so far</h3>
          <div className="mg-summary">
            {summary.map(s => (
              <div key={s.tool} className="mg-summary-row">
                <span className="ellipsis">{TOOL_NAMES[s.tool] || s.tool}</span>
                <span className="mg-bar" aria-hidden="true"><span style={{ width: `${(s.average / 5) * 100}%` }} /></span>
                <span className="caption">{s.average} / 5 · {s.count} {s.count === 1 ? 'reply' : 'replies'}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {feedback.length > 0 && (
        <div className="stack-10">
          <span className="chs-overline">{eng ? 'All feedback' : 'Your feedback'}</span>
          <div className="mg-list">{feedback.map(r => <RequestCard key={r.id} r={r} ctx={ctx} onChange={x => setList(l => l.map(y => (y.id === r.id ? { ...y, ...x } : y)))} onDeleted={reload} />)}</div>
        </div>
      )}
    </div>
  )
}
