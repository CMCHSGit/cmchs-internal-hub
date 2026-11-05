/* Customer folders (the Customers tab): one folder per customer, and in each
   a list of sub folders that are really links (the OneDrive equipment list,
   the projects folder, test reports…). The screens only ever show the names;
   the links are set in the folder's settings.

   They live in the tracker's settings document (settings.customers), so the
   security rules, the backups and Restore already cover them. Plain functions
   here, so tests/customers.test.mjs can run them under node --test. */

import { linkHref } from './model.js'

/** Folder colours: the brand's, then a few neutrals. */
export const FOLDER_COLOURS = ['#554596', '#80bd01', '#F7941D', '#0070C0', '#c8102e', '#E5539A', '#00A19B', '#575756']

/**
 * The icons a folder or sub folder can wear: [key, label]. The key is what is stored;
 * the drawing for it is in views/Customers.jsx (an unknown key shows the plain folder).
 */
export const FOLDER_ICONS = [
  ['folder', 'Folder'], ['building', 'Hospital / site'], ['boxes', 'Equipment'], ['sheet', 'Spreadsheet'], ['check', 'Test reports'],
  ['file', 'Document'], ['sign', 'Contract'], ['receipt', 'Quote / invoice'], ['image', 'Photos'], ['map', 'Map / site plan'],
  ['wrench', 'Service'], ['wifi', 'Network'], ['shield', 'Safety'], ['book', 'Training'], ['users', 'People'],
  ['calendar', 'Schedule'], ['mail', 'Email'], ['link', 'Link'],
]
export const ICON_KEYS = new Set(FOLDER_ICONS.map(([k]) => k))

/** What a sub folder usually is: its name, and the icon it starts with. Offered as suggestions, never required. */
export const SUB_KINDS = [
  ['Equipment list', 'sheet'], ['Projects folder', 'folder'], ['Test reports', 'check'], ['Service reports', 'wrench'],
  ['Quotes', 'receipt'], ['Contracts', 'sign'], ['Site photos', 'image'], ['Drawings and site plans', 'map'],
  ['Network and Wi-Fi', 'wifi'], ['Training', 'book'], ['Contacts', 'users'],
]
export const DEFAULT_SUBS = ['Equipment list', 'Projects folder', 'Test reports']

const iconForName = (name) => SUB_KINDS.find(([n]) => n.toLowerCase() === String(name).trim().toLowerCase())?.[1] || 'link'
const rid = () => Math.random().toString(36).slice(2, 10)
const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

/** A sub folder, from whatever was stored (missing pieces filled in). */
export function normaliseSub(s) {
  return { id: s?.id || rid(), name: text(s?.name, 80), link: String(s?.link ?? '').trim(), icon: ICON_KEYS.has(s?.icon) ? s.icon : iconForName(s?.name), note: text(s?.note, 200) }
}

/** A customer folder, from whatever was stored. */
export function normaliseCustomer(c) {
  return {
    id: c?.id || rid(),
    name: text(c?.name, 80),
    colour: FOLDER_COLOURS.includes(c?.colour) ? c.colour : FOLDER_COLOURS[0],
    icon: ICON_KEYS.has(c?.icon) ? c.icon : 'folder',
    note: text(c?.note, 300),
    pinned: !!c?.pinned,
    subs: (Array.isArray(c?.subs) ? c.subs : []).map(normaliseSub),
  }
}

export const customersOf = (settings) => (Array.isArray(settings?.customers) ? settings.customers : []).map(normaliseCustomer)

/** A new folder with the usual sub folders (empty links), ready to be named. `names` is the Settings list. */
export function newCustomer(names = DEFAULT_SUBS) {
  return { id: rid(), name: '', colour: FOLDER_COLOURS[0], icon: 'folder', note: '', pinned: false, subs: names.map((n) => normaliseSub({ name: n })) }
}
export const newSub = (name = '') => normaliseSub({ name })

/** The same folder for another customer: its structure, none of its links. */
export function copyCustomer(c, name) {
  return { ...normaliseCustomer(c), id: rid(), name, pinned: false, subs: c.subs.map((s) => ({ ...normaliseSub(s), id: rid(), link: '' })) }
}

/**
 * What stops a folder being saved: [] when it is fine. Names must be filled in (a customer's
 * name must also be new), and a link, if given, must be a web address (model.js linkHref).
 */
export function customerProblems(draft, others = []) {
  const out = []
  const name = text(draft.name, 80)
  if (!name) out.push('Give the folder a name.')
  else if (others.some((o) => o.id !== draft.id && o.name.toLowerCase() === name.toLowerCase())) out.push(`There is already a folder called "${name}".`)
  draft.subs.forEach((s, i) => {
    if (!text(s.name, 80)) out.push(`Sub folder ${i + 1} needs a name.`)
    if (String(s.link ?? '').trim() && !linkHref(s.link)) out.push(`${text(s.name, 80) || `Sub folder ${i + 1}`}: the link must be a web address starting with https://`)
  })
  return out
}

/** The folder ready to store: trimmed, links as pasted but with the https:// added where it was left off. */
export function tidyCustomer(draft) {
  const c = normaliseCustomer(draft)
  return { ...c, subs: c.subs.map((s) => ({ ...s, link: linkHref(s.link) || s.link })) }
}

/** Puts a folder in the list (replacing the one with its id), or takes it out when `c` is null. */
export function withCustomer(list, id, c) {
  const rest = list.filter((x) => x.id !== id)
  return c ? [...rest, c] : rest
}

/** Pinned first, then A to Z. With a search: folders whose name, note or a sub folder's name has every word. */
export function visibleCustomers(list, q = '') {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean)
  const hay = (c) => [c.name, c.note, ...c.subs.map((s) => s.name)].join(' ').toLowerCase()
  return list
    .filter((c) => words.every((w) => hay(c).includes(w)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/** Moves item `i` of a list by `d` places (-1 up, 1 down); the same list if it can't. */
export function moved(list, i, d) {
  const j = i + d
  if (j < 0 || j >= list.length) return list
  const next = [...list]
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** The folder a job's customer name belongs to (same name, ignoring case), if any. */
export const customerFor = (list, jobCustomer) => {
  const n = String(jobCustomer || '').trim().toLowerCase()
  return n ? list.find((c) => c.name.toLowerCase() === n) || null : null
}
