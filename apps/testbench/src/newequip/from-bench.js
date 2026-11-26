/* A device the Test Bench didn't find in the customer's asset list, recorded from the bench as a pending row (pending.js), so it
   waits on the New equipment page to be pasted under the asset list's last row (or handed to Simpro Asset Sync). The bench only
   knows the customer by the asset list's file name and the "Customer on the report" box, so this picks the New equipment customer
   it means: the one this file was added to before on this laptop, else the only customer whose name matches, else the person
   chooses. Plain functions (no Firebase, no React) so the tests run them as they are. */
import { sameCustomer } from '../orders.js'
import { cleanPending } from './pending.js'
import { assetListHref } from './customers.js'

/** "Sth X Asset List 13.03.2025.xlsx" -> "Sth X": the file name without its extension, "Asset List" and anything after it, or a date. */
export function fileStem(name) {
  const s = String(name ?? '').replace(/\.[^.\s]+$/, '')
  const cut = s.replace(/\s*asset\s*list.*$/i, '').replace(/\s*\d{1,2}[./-]\d{1,2}[./-]\d{2,4}.*$/, '').replace(/[\s_-]+$/, '').trim()
  return cut || s.trim()
}

/**
 * Which New equipment customer a bench request means. `remembered` is { [file name]: customerId } kept on this laptop.
 * Returns { pick: id or '', list: [{ id, name }] by name }: `pick` is set only when there is no doubt.
 */
export function matchCustomer(customers, { customer = '', file = '' } = {}, remembered = {}) {
  const list = (customers || []).filter((c) => c && c.id && String(c.name || '').trim())
    .map((c) => ({ id: String(c.id), name: String(c.name).trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }))
  const before = file && remembered?.[file]
  if (before && list.some((c) => c.id === before)) return { pick: before, list }
  for (const name of [customer, fileStem(file)]) {
    if (!String(name).trim()) continue
    const exact = list.filter((c) => c.name.toLowerCase() === String(name).trim().toLowerCase())
    if (exact.length === 1) return { pick: exact[0].id, list }
    const hits = list.filter((c) => sameCustomer(c.name, name))
    if (hits.length === 1) return { pick: hits[0].id, list }
  }
  return { pick: '', list }
}

/**
 * "Open workbook" in the bench: the web address of the customer's asset list. { url, customer } when the customer is known (chosen, remembered,
 * or the only one the name fits) and has a link; { error } when it has none; otherwise { pick: '', list } for the person to choose from
 * (each with `link`: whether it has one).
 */
export function workbookFor(customers, { customer = '', file = '', customerId = '' } = {}, remembered = {}) {
  const { pick, list } = matchCustomer(customers, { customer, file }, remembered)
  const id = String(customerId || pick || ''), byId = (x) => (customers || []).find((c) => String(c.id) === String(x))
  if (id) {
    const c = byId(id)
    if (!c) return { error: 'Choose the customer this list belongs to.' }
    const url = assetListHref(c)
    return url ? { url, customer: c.name, customerId: id } : { error: `${c.name} has no link to its asset list yet. Add it on the Customers tab (Edit customer).` }
  }
  return { pick: '', list: list.map((c) => ({ ...c, link: !!assetListHref(byId(c.id)) })) }
}

/** The bench's form as a pending row: { row, errors } (cleanPending: the known fields only, one line each, a serial number needed). */
export function rowFromBench(fields) {
  return cleanPending(fields && typeof fields === 'object' ? fields : {})
}
