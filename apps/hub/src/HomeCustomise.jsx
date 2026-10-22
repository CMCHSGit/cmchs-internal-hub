/* Customise the home page's icon row: drag the rows (or use the arrows, which also work on a phone)
   to reorder, remove what you don't use, add any tool back, and add your own links. */
import { useState } from 'react'
import Icon from './Icon.jsx'
import { Dialog } from './ui.jsx'
import { resolveEntries, safeUrl } from './home-layout.js'
import { tools } from './tools.js'

/** A tool's icon; a link added by someone shows its site's own icon when it has one. */
export function ToolGlyph({ tool, size }) {
  const [failed, setFailed] = useState(false)
  if (tool.favicon && !failed) return <img src={tool.favicon} alt="" width={size} height={size} className="glyph-favicon" onError={() => setFailed(true)} />
  return <Icon name={tool.icon} size={size} />
}

export default function HomeCustomise({ entries, onSave, onReset, onClose }) {
  const [list, setList] = useState(entries)
  const [drag, setDrag] = useState(null)
  const [label, setLabel] = useState('')
  const [url, setUrl] = useState('')
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)

  const rows = resolveEntries(list)
  const move = (from, to) => {
    if (to < 0 || to >= list.length || from === to) return
    const next = [...list]
    next.splice(to, 0, next.splice(from, 1)[0])
    setList(next)
  }
  const remove = i => setList(list.filter((_, j) => j !== i))
  const available = tools.filter(t => !list.includes(t.id))

  function addLink(e) {
    e.preventDefault()
    const u = url.trim()
    if (!label.trim()) return setProblem('Give the link a name.')
    if (!safeUrl(u)) return setProblem('The address needs to start with https:// (or / for a page in the hub).')
    setList([...list, { label: label.trim(), url: u }])
    setLabel(''); setUrl(''); setProblem('')
  }

  async function finish(fn, arg) {
    setBusy(true)
    const msg = await fn(arg)
    setBusy(false)
    onClose(msg || 'Home page saved.')
  }

  return (
    <Dialog title="Customise your home page" wide onClose={() => onClose('')}>
      <p className="body-sm">The round icons under the search box. Drag to reorder (or use the arrows), remove what you don’t use, and add your own links.</p>
      <ul className="hc-list" aria-label="Your icons">
        {rows.map((r, i) => (
          <li key={r.key} className={`hc-row${drag === i ? ' dragging' : ''}`} draggable
            onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)}
            onDragOver={e => { e.preventDefault(); if (drag !== null && drag !== i) { move(drag, i); setDrag(i) } }}>
            <span className="hc-grip" aria-hidden="true">⋮⋮</span>
            <span className="tile tile-32"><ToolGlyph tool={r.tool} size={16} /></span>
            <span className="hc-name">{r.tool.short || r.tool.name}{typeof list[i] === 'object' && <span className="caption"> · {list[i].url}</span>}</span>
            <button type="button" className="icon-btn" aria-label={`Move ${r.tool.name} up`} disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
            <button type="button" className="icon-btn" aria-label={`Move ${r.tool.name} down`} disabled={i === rows.length - 1} onClick={() => move(i, i + 1)}>↓</button>
            <button type="button" className="icon-btn" aria-label={`Remove ${r.tool.name}`} onClick={() => remove(i)}>×</button>
          </li>
        ))}
        {rows.length === 0 && <li className="caption">Nothing here. Add a tool below.</li>}
      </ul>
      {available.length > 0 && (
        <div className="stack-10">
          <span className="chs-overline">Add a tool</span>
          <div className="tag-row">
            {available.map(t => <button key={t.id} type="button" className="tag" onClick={() => setList([...list, t.id])}>+ {t.short || t.name}</button>)}
          </div>
        </div>
      )}
      <form className="hc-add" onSubmit={addLink}>
        <span className="chs-overline">Add a link</span>
        <div className="hc-add-row">
          <input className="input" placeholder="Name" aria-label="Link name" maxLength={40} value={label} onChange={e => setLabel(e.target.value)} />
          <input className="input" placeholder="https://…" aria-label="Link address" value={url} onChange={e => setUrl(e.target.value)} />
          <button type="submit" className="btn btn-secondary">Add</button>
        </div>
        {problem && <span className="caption" role="alert">{problem}</span>}
      </form>
      <div className="hc-actions">
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => finish(onReset)}>Back to the standard row</button>
        <span className="spacer" />
        <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onClose('')}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => finish(onSave, list)}>Save</button>
      </div>
    </Dialog>
  )
}
