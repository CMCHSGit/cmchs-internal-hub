/* QR codes, drawn here with qrcode-generator (already used by the demo tracker's asset labels), so nothing is sent
   anywhere. Pure and DOM-free so the tests can read it. */
import qrcode from 'qrcode-generator'

/** Error correction: how much of the code can be damaged or covered and still read. */
export const LEVELS = {
  L: { name: 'Low (about 7% can be lost)', note: 'Most data, for clean screens and paper' },
  M: { name: 'Medium (about 15%)', note: 'A good everyday choice' },
  Q: { name: 'Quarter (about 25%)', note: 'For labels that may get scuffed' },
  H: { name: 'High (about 30%)', note: 'For rough use; the code gets bigger' },
}
export const DEFAULT_LEVEL = 'M'

/** The text as UTF-8 bytes, one per character: qrcode-generator keeps only the low byte of each character, so this makes accents and macrons (Māori names, Ō, ā) come out right. */
function asBytes(text) {
  return Array.from(new TextEncoder().encode(String(text)), (b) => String.fromCharCode(b)).join('')
}

/** The QR for a text: { size, isDark(row, col) }. Throws an Error with a plain message when it cannot be made (nothing typed, or too long to fit). */
export function qrMatrix(text, level = DEFAULT_LEVEL) {
  const s = String(text ?? '')
  if (!s) throw new Error('Type something to make a QR code.')
  if (!LEVELS[level]) level = DEFAULT_LEVEL
  const q = qrcode(0, level)
  q.addData(asBytes(s))
  try { q.make() } catch { throw new Error('That is too much text for one QR code. Shorten it, or try a lower error correction.') }
  return { size: q.getModuleCount(), isDark: (r, c) => q.isDark(r, c) }
}

/** The QR as SVG: one path, square modules, black on white, with the 4-module quiet zone the standard asks for. `px` is one module's size in SVG units. */
export function qrSvg(text, { level = DEFAULT_LEVEL, px = 8 } = {}) {
  const m = qrMatrix(text, level)
  const quiet = 4, n = m.size + quiet * 2, S = n * px
  let d = ''
  for (let r = 0; r < m.size; r++) {
    // Join each row's runs of dark modules into one rectangle: a much smaller file.
    let c = 0
    while (c < m.size) {
      if (!m.isDark(r, c)) { c++; continue }
      const start = c
      while (c < m.size && m.isDark(r, c)) c++
      d += `M${(start + quiet) * px} ${(r + quiet) * px}h${(c - start) * px}v${px}h-${(c - start) * px}z`
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" shape-rendering="crispEdges"><rect width="${S}" height="${S}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
