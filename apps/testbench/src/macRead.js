/* Reading a device's network screen (Mindray Maintenance > Device Location, a label, a log line):
   the text the camera's text recognition (ocr.js) gave, turned into the Device ID and the MAC
   addresses on it. Pure, so it is tested (tests/macread.test.mjs) without a camera.

     Device ID   8 bytes, dashes on the screen:   00-0F-14-04-CC-54-95-D4
     LAN MAC     6 bytes, colons on the screen:   00:0F:14:54:95:D4
     WLAN MAC    6 bytes:                         08:9B:27:69:71:BA

   Text recognition slips on look-alikes (O for 0, I or l for 1) and on the separators
   (: read as ; or .), so those are put right and the value is marked `fixed`, so the page can
   say "check this one". A character that could be one of two hex digits (B or 8, D or 0) can't be
   told apart here: that is what the `lanMatchesDeviceId` check and the editable fields are for. */

const BYTE = '[0-9A-Fa-fOoIl|]{2}'
const SEP = '[:;.\\-–—]'
// 6 or 8 bytes, separated: 00:0F:14:54:95:D4
const SEPARATED = new RegExp(`(?<![0-9A-Za-z])(?:${BYTE}${SEP}){5,7}${BYTE}(?![0-9A-Za-z])`, 'g')
// 12 or 16 digits run together, only trusted beside a label (a serial number is not a MAC)
const RUN_TOGETHER = /(?<![0-9A-Za-z])(?:[0-9A-Fa-f]{16}|[0-9A-Fa-f]{12})(?![0-9A-Za-z])/g

/** Look-alikes put right: O and o are 0, I, l and | are 1. Returns the text and whether anything changed. */
function hexOf(s) {
  const out = s.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1').toUpperCase()
  return { out, changed: out !== s.toUpperCase() }
}

/** Two-character bytes of an OCR'd candidate (with or without separators): { bytes: ['00','0F',…], fixed } */
function bytesOf(token) {
  const fixedSep = !(new RegExp(`^(?:${BYTE}(:|-))+${BYTE}$`).test(token) && new Set(token.match(/[:\-]/g) || []).size === 1 && !/[;.–—]/.test(token))
  const raw = token.replace(new RegExp(SEP, 'g'), '')
  const { out, changed } = hexOf(raw)
  if (!/^[0-9A-F]+$/.test(out)) return null
  return { bytes: out.match(/../g), fixed: changed || fixedSep }
}

/** MAC (colons) or Device ID (dashes, as the device shows it) from bytes: '00:0F:14:54:95:D4'. */
export const showMac = (bytes) => bytes.join(':')
export const showDeviceId = (bytes) => bytes.join('-')

/** Tidy anything typed or pasted: 000f.1454.95d4, 00-0f-14-54-95-d4 → '00:0F:14:54:95:D4'. '' when it isn't 6 bytes. */
export function tidyMac(text) {
  const hex = String(text || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
  return /^[0-9A-F]{12}$/.test(hex) ? hex.match(/../g).join(':') : ''
}

/** The Mindray rule the asset lists use: the LAN MAC is the Device ID without its 4th and 5th bytes
    (00-0F-14-04-CC-54-95-D4 → 00:0F:14:54:95:D4). '' when the Device ID isn't 8 bytes. */
export function lanFromDeviceId(deviceId) {
  const b = String(deviceId || '').toUpperCase().replace(/[^0-9A-F]/g, '').match(/../g) || []
  return b.length === 8 ? showMac([b[0], b[1], b[2], b[5], b[6], b[7]]) : ''
}

/** What a line says its address is, from the words before it. */
function labelOf(before) {
  const t = before.toLowerCase()
  if (/device\s*[il1]d|devi[ce]+\s*id/.test(t)) return 'deviceId'
  if (/wlan|wi-?fi|wireless|wifi/.test(t)) return 'wlan'
  if (/\blan\b|ethernet|wired|\bmac\b|l\s?an\s?mac/.test(t)) return 'lan'
  return ''
}

/**
 * The Device ID and MACs in a screen's text.
 * Returns { deviceId, lanMac, wlanMac, others, lanMatchesDeviceId }: each of the first three is
 * `{ value, fixed }` or null; `others` are MACs with no label of their own; `lanMatchesDeviceId` is
 * true / false when both are there (null otherwise).
 */
export function readScreenText(text) {
  const found = { deviceId: null, lanMac: null, wlanMac: null, others: [] }
  const seen = new Set()
  const place = (kind, bytes, fixed) => {
    const value = kind === 'deviceId' ? showDeviceId(bytes) : showMac(bytes)
    const key = bytes.join('')
    if (seen.has(key)) return
    seen.add(key)
    const hit = { value, fixed }
    if (kind === 'deviceId' && !found.deviceId) found.deviceId = hit
    else if (kind === 'lan' && !found.lanMac) found.lanMac = hit
    else if (kind === 'wlan' && !found.wlanMac) found.wlanMac = hit
    else found.others.push(hit)
  }
  for (const line of String(text || '').split(/\r?\n/)) {
    const taken = []
    for (const m of line.matchAll(SEPARATED)) {
      const b = bytesOf(m[0])
      if (!b || (b.bytes.length !== 6 && b.bytes.length !== 8)) continue
      taken.push([m.index, m.index + m[0].length])
      const label = labelOf(line.slice(0, m.index))
      place(b.bytes.length === 8 ? 'deviceId' : label === 'deviceId' ? 'lan' : label || 'other', b.bytes, b.fixed)
    }
    for (const m of line.matchAll(RUN_TOGETHER)) {
      if (taken.some(([a, z]) => m.index >= a && m.index < z)) continue
      const label = labelOf(line.slice(0, m.index))
      if (!label) continue
      const bytes = m[0].toUpperCase().match(/../g)
      place(bytes.length === 8 ? 'deviceId' : label === 'deviceId' ? 'lan' : label, bytes, true)
    }
  }
  const lan = found.deviceId && found.lanMac ? lanFromDeviceId(found.deviceId.value) : ''
  return { ...found, lanMatchesDeviceId: lan ? lan === found.lanMac.value : null }
}

/** Everything found, in screen order, as rows for the page: [{ key, label, value, fixed }]. */
export function readRows(result) {
  const rows = []
  if (result.deviceId) rows.push({ key: 'deviceId', label: 'Device ID', ...result.deviceId })
  if (result.wlanMac) rows.push({ key: 'wlanMac', label: 'WLAN MAC', ...result.wlanMac })
  if (result.lanMac) rows.push({ key: 'lanMac', label: 'LAN MAC', ...result.lanMac })
  result.others.forEach((o, i) => rows.push({ key: 'other' + i, label: result.others.length > 1 ? `MAC ${i + 1}` : 'MAC', ...o }))
  return rows
}

/** All of them as text to paste: "Device ID: 00-0F-…\nWLAN MAC: …". */
export const rowsAsText = (rows) => rows.map((r) => `${r.label}: ${r.value}`).join('\n')

/** Tidy a typed or pasted Device ID: 000f1404cc5495d4 or 00:0f:14:04:cc:54:95:d4 → '00-0F-14-04-CC-54-95-D4'. '' when it isn't 8 bytes. */
export function tidyDeviceId(text) {
  const hex = String(text || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase()
  return /^[0-9A-F]{16}$/.test(hex) ? hex.match(/../g).join('-') : ''
}
