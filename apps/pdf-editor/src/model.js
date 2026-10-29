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
  // The direction of page space's x axis in user space, in degrees
  // anticlockwise: what drawing calls need to lay text and boxes along it.
  return { width, height, toUser, angle: rot }
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

/** The CSS transform that lays page space over the displayed page: rotate, then zoom. */
export function overlayTransform(rotate, W, H, z) {
  switch (norm(rotate)) {
    case 90: return `translate(${W}px, 0) rotate(90deg) scale(${z})`
    case 180: return `translate(${W}px, ${H}px) rotate(180deg) scale(${z})`
    case 270: return `translate(0, ${H}px) rotate(270deg) scale(${z})`
    default: return `scale(${z})`
  }
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
