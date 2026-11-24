/* Code 128 barcodes, drawn here: no library, nothing sent anywhere.

   Text in, bars out. Printable ASCII only (space to ~, codes 32 to 126): that is every letter, digit and symbol on a
   keyboard, and what asset numbers, serial numbers and part numbers are made of. Code set B carries the text; a run of
   four or more digits switches to code set C, which packs two digits to a bar group, so a long number comes out
   shorter and easier to scan. (Code set A, for control characters, is left out on purpose.)

   Pure and DOM-free so the tests can read it. */

/** Bar and space widths (bar, space, bar, space, bar, space) of each of the 107 symbols: values 0 to 105, then Stop (106, which ends in an extra bar). */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
]
const START_B = 104, START_C = 105, CODE_B = 100, CODE_C = 99, STOP = 106

export const MAX_LENGTH = 80

/** What is wrong with a text for a Code 128 barcode, or '' when it is fine. */
export function code128Problem(text) {
  const s = String(text ?? '')
  if (!s) return 'Type something to make a barcode.'
  if (s.length > MAX_LENGTH) return `That is too long for a barcode (${s.length} characters; the most is ${MAX_LENGTH}).`
  const bad = [...s].find((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126)
  if (bad !== undefined) return 'Barcodes can hold letters, digits and the usual symbols only (no accents, emoji, tabs or line breaks).'
  return ''
}

/** The symbol values for a text: a start code, the data (set B, with runs of 4+ digits, or a pair at either end of an all-digit text, in set C), the check symbol and Stop. */
export function code128Values(text) {
  const s = String(text)
  const problem = code128Problem(s)
  if (problem) throw new Error(problem)

  const values = []
  let set = null
  let i = 0
  while (i < s.length) {
    // How many digits start here (only whole pairs go in set C).
    let run = 0
    while (i + run < s.length && s[i + run] >= '0' && s[i + run] <= '9') run++
    const rest = s.length - i
    // Set C pays off for 4+ digits in a row, or for 2+ when the digits are the whole text (no switch needed at all).
    const useC = run >= 4 || (run >= 2 && (i === 0 && run === rest))
    if (useC) {
      const pairs = Math.floor(run / 2)
      if (set === null) values.push(START_C)
      else if (set !== 'C') values.push(CODE_C)
      set = 'C'
      for (let p = 0; p < pairs; p++, i += 2) values.push(Number(s.slice(i, i + 2)))
    } else {
      if (set === null) values.push(START_B)
      else if (set !== 'B') values.push(CODE_B)
      set = 'B'
      values.push(s.charCodeAt(i) - 32)
      i++
    }
  }
  let sum = values[0]
  for (let k = 1; k < values.length; k++) sum += values[k] * k
  values.push(sum % 103, STOP)
  return values
}

/** The bars as a run of widths in modules, starting with a bar: [2,1,1,2,2,2, …]. */
export function code128Widths(text) {
  return code128Values(text).flatMap((v) => [...PATTERNS[v]].map(Number))
}

/** The barcode as SVG. `module` is one narrow bar's width in SVG units; `height` the bars' height; a quiet zone of 10 modules each side (the standard's minimum). `label` prints the text under the bars. */
export function code128Svg(text, { module = 2, height = 80, label = true } = {}) {
  const widths = code128Widths(text)
  const quiet = 10
  const total = widths.reduce((a, b) => a + b, 0)
  const fontSize = Math.round(module * 8)
  const textH = label ? fontSize + 10 : 0
  const W = (total + quiet * 2) * module, H = height + textH + (label ? 4 : 0)
  let x = quiet * module, d = ''
  widths.forEach((w, k) => {
    if (k % 2 === 0) d += `M${x} 0h${w * module}v${height}h-${w * module}z`
    x += w * module
  })
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" shape-rendering="crispEdges">`
    + `<rect width="${W}" height="${H}" fill="#fff"/><path d="${d}" fill="#000"/>`
    + (label ? `<text x="${W / 2}" y="${height + fontSize + 4}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="${fontSize}" fill="#000">${esc(text)}</text>` : '')
    + `</svg>`
}

export const _internals = { PATTERNS }
