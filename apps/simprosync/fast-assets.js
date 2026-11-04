/* Simpro Asset Sync — reading the assets on a set of sites quickly.

   The preview needs every asset of one type on each site in the sheet, with its custom fields (the serial number
   is one: it is what rows are matched on). The original way was one call to list a site's assets and then one call
   a asset for its custom fields: thousands of calls for a big site, which Simpro throttles (429), and each throttled
   call waits 4, 8, then 12 seconds before it retries. That is the long "Reading asset details on site…" wait.

   Simpro can list assets company-wide with their custom fields included (/customerAssets/ with columns=…CustomFields,
   250 to a call), filtered by type and site, which is what the delete tool already does. This does the same for the
   sync, with two safeguards, because a wrong read here becomes duplicate assets when the sync is applied:
     - the answer must have the shape the per-asset way gives (custom fields with their ids); and
     - a few assets are also read the old way and must agree, field for field.
   Anything else (the proxy not allowing the list call, a different shape, a disagreement) returns null, and the
   caller carries on the old way. */

const PAGE = 250
const SITES_PER_CALL = 40 // keeps the address short
const PAGES_AT_ONCE = 4   // travel together in one proxy batch

const text = (v) => (v === null || v === undefined ? '' : String(v).trim())

/** The list's custom fields as the per-asset call gives them: [{ CustomField: { ID, Name }, Value }], or null if they don't look like that. */
function normaliseFields(list) {
  if (!Array.isArray(list)) return null
  const out = []
  for (const c of list) {
    const id = c?.CustomField?.ID
    if (id === undefined || id === null) return null
    out.push({ CustomField: { ID: id, Name: c.CustomField.Name }, Value: c.Value })
  }
  return out
}

/** A few assets spread across the list: first, last and one from the middle. */
function sampleOf(list, n) {
  if (list.length <= n) return list
  const picks = [0, Math.floor(list.length / 2), list.length - 1, Math.floor(list.length / 4), Math.floor((list.length * 3) / 4)].slice(0, n)
  return [...new Set(picks)].map((i) => list[i])
}

/**
 * Every non-archived asset of type `tid` on `sites`, with custom fields, as Map(siteId string -> assets[]), where an
 * asset is { ID, Site, CustomFields }. Null when the fast way can't be trusted (see the top of this file).
 *   transport(method, path)  one call straight to the proxy, throwing if it refuses
 *   call(method, path)       the same with retries: { status, data }
 */
export async function fastSiteAssets({ transport, call, cid, tid, sites, sample = 3, onProgress = () => {} }) {
  const wanted = [...new Set(sites.map(String))].filter((s) => /^\d+$/.test(s))
  if (!wanted.length) return new Map()
  const raw = []

  for (let i = 0; i < wanted.length; i += SITES_PER_CALL) {
    const chunk = wanted.slice(i, i + SITES_PER_CALL)
    const q = `AssetType.ID=${tid}&Site.ID=in(${chunk.join(',')})&columns=ID,Site,AssetType,Archived,CustomFields&pageSize=${PAGE}`
    const path = (page) => `/companies/${cid}/customerAssets/?${q}&page=${page}`
    let first
    // Straight to the transport, not call(): a refusal would otherwise be retried with a wait before giving up.
    try { first = await transport('GET', path(1)) } catch (e) { if (/not allowed/i.test(e.message || '')) return null; throw e }
    if (first.status !== 200 || !Array.isArray(first.data)) return null
    let got = first.data
    onProgress(`Reading assets from Simpro… ${raw.length + got.length} so far`)
    for (let page = 2; got.length === (page - 1) * PAGE; page += PAGES_AT_ONCE) {
      const res = await Promise.all(Array.from({ length: PAGES_AT_ONCE }, (_, k) => call('GET', path(page + k))))
      for (const r of res) {
        if (r.status !== 200 || !Array.isArray(r.data)) return null
        got = got.concat(r.data)
      }
      onProgress(`Reading assets from Simpro… ${raw.length + got.length} so far`)
    }
    raw.push(...got)
  }

  const bySite = new Map(wanted.map((s) => [s, []]))
  for (const a of raw) {
    if (a?.ID === undefined || a?.Site?.ID === undefined) return null
    if (String(a.AssetType?.ID) !== String(tid) || a.Archived) continue
    const fields = normaliseFields(a.CustomFields)
    if (!fields) return null
    const site = String(a.Site.ID)
    if (bySite.has(site)) bySite.get(site).push({ ID: a.ID, Site: a.Site, CustomFields: fields })
  }

  // Check a few the old way. Disagreement on any field, or nothing readable to check against, means don't trust it.
  const all = [...bySite.values()].flat()
  let checked = 0
  for (const a of sampleOf(all, sample)) {
    onProgress('Checking the faster read against Simpro…')
    const r = await call('GET', `/companies/${cid}/sites/${a.Site.ID}/assets/${a.ID}/customFields/?pageSize=${PAGE}`)
    if (r.status !== 200 || !Array.isArray(r.data)) continue
    checked++
    const listed = new Map(a.CustomFields.map((c) => [String(c.CustomField.ID), text(c.Value)]))
    for (const c of r.data) {
      if (text(c.Value) !== (listed.get(String(c.CustomField?.ID)) ?? '')) return null
    }
  }
  if (all.length && !checked) return null
  return bySite
}
