/* QR asset labels, as a printable sheet. Each label's QR holds the link to
   that asset's record (model.js labelUrl): the phone's own camera opens it in
   the hub, and Scan reads it too (assetNoFromScan), as it still reads the older
   labels that hold just the asset number.

   The sheet is a standalone page (so printing never depends on the hub's
   styles), in millimetres, one absolutely placed box per label. Sizes are the
   common A4 label sheets (Avery L7160 and L7163 and their equivalents) and plain
   paper to cut up. Pure and DOM-free so the tests can read it; the QR drawing
   comes from qrcode-generator. */
import qrcode from 'qrcode-generator'
import { labelUrl } from './model.js'

/** Sheet layouts: label and pitch (distance between label starts) in mm, margins, and the QR's size. */
export const LAYOUTS = {
  l7160: { name: '21 per sheet (63.5 × 38.1 mm, Avery L7160)', cols: 3, rows: 7, w: 63.5, h: 38.1, pitchX: 66, pitchY: 38.1, top: 15.1, left: 7.2, qr: 26 },
  l7163: { name: '14 per sheet (99.1 × 38.1 mm, Avery L7163)', cols: 2, rows: 7, w: 99.1, h: 38.1, pitchX: 101.6, pitchY: 38.1, top: 15.1, left: 4.7, qr: 28 },
  plain: { name: '24 per sheet on plain paper (70 × 37 mm, cut out)', cols: 3, rows: 8, w: 70, h: 37, pitchX: 70, pitchY: 37, top: 0.5, left: 0, qr: 25 },
}
export const DEFAULT_LAYOUT = 'l7160'

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** A QR code as an SVG (one path, square modules, a 2-module quiet zone) for a text. Error correction M, so a scuffed label still reads. */
export function qrSvg(text) {
  const q = qrcode(0, 'M')
  q.addData(String(text))
  q.make()
  const n = q.getModuleCount(), quiet = 2
  let d = ''
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c + quiet} ${r + quiet}h1v1h-1z`
  const size = n + quiet * 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}

/** The items split into sheets, each a list of label slots (null = left blank). `skip` blanks the first slots, to carry on with a part-used sheet. */
export function labelPages(items, layoutKey = DEFAULT_LAYOUT, skip = 0) {
  const per = LAYOUTS[layoutKey].cols * LAYOUTS[layoutKey].rows
  const slots = [...Array(Math.max(0, Math.min(per - 1, Math.floor(skip) || 0))).fill(null), ...items]
  const pages = []
  for (let i = 0; i < slots.length; i += per) pages.push(slots.slice(i, i + per))
  return pages
}

/** One label's box: the QR, then the asset number large, the model, and the serial number. */
function labelHtml(item, L, left, top, guides) {
  const url = labelUrl(item.CHSAssetNo)
  return `<div class="lb${guides ? ' guide' : ''}" style="left:${left.toFixed(2)}mm;top:${top.toFixed(2)}mm;width:${L.w}mm;height:${L.h}mm">`
    + `<div class="qr" style="width:${L.qr}mm;height:${L.qr}mm">${qrSvg(url)}</div>`
    + `<div class="tx"><div class="no">${esc(item.CHSAssetNo)}</div>`
    + `<div class="md">${esc(item.Model)}</div>`
    + (item.SerialNo ? `<div class="sn">S/N ${esc(item.SerialNo)}</div>` : '')
    + `<div class="co">CMCHS demo equipment</div></div></div>`
}

/** The whole printable page. `guides` outlines each label (for the preview; off for printing on real label stock). `autoPrint` opens the print dialog on load. */
export function sheetHtml(items, { layout = DEFAULT_LAYOUT, skip = 0, guides = false, autoPrint = false } = {}) {
  const L = LAYOUTS[layout]
  const pages = labelPages(items, layout, skip).map((page) => `<section class="pg">${page.map((it, i) => (it
    ? labelHtml(it, L, L.left + (i % L.cols) * L.pitchX, L.top + Math.floor(i / L.cols) * L.pitchY, guides) : '')).join('')}</section>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Asset labels</title><style>`
    + `@page{size:A4;margin:0}*{box-sizing:border-box}html,body{margin:0;background:#fff}body{font-family:Arial,Helvetica,sans-serif;color:#000}`
    + `.pg{position:relative;width:210mm;height:297mm;overflow:hidden;page-break-after:always;break-after:page}.pg:last-child{page-break-after:auto;break-after:auto}`
    + `.lb{position:absolute;display:flex;align-items:center;gap:2.5mm;padding:2mm 2.5mm;overflow:hidden}.lb.guide{outline:.2mm dashed #999;outline-offset:-.2mm}`
    + `.qr{flex:none}.qr svg{display:block;width:100%;height:100%}.tx{min-width:0;display:flex;flex-direction:column;gap:.8mm}`
    + `.no{font-size:15pt;font-weight:700;line-height:1.05;overflow-wrap:anywhere}.md{font-size:8.5pt;line-height:1.15;max-height:2.4em;overflow:hidden}`
    + `.sn{font-size:7pt;color:#333;overflow-wrap:anywhere}.co{font-size:6.5pt;color:#555;margin-top:.6mm}`
    + `@media screen{body{background:#eee}.pg{margin:0 auto 6mm;background:#fff}}`
    + `</style></head><body>${pages}${autoPrint ? '<script>window.onload=function(){window.print()}<\/script>' : ''}</body></html>`
}
