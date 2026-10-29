/* One page in the editor: the PDF page drawn on a canvas, with the person's
   objects (text, shapes, images) in an overlay on top.

   The overlay is "page space" (model.js): points, top left origin, the page's
   own orientation. CSS turns it with the page when someone rotates it and
   scales it with the zoom, so an object is stored once and never recomputed.
   Pointer movements are turned back into page space (deltaToPage,
   displayToPage) before they touch an object. */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawPage } from './engine.js'
import {
  FAMILIES, HIGHLIGHT_OPACITY, LINE, addPenPoint, boxFrom, deltaToPage, displaySize, displayToPage, geometry,
  moveObject, newBox, newLine, newPen, newText, norm, overlayTransform, resizeBox,
} from './model.js'

const DRAW_TOOLS = ['rect', 'ellipse', 'highlight', 'whiteout', 'line', 'pen']
/** These stay selected after one use: marking up a page takes many highlights and whiteouts. */
const STICKY = ['pen', 'highlight', 'whiteout']
/** 'plaintext-only' keeps pasted formatting out and newlines as \n; Firefox before 136 needs plain 'true'. */
const PLAIN = (() => { try { const d = document.createElement('div'); d.contentEditable = 'plaintext-only'; return d.contentEditable === 'plaintext-only' ? 'plaintext-only' : 'true' } catch { return 'true' } })()

function bounds(o) {
  if (o.type === 'line') return { x: Math.min(o.x1, o.x2), y: Math.min(o.y1, o.y2), w: Math.abs(o.x2 - o.x1), h: Math.abs(o.y2 - o.y1) }
  if (o.type === 'pen') {
    const xs = o.points.map(p => p[0]), ys = o.points.map(p => p[1])
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
  }
  return { x: o.x, y: o.y, w: o.w, h: o.h }
}

function TextEditor({ text, onDone }) {
  const el = useRef(null)
  useLayoutEffect(() => {
    const e = el.current
    e.innerText = text
    // Focus a moment later: the click that made this editor is still being
    // handled, and the browser would move focus off it as soon as that ends.
    const t = setTimeout(() => {
      e.focus()
      const r = document.createRange()
      r.selectNodeContents(e); r.collapse(false)
      const s = getSelection(); s.removeAllRanges(); s.addRange(r)
    }, 30)
    return () => clearTimeout(t)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <span ref={el} className="pe-editing" contentEditable={PLAIN} suppressContentEditableWarning spellCheck={false}
      onBlur={() => onDone(el.current.innerText.replace(/\n$/, ''))}
      onKeyDown={e => { e.stopPropagation(); if (e.key === 'Escape') el.current.blur() }}
      onPaste={e => { if (PLAIN === 'true') { e.preventDefault(); document.execCommand('insertText', false, e.clipboardData.getData('text/plain')) } }} />
  )
}

function ObjectNode({ o, selected, editing, imageUrl, onText }) {
  const cls = `pe-obj pe-${o.type}${selected ? ' sel' : ''}`
  if (o.type === 'text') {
    const f = FAMILIES[o.family] || FAMILIES.Helvetica
    return (
      <div data-oid={o.id} className={cls + (editing ? ' editing' : '')}
        style={{ left: o.x, top: o.y, fontSize: o.size, lineHeight: LINE, fontFamily: f.css, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', color: o.color }}>
        {editing ? <TextEditor text={o.text} onDone={onText} /> : o.text}
      </div>
    )
  }
  if (o.type === 'image') {
    return (
      <div data-oid={o.id} className={cls} style={{ left: o.x, top: o.y, width: o.w, height: o.h }}>
        {imageUrl && <img src={imageUrl} alt="" draggable={false} />}
        {selected && <Handles />}
      </div>
    )
  }
  if (o.type === 'rect' || o.type === 'ellipse' || o.type === 'highlight') {
    const sw = o.stroke ? o.sw : 0
    return (
      <div data-oid={o.id} className={cls} style={{
        left: o.x - sw / 2, top: o.y - sw / 2, width: o.w + sw, height: o.h + sw,
        background: o.fill || 'transparent', border: sw ? `${sw}px solid ${o.stroke}` : 'none',
        borderRadius: o.type === 'ellipse' ? '50%' : 0,
        ...(o.type === 'highlight' ? { mixBlendMode: 'multiply', opacity: HIGHLIGHT_OPACITY } : {}),
      }}>
        {selected && <Handles />}
      </div>
    )
  }
  // line, pen
  const pts = o.type === 'line' ? [[o.x1, o.y1], [o.x2, o.y2]] : o.points
  const d = pts.map(p => p.join(',')).join(' ')
  return (
    <svg data-oid={o.id} className={cls} width="100%" height="100%" style={{ left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}>
      <polyline points={d} fill="none" stroke={o.stroke} strokeWidth={o.sw} strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={d} fill="none" stroke="transparent" strokeWidth={Math.max(o.sw, 12)} strokeLinecap="round" style={{ pointerEvents: 'stroke' }} />
    </svg>
  )
}

const Handles = () => ['nw', 'ne', 'sw', 'se'].map(h => <i key={h} className="pe-handle" data-h={h} />)

export const PageView = memo(function PageView({ entry, geom, src, z, tool, selId, defaults, imageUrls, api }) {
  const box = useRef(null), canvas = useRef(null), drag = useRef(null), rotated = useRef(entry.rotate)
  const [near, setNear] = useState(false)
  const [draft, setDraft] = useState(null)   // an object being drawn
  const [editId, setEditId] = useState(null) // the text object being typed into ('draft' for a new one)

  const g = geometry(geom)
  const disp = displaySize(geom, entry.rotate)
  const W = disp.w * z, H = disp.h * z

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: api.scroller.current, rootMargin: '1400px 0px' })
    io.observe(box.current)
    return () => io.disconnect()
  }, [api])

  // Draw while near the screen, drop the pixels when far away (a long document would otherwise hold them all).
  useEffect(() => {
    if (!src) return undefined
    const c = canvas.current
    if (!near) { c.width = 0; c.height = 0; return undefined }
    if (rotated.current !== entry.rotate) { rotated.current = entry.rotate; c.width = 0 }
    const scale = z * Math.min(2, window.devicePixelRatio || 1)
    let job
    const t = setTimeout(() => {
      job = drawPage(src, entry.n, norm(geom.rot + entry.rotate), scale, c)
      job.done.catch(e => console.warn('[pdf-editor] page did not draw', e))
    }, c.width ? 140 : 0) // zooming: wait for the zoom to settle, the old pixels stretch meanwhile
    return () => { clearTimeout(t); job?.cancel() }
  }, [near, z, entry.rotate, entry.n, src, geom.rot])

  const toPage = (e) => {
    const r = box.current.getBoundingClientRect()
    return displayToPage(e.clientX - r.left, e.clientY - r.top, entry.rotate, W, H, z)
  }
  const find = (id) => entry.objects.find(o => o.id === id)

  const down = (e) => {
    if (e.button !== 0 || e.target.isContentEditable) return
    const hit = e.target.closest('[data-oid]')
    const handle = e.target.closest('[data-h]')?.dataset.h
    const obj = hit && find(hit.dataset.oid)
    const [px, py] = toPage(e)
    const start = { sx: e.clientX, sy: e.clientY }

    if (tool === 'select' || (tool === 'text' && obj?.type === 'text')) {
      if (!obj) { api.select(null); return }
      api.select(entry.id, obj.id)
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { ...start, kind: handle ? 'resize' : 'move', handle, obj, moved: false }
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    api.select(null)
    if (tool === 'text') {
      const t = newText(px, py - defaults.size * 0.6, defaults)
      setDraft(t); setEditId('draft')
      drag.current = null
      return
    }
    if (DRAW_TOOLS.includes(tool)) {
      const d = tool === 'whiteout' ? { ...defaults, fill: '#ffffff', stroke: null } : defaults
      const o = tool === 'line' ? newLine(px, py, px, py, d)
        : tool === 'pen' ? newPen([[px, py]], d)
        : newBox(tool === 'whiteout' ? 'rect' : tool, px, py, 0, 0, d)
      drag.current = { ...start, kind: 'create', px, py, obj: o, moved: false }
      setDraft(o)
    }
  }

  const move = (e) => {
    const d = drag.current
    if (!d) return
    const sdx = e.clientX - d.sx, sdy = e.clientY - d.sy
    if (!d.moved && Math.hypot(sdx, sdy) < 3) return
    d.moved = true
    const [dx, dy] = deltaToPage(sdx, sdy, entry.rotate).map(v => v / z)
    if (d.kind === 'move') api.live(entry.id, d.obj.id, moveObject(d.obj, dx, dy))
    else if (d.kind === 'resize') api.live(entry.id, d.obj.id, resizeBox(d.obj, d.handle, dx, dy, d.obj.type === 'image'))
    else {
      const [x, y] = toPage(e)
      const o = d.obj
      setDraft(o.type === 'line' ? { ...o, x2: x, y2: y } : o.type === 'pen' ? (d.obj = { ...o, points: addPenPoint(o.points, x, y) }) : { ...o, ...boxFrom(d.px, d.py, x, y) })
    }
  }

  const up = () => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind !== 'create') { api.endLive(); return }
    const o = draft
    setDraft(null)
    const big = o && (o.type === 'line' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) > 3 : o.type === 'pen' ? o.points.length > 1 : o.w > 3 && o.h > 3)
    if (big) api.add(entry.id, o, { select: !STICKY.includes(tool), revert: !STICKY.includes(tool) })
  }

  const dbl = (e) => {
    const hit = e.target.closest('[data-oid]')
    const obj = hit && find(hit.dataset.oid)
    if (obj?.type === 'text') { api.select(entry.id, obj.id); setEditId(obj.id) }
  }

  const finishText = (text) => {
    if (editId === 'draft') {
      if (text.trim()) api.add(entry.id, { ...draft, text }, { select: true, revert: true })
      setDraft(null)
    } else if (!text.trim()) api.remove(entry.id, editId)
    else api.update(entry.id, editId, { text })
    setEditId(null)
    api.setTool('select')
  }

  const sel = selId && find(selId)
  const sb = sel && (sel.type === 'line' || sel.type === 'pen') ? bounds(sel) : null
  const cursor = tool === 'select' ? '' : tool === 'text' ? 'text' : 'crosshair'

  return (
    <div ref={box} id={'pe-pg-' + entry.id} className="pe-page" data-page={entry.id} style={{ width: W, height: H }}>
      {src && <canvas ref={canvas} className="pe-canvas" style={{ width: W, height: H }} />}
      <div className="pe-overlay" data-tool={tool}
        style={{ width: g.width, height: g.height, transform: overlayTransform(entry.rotate, W, H, z), '--u': 1 / z + 'px', cursor }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={dbl}>
        {entry.objects.map(o => (
          <ObjectNode key={o.id} o={o} selected={o.id === selId} editing={o.id === editId} imageUrl={imageUrls.get(o.imgId)} onText={finishText} />
        ))}
        {sb && <div className="pe-selbox" style={{ left: sb.x, top: sb.y, width: sb.w, height: sb.h }} />}
        {draft && <ObjectNode o={draft} editing={editId === 'draft'} onText={finishText} />}
      </div>
    </div>
  )
})
