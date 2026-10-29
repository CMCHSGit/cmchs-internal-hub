import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  addObject, addPenPoint, blankPage, boxFrom, commit, deletePages, deltaToPage, displaySize, displayToPage, duplicatePages,
  geometry, insertPages, live, moveObject, movePages, newHistory, newText, norm, nudgePages, redo, removeObject,
  resizeBox, rotatePages, settle, sourcePage, undo, updateObject,
  bestStyle, familyOf, imageBoxes, pageToDisplay, pickColours, resizePen, resizeText, textHotspots,
} from '../src/model.js'

const ids = (pages) => pages.map(p => p.id)
const mk = (n) => Array.from({ length: n }, (_, i) => ({ ...sourcePage(0, i), id: 'p' + i }))

test('norm keeps rotations to 0, 90, 180, 270', () => {
  assert.equal(norm(-90), 270)
  assert.equal(norm(450), 90)
  assert.equal(norm(undefined), 0)
})

test('geometry maps page space to user space for every rotation', () => {
  // a 200 x 100 visible box at (10, 20)
  const box = { x0: 10, y0: 20, w: 200, h: 100 }
  // upright: top left is (x0, y0 + h)
  assert.deepEqual(geometry({ ...box, rot: 0 }).toUser(0, 0), [10, 120])
  assert.deepEqual(geometry({ ...box, rot: 0 }).toUser(200, 100), [210, 20])
  // turned a quarter clockwise: displayed 100 x 200, its top left is the box's bottom left
  const g90 = geometry({ ...box, rot: 90 })
  assert.equal(g90.width, 100); assert.equal(g90.height, 200)
  assert.deepEqual(g90.toUser(0, 0), [10, 20])
  assert.deepEqual(g90.toUser(100, 0), [10, 120]) // top right is the box's top left
  assert.deepEqual(g90.toUser(0, 200), [210, 20])
  const g180 = geometry({ ...box, rot: 180 })
  assert.deepEqual(g180.toUser(0, 0), [210, 20])
  const g270 = geometry({ ...box, rot: 270 })
  assert.deepEqual(g270.toUser(0, 0), [210, 120])
  assert.deepEqual(g270.toUser(100, 200), [10, 20])
})

test('the page-space x axis points where geometry().angle says, in user space', () => {
  for (const rot of [0, 90, 180, 270]) {
    const g = geometry({ x0: 0, y0: 0, w: 50, h: 80, rot })
    const [ax, ay] = g.toUser(0, 0), [bx, by] = g.toUser(1, 0)
    const a = Math.round(Math.atan2(by - ay, bx - ax) * 180 / Math.PI)
    assert.equal(norm(a), rot)
  }
})

test('display size swaps for a turned page', () => {
  const g = { x0: 0, y0: 0, w: 200, h: 100, rot: 0 }
  assert.deepEqual(displaySize(g, 0), { w: 200, h: 100 })
  assert.deepEqual(displaySize(g, 90), { w: 100, h: 200 })
  assert.deepEqual(displaySize({ ...g, rot: 90 }, 90), { w: 200, h: 100 })
})

test('pointer positions come back to page space for every rotation', () => {
  // a 200 x 100 page at zoom 2, turned: a point in page space is drawn at the
  // overlay transform's image of it, and displayToPage must undo that
  const z = 2
  for (const rotate of [0, 90, 180, 270]) {
    const turned = rotate % 180
    const W = (turned ? 100 : 200) * z, H = (turned ? 200 : 100) * z
    const [px, py] = [30, 70]
    // forward: rotate clockwise about the origin, then translate (same as overlayTransform)
    let X, Y
    const [sx, sy] = [px * z, py * z]
    if (rotate === 0) [X, Y] = [sx, sy]
    if (rotate === 90) [X, Y] = [W - sy, sx]
    if (rotate === 180) [X, Y] = [W - sx, H - sy]
    if (rotate === 270) [X, Y] = [sy, H - sx]
    assert.deepEqual(displayToPage(X, Y, rotate, W, H, z), [px, py], 'rotate ' + rotate)
  }
})

test('a drag on screen moves the object the right way on a turned page', () => {
  assert.deepEqual(deltaToPage(10, 0, 0), [10, 0])
  // turned a quarter clockwise, page-space "right" points down the screen
  assert.deepEqual(deltaToPage(0, 10, 90), [10, 0])
  assert.deepEqual(deltaToPage(10, 0, 180), [-10, 0])
  assert.deepEqual(deltaToPage(0, 10, 270), [-10, 0])
})

test('rotate, delete and keep at least one page', () => {
  const p = mk(3)
  const r = rotatePages(p, ['p1'], 90)
  assert.equal(r[1].rotate, 90); assert.equal(r[0].rotate, 0)
  assert.equal(rotatePages(r, ['p1'], -90)[1].rotate, 0)
  assert.deepEqual(ids(deletePages(p, ['p0', 'p2'])), ['p1'])
  assert.equal(deletePages(p, ['p0', 'p1', 'p2']), p)
})

test('move pages as a block, to the end, and onto themselves', () => {
  const p = mk(5)
  assert.deepEqual(ids(movePages(p, ['p3', 'p4'], 'p1')), ['p0', 'p3', 'p4', 'p1', 'p2'])
  assert.deepEqual(ids(movePages(p, ['p0'], null)), ['p1', 'p2', 'p3', 'p4', 'p0'])
  assert.deepEqual(ids(movePages(p, ['p0', 'p2'], 'p2')), ['p1', 'p0', 'p2', 'p3', 'p4'])
})

test('nudge pages one place at a time, stopping at the ends', () => {
  const p = mk(4)
  assert.deepEqual(ids(nudgePages(p, ['p1', 'p2'], -1)), ['p1', 'p2', 'p0', 'p3'])
  assert.deepEqual(ids(nudgePages(p, ['p0'], -1)), ['p0', 'p1', 'p2', 'p3'])
  assert.deepEqual(ids(nudgePages(p, ['p2', 'p3'], 1)), ['p0', 'p1', 'p2', 'p3'])
  assert.deepEqual(ids(nudgePages(p, ['p0'], 1)), ['p1', 'p0', 'p2', 'p3'])
})

test('duplicate a page with its objects under new ids', () => {
  let p = mk(2)
  p = addObject(p, 'p0', { id: 'o1', type: 'pen', points: [[1, 1], [2, 2]] })
  const d = duplicatePages(p, ['p0'])
  assert.equal(d.length, 3)
  assert.notEqual(d[1].id, 'p0')
  assert.notEqual(d[1].objects[0].id, 'o1')
  d[1].objects[0].points[0][0] = 99
  assert.equal(d[0].objects[0].points[0][0], 1)
})

test('insert after a page, at the start, at the end', () => {
  const p = mk(2), a = [blankPage()]
  assert.equal(insertPages(p, a, 'p0')[1], a[0])
  assert.equal(insertPages(p, a, null)[0], a[0])
  assert.equal(insertPages(p, a)[2], a[0])
})

test('objects: add, update, remove, move', () => {
  let p = mk(1)
  p = addObject(p, 'p0', newText(10, 20, { size: 12, color: '#000', family: 'Helvetica', bold: false, italic: false }))
  const o = p[0].objects[0]
  p = updateObject(p, 'p0', o.id, { text: 'hi' })
  assert.equal(p[0].objects[0].text, 'hi')
  assert.deepEqual([moveObject(p[0].objects[0], 5, -5).x, moveObject(p[0].objects[0], 5, -5).y], [15, 15])
  assert.equal(removeObject(p, 'p0', o.id)[0].objects.length, 0)
  const line = moveObject({ type: 'line', x1: 0, y1: 0, x2: 4, y2: 4 }, 1, 1)
  assert.deepEqual([line.x1, line.x2], [1, 5])
})

test('resizing a box keeps the opposite corner still', () => {
  const o = { x: 10, y: 10, w: 100, h: 50 }
  const se = resizeBox(o, 'se', 20, 10)
  assert.deepEqual([se.x, se.y, se.w, se.h], [10, 10, 120, 60])
  const nw = resizeBox(o, 'nw', 20, 10)
  assert.deepEqual([nw.x, nw.y, nw.w, nw.h], [30, 20, 80, 40])
  const tiny = resizeBox(o, 'se', -500, -500)
  assert.ok(tiny.w >= 6 && tiny.h >= 6)
  const kept = resizeBox(o, 'se', 100, 0, true)
  assert.equal(kept.w / kept.h, 2)
})

test('a box dragged out in any direction', () => {
  assert.deepEqual(boxFrom(50, 60, 10, 20), { x: 10, y: 20, w: 40, h: 40 })
})

test('pen points are thinned', () => {
  let pts = [[0, 0]]
  pts = addPenPoint(pts, 0.5, 0.5)
  assert.equal(pts.length, 1)
  pts = addPenPoint(pts, 5, 5)
  assert.equal(pts.length, 2)
})

test('history: commit, undo, redo, and a drag is one step', () => {
  let h = newHistory(['a'])
  h = commit(h, ['b'])
  h = live(h, ['c']); h = live(h, ['d']); h = settle(h)
  assert.equal(h.past.length, 2)
  h = undo(h); assert.deepEqual(h.present, ['b'])
  h = undo(h); assert.deepEqual(h.present, ['a'])
  assert.equal(undo(h).present, h.present)
  h = redo(h); h = redo(h); assert.deepEqual(h.present, ['d'])
  assert.equal(redo(h), h)
  // an undo in the middle of a drag drops back to where the drag began
  let g = newHistory(1); g = live(g, 2); g = undo(g)
  assert.equal(g.present, 1)
  // a change that changes nothing is not a step
  const same = newHistory(['x'])
  assert.equal(commit(same, same.present), same)
})

test('fromUser undoes toUser for every rotation', () => {
  for (const rot of [0, 90, 180, 270]) {
    const g = geometry({ x0: 10, y0: 20, w: 200, h: 100, rot })
    for (const [x, y] of [[0, 0], [13, 7], [60, 90]]) {
      const [ux, uy] = g.toUser(x, y)
      assert.deepEqual(g.fromUser(ux, uy).map(v => Math.round(v * 1e6) / 1e6), [x, y], 'rot ' + rot)
    }
  }
})

test('pageToDisplay is the inverse of displayToPage', () => {
  const z = 1.5
  for (const rotate of [0, 90, 180, 270]) {
    const turned = rotate % 180
    const W = (turned ? 100 : 200) * z, H = (turned ? 200 : 100) * z
    const [X, Y] = pageToDisplay(30, 70, rotate, W, H, z)
    assert.deepEqual(displayToPage(X, Y, rotate, W, H, z).map(v => Math.round(v * 1e6) / 1e6), [30, 70])
  }
})

test('the page’s own text becomes boxes in page space', () => {
  const geom = { x0: 0, y0: 0, w: 595, h: 842, rot: 0 }
  const items = [
    { str: 'MANUFACTURER', transform: [9, 0, 0, 9, 47, 666.9], width: 57.8, fontName: 'f1' },
    { str: ' ', transform: [9, 0, 0, 9, 104, 666.9], width: 4, fontName: 'f1' },
    { str: '', transform: [9, 0, 0, 9, 47, 600], width: 0, fontName: 'f1' },
    { str: 'sideways', transform: [0, 9, -9, 0, 300, 300], width: 40, fontName: 'f1' },
    { type: 'beginMarkedContent' },
  ]
  const hot = textHotspots(items, { f1: { fontFamily: 'serif' } }, geom)
  assert.equal(hot.length, 1)
  const t = hot[0]
  assert.equal(t.str, 'MANUFACTURER')
  assert.equal(t.fam, 'serif')
  assert.ok(Math.abs(t.x - 47) < 1e-9 && Math.abs(t.baseline - (842 - 666.9)) < 1e-9)
  assert.ok(t.y < t.baseline && t.y + t.h > t.baseline, 'the box holds the baseline')
  assert.ok(Math.abs(t.w - 57.8) < 1e-9)
  // the same text on a page turned a quarter is sideways in page space, so it isn't offered
  assert.equal(textHotspots(items.slice(0, 1), {}, { ...geom, rot: 90 }).length, 0)
})

test('bold and italic are found from the width, and plain wins a tie', () => {
  const widths = { 'Helvetica|false|false': 100, 'Helvetica|true|false': 108, 'Helvetica|false|true': 100, 'Helvetica|true|true': 108 }
  const measure = (f, b, i) => widths[`${f}|${b}|${i}`]
  assert.deepEqual(bestStyle('sans-serif', 100, measure), { family: 'Helvetica', bold: false, italic: false })
  assert.deepEqual(bestStyle('sans-serif', 108, measure), { family: 'Helvetica', bold: true, italic: false })
  assert.equal(bestStyle('monospace', 50, () => 50).family, 'Courier')
  assert.equal(familyOf('serif'), 'Times')
  assert.equal(familyOf('sans-serif'), 'Helvetica')
})

test('the background and text colour are read off the rendered pixels', () => {
  const px = []
  for (let i = 0; i < 100; i++) px.push(255, 224, 138, 255) // a yellow cell
  px.push(0, 90, 0, 255, 10, 100, 10, 255)                  // dark green text
  const c = pickColours(Uint8ClampedArray.from(px))
  assert.equal(c.bg, '#ffe08a')
  assert.equal(c.text, '#005a00')
  // a blank patch has no text colour to find
  assert.equal(pickColours(Uint8ClampedArray.from([255, 255, 255, 255, 255, 255, 255, 255])).text, '#000000')
  assert.equal(pickColours(Uint8ClampedArray.from([20, 20, 20, 255])).text, '#ffffff')
})

const OPS = { save: 10, restore: 11, transform: 12, paintFormXObjectBegin: 74, paintFormXObjectEnd: 75, paintImageXObject: 85, paintInlineImageXObject: 86 }

test('pictures are found where the page draws them, through saves and transforms', () => {
  const geom = { x0: 0, y0: 0, w: 595, h: 842, rot: 0 }
  const fn = [OPS.save, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.save, OPS.transform, OPS.transform, OPS.paintImageXObject, OPS.restore, OPS.paintImageXObject]
  const args = [null, [100, 0, 0, 50, 40, 700], ['img1', 10, 10], null, null, [2, 0, 0, 2, 0, 0], [30, 0, 0, 20, 100, 300], ['img2', 10, 10], null, ['img3', 10, 10]]
  const pics = imageBoxes(fn, args, OPS, geom)
  // img1: 100 x 50 with its bottom left at (40, 700) in user space: top at 842 - 750 in page space
  assert.deepEqual(pics[0], { kind: 'image', x: 40, y: 92, w: 100, h: 50 })
  // img2: scaled by the second transform first (30 x 20 at (100, 300)), then by 2: 60 x 40 at (200, 600)
  assert.deepEqual(pics[1], { kind: 'image', x: 200, y: 202, w: 60, h: 40 })
  // img3 is drawn after the restore, so with the identity: a 1 x 1 picture, too small to be worth offering
  assert.equal(pics.length, 2)
})

test('a picture that covers the page is not offered, and a turned page puts pictures where they show', () => {
  const geom = { x0: 0, y0: 0, w: 595, h: 842, rot: 0 }
  assert.equal(imageBoxes([OPS.transform, OPS.paintImageXObject], [[595, 0, 0, 842, 0, 0], ['bg']], OPS, geom).length, 0)
  const turned = imageBoxes([OPS.transform, OPS.paintImageXObject], [[100, 0, 0, 50, 0, 0], ['a']], OPS, { ...geom, rot: 90 })
  assert.deepEqual([turned[0].w, turned[0].h], [50, 100])
})

test('resizing text scales its size and keeps the opposite corner', () => {
  const o = { type: 'text', x: 100, y: 100, size: 10 }
  const se = resizeText(o, 'se', 50, 0, 100, 12) // wider by half: size x1.5
  assert.equal(se.size, 15); assert.deepEqual([se.x, se.y], [100, 100])
  const nw = resizeText(o, 'nw', -50, 0, 100, 12) // dragged out to the left: size x1.5, so the right edge stays at 200
  assert.equal(nw.size, 15); assert.equal(nw.x, 100 + 100 - 150)
  assert.equal(resizeText(o, 'se', -500, -500, 100, 12).size, 4, 'never smaller than 4')
})

test('resizing a pen stroke stretches its points with its box', () => {
  const o = { type: 'pen', points: [[0, 0], [10, 10], [20, 0]] }
  const r = resizePen(o, 'se', 20, 10)
  assert.deepEqual(r.points[0], [0, 0])
  assert.deepEqual(r.points[2], [40, 0])
  assert.deepEqual(r.points[1], [20, 20])
})
