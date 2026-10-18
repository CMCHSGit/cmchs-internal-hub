// The hub home page (design: design/CMCHS Internal Hub v2.dc.html, notes in
// design/UPGRADE-v2.md). Top to bottom: hero with search and quick launch,
// At a glance, News and announcements, Who's where today + Calendar, Tools,
// footer. The staff-schedule blocks hide themselves if it can't be read.
import { navigate } from './router.js'
import { openSearch } from './Palette.jsx'
import { useEffect, useRef, useState } from 'react'
import { firstNameOf } from '../../../shared/session.js'
import Calendar from './Calendar.jsx'
import AsksPanel from './AsksPanel.jsx'
import { asksSummary, readSeen, watchMyAsks } from './asks.js'
import Icon from './Icon.jsx'
import { DEPARTMENTS, ONCALL_BG, loadToday } from './today.js'
import { CATEGORIES, SECTIONS, TONE, categoryOf, loadNews, loadPhoto, mergeNews, photoCountOf, teamNews } from './news.js'
import { ReactionBar, postUrl } from './NewsPost.jsx'
import { reactionSummary } from './social.js'
import { Linked } from './ui.jsx'
import {
  hostOf, markUsed, newsImage,
  openPhoneApp, opensInTab, recentTools, searchTools, toolGroups, tools,
} from './tools.js'

// The staff directory and profiles (People.jsx)
const PEOPLE_URL = '#/people'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MON = MONTHS.map(m => m.slice(0, 3))
const dateLabel = d => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
/** "2026-10-09" -> "9 Oct" (other text is shown as written). */
const newsDate = s => (/^\d{4}-\d{2}-\d{2}$/.test(s || '') ? `${Number(s.slice(8))} ${MON[Number(s.slice(5, 7)) - 1]}` : s || '')
const firstNames = list => list.slice(0, 3).map(p => p.name).join(', ') + (list.length > 3 ? ` +${list.length - 3}` : '')

// A tool link: same tab for pages on this site, new tab for other sites.
function ToolLink({ tool, className, children, title }) {
  const tab = opensInTab(tool)
  return (
    <a className={className} href={tool.link} title={title}
       target={tab ? '_blank' : undefined} rel={tab ? 'noopener' : undefined}
       onClick={e => { markUsed(tool); if (openPhoneApp(tool)) e.preventDefault() }}>
      {children}
    </a>
  )
}

function SectionHead({ c1, c2, overline, title, children }) {
  return (
    <div className="section-head">
      <div className="section-head-text">
        <span className="section-stripes" aria-hidden="true"><span style={{ background: c1 }} /><span style={{ background: c2 }} /></span>
        <span className="chs-overline">{overline}</span>
        <h3>{title}</h3>
      </div>
      {children}
    </div>
  )
}

// ── Hero ──────────────────────────────────────────────────────────────────

function HeroSearch({ people }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const box = useRef(null)
  const query = q.trim().toLowerCase()
  const toolHits = searchTools(q)
  const peopleHits = query && people
    ? people.filter(p => `${p.name} ${p.fullName} ${p.deptName}`.toLowerCase().includes(query)).slice(0, 5)
    : []

  useEffect(() => {
    const close = e => { if (!box.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className="hero-search" ref={box}>
      <Icon name="search" size={18} className="hero-search-icon" />
      <input
        type="search" value={q} placeholder={people ? 'Search tools and people' : 'Search tools'}
        aria-label="Search tools and people"
        onChange={e => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'Escape') { setOpen(false); e.currentTarget.blur() }
          if (e.key === 'Enter' && toolHits[0]) {
            markUsed(toolHits[0])
            if (openPhoneApp(toolHits[0])) return
            if (opensInTab(toolHits[0])) window.open(toolHits[0].link, '_blank', 'noopener')
            else navigate(toolHits[0].link)
          }
        }}
      />
      {open && query && (
        <div className="search-results hero-results" role="listbox">
          {toolHits.map(t => (
            <ToolLink key={t.id} tool={t} className="search-hit">
              <span className="tile tile-32"><Icon name={t.icon} size={16} /></span>
              <span className="search-hit-text">
                <span className="search-hit-name">{t.name}</span>
                <span className="caption">{t.description}</span>
              </span>
            </ToolLink>
          ))}
          {peopleHits.map(p => (
            <a key={p.uid} className="search-hit" href={`${PEOPLE_URL}/${encodeURIComponent(p.uid)}`}>
              <span className="avatar-sm" style={p.onCall ? { background: ONCALL_BG, color: '#1d1d1d' } : undefined}>{p.initials}</span>
              <span className="search-hit-text">
                <span className="search-hit-name">{p.name}{p.onCall ? ' - OnCall' : ''}</span>
                <span className="caption">{[p.deptName, p.where].filter(Boolean).join(' · ')}</span>
              </span>
            </a>
          ))}
          {!toolHits.length && !peopleHits.length && (
            <span className="search-empty">No tools or people match that search.</span>
          )}
          {/* The rest of the hub too: jobs, asks, every page (Ctrl+K anywhere). */}
          <button type="button" className="search-hit search-all" onClick={() => { setOpen(false); openSearch(q) }}>
            <span className="tile tile-32"><Icon name="search" size={16} /></span>
            <span className="search-hit-text">
              <span className="search-hit-name">Search everything for “{q.trim()}”</span>
              <span className="caption">Jobs, asks and every page as well · Ctrl K</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}

function Hero({ user, today, asksCount = 0 }) {
  let sub = ''
  if (today) {
    const out = today.glance.find(g => g.key === 'out').people.length
    const when = today.weekend ? `out on ${today.dayName}` : 'out today'
    sub = `${out} ${out === 1 ? 'person' : 'people'} ${when} · ${today.onCallName ? `${today.onCallName} is on call this week` : 'no one on call this week'}`
    if (today.holiday) sub = `${today.holiday} · ${sub}`
  }
  return (
    <section className="hero">
      <img className="ghost ghost-br" src="/brand/logo-mark-white.png" alt="" />
      <img className="ghost ghost-tl" src="/brand/logo-mark-white.png" alt="" />
      <div className="hero-inner">
        <div className="hero-text">
          <span className="chs-overline hero-over">{dateLabel(new Date())}</span>
          <h1 className="hero-title">Kia ora, {firstNameOf(user)}</h1>
          {sub && <span className="hero-sub">{sub}</span>}
        </div>
        <HeroSearch people={today?.people || null} />
        <nav className="quick" aria-label="Open a tool">
          {tools.map(t => (
            <ToolLink key={t.id} tool={t} className="quick-btn" title={t.description}>
              <span className="quick-circle"><Icon name={t.icon} size={26} />{t.id === 'asks' && asksCount > 0 && <span className="quick-badge" aria-label={`${asksCount} waiting`}>{asksCount}</span>}</span>
              <span className="quick-label">{t.short || t.name}</span>
            </ToolLink>
          ))}
        </nav>
      </div>
    </section>
  )
}

// ── At a glance ───────────────────────────────────────────────────────────

function Glance({ today }) {
  return (
    <section className="glance" aria-label={today?.weekend ? `At a glance, ${today.dayName}` : 'At a glance today'}>
      {(today?.glance || [{ key: 'office' }, { key: 'site' }, { key: 'remote' }, { key: 'out' }]).map(g => (
        <a key={g.key} href={PEOPLE_URL} className={`card card-interactive glance-card accent-${g.accent || 'none'}`} aria-busy={!today}>
          <span className="chs-overline glance-over">{g.icon && <Icon name={g.icon} size={14} />}{g.label || ' '}</span>
          <span className="glance-n">{today ? g.people.length : '–'}</span>
          <span className="body-sm glance-names">{today ? (firstNames(g.people) || 'No one') : ' '}</span>
        </a>
      ))}
    </section>
  )
}

// ── News ──────────────────────────────────────────────────────────────────
// Posted from Manage (news.js); the old announcements.json shows until it's moved across.

// The whole card opens the post (NewsPost.jsx); links in the text and the
// reaction bar keep their own clicks.
function NewsCard({ a, uid }) {
  const [photo, setPhoto] = useState('')
  const count = photoCountOf(a)
  useEffect(() => { if (count) loadPhoto(a.id).then(setPhoto) }, [a.id, count])
  const cat = categoryOf(a)
  const img = photo || newsImage(a)
  const long = (a.body || '').length > 220
  const open = (comment = false) => navigate(postUrl(a.id) + (comment ? '?c=1' : ''))
  return (
    <article className="card news-card news-card-link" onClick={e => { if (!e.target.closest('a, button')) open() }}>
      <div className={img ? "news-photo" : "news-photo news-photo-empty"}>
        {img && <img src={img} alt="" loading="lazy" />}
        {count > 1 && <span className="badge news-photo-more"><Icon name="camera" size={14} /> +{count - 1}</span>}
        {a.pinned && <span className="badge badge-orange-solid news-pin">Pinned</span>}
      </div>
      <div className="news-body">
        <div className="news-meta">
          <span className={`badge badge-${TONE[cat]}`}>{cat}</span>
          <span className="caption">{[newsDate(a.date), a.author].filter(Boolean).join(' · ')}</span>
        </div>
        <a className="news-title" href={postUrl(a.id)}>{a.title}</a>
        <p className={`news-text ${long ? 'clamped' : ''}`}><Linked text={a.body} /></p>
        {long && <a className="link-btn" href={postUrl(a.id)}>Read more</a>}
      </div>
      <ReactionBar post={a} uid={uid} compact onComment={() => open(true)} />
    </article>
  )
}

const FEATURE_CATEGORIES = CATEGORIES.filter(c => c !== 'Team news')

function News({ news, uid }) {
  const [tab, setTab] = useState('All')
  const [all, setAll] = useState(false)
  const list = news.filter(a => categoryOf(a) !== 'Team news' && (tab === 'All' || categoryOf(a) === tab))
  const shown = all ? list : list.slice(0, 3)
  return (
    <section className="stack-18" aria-label="News and announcements">
      <SectionHead c1="#554596" c2="#ef7d00" overline="Company news" title="News and announcements">
        <div className="tag-row">
          {['All', ...FEATURE_CATEGORIES].map(n => (
            <button key={n} className={`tag ${tab === n ? 'tag-on' : ''}`} aria-pressed={tab === n} onClick={() => { setTab(n); setAll(false) }}>{n}</button>
          ))}
          <a className="btn-ghost-sm" href="#/manage">Post <Icon name="arrow-right" size={16} /></a>
        </div>
      </SectionHead>
      {shown.length > 0
        ? <div className="news-grid">{shown.map(a => <NewsCard key={a.id} a={a} uid={uid} />)}</div>
        : <span className="body-sm muted">Nothing posted in this category yet.</span>}
      {list.length > 3 && (
        <button className="btn-ghost-sm self-start" onClick={() => setAll(v => !v)}>
          {all ? 'Show fewer' : `Show all ${list.length}`}
        </button>
      )}
    </section>
  )
}

// A team news line's reactions and comments, or a faint "react" hint on hover.
function TeamItemCounts({ a }) {
  const s = reactionSummary(a.reactions)
  const c = a.commentCount || 0
  return (
    <a className={`team-rx ${s.total || c ? 'has' : ''}`} href={postUrl(a.id)} aria-label={`Open “${a.title}” to react or comment`}>
      {s.total > 0 && <span>{s.top.slice(0, 2).map(r => r.emoji).join('')} {s.total}</span>}
      {c > 0 && <span><Icon name="message-circle" size={13} /> {c}</span>}
      {!s.total && !c && <Icon name="smile" size={14} />}
    </a>
  )
}

// The project team's weekly update, one line per item, by section and region.
function TeamNews({ news }) {
  const [region, setRegion] = useState('')
  const t = teamNews(news)
  if (!t) return null
  const pick = xs => xs.filter(a => !region || (a.regions || []).includes(region))
  const col = (label, xs, tone) => (
    <div className="card team-col">
      <span className={`team-col-head team-${tone}`}>{label}</span>
      {pick(xs).length
        ? <ul className="team-list">{pick(xs).map(a => (
            <li key={a.id} className={a.legacy ? '' : 'team-item'} onClick={e => { if (!a.legacy && !e.target.closest('a, button')) navigate(postUrl(a.id)) }}>
              <span><Linked text={a.title} />{a.body ? <span className="muted"> – <Linked text={a.body} /></span> : null}</span>
              {!a.legacy && <TeamItemCounts a={a} />}
              {(a.regions || []).length > 0 && <span className="team-regions">{a.regions.map(r => <span key={r} className="mg-region">{r}</span>)}</span>}
            </li>
          ))}</ul>
        : <span className="body-sm muted">{region ? `Nothing in ${region}.` : 'Nothing yet.'}</span>}
    </div>
  )
  return (
    <section className="stack-18" aria-label="Team news">
      <SectionHead c1="#80bd01" c2="#ef7d00" overline={`Team news · week of ${newsDate(t.weekOf)}`} title="Where the team has been, and where it’s going">
        {t.regions.length > 1 && (
          <select className="pp-input mg-select" value={region} onChange={e => setRegion(e.target.value)} aria-label="Region">
            <option value="">All regions</option>
            {t.regions.map(r => <option key={r}>{r}</option>)}
          </select>
        )}
      </SectionHead>
      <div className="team-cols">
        {col(SECTIONS.been, t.been, 'green')}
        {col(SECTIONS.next, t.next, 'orange')}
      </div>
      {t.other.length > 0 && col('Also', t.other, 'purple')}
    </section>
  )
}

// ── Who's where today ─────────────────────────────────────────────────────

function Directory({ today }) {
  const [dq, setDq] = useState('')
  const [depts, setDepts] = useState([])
  const q = dq.trim().toLowerCase()
  const people = today.people.filter(p =>
    (!depts.length || depts.includes(p.dept)) && (!q || `${p.name} ${p.fullName}`.toLowerCase().includes(q)))
  const toggle = id => setDepts(d => (d.includes(id) ? d.filter(x => x !== id) : [...d, id]))
  return (
    <div className="stack-16">
      <SectionHead c1="#80bd01" c2="#554596" overline="Staff directory" title={today.weekend ? `Who's where on ${today.dayName}` : "Who's where today"}>
        <a className="btn-ghost-sm" href={PEOPLE_URL}>See all {today.people.length} people <Icon name="arrow-right" size={16} /></a>
      </SectionHead>
      <div className="dir-filters">
        <div className="field-sm">
          <Icon name="search" size={16} className="field-icon" />
          <input type="search" value={dq} onChange={e => setDq(e.target.value)} placeholder="Search person" aria-label="Search person" />
        </div>
        <div className="tag-row">
          <button className={`tag ${!depts.length ? 'tag-on' : ''}`} aria-pressed={!depts.length} onClick={() => setDepts([])}>All</button>
          {DEPARTMENTS.map(d => (
            <button key={d.id} className={`tag ${depts.includes(d.id) ? 'tag-on' : ''}`} aria-pressed={depts.includes(d.id)} onClick={() => toggle(d.id)}>{d.name}</button>
          ))}
        </div>
      </div>
      {people.length > 0
        ? <div className="dir-grid">
            {people.slice(0, 8).map(p => (
              <a key={p.uid} className="card card-interactive person person-link" href={`${PEOPLE_URL}/${encodeURIComponent(p.uid)}`}>
                <span className="avatar-md" style={p.onCall ? { background: ONCALL_BG, color: '#1d1d1d' } : undefined}>{p.initials}</span>
                <div className="person-text">
                  <span className="person-name">{p.name}{p.onCall ? ' - OnCall' : ''}</span>
                  <span className="person-where"><span className="swatch" style={{ background: p.swatch }} /><span className="ellipsis">{p.where}</span></span>
                </div>
                <span className="caption">{p.deptName}</span>
              </a>
            ))}
          </div>
        : <span className="body-sm muted">No one matches that search.</span>}
    </div>
  )
}

// ── Tools ─────────────────────────────────────────────────────────────────

function ToolCard({ tool }) {
  const tab = opensInTab(tool)
  return (
    <div className="card card-interactive tool-card">
      <div className="tool-card-top">
        <span className="tile tile-40"><Icon name={tool.icon} size={20} /></span>
        {tab
          ? <span className="tool-card-tab" title="Opens in a new tab"><Icon name="external-link" size={16} /></span>
          : <a className="icon-btn" href={tool.link} target="_blank" rel="noopener" aria-label={`Open ${tool.name} in a new tab`}
               title="Open in a new tab" onClick={() => markUsed(tool)}>
              <Icon name="external-link" size={16} />
            </a>}
      </div>
      <div className="tool-card-body">
        {/* The name link stretches over the whole card (see .tool-card-link::after) */}
        <ToolLink tool={tool} className="tool-card-link">{tool.name}</ToolLink>
        <span className="body-sm">{tool.description}</span>
      </div>
      <span className="mono host">{hostOf(tool)}</span>
    </div>
  )
}

function Tools() {
  const recent = recentTools()
  return (
    <section className="stack-22" aria-label="Tools">
      <SectionHead c1="#554596" c2="#80bd01" overline="Tools" title="Everything in the hub">
        {recent.length > 0 && (
          <div className="tag-row">
            <span className="caption">Recent</span>
            {recent.map(t => <ToolLink key={t.id} tool={t} className="tag">{t.short || t.name}</ToolLink>)}
          </div>
        )}
      </SectionHead>
      {toolGroups().map(g => (
        <div key={g.name} className="stack-10">
          <div className="group-head">
            <span className="group-stripes" aria-hidden="true"><span style={{ background: g.c1 }} /><span style={{ background: g.c2 }} /></span>
            <h4>{g.name}</h4>
            <span className="mono group-count">{g.tools.length}</span>
          </div>
          <div className="tool-grid">{g.tools.map(t => <ToolCard key={t.id} tool={t} />)}</div>
        </div>
      ))}
    </section>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <img className="ghost ghost-footer" src="/brand/logo-mark-white.png" alt="" />
      <div className="footer-inner">
        <div className="footer-col">
          <span className="footer-title">CMCHS Internal Hub</span>
          <span>Connected Healthcare Systems · 6C Jack Conway Avenue, Manukau, Auckland</span>
        </div>
        <div className="footer-col">
          <span className="chs-overline footer-over">Hub support</span>
          <span>Peter Lin · Service · 0800 424 797</span>
        </div>
      </div>
    </footer>
  )
}

// What Home last showed, so coming back from People or Manage shows it straight
// away (then refreshes) instead of the blocks popping in again.
const seen = { today: undefined, news: null }

export default function Home({ user }) {
  // undefined = loading, null = the schedule couldn't be read (blocks hidden)
  const [today, setToday] = useState(seen.today)
  useEffect(() => {
    let live = true
    loadToday()
      .then(t => { seen.today = t; if (live) setToday(t) })
      .catch(e => { console.warn('[hub] staff schedule unavailable', e); if (live && seen.today === undefined) setToday(null) })
    return () => { live = false }
  }, [])

  // The JSON straight away, then whatever's been posted in Manage
  const [news, setNews] = useState(() => seen.news || mergeNews([]))
  useEffect(() => { loadNews().then(n => { seen.news = n; setNews(n) }) }, [])

  // Asks waiting for this person, live (asks.js). null = Asks can't be read: panel hidden.
  const [asks, setAsks] = useState(undefined)
  const [seenAsks, setSeenAsks] = useState(readSeen)
  useEffect(() => {
    let off = () => {}
    let live = true
    watchMyAsks(user, d => { if (live) setAsks(d) }).then(u => { if (live) off = u; else u() })
    // Opening an ask in Asks (another tab) clears its dot here too
    const storage = e => { if (e.key === 'asks:seen') setSeenAsks(readSeen()) }
    const back = () => { if (document.visibilityState === 'visible') setSeenAsks(readSeen()) }
    window.addEventListener('storage', storage)
    document.addEventListener('visibilitychange', back)
    return () => { live = false; off(); window.removeEventListener('storage', storage); document.removeEventListener('visibilitychange', back) }
  }, [user])
  const asksNow = asks ? asksSummary(asks.asks, asks.me, asks.names, seenAsks) : null

  return (
    <main className="home">
      <Hero user={user} today={today} asksCount={asksNow?.mine.length || 0} />
      <div className="stripe-rule stripe-6" aria-hidden="true"><span /><span /><span /></div>
      <div className="home-page">
        {today !== null && <Glance today={today} />}
        {asksNow && <AsksPanel summary={asksNow} SectionHead={SectionHead} />}
        <News news={news} uid={user.uid} />
        <TeamNews news={news} />
        <div className={today ? 'mid-cols' : 'mid-cols mid-cols-single'}>
          {today && <Directory today={today} />}
          <div className="stack-16">
            <SectionHead c1="#ef7d00" c2="#80bd01" overline="Calendar" title="Coming up" />
            <Calendar />
          </div>
        </div>
        <Tools />
      </div>
      <Footer />
    </main>
  )
}
