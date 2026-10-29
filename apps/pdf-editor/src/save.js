/* Writes the edited document out as a new PDF with pdf-lib. This is the only
   place the PDF's bytes are touched: until Save, an edit is only a record in
   the model (model.js), so the editor stays fast however big the file is.

   No browser calls in here, so tests/save.test.mjs can run it in Node. The one
   thing it can't fetch itself is the fallback typeface (for letters the PDF
   standard fonts don't have, like the Māori macron vowels): the caller passes
   `loadFallbackFont(bold, italic)`. */
import { PDFDocument, StandardFonts, rgb, degrees, BlendMode, LineCapStyle } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { FAMILIES, HIGHLIGHT_OPACITY, LINE, blankGeom, geometry, norm } from './model.js'

const STANDARD = {
  Helvetica: ['Helvetica', 'HelveticaBold', 'HelveticaOblique', 'HelveticaBoldOblique'],
  Times: ['TimesRoman', 'TimesRomanBold', 'TimesRomanItalic', 'TimesRomanBoldItalic'],
  Courier: ['Courier', 'CourierBold', 'CourierOblique', 'CourierBoldOblique'],
}

/** '#rrggbb' as a pdf-lib colour. */
export function colour(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  const n = m ? parseInt(m[1], 16) : 0
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

/** Whether a font can draw this character (the standard fonts only cover Western European text). */
function canDraw(font, ch, cache) {
  if (!cache.has(ch)) {
    let ok = true
    try { font.encodeText(ch) } catch { ok = false }
    cache.set(ch, ok)
  }
  return cache.get(ch)
}

/**
 * Builds the PDF. `sources` are the opened files ({ bytes, geoms }), `images`
 * maps an image id to { bytes, type: 'png' | 'jpg' }. Returns the file's bytes.
 */
export async function buildPdf({ pages, sources, images = new Map(), loadFallbackFont = null }) {
  const out = await PDFDocument.create()

  // Copy the wanted pages out of each source, one source in memory at a time.
  const wanted = new Map()
  for (const p of pages) if (p.src >= 0) {
    if (!wanted.has(p.src)) wanted.set(p.src, [])
    wanted.get(p.src).push(p)
  }
  const copies = new Map()
  for (const [si, list] of wanted) {
    const doc = await PDFDocument.load(sources[si].bytes, { ignoreEncryption: true, updateMetadata: false })
    const copied = await out.copyPages(doc, list.map(p => p.n))
    list.forEach((p, i) => copies.set(p.id, copied[i]))
  }

  const fonts = new Map()      // 'Helvetica|b|i' -> embedded font
  const fallbacks = new Map()  // 'b|i' -> embedded fallback font, or null
  const encodable = new Map()  // font -> Map(char -> bool)
  const imgs = new Map()       // image id -> embedded image
  let fontkitSet = false

  const fontFor = (family, bold, italic) => {
    const key = `${family}|${bold ? 'b' : ''}|${italic ? 'i' : ''}`
    if (!fonts.has(key)) {
      const [plain, b, i, bi] = STANDARD[family] || STANDARD.Helvetica
      fonts.set(key, out.embedStandardFont(StandardFonts[bold && italic ? bi : bold ? b : italic ? i : plain]))
    }
    return fonts.get(key)
  }
  const fallbackFor = async (bold, italic) => {
    const key = `${bold ? 'b' : ''}|${italic ? 'i' : ''}`
    if (!fallbacks.has(key)) {
      let f = null
      if (loadFallbackFont) {
        try {
          if (!fontkitSet) { out.registerFontkit(fontkit); fontkitSet = true }
          f = await out.embedFont(await loadFallbackFont(bold, italic), { subset: true })
        } catch { f = null }
      }
      fallbacks.set(key, f)
    }
    return fallbacks.get(key)
  }
  const cacheOf = (font) => {
    if (!encodable.has(font)) encodable.set(font, new Map())
    return encodable.get(font)
  }

  /** A line of text as runs, each in a font that can draw it. */
  const runsOf = async (line, o) => {
    const main = fontFor(o.family, o.bold, o.italic)
    const runs = []
    const push = (font, ch) => {
      const last = runs[runs.length - 1]
      if (last && last.font === font) last.text += ch
      else runs.push({ font, text: ch })
    }
    for (const ch of line) {
      if (canDraw(main, ch, cacheOf(main))) { push(main, ch); continue }
      const fb = await fallbackFor(o.bold, o.italic)
      if (fb && canDraw(fb, ch, cacheOf(fb))) { push(fb, ch); continue }
      push(main, '?')
    }
    return runs
  }

  for (const p of pages) {
    const geom = geometry(p.src >= 0 ? sources[p.src].geoms[p.n] : blankGeom(p.blank.w, p.blank.h))
    const page = p.src >= 0 ? out.addPage(copies.get(p.id)) : out.addPage([p.blank.w, p.blank.h])
    if (p.rotate) page.setRotation(degrees(norm(page.getRotation().angle + p.rotate)))
    const rot = degrees(geom.angle)
    const dir = [Math.cos(geom.angle * Math.PI / 180), Math.sin(geom.angle * Math.PI / 180)]

    for (const o of p.objects) {
      if (o.type === 'text') {
        const family = FAMILIES[o.family] || FAMILIES.Helvetica
        const lines = String(o.text).split('\n')
        for (let n = 0; n < lines.length; n++) {
          if (!lines[n]) continue
          let [x, y] = geom.toUser(o.x, o.y + (family.baseline + n * LINE) * o.size)
          for (const run of await runsOf(lines[n], o)) {
            page.drawText(run.text, { x, y, size: o.size, font: run.font, color: colour(o.color), rotate: rot })
            const w = run.font.widthOfTextAtSize(run.text, o.size)
            x += dir[0] * w; y += dir[1] * w
          }
        }
      } else if (o.type === 'rect' || o.type === 'highlight') {
        const [x, y] = geom.toUser(o.x, o.y + o.h)
        page.drawRectangle({
          x, y, width: o.w, height: o.h, rotate: rot,
          ...(o.fill ? { color: colour(o.fill) } : {}),
          ...(o.stroke ? { borderColor: colour(o.stroke), borderWidth: o.sw } : {}),
          ...(o.type === 'highlight' ? { opacity: HIGHLIGHT_OPACITY, blendMode: BlendMode.Multiply } : {}),
        })
      } else if (o.type === 'ellipse') {
        const [x, y] = geom.toUser(o.x + o.w / 2, o.y + o.h / 2)
        page.drawEllipse({
          x, y, xScale: o.w / 2, yScale: o.h / 2, rotate: rot,
          ...(o.fill ? { color: colour(o.fill) } : {}),
          ...(o.stroke ? { borderColor: colour(o.stroke), borderWidth: o.sw } : {}),
        })
      } else if (o.type === 'line') {
        const [x1, y1] = geom.toUser(o.x1, o.y1), [x2, y2] = geom.toUser(o.x2, o.y2)
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.sw, color: colour(o.stroke), lineCap: LineCapStyle.Round })
      } else if (o.type === 'pen') {
        for (let i = 1; i < o.points.length; i++) {
          const [x1, y1] = geom.toUser(...o.points[i - 1]), [x2, y2] = geom.toUser(...o.points[i])
          page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: o.sw, color: colour(o.stroke), lineCap: LineCapStyle.Round })
        }
      } else if (o.type === 'image') {
        const src = images.get(o.imgId)
        if (!src) continue
        if (!imgs.has(o.imgId)) imgs.set(o.imgId, await (src.type === 'jpg' ? out.embedJpg(src.bytes) : out.embedPng(src.bytes)))
        const [x, y] = geom.toUser(o.x, o.y + o.h)
        page.drawImage(imgs.get(o.imgId), { x, y, width: o.w, height: o.h, rotate: rot })
      }
    }
  }
  return out.save()
}
