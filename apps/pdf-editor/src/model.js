/* The PDF editor's document model: pure functions, no browser, no PDF library,
   so they can be tested in Node (tests/model.test.mjs).

   A document is a list of pages. A page is a reference to a page of a source
   PDF (or a blank one) plus what the person has done to it: a rotation and a
   list of objects (text, shapes, images) drawn on top. Nothing touches the PDF's
   bytes until Save (save.js), which is why editing stays fast.

   Coordinates: every object lives in "page space": points (1/72 inch), origin
   at the top left, measured on the page as it is *natively* oriented (its own
   /Rotate applied, the person's rotation not). The editor spins the whole page
   and its objects together when someone rotates it, so objects never need
   re-computing; save.js maps page space to PDF user space with geometry(). */

let seq = 0
/** A short id, unique within a session. */
export const uid = (prefix = 'x') => prefix + (++seq).toString(36) + Math.random().toString(36).slice(2, 6)

/** A rotation as 0, 90, 180 or 270. */
export const norm = (r) => (((Math.round((r || 0) / 90) * 90) % 360) + 360) % 360

/**
 * Where a page's visible area is and how it is turned, from the source PDF:
 * { x0, y0, w, h } is the visible box in user space (bottom-left origin) and
 * rot its own /Rotate. Gives the page's size as displayed and the mapping from
 * page space (top-left origin, y down) back to user space.
 */
export function geometry({ x0, y0, w, h, rot }) {
  rot = norm(rot)
  const turned = rot === 90 || rot === 270
  const width = turned ? h : w
  const height = turned ? w : h
  const toUser = (dx, dy) => {
    switch (rot) {
      case 90: return [x0 + dy, y0 + dx]
      case 180: return [x0 + w - dx, y0 + dy]
      case 270: return [x0 + w - dy, y0 + h - dx]
      default: return [x0 + dx, y0 + h - dy]
    }
  }
  const fromUser = (ux, uy) => {
    switch (rot) {
      case 90: return [uy - y0, ux - x0]
      case 180: return [x0 + w - ux, uy - y0]
      case 270: return [y0 + h - uy, x0 + w - ux]
      default: return [ux - x0, y0 + h - uy]
    }
  }
  // The direction of page space's x axis in user space, in degrees
  // anticlockwise: what drawing calls need to lay text and boxes along it.
  return { width, height, toUser, fromUser, angle: rot }
}

/** The geometry of a blank page: upright, origin at the corner. */
export const blankGeom = (w, h) => ({ x0: 0, y0: 0, w, h, rot: 0 })

/** A4 portrait in points. */
export const A4 = { w: 595.28, h: 841.89 }

/** The size of a page as it is shown, in points (its native size, then turned by the person's rotation). */
export function displaySize(geom, rotate) {
  const g = geometry(geom)
  return norm(rotate) % 180 ? { w: g.height, h: g.width } : { w: g.width, h: g.height }
}

/**
 * A pointer movement on screen as a movement in page space, for a page turned
 * by `rotate` (the page spins clockwise, so its axes do).
 */
export function deltaToPage(sdx, sdy, rotate) {
  switch (norm(rotate)) {
    case 90: return [sdy, 0 - sdx]
    case 180: return [0 - sdx, 0 - sdy]
    case 270: return [0 - sdy, sdx]
    default: return [sdx, sdy]
  }
}

/**
 * A point on the displayed page (px from its top left, at zoom z, W×H px in
 * all) as a point in page space.
 */
export function displayToPage(X, Y, rotate, W, H, z) {
  let x, y
  switch (norm(rotate)) {
    case 90: x = Y; y = W - X; break
    case 180: x = W - X; y = H - Y; break
    case 270: x = H - Y; y = X; break
    default: x = X; y = Y
  }
  return [x / z, y / z]
}

/** A point in page space as a point on the displayed page, in px at zoom z (the inverse of displayToPage). */
export function pageToDisplay(x, y, rotate, W, H, z) {
  switch (norm(rotate)) {
    case 90: return [W - y * z, x * z]
    case 180: return [W - x * z, H - y * z]
    case 270: return [y * z, H - x * z]
    default: return [x * z, y * z]
  }
}

/** The CSS transform that lays page space over the displayed page: rotate, then zoom. */
export function overlayTransform(rotate, W, H, z) {
  switch (norm(rotate)) {
    case 90: return `translate(${W}px, 0) rotate(90deg) scale(${z})`
    case 180: return `translate(${W}px, ${H}px) rotate(180deg) scale(${z})`
    case 270: return `translate(0, ${H}px) rotate(270deg) scale(${z})`
    default: return `scale(${z})`
  }
}

/* ── The page's own text ── */

/** How far a line of text reaches above its baseline and below it, as a share of its size: the box a cover has to fill. */
const ASCENT = 0.78, DESCENT = 0.22

/**
 * The page's text as boxes in page space, from pdf.js's text content (items
 * with a transform and a width, in user space). Only upright, left to right
 * text is offered: that is what can be covered and retyped in place.
 * Each: { str, x, y, w, h, baseline, size, fam } with y the top of the box.
 */
export function textHotspots(items, styles, geom) {
  const g = geometry(geom)
  const out = []
  for (const it of items) {
    if (typeof it.str !== 'string' || !it.str.trim() || !(it.width > 0)) continue
    const [a, b, c, d, e, f] = it.transform
    const size = Math.hypot(a, b)
    if (!(size > 0)) continue
    const p0 = g.fromUser(e, f)
    const p1 = g.fromUser(e + (a / size) * it.width, f + (b / size) * it.width)
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1]
    if (dx <= 0 || Math.abs(dy) > 0.02 * dx) continue
    const up = g.fromUser(e + c, f + d)
    if (up[1] - p0[1] >= 0 || Math.abs(up[0] - p0[0]) > 0.35 * size) continue
    out.push({
      str: it.str, size, baseline: p0[1], x: p0[0], w: dx,
      y: p0[1] - ASCENT * size, h: (ASCENT + DESCENT) * size,
      fam: styles?.[it.fontName]?.fontFamily || 'sans-serif', font: it.fontName,
    })
  }
  return out
}

const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]

/**
 * Where the page's pictures are, as boxes in page space, from pdf.js's operator
 * list (`fnArray`, `argsArray`; `OPS` is pdf.js's table of operator codes). It
 * follows the current transform through save, restore, transform and form
 * XObjects, because a picture is drawn into the unit square of whatever
 * transform is current. Pictures that cover most of the page (a scanned
 * background) are left out: they would swallow every click.
 */
export function imageBoxes(fnArray, argsArray, OPS, geom) {
  const g = geometry(geom)
  const pictures = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintImageXObjectRepeat, OPS.paintSolidColorImageMask].filter(v => v !== undefined))
  const stack = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const out = []
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]
    if (fn === OPS.save) stack.push(ctm)
    else if (fn === OPS.restore) ctm = stack.pop() || ctm
    else if (fn === OPS.transform) ctm = mul(argsArray[i], ctm)
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (argsArray[i]?.[0]) ctm = mul(argsArray[i][0], ctm) }
    else if (fn === OPS.paintFormXObjectEnd) ctm = stack.pop() || ctm
    else if (pictures.has(fn)) {
      const [a, b, c, d, e, f] = ctm
      const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => g.fromUser(a * x + c * y + e, b * x + d * y + f))
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      const box = { kind: 'image', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
      if (box.w < 4 || box.h < 4 || (box.w * box.h) / (g.width * g.height) > 0.5) continue
      out.push(box)
    }
  }
  return out
}

/**
 * Where the page paints shapes (a banner, a coloured rule, a table's header
 * row, a border), as boxes in page space, from the same operator list. Each
 * path painted comes with its bounding box, which is followed through the
 * current transform; a plain white fill is left out (it is only the paper), and
 * so is anything covering most of the page. Lines thinner than a few points
 * are given a few points of height or width so they can be hit.
 */
export function shapeBoxes(fnArray, argsArray, OPS, geom) {
  const g = geometry(geom)
  const fills = new Set([OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const strokes = new Set([OPS.stroke, OPS.closeStroke, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke])
  const stack = []
  let ctm = [1, 0, 0, 1, 0, 0], fill = null, lineWidth = 1
  const out = []
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i]
    if (fn === OPS.save) stack.push([ctm, fill, lineWidth])
    else if (fn === OPS.restore) { if (stack.length) [ctm, fill, lineWidth] = stack.pop() }
    else if (fn === OPS.transform) ctm = mul(a, ctm)
    else if (fn === OPS.paintFormXObjectBegin) { stack.push([ctm, fill, lineWidth]); if (a?.[0]) ctm = mul(a[0], ctm) }
    else if (fn === OPS.paintFormXObjectEnd) { if (stack.length) [ctm, fill, lineWidth] = stack.pop() }
    else if (fn === OPS.setFillRGBColor) fill = String(a[0]).toLowerCase()
    else if (fn === OPS.setLineWidth) lineWidth = a[0]
    else if (fn === OPS.constructPath && a?.[2] && (fills.has(a[0]) || strokes.has(a[0]))) {
      const [x0, y0, x1, y1] = a[2]
      const [m0, m1, m2, m3, e, f] = ctm
      const pts = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].map(([x, y]) => g.fromUser(m0 * x + m2 * y + e, m1 * x + m3 * y + f))
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1])
      let box = { kind: 'shape', x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }
      if (strokes.has(a[0])) {
        const pad = lineWidth * Math.hypot(m0, m1) / 2
        box = { ...box, x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad }
      }
      const onlyWhite = fills.has(a[0]) && !strokes.has(a[0]) && fill === '#ffffff'
      if (onlyWhite || (box.w < 0.8 && box.h < 0.8) || (box.w * box.h) / (g.width * g.height) > 0.5) continue
      for (const [d, k, s] of [['w', 'x', 'w'], ['h', 'y', 'h']]) if (box[d] < 3) { box[k] -= (3 - box[d]) / 2; box[s] = 3 }
      out.push(box)
    }
  }
  return out
}

/** The editor's font for a PDF text run: Helvetica, Times or Courier by the run's family. */
export const familyOf = (fam) => (/serif/.test(fam) && !/sans/.test(fam) ? 'Times' : /mono|courier/i.test(fam) ? 'Courier' : 'Helvetica')

/**
 * Whether a run was bold and/or italic, found by which of the four styles of
 * its family is as wide as the run really is (`measure(family, bold, italic)`
 * is the width the editor's font gives the same text). Plain wins a near tie.
 */
export function bestStyle(fam, width, measure) {
  const family = familyOf(fam)
  let best = { family, bold: false, italic: false }, err = Math.abs(measure(family, false, false) - width)
  for (const [bold, italic] of [[true, false], [false, true], [true, true]]) {
    const e = Math.abs(measure(family, bold, italic) - width)
    if (e < err - 0.02 * width) { best = { family, bold, italic }; err = e }
  }
  return best
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

/**
 * The background and the text colour of a patch of rendered page (RGBA
 * pixels): the background is the most common colour, the text the pixel
 * furthest from it. Used so a cover matches what it covers and the retyped
 * text matches the original's colour.
 */
export function pickColours(rgba) {
  const bins = new Map()
  for (let i = 0; i < rgba.length; i += 4) {
    const k = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4)
    const b = bins.get(k)
    if (b) { b.n++; b.r += rgba[i]; b.g += rgba[i + 1]; b.b += rgba[i + 2] } else bins.set(k, { n: 1, r: rgba[i], g: rgba[i + 1], b: rgba[i + 2] })
  }
  let bg = null
  for (const b of bins.values()) if (!bg || b.n > bg.n) bg = b
  if (!bg) return { bg: '#ffffff', text: '#000000' }
  const br = bg.r / bg.n, bgc = bg.g / bg.n, bb = bg.b / bg.n
  let far = 0, tr = 0, tg = 0, tb = 0
  for (let i = 0; i < rgba.length; i += 4) {
    const d = (rgba[i] - br) ** 2 + (rgba[i + 1] - bgc) ** 2 + (rgba[i + 2] - bb) ** 2
    if (d > far) { far = d; tr = rgba[i]; tg = rgba[i + 1]; tb = rgba[i + 2] }
  }
  // nothing stands out: a patch of blank page, so the text is black or white, whichever shows
  if (far < 40 * 40) return { bg: hex(br, bgc, bb), text: br + bgc + bb > 382 ? '#000000' : '#ffffff' }
  return { bg: hex(br, bgc, bb), text: hex(tr, tg, tb) }
}

/* ── Pages ── */

/** A page of a source PDF. */
export const sourcePage = (src, n) => ({ id: uid('p'), src, n, blank: null, rotate: 0, objects: [] })
/** A blank page of the given size. */
export const blankPage = (w = A4.w, h = A4.h) => ({ id: uid('p'), src: -1, n: 0, blank: { w, h }, rotate: 0, objects: [] })

const idSet = (ids) => ids instanceof Set ? ids : new Set(ids)

export function rotatePages(pages, ids, delta) {
  const s = idSet(ids)
  return pages.map(p => s.has(p.id) ? { ...p, rotate: norm(p.rotate + delta) } : p)
}

/** Never leaves the document with no pages: deleting them all changes nothing. */
export function deletePages(pages, ids) {
  const s = idSet(ids)
  const left = pages.filter(p => !s.has(p.id))
  return left.length ? left : pages
}

/** Moves the pages to just before `beforeId` (or the end), keeping their order. */
export function movePages(pages, ids, beforeId = null) {
  const s = idSet(ids)
  if (beforeId && s.has(beforeId)) {
    // dropped onto itself: onto the first unselected page after it, so the block closes up where it was
    const i = pages.findIndex(p => p.id === beforeId)
    const next = pages.slice(i + 1).find(p => !s.has(p.id))
    beforeId = next ? next.id : null
  }
  const moving = pages.filter(p => s.has(p.id))
  const rest = pages.filter(p => !s.has(p.id))
  const at = beforeId ? rest.findIndex(p => p.id === beforeId) : -1
  const i = at < 0 ? rest.length : at
  return [...rest.slice(0, i), ...moving, ...rest.slice(i)]
}

/** Moves the selected pages one place earlier (-1) or later (1) as a block. */
export function nudgePages(pages, ids, dir) {
  const s = idSet(ids)
  const out = pages.slice()
  if (dir < 0) {
    for (let i = 1; i < out.length; i++) if (s.has(out[i].id) && !s.has(out[i - 1].id)) [out[i - 1], out[i]] = [out[i], out[i - 1]]
  } else {
    for (let i = out.length - 2; i >= 0; i--) if (s.has(out[i].id) && !s.has(out[i + 1].id)) [out[i + 1], out[i]] = [out[i], out[i + 1]]
  }
  return out
}

const cloneObject = (o) => ({ ...o, id: uid('o'), ...(o.points ? { points: o.points.map(p => p.slice()) } : {}) })

/** Each selected page copied just after itself, objects included. */
export function duplicatePages(pages, ids) {
  const s = idSet(ids)
  const out = []
  for (const p of pages) {
    out.push(p)
    if (s.has(p.id)) out.push({ ...p, id: uid('p'), blank: p.blank && { ...p.blank }, objects: p.objects.map(cloneObject) })
  }
  return out
}

/** `added` inserted after the page `afterId` (at the start if null, at the end if undefined). */
export function insertPages(pages, added, afterId) {
  if (afterId === undefined) return [...pages, ...added]
  if (afterId === null) return [...added, ...pages]
  const i = pages.findIndex(p => p.id === afterId)
  return i < 0 ? [...pages, ...added] : [...pages.slice(0, i + 1), ...added, ...pages.slice(i + 1)]
}

/* ── Objects ── */

export const FAMILIES = {
  Helvetica: { label: 'Sans', css: 'Helvetica, Arial, "Liberation Sans", sans-serif', baseline: 0.947 },
  Times: { label: 'Serif', css: '"Times New Roman", Times, "Liberation Serif", serif', baseline: 0.9375 },
  Courier: { label: 'Mono', css: '"Courier New", Courier, "Liberation Mono", monospace', baseline: 0.8665 },
}
/** Line height as a multiple of the font size, in the editor and the saved file alike. */
export const LINE = 1.2

export const BOX_TYPES = ['rect', 'ellipse', 'highlight', 'image']
/** How much of a highlight's colour shows: the page's own marks still read through it. */
export const HIGHLIGHT_OPACITY = 0.4

export const newText = (x, y, d) => ({ id: uid('o'), type: 'text', x, y, text: '', size: d.size, color: d.color, family: d.family, bold: d.bold, italic: d.italic })
export const newBox = (type, x, y, w, h, d) => ({
  id: uid('o'), type, x, y, w, h,
  fill: type === 'highlight' ? d.highlight : d.fill,
  stroke: type === 'highlight' ? null : d.stroke,
  sw: d.sw,
})
export const newLine = (x1, y1, x2, y2, d) => ({ id: uid('o'), type: 'line', x1, y1, x2, y2, stroke: d.stroke, sw: d.sw })
export const newPen = (points, d) => ({ id: uid('o'), type: 'pen', points, stroke: d.stroke, sw: d.sw })
export const newImage = (x, y, w, h, imgId) => ({ id: uid('o'), type: 'image', x, y, w, h, imgId })

export function mapObjects(pages, pageId, fn) {
  return pages.map(p => p.id === pageId ? { ...p, objects: fn(p.objects) } : p)
}
export const addObject = (pages, pageId, obj) => mapObjects(pages, pageId, os => [...os, obj])
export const updateObject = (pages, pageId, objId, patch) =>
  mapObjects(pages, pageId, os => os.map(o => o.id === objId ? { ...o, ...(typeof patch === 'function' ? patch(o) : patch) } : o))
export const removeObject = (pages, pageId, objId) => mapObjects(pages, pageId, os => os.filter(o => o.id !== objId))

/** The object moved by (dx, dy) page points. */
export function moveObject(o, dx, dy) {
  if (o.type === 'line') return { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }
  if (o.type === 'pen') return { ...o, points: o.points.map(([x, y]) => [x + dx, y + dy]) }
  return { ...o, x: o.x + dx, y: o.y + dy }
}

const MIN = 6
/**
 * A box object with one corner dragged by (dx, dy). `corner` is 'nw', 'ne',
 * 'sw' or 'se'; `keep` holds the aspect ratio (images); the opposite corner stays put.
 */
export function resizeBox(o, corner, dx, dy, keep = false) {
  let { x, y, w, h } = o
  const east = corner.includes('e'), south = corner.includes('s')
  let nw = east ? w + dx : w - dx
  let nh = south ? h + dy : h - dy
  if (keep) {
    const k = Math.max(nw / w, nh / h)
    nw = w * k; nh = h * k
  }
  nw = Math.max(MIN, nw); nh = Math.max(MIN, nh)
  if (!east) x += w - nw
  if (!south) y += h - nh
  return { ...o, x, y, w: nw, h: nh }
}

/**
 * A text object with one corner dragged: its font size grows or shrinks with
 * the box (w0 × h0 is the text as it is laid out now), and the opposite corner stays put.
 */
export function resizeText(o, corner, dx, dy, w0, h0) {
  const east = corner.includes('e'), south = corner.includes('s')
  const k = Math.max((east ? w0 + dx : w0 - dx) / w0, (south ? h0 + dy : h0 - dy) / h0)
  const size = Math.min(400, Math.max(4, o.size * k))
  const f = size / o.size
  return { ...o, size, x: east ? o.x : o.x + w0 - w0 * f, y: south ? o.y : o.y + h0 - h0 * f }
}

/** A freehand stroke stretched by dragging a corner of its box. */
export function resizePen(o, corner, dx, dy) {
  const xs = o.points.map(p => p[0]), ys = o.points.map(p => p[1])
  const x = Math.min(...xs), y = Math.min(...ys)
  const w = Math.max(...xs) - x || 1, h = Math.max(...ys) - y || 1
  const b = resizeBox({ x, y, w, h }, corner, dx, dy)
  return { ...o, points: o.points.map(([px, py]) => [b.x + (px - x) / w * b.w, b.y + (py - y) / h * b.h]) }
}

/** A box from two corners dragged out in any direction. */
export function boxFrom(x1, y1, x2, y2) {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }
}

/** Freehand points thinned so a long stroke doesn't carry thousands of them. */
export function addPenPoint(points, x, y, min = 1.5) {
  const last = points[points.length - 1]
  if (last && Math.hypot(x - last[0], y - last[1]) < min) return points
  return [...points, [x, y]]
}

/* ── History ── */

export const newHistory = (present) => ({ past: [], present, future: [], base: null })
const LIMIT = 100

/** A change that is its own undo step. */
export function commit(h, next) {
  if (next === h.present) return h
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [], base: null }
}
/** A change in progress (a drag): shown, but not an undo step until settle(). */
export function live(h, next) {
  return { ...h, present: next, base: h.base || h.present }
}
/** The end of a drag: one undo step back to where it began. */
export function settle(h) {
  if (!h.base) return h
  if (h.base === h.present) return { ...h, base: null }
  return { past: [...h.past, h.base].slice(-LIMIT), present: h.present, future: [], base: null }
}
export function undo(h) {
  const s = settle(h)
  if (!s.past.length) return s
  return { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future], base: null }
}
export function redo(h) {
  if (!h.future.length) return h
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), base: null }
}
