/* Files on an ask: a PDF, a quote, a spreadsheet, a service report. Kept in
   Firestore like the photos (photos.js), so still no Firebase Storage. A file
   can't be shrunk the way a photo can, so it is split into parts, each its
   own document under the 1 MB Firestore allows:

     asks/{id}/files/{fid}               { uid, name, type, bytes, parts, atMs, commentId }
     asks/{id}/files/{fid}/parts/{0..9}  { data }   base64, PART_CHARS at most

   The ask's thread reads only the small first document; the parts are read
   when someone opens the file. The rules hold the same limits. */

export const MAX_BYTES = 5 * 1024 * 1024
export const PART_CHARS = 700000
export const MAX_PARTS = 10 // 5 MB is 6,990,508 base64 characters

/** Base64 in parts small enough for one Firestore document each. */
export function splitParts(b64) {
  const out = []
  for (let i = 0; i < b64.length; i += PART_CHARS) out.push(b64.slice(i, i + PART_CHARS))
  return out.length ? out : ['']
}

/** "1.2 MB", "340 KB" */
export function sizeLabel(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** A File from the picker -> { name, type, bytes, parts }. */
export function readFile(file) {
  if (!file.size) return Promise.reject(new Error(`${file.name || 'That file'} is empty.`))
  if (file.size > MAX_BYTES) return Promise.reject(new Error(`${file.name || 'That file'} is ${sizeLabel(file.size)}. Files can be up to 5 MB; for a bigger one, put a SharePoint link in the ask.`))
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => {
      const url = String(r.result)
      resolve({
        name: String(file.name || 'file').slice(0, 200),
        type: String(file.type || '').slice(0, 120),
        bytes: file.size,
        parts: splitParts(url.slice(url.indexOf(',') + 1)),
      })
    }
    r.onerror = () => reject(new Error(`${file.name || 'That file'} couldn't be read.`))
    r.readAsDataURL(file)
  })
}

// Opened in the browser only if it's one of these. Anything else (a web page,
// an SVG) could run script as the hub if opened here, so it is only ever
// downloaded, whatever type it says it is.
const VIEWABLE = ['application/pdf', 'image/jpeg', 'image/png', 'image/gif', 'image/webp']
export const canView = (type) => VIEWABLE.includes(type)

/** The parts joined back into a Blob, typed so the browser treats it as above. */
export function toBlob(parts, type) {
  const bin = atob(parts.join(''))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: canView(type) ? type : 'application/octet-stream' })
}
