/* The page strip: small pictures of every page, to pick pages (click, Ctrl or
   Shift for several) and to drag into a new order. Each picture is drawn only
   once it scrolls into view. */
import { memo, useEffect, useRef, useState } from 'react'
import { drawPage } from './engine.js'
import { displaySize, norm } from './model.js'

const THUMB_W = 120

const Thumb = memo(function Thumb({ entry, geom, src, index, selected, current, drop, onPick, onDragStart, onDragOver, onDrop, onDragEnd, scroller }) {
  const box = useRef(null), canvas = useRef(null)
  const [near, setNear] = useState(false)
  const disp = displaySize(geom, entry.rotate)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: scroller.current, rootMargin: '400px 0px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [scroller])

  useEffect(() => {
    const c = canvas.current
    if (!src || !c) return undefined
    if (!near) { c.width = 0; c.height = 0; return undefined } // far away: give the pixels back
    const scale = (THUMB_W * Math.min(2, window.devicePixelRatio || 1)) / disp.w
    const job = drawPage(src, entry.n, norm(geom.rot + entry.rotate), scale, c)
    job.done.catch(() => {})
    return () => job.cancel()
  }, [near, src, entry.n, entry.rotate, geom.rot, disp.w])

  useEffect(() => {
    if (current) box.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <div ref={box} className={`pe-thumb${selected ? ' on' : ''}${current ? ' cur' : ''}${drop ? ' drop-' + drop : ''}`}
      draggable onDragStart={e => onDragStart(e, entry.id)} onDragOver={e => onDragOver(e, entry.id)} onDrop={e => onDrop(e, entry.id)} onDragEnd={onDragEnd}
      onClick={e => onPick(entry.id, e)} role="button" aria-pressed={selected} aria-label={`Page ${index + 1}`} tabIndex={0}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(entry.id, e) } }}>
      <div className="pe-thumb-pic" style={{ aspectRatio: `${disp.w} / ${disp.h}` }}>
        {src ? <canvas ref={canvas} /> : null}
        {entry.objects.length > 0 && <i className="pe-thumb-dot" title="Has edits" />}
      </div>
      <span className="pe-thumb-n">{index + 1}</span>
    </div>
  )
})

export function Thumbs({ pages, sources, geomOf, selected, currentId, onPick, onMove }) {
  const scroller = useRef(null)
  const dragIds = useRef([])
  const [drop, setDrop] = useState(null) // { id, side: 'before' | 'after' }

  const onDragStart = (e, id) => {
    dragIds.current = selected.has(id) ? pages.filter(p => selected.has(p.id)).map(p => p.id) : [id]
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', 'pages')
  }
  const onDragOver = (e, id) => {
    if (!dragIds.current.length) return
    e.preventDefault()
    const r = e.currentTarget.getBoundingClientRect()
    const side = e.clientY < r.top + r.height / 2 ? 'before' : 'after'
    setDrop(d => (d && d.id === id && d.side === side ? d : { id, side }))
  }
  const onDrop = (e, id) => {
    if (!dragIds.current.length) return
    e.preventDefault()
    const i = pages.findIndex(p => p.id === id)
    const before = drop?.side === 'after' ? (pages[i + 1]?.id ?? null) : id
    onMove(dragIds.current, before)
    dragIds.current = []; setDrop(null)
  }
  const onDragEnd = () => { dragIds.current = []; setDrop(null) }

  return (
    <div className="pe-thumbs" ref={scroller}>
      {pages.map((p, i) => (
        <Thumb key={p.id} entry={p} geom={geomOf(p)} src={p.src >= 0 ? sources[p.src] : null} index={i} scroller={scroller}
          selected={selected.has(p.id)} current={p.id === currentId} drop={drop?.id === p.id ? drop.side : ''}
          onPick={onPick} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd} />
      ))}
    </div>
  )
}
