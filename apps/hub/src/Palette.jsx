// Ctrl+K (⌘K on a Mac), the header's search box, or "Search everything" on
// Home: one search across the whole app (INTEGRATION-PLAN.md step 2). Pages
// and views, tools, people, jobs and asks, grouped, with the matching words
// marked; Up and Down to move, Enter to open, in place.
//
// What it searches comes from several places (search.js says which). The
// jobs and asks come from those sections' own search-source.js, loaded the
// first time the search opens and then kept up to date while the app is open,
// so a second search is instant and shows changes made since.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from '../../../shared/ui/index.jsx'
import Icon from './Icon.jsx'
import { loadDirectory } from './people.js'
import { navigate } from './router.js'
import { PAGES, grouped, personHits, placeHits, words } from './search.js'
import { openTool, tools } from './tools.js'
import './palette.css'

/** Open the search from anywhere, optionally with something already typed. */
export function openSearch(q = '') {
  window.dispatchEvent(new CustomEvent('hub:search', { detail: { q } }))
}

// What an empty search offers: the places most people go.
const QUICK = ['/#/', '/schedule/', '/schedule/my', '/#/people', '/asks/#/mine', '/projects/#/home']
  .map(href => PAGES.find(p => p.href === href))
  .map(p => ({ key: 'page:' + p.href, group: 'places', title: p.title, sub: p.sub, href: p.href, score: 1 }))

// Sections' sources, loaded when first needed (each brings its backend).
const SOURCES = {
  jobs: () => import('../../projects/src/search-source.js'),
  asks: () => import('../../asks/src/search-source.js'),
}

export default function Palette({ user }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [cursor, setCursor] = useState(0)
  const [people, setPeople] = useState(null)
  const [data, setData] = useState({})   // source id -> its latest data
  const [mods, setMods] = useState({})   // source id -> its module
  const started = useRef(false)
  const stops = useRef([]).current // each source's stop(), for when the app goes (signing out)
  const input = useRef(null)

  // Ctrl+K / ⌘K from anywhere, and openSearch().
  useEffect(() => {
    const key = e => {
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    const ask = e => { setQ(e.detail?.q || ''); setOpen(true) }
    window.addEventListener('keydown', key)
    window.addEventListener('hub:search', ask)
    return () => { window.removeEventListener('keydown', key); window.removeEventListener('hub:search', ask) }
  }, [])

  // Load what it searches the first time it opens; keep it live after that.
  useEffect(() => {
    if (!open || started.current) return
    started.current = true
    loadDirectory(user, async () => null).then(r => setPeople(r.directory)).catch(() => setPeople([]))
    for (const [id, load] of Object.entries(SOURCES)) {
      load().then(m => {
        setMods(x => ({ ...x, [id]: m }))
        stops.push(m.start(user, d => setData(x => ({ ...x, [id]: d }))))
      }).catch(e => console.warn(`[search] ${id} unavailable`, e))
    }
  }, [open, user, stops])
  useEffect(() => () => stops.forEach(s => s()), [stops])

  useEffect(() => setCursor(0), [q])

  const toks = words(q)
  const groups = useMemo(() => {
    if (!toks.length) return [{ id: 'places', label: 'Go to', hits: QUICK, more: 0 }]
    const hits = [
      ...placeHits(q, tools),
      ...personHits(people, q),
      ...Object.entries(mods).flatMap(([id, m]) => (data[id] ? m.search(q, data[id]) : [])),
    ]
    return grouped(hits)
  }, [q, people, mods, data]) // eslint-disable-line react-hooks/exhaustive-deps
  const flat = groups.flatMap(g => g.hits)
  const loading = toks.length > 0 && (people === null || Object.keys(SOURCES).some(id => !data[id]))

  const close = () => { setOpen(false); setQ('') }
  const go = hit => {
    close()
    if (hit.tool) openTool(hit.tool)
    else navigate(hit.href)
  }
  const key = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor(c => Math.min(flat.length - 1, c + 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setCursor(c => Math.max(0, c - 1)) }
    if (e.key === 'Enter' && flat[cursor]) { e.preventDefault(); go(flat[cursor]) }
  }
  // Keep the highlighted result in view while moving with the keys.
  useEffect(() => { document.getElementById(`pal-hit-${cursor}`)?.scrollIntoView({ block: 'nearest' }) }, [cursor])

  if (!open) return null
  return (
    <Dialog title="Search" description="Pages, people, jobs, asks and tools, across the whole hub." onClose={close} width={680} className="palette" initialFocus={input}>
      <div className="pal-field">
        <Icon name="search" size={18} className="pal-field-icon" />
        <input ref={input} className="input pal-input" type="search" value={q} onChange={e => setQ(e.target.value)} onKeyDown={key}
          placeholder="Try “my week”, a name, a hospital, a device or an ask" aria-label="Search the hub"
          role="combobox" aria-expanded={flat.length > 0} aria-controls="pal-results" aria-activedescendant={flat.length ? `pal-hit-${cursor}` : undefined} />
      </div>
      <div className="pal-results" id="pal-results" role="listbox" aria-label="Results">
        {groups.map(g => (
          <div key={g.id} role="group" aria-label={g.label}>
            <div className="overline pal-group">
              {g.label}{g.more > 0 && <span className="pal-more"> · {g.hits.length} of {g.hits.length + g.more}, keep typing to narrow</span>}
            </div>
            {g.hits.map(h => {
              const i = flat.indexOf(h)
              return (
                <button key={h.key} id={`pal-hit-${i}`} type="button" role="option" aria-selected={i === cursor}
                  className={`pal-hit${i === cursor ? ' on' : ''}`} onMouseMove={() => i !== cursor && setCursor(i)} onClick={() => go(h)}>
                  <span className="pal-hit-title">{h.parts ? <Parts parts={h.parts} /> : <Marked text={h.title} toks={toks} />}</span>
                  {h.sub && <span className="pal-hit-sub">{h.sub}</span>}
                  {h.detail && <span className="pal-hit-detail"><b>{h.detail.label}: </b><Parts parts={h.detail.parts} /></span>}
                </button>
              )
            })}
          </div>
        ))}
        {toks.length > 0 && !flat.length && !loading && <p className="pal-empty">Nothing in the hub matches that.</p>}
        {loading && <p className="pal-empty">{flat.length ? 'Still loading some of the hub…' : 'Searching…'}</p>}
      </div>
      <div className="pal-foot">
        <span><kbd>↑</kbd> <kbd>↓</kbd> to move</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span>
      </div>
    </Dialog>
  )
}

/** Highlighted parts from a source that marks its own matches ({ t, hit }). */
function Parts({ parts }) {
  return parts.map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))
}

/** Text with the searched-for words marked. */
function Marked({ text, toks }) {
  if (!toks.length) return text
  const re = new RegExp(`(${toks.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig')
  return String(text).split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>))
}
