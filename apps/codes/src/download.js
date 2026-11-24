/* Saving a drawn code: as the SVG itself or as a PNG (the SVG painted onto a canvas). Browser only; the drawing is
   in qr.js and code128.js. */

/** A file name from the text: letters and digits, trimmed, so a link or a long sentence still gives something sensible. */
export function fileNameFor(kind, text) {
  const slug = String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return `${kind}${slug ? '-' + slug : ''}`
}

function save(blob, name) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadSvg(svg, name) {
  save(new Blob([svg], { type: 'image/svg+xml' }), name + '.svg')
}

/** The SVG as a PNG blob, at the SVG's own size (qr.js and code128.js draw it at the size to save). */
export function svgToPng(svg) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(img, 0, 0)
      URL.revokeObjectURL(url)
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the PNG.'))), 'image/png')
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not make the PNG.')) }
    img.src = url
  })
}

export async function downloadPng(svg, name) {
  save(await svgToPng(svg), name + '.png')
}

/** Copy the PNG to the clipboard (not every browser lets a page do it; the caller shows the Download buttons either way). */
export const canCopyImage = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
export async function copyPng(svg) {
  // Handing ClipboardItem the promise keeps Safari happy: it wants the write started inside the click.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': svgToPng(svg) })])
}
