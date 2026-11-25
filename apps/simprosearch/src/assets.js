/* "Export customer assets": every customer asset in Simpro (or one asset type) as one row each, with every custom field as its own
   column, for building a master asset list and checking customers' own equipment lists against it.
   Read only: the company-wide /customerAssets/ list through the hub's Simpro relay, 250 to a page and 4 pages to a trip (the same
   call Asset Sync's fast read and the asset scan use), so no relay change. No React and no DOM, so the tests run it. */
import { SendError, ok } from '../../testbench/src/simpro-api.js'

export const PAGE = 250
export const PAGES_AT_ONCE = 4
export const MAX_PAGES = 400          // 100,000 assets: far more than Simpro has, but a ceiling so a page Simpro repeats can't run forever
const BASE_COLUMNS = 'ID,Site,AssetType,Archived,CustomFields'
const WITH_CUSTOMER = BASE_COLUMNS + ',Customer'

/** The address of one page of customer assets, optionally one asset type. */
export function assetsPagePath(companyId, { typeId = '', columns = BASE_COLUMNS, page = 1 } = {}) {
  const parts = []
  if (typeId !== '' && typeId !== null && typeId !== undefined) {
    if (!/^\d+$/.test(String(typeId))) throw new Error('An asset type is a number: ' + typeId)
    parts.push('AssetType.ID=' + typeId)
  }
  parts.push('columns=' + columns, 'pageSize=' + PAGE, 'page=' + page)
  return `/companies/${companyId}/customerAssets/?${parts.join('&')}`
}

/**
 * Every customer asset (of `typeId`, if given). Archived ones are left out unless `includeArchived`.
 *   batchGet(paths): bulk.js makeBatchGet's result.   onProgress({ pages, assets }), isCancelled().
 * Returns { assets, pages, cancelled, capped, customers, error }: `assets` in Simpro's order by ID; `customers`: whether Simpro gave each
 * asset's customer (it is asked for, and left out if Simpro refuses it); `capped`: stopped at MAX_PAGES, so there may be more;
 * `error`: Simpro stopped answering part-way (the assets read before then are still returned). A refused first page throws.
 */
export async function exportAssets({ batchGet, companyId, typeId = '', includeArchived = false, onProgress = () => {}, isCancelled = () => false }) {
  const byId = new Map()
  let columns = WITH_CUSTOMER
  let pages = 0, finished = false, lastFirst = null, error = ''

  // The first page alone: whether Simpro gives the customer column, and that it lists assets at all.
  let first = (await batchGet([assetsPagePath(companyId, { typeId, columns, page: 1 })]))[0]
  if (!ok(first) && first?.status >= 400 && first?.status < 500) {
    columns = BASE_COLUMNS
    first = (await batchGet([assetsPagePath(companyId, { typeId, columns, page: 1 })]))[0]
  }
  if (!ok(first) || !Array.isArray(first.data)) throw new SendError(`Simpro wouldn’t list the customer assets (${first?.status}).`, (first?.status || 0) >= 500)
  const take = (rows) => { for (const a of rows) if (a && a.ID != null) byId.set(String(a.ID), a) }
  take(first.data); pages = 1; lastFirst = first.data[0]?.ID ?? null
  if (first.data.length < PAGE) finished = true
  onProgress({ pages, assets: byId.size })

  for (let page = 2; !finished && !error && page <= MAX_PAGES && !isCancelled(); page += PAGES_AT_ONCE) {
    const want = Array.from({ length: Math.min(PAGES_AT_ONCE, MAX_PAGES - page + 1) }, (_, k) => assetsPagePath(companyId, { typeId, columns, page: page + k }))
    let res = null
    for (let attempt = 0; attempt < 3 && !res; attempt++) {
      try { res = await batchGet(want) } catch (e) {
        if (!e?.retry || attempt === 2) { error = `Simpro stopped answering after ${byId.size} assets: ${e?.message || e}`; break }
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)))
      }
    }
    for (const r of res || []) {
      if (!ok(r) || !Array.isArray(r.data)) { error = `Simpro stopped answering after ${byId.size} assets (page ${pages + 1}: ${r?.status}).`; break }
      const firstId = r.data[0]?.ID ?? null
      if (firstId !== null && firstId === lastFirst) { finished = true; break } // Simpro ignored the page number: stop rather than repeat
      lastFirst = firstId
      take(r.data); pages++
      if (r.data.length < PAGE) { finished = true; break }
    }
    onProgress({ pages, assets: byId.size })
  }

  const cancelled = isCancelled() && !finished && !error
  let assets = [...byId.values()]
  if (!includeArchived) assets = assets.filter((a) => !a.Archived)
  if (typeId !== '' && typeId !== null && typeId !== undefined) assets = assets.filter((a) => String(a?.AssetType?.ID) === String(typeId)) // in case Simpro ignored the filter
  assets.sort((a, b) => Number(a.ID) - Number(b.ID))
  return { assets, pages, cancelled, capped: !finished && !cancelled && !error, customers: columns === WITH_CUSTOMER, error }
}

const text = (v) => (v === null || v === undefined ? '' : typeof v === 'object' ? String(v.Name ?? v.ID ?? '') : String(v).trim())
const nameKey = (s) => String(s || '').trim().toLowerCase()
export const customerOfAsset = (a) => {
  const c = a?.Customer
  if (!c) return ''
  return String(c.CompanyName || [c.GivenName, c.FamilyName].filter(Boolean).join(' ') || c.Name || '').trim()
}

export const FIXED = ['Simpro Asset ID', 'Site ID', 'Site', 'Customer', 'Asset Type', 'Archived', 'Serial Number']

/**
 * The assets as a table: { headers, rows } (rows are arrays of text). The fixed columns first, then every custom field any asset has,
 * by name (A–Z; names that differ only in case or spaces are one column). Serial Number is a fixed column, never repeated.
 * `customers`: false leaves the Customer column out (Simpro didn't give it).
 */
export function assetTable(assets, { customers = true } = {}) {
  const fields = new Map() // key -> the first spelling seen
  for (const a of assets) for (const c of a?.CustomFields || []) {
    const name = String(c?.CustomField?.Name || '').trim()
    if (name && !fields.has(nameKey(name))) fields.set(nameKey(name), name)
  }
  fields.delete('serial number')
  const extra = [...fields.entries()].sort((x, y) => x[1].localeCompare(y[1], 'en-NZ'))
  const fixed = customers ? FIXED : FIXED.filter((h) => h !== 'Customer')
  const headers = [...fixed, ...extra.map(([, name]) => name)]
  const rows = assets.map((a) => {
    const vals = new Map()
    for (const c of a?.CustomFields || []) {
      const k = nameKey(c?.CustomField?.Name)
      if (k && !vals.has(k)) vals.set(k, text(c?.Value))
    }
    const base = {
      'Simpro Asset ID': text(a?.ID), 'Site ID': text(a?.Site?.ID), Site: text(a?.Site?.Name), Customer: customerOfAsset(a),
      'Asset Type': text(a?.AssetType?.Name), Archived: a?.Archived ? 'Yes' : '', 'Serial Number': vals.get('serial number') || '',
    }
    return [...fixed.map((h) => base[h]), ...extra.map(([k]) => vals.get(k) || '')]
  })
  return { headers, rows }
}

/** A cell as Excel reads it safely: quoted when needed, and text that Excel would run as a formula starts with ' so it stays text. */
export function csvCell(v) {
  let s = String(v ?? '')
  if (/^[=+@\t\r]/.test(s) || /^-[^\d]/.test(s)) s = "'" + s
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

/** The table as a CSV file Excel opens with the right characters (a byte-order mark, CRLF lines). */
export function toCsv({ headers, rows }) {
  return '﻿' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'
}

/** How many assets each site has, most first: [{ site, siteId, count }], for the summary sheet. */
export function bySite(assets) {
  const m = new Map()
  for (const a of assets) {
    const id = text(a?.Site?.ID)
    const have = m.get(id) || { siteId: id, site: text(a?.Site?.Name), customer: customerOfAsset(a), count: 0 }
    have.count++
    m.set(id, have)
  }
  return [...m.values()].sort((x, y) => y.count - x.count || x.site.localeCompare(y.site, 'en-NZ'))
}
