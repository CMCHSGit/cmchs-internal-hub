/* A gentle check on what is being put into a code. A QR code or barcode is readable by anyone with a phone, and the
   company's IT policy (QP33) keeps patient information out of anything shared, so the page warns when the text looks
   like an NHI number. It never blocks (a device serial can look the same) and nothing leaves the browser either way. Pure. */

// Old NHI: three letters then four digits. Current NHI: three letters, two digits, two letters. Letters exclude I and O.
const NHI = /\b[A-HJ-NP-Z]{3}\d{2}(?:\d{2}|[A-HJ-NP-Z]{2})\b/i

/** True when the text holds something shaped like an NHI number. */
export function looksLikeNhi(text) {
  return NHI.test(String(text ?? ''))
}
