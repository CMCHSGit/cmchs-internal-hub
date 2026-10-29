/* One page in the editor: the PDF page drawn on a canvas, with the person's
   objects (text, shapes, images) in an overlay on top.

   The overlay is "page space" (model.js): points, top left origin, the page's
   own orientation. CSS turns it with the page when someone rotates it and
   scales it with the zoom, so an object is stored once and never recomputed.
   Pointer movements are turned back into page space (deltaToPage,
   displayToPage) before they touch an object.

   The page's own text and pictures can be picked up too: clicking text puts it
   in an editor, dragging text or a picture moves it, and the Move area tool lifts
   any area. Picking something up covers the original (in the page's own
   background colour) and puts the same thing on top as an object of ours, which
   can then be moved, resized or retyped like any other. */
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { drawPage, fontFlags, liftRegion, loadImageBoxes, loadText, sampleRegion } from './engine.js'
import {
  FAMILIES, HIGHLIGHT_OPACITY, LINE, addPenPoint, bestStyle, boxFrom, deltaToPage, displaySize, displayToPage, geometry,
  moveObject, newBox, newImage, newLine, newPen, newText, norm, overlayTransform, pickColours, resizeBox, resizePen, resizeText, textHotspots,
} from './model.js'

/** How wide `str` is at `size` in the editor's own font (Arial, Times New Roman or Courier New, as Helvetica, Times and Courier are saved). */
let measureCtx = null
const measure = (str, size) => (family, bold, italic) => {
  measureCtx ||= document.createElement('canvas').getContext('2d')
  measureCtx.font = `${italic ? 'italic ' : ''}${bold ? '700 ' : '400 '}100px ${FAMILIES[family].css}`
  return measureCtx.measureText(str).width * size / 100
}

const DRAW_TOOLS = ['rect', 'ellipse', 'highlight', 'whiteout', 'line', 'pen']
/** These stay selected after one use: marking up a page takes many highlights and whiteouts. */
const STICKY = ['pen', 'highlight', 'whiteout']
/** Further than this many screen pixels from where it went down, a press is a drag, not a click. */
const DRAG = 6
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

const Handles = () => ['nw', 'ne', 'sw', 'se'].map(h => <i key={h} className="pe-handle" data-h={h} />)

function ObjectNode({ o, selected, editing, imageUrl, onText }) {
  const cls = `pe-obj pe-${o.type}${selected ? ' sel' : ''}`
  if (o.type === 'text') {
    const f = FAMILIES[o.family] || FAMILIES.Helvetica
    return (
      <div data-oid={o.id} className={cls + (editing ? ' editing' : '')}
        style={{ left: o.x, top: o.y, fontSize: o.size, lineHeight: LINE, fontFamily: f.css, fontWeight: o.bold ? 700 : 400, fontStyle: o.italic ? 'italic' : 'normal', color: o.color }}>
        {editing ? <TextEditor text={o.text} onDone={onText} /> : o.text}
        {selected && !editing && <Handles />}
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

export const PageView = memo(function PageView({ entry, geom, src, z, tool, selId, defaults, imageUrls, api }) {
  const box = useRef(null), canvas = useRef(null), drag = useRef(null), rotated = useRef(entry.rotate)
  const [near, setNear] = useState(false)
  const [draft, setDraft] = useState(null)   // an object being drawn
  const [editId, setEditId] = useState(null) // the text object being typed into ('draft' for a new one)
  const [hot, setHot] = useState([])         // the page's own text, as boxes in page space
  const [pics, setPics] = useState([])       // the page's own pictures
  const [hover, setHover] = useState(null)   // the one under the pointer
  const [cover, setCover] = useState(null)   // { box, orig }: what covers the page's text while it is being retyped
  const [area, setArea] = useState(null)     // the area being dragged out with the Move area tool
  const pending = useRef(null)               // a press on the page's own text or picture: a click or a drag, not yet known
  const down_ = useRef(false), last = useRef({ x: 0, y: 0 })

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

  // Read the page's own text and pictures once it is near the screen, so they can be clicked.
  useEffect(() => {
    if (!src || !near || tool !== 'select') return undefined
    let live = true
    loadText(src, entry.n)
      .then(c => { if (live) setHot(textHotspots(c.items, c.styles, geom)) })
      .catch(e => console.warn('[pdf-editor] page text not read', e))
    loadImageBoxes(src, entry.n, geom)
      .then(b => { if (live) setPics(b) })
      .catch(e => console.warn('[pdf-editor] page pictures not read', e))
    return () => { live = false }
  }, [src, entry.n, near, tool, geom])

  const inside = (t, x, y) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h
  // Text first (it is drawn over pictures and shapes); of several pictures and shapes the smallest.
  const hotAt = (x, y) => hot.find(t => inside(t, x, y))
    || pics.filter(t => inside(t, x, y)).sort((a, b) => a.w * a.h - b.w * b.h)[0] || null

  /** Text on the page, taken up: the cover that hides it, and the same words as a text object of ours. */
  const prepText = async (t) => {
    // Bold and italic: from the font's own name when pdf.js has it, else from which style is as wide as the text really is.
    const style = bestStyle(t.fam, t.w, measure(t.str, t.size))
    const flags = await fontFlags(src, entry.n, t.font)
    if (flags) { style.bold = flags.bold; style.italic = flags.italic }
    // The cover and the new text take the colours the page has there: read off a close-up of the text itself.
    let col = { bg: '#ffffff', text: '#000000' }
    try {
      col = pickColours(await sampleRegion(src, entry.n, geom.rot, { x: t.x, y: t.baseline - 0.7 * t.size, w: t.w, h: 0.8 * t.size }))
    } catch (e) { console.warn('[pdf-editor] colours not read', e) }
    const obj = { ...newText(t.x, t.baseline - FAMILIES[style.family].baseline * t.size, { ...style, size: t.size, color: col.text }), text: t.str }
    const coverBox = newBox('rect', t.x - 0.6, t.y - 0.4, t.w + 1.2, t.h + 0.8, { fill: col.bg, stroke: null, sw: 1 })
    return { cover: coverBox, obj }
  }

  /** A picture, or any area, taken up: the cover that hides it, and the same pixels as an image of ours. */
  const prepArea = async (a) => {
    const { bytes, url, bg } = await liftRegion(src, entry.n, geom.rot, a, { w: g.width, h: g.height })
    const id = api.registerImage(bytes, url)
    return {
      cover: newBox('rect', a.x - 0.5, a.y - 0.5, a.w + 1, a.h + 1, { fill: bg, stroke: null, sw: 1 }),
      obj: newImage(a.x, a.y, a.w, a.h, id),
    }
  }
  const prep = (t) => (t.kind ? prepArea(t) : prepText(t))

  /** Click on the page's own text: cover it and put the same words in a text box over the cover, to be retyped. */
  const startEdit = async (t) => {
    const { cover: coverBox, obj } = await prepText(t)
    setHover(null); setCover({ box: coverBox, orig: t.str }); setDraft(obj); setEditId('draft')
  }

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
    last.current = { x: e.clientX, y: e.clientY }

    if (tool === 'select' || (tool === 'text' && obj?.type === 'text')) {
      if (!obj) {
        api.select(null)
        // A press on the page's own text or picture: a click edits or picks it up, a drag moves it (see move and up).
        const t = tool === 'select' ? hotAt(px, py) : null
        if (t) { pending.current = { t, ...start }; down_.current = true; e.currentTarget.setPointerCapture(e.pointerId) }
        return
      }
      api.select(entry.id, obj.id)
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { ...start, kind: handle ? 'resize' : 'move', handle, obj, moved: false, w0: hit.offsetWidth, h0: hit.offsetHeight }
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    api.select(null)
    if (tool === 'grab') {
      drag.current = { ...start, kind: 'grab', px, py, moved: false }
      setArea({ x: px, y: py, w: 0, h: 0 })
      return
    }
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
    last.current = { x: e.clientX, y: e.clientY }
    const d = drag.current
    if (!d) {
      const p = pending.current
      if (p && !p.lifting && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) >= DRAG) {
        // Dragged from the page's own text or picture: take it up, then carry on dragging it.
        p.lifting = true
        setHover(null)
        prep(p.t).then(({ cover: coverBox, obj }) => {
          api.addMany(entry.id, [coverBox, obj], { select: true })
          if (pending.current !== p) return
          pending.current = null
          if (down_.current) drag.current = { sx: last.current.x, sy: last.current.y, kind: 'move', obj, moved: false }
        }).catch(err => { pending.current = null; console.warn('[pdf-editor] could not pick that up', err) })
        return
      }
      if (tool === 'select' && e.pointerType === 'mouse' && !p && (hot.length || pics.length)) {
        const t = e.target.closest('[data-oid]') ? null : hotAt(...toPage(e))
        setHover(h => (h === t ? h : t))
      }
      return
    }
    const sdx = e.clientX - d.sx, sdy = e.clientY - d.sy
    if (!d.moved && Math.hypot(sdx, sdy) < 3) return
    d.moved = true
    const [dx, dy] = deltaToPage(sdx, sdy, entry.rotate).map(v => v / z)
    if (d.kind === 'move') api.live(entry.id, d.obj.id, moveObject(d.obj, dx, dy))
    else if (d.kind === 'resize') {
      const o = d.obj
      let next
      if (o.type === 'line') next = d.handle === 'p1' ? { ...o, x1: o.x1 + dx, y1: o.y1 + dy } : { ...o, x2: o.x2 + dx, y2: o.y2 + dy }
      else if (o.type === 'pen') next = resizePen(o, d.handle, dx, dy)
      else if (o.type === 'text') next = resizeText(o, d.handle, dx, dy, d.w0, d.h0)
      else next = resizeBox(o, d.handle, dx, dy, o.type === 'image')
      api.live(entry.id, o.id, next)
    } else if (d.kind === 'grab') {
      const [x, y] = toPage(e)
      d.box = boxFrom(d.px, d.py, x, y)
      setArea(d.box)
    } else {
      const [x, y] = toPage(e)
      const o = d.obj
      setDraft(o.type === 'line' ? { ...o, x2: x, y2: y } : o.type === 'pen' ? (d.obj = { ...o, points: addPenPoint(o.points, x, y) }) : { ...o, ...boxFrom(d.px, d.py, x, y) })
    }
  }

  const up = (e) => {
    down_.current = false
    const p = pending.current
    if (p) {
      if (p.lifting) return // being picked up: move() finishes the job
      pending.current = null
      if (e && Math.hypot(e.clientX - p.sx, e.clientY - p.sy) < DRAG) {
        if (p.t.kind) prepArea(p.t).then(({ cover: coverBox, obj }) => api.addMany(entry.id, [coverBox, obj], { select: true })).catch(err => console.warn('[pdf-editor] could not pick that up', err))
        else startEdit(p.t)
      }
      return
    }
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'grab') {
      const a = d.box
      setArea(null)
      api.setTool('select')
      if (a && a.w > 6 && a.h > 6) {
        const clipped = { x: Math.max(0, a.x), y: Math.max(0, a.y) }
        clipped.w = Math.min(g.width, a.x + a.w) - clipped.x
        clipped.h = Math.min(g.height, a.y + a.h) - clipped.y
        if (clipped.w > 2 && clipped.h > 2) prepArea(clipped).then(({ cover: coverBox, obj }) => api.addMany(entry.id, [coverBox, obj], { select: true })).catch(err => console.warn('[pdf-editor] could not pick that up', err))
      }
      return
    }
    if (d.kind !== 'create') { api.endLive(); return }
    const o = draft
    setDraft(null)
    const big = o && (o.type === 'line' ? Math.hypot(o.x2 - o.x1, o.y2 - o.y1) > 3 : o.type === 'pen' ? o.points.length > 1 : o.w > 3 && o.h > 3)
    if (big) api.add(entry.id, o, { select: !STICKY.includes(tool), revert: !STICKY.includes(tool) })
  }

  const cancel = () => { pending.current = null; up() }

  const dbl = (e) => {
    const hit = e.target.closest('[data-oid]')
    const obj = hit && find(hit.dataset.oid)
    if (obj?.type === 'text') { api.select(entry.id, obj.id); setEditId(obj.id) }
  }

  const finishText = (text) => {
    if (editId === 'draft' && cover) {
      // Retyping the page's own text: nothing changes unless the words did; erasing them all leaves just the cover.
      if (text !== cover.orig) api.addMany(entry.id, text.trim() ? [cover.box, { ...draft, text }] : [cover.box], { select: !!text.trim() })
      setDraft(null); setCover(null)
      setEditId(null)
      return
    }
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
  const cursor = tool === 'select' ? (hover ? (hover.kind ? 'move' : 'text') : '') : tool === 'text' ? 'text' : 'crosshair'

  return (
    <div ref={box} id={'pe-pg-' + entry.id} className="pe-page" data-page={entry.id} style={{ width: W, height: H }}>
      {src && <canvas ref={canvas} className="pe-canvas" style={{ width: W, height: H }} />}
      <div className="pe-overlay" data-tool={tool}
        style={{ width: g.width, height: g.height, transform: overlayTransform(entry.rotate, W, H, z), '--u': 1 / z + 'px', cursor }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={cancel} onPointerLeave={() => setHover(null)} onDoubleClick={dbl}>
        {hover && !editId && <div className="pe-hot" style={{ left: hover.x - 1, top: hover.y - 1, width: hover.w + 2, height: hover.h + 2 }} />}
        {entry.objects.map(o => (
          <ObjectNode key={o.id} o={o} selected={o.id === selId} editing={o.id === editId} imageUrl={imageUrls.get(o.imgId)} onText={finishText} />
        ))}
        {sb && <div className="pe-selbox" style={{ left: sb.x, top: sb.y, width: sb.w, height: sb.h }} />}
        {sel?.type === 'line' && [['p1', sel.x1, sel.y1], ['p2', sel.x2, sel.y2]].map(([h, x, y]) => (
          <i key={h} className="pe-handle" data-oid={sel.id} data-h={h} style={{ left: x, top: y }} />
        ))}
        {sel?.type === 'pen' && sb && ['nw', 'ne', 'sw', 'se'].map(h => (
          <i key={h} className="pe-handle" data-oid={sel.id} data-h={h} style={{ left: h.includes('e') ? sb.x + sb.w : sb.x, top: h.includes('s') ? sb.y + sb.h : sb.y }} />
        ))}
        {area && <div className="pe-selbox pe-area" style={{ left: area.x, top: area.y, width: area.w, height: area.h }} />}
        {cover && <ObjectNode o={cover.box} />}
        {draft && <ObjectNode o={draft} editing={editId === 'draft'} onText={finishText} />}
      </div>
    </div>
  )
})
