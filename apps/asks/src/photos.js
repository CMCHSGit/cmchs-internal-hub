/* Photos from site, shrunk in the browser before they're saved. Each one is
   a JPEG data URL in its own Firestore document (asks/{id}/photos/{id}),
   which keeps it free: no Firebase Storage, no extra setup. The rules refuse
   anything over 500,000 characters; a phone photo comes out at roughly
   150–300 KB here, which is plenty to read a serial plate or a screen. */

export const MAX_CHARS = 480000
const SIZES = [1600, 1280, 1024, 800]

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name || 'That file'} isn't a photo this browser can open.`)) }
    img.src = url
  })
}

/** A File from the camera or photo library -> { data, w, h }. */
export async function compressPhoto(file) {
  if (!/^image\//.test(file.type || '')) throw new Error(`${file.name || 'That file'} isn't a photo.`)
  const img = await loadImage(file)
  for (const max of SIZES) {
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
    const w = Math.round(img.naturalWidth * scale)
    const h = Math.round(img.naturalHeight * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d').drawImage(img, 0, 0, w, h)
    for (const q of [0.72, 0.6, 0.5]) {
      const data = canvas.toDataURL('image/jpeg', q)
      if (data.length <= MAX_CHARS) return { data, w, h }
    }
  }
  throw new Error('That photo is too big even after shrinking it.')
}
