/* Pulls the fields out of a pasted service order.

   The same rules as the retired Service Order Parser (/order-parser/): the
   service order prints each label on its own line with the value on the next
   non-empty one, and part numbers sit on a line by themselves with the part
   name directly under. */

import { parseDate } from './store.js'

const linesOf = (text) => text.split('\n').map((l) => l.trim())

/** The next non-empty line after a line that is exactly `label`. */
function after(lines, label) {
  const want = label.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase() !== want) continue
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j] && lines[j].toLowerCase() !== want) return lines[j]
    }
  }
  return ''
}

// 115-049059-00 is a part that stays; Q115-048108-00 is one that has to go back.
const PART = /^(Q?\d{3}-\d{6}-\d{2})$/

function parts(lines) {
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const m = PART.exec(lines[i])
    if (m) out.push({ pn: m[1], name: lines[i + 1] || '', isReturn: m[1].startsWith('Q') })
  }
  return out
}

// Who applied for the RMA. The label hasn't been seen on a real order yet, so
// these are the likely spellings; the first one present wins.
const APPLIED_BY = ['Applicant', 'Applied By', 'Applied by', 'Submitted By', 'Submitter', 'Requester', 'Requested By', 'Created By']

/** Returns the order's fields, plus the keys that were actually found. */
export function parseServiceOrder(text) {
  const lines = linesOf(text)
  const found = parts(lines)
  // The service order uses a full-width colon after this label.
  const tech = /Technician Notes[：:]\s*\n([^\n]+)/.exec(text)

  const order = {
    so: after(lines, 'Order No.'),
    title: after(lines, 'Description'),
    sn: after(lines, 'Serial No.'),
    pn: found.map((p) => p.pn).join(' / '),
    partName: found.map((p) => p.name).join(' / '),
    needReturn: found.length ? (found.some((p) => p.isReturn) ? 'YES' : 'NO') : '',
    site: after(lines, 'Customer Name'),
    notes: tech ? tech[1].trim() : '',
    dateRaised: parseDate(after(lines, 'Order Submitted')),
    appliedBy: APPLIED_BY.map((l) => after(lines, l) || after(lines, l + ':') || after(lines, l + '：')).find(Boolean) || '',
  }
  return { order, auto: Object.keys(order).filter((k) => order[k]) }
}

export const AUTO_FIELDS = ['so', 'title', 'sn', 'pn', 'partName', 'needReturn', 'site', 'notes', 'dateRaised', 'appliedBy']
