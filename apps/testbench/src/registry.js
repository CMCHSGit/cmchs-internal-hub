/* The customer registry's plain rules (no Firebase, no React, so the tests run them as they are). One entry per large customer:
   its name, the links to its asset list and its reports folder (online OneDrive or SharePoint), and which Simpro customer and
   sites it is. Links and numbers only: no workbook and no report is kept here. Stored in Firestore `customerRegistry`
   (registry-firebase.js); the rules there (rules/firestore.rules) say the same things again, because the rules are what counts. */

export const MAX_NAME = 120
export const MAX_LINK = 1500
export const MAX_SITES = 30

/** { value, error }: a link as typed. Blank is allowed (not set yet); anything else must be an https address with no spaces. */
export function cleanLink(v, what = 'link') {
  const s = String(v ?? '').trim()
  if (!s) return { value: '', error: '' }
  if (/\s/.test(s)) return { value: s, error: `The ${what} has a space in it. Paste the whole link as it is.` }
  if (!/^https:\/\/\S+$/i.test(s)) return { value: s, error: `The ${what} must start with https://` }
  if (s.length > MAX_LINK) return { value: s, error: `The ${what} is too long.` }
  return { value: s, error: '' }
}

/** 'online' for a OneDrive or SharePoint address, 'other' for any other https address, '' for none. Only used to warn: any https link is accepted. */
export function linkKind(url) {
  let host = ''
  try { host = new URL(String(url || '')).hostname.toLowerCase() } catch { return '' }
  return host.endsWith('.sharepoint.com') || host === '1drv.ms' || host.endsWith('.1drv.ms') || host === 'onedrive.live.com' || host.endsWith('.onedrive.com') ? 'online' : 'other'
}

/** { sites, bad }: site IDs typed as "2350, 2351 2352" (commas, spaces or new lines). IDs are digits; repeats are dropped. */
export function parseSites(text) {
  const sites = [], bad = []
  for (const t of String(text ?? '').split(/[\s,;]+/).filter(Boolean)) {
    if (!/^\d{1,12}$/.test(t)) bad.push(t)
    else if (!sites.includes(t)) sites.push(t)
  }
  return { sites, bad }
}

/** { entry, errors }: the form's values checked and tidied into what is stored (without who and when: the saver adds those). */
export function cleanEntry({ name, assetListUrl, reportsUrl, simproCustomerId, sites }) {
  const errors = []
  const n = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!n) errors.push('Give the customer a name.')
  else if (n.length > MAX_NAME) errors.push(`The name is longer than ${MAX_NAME} characters.`)
  const a = cleanLink(assetListUrl, 'asset list link'); if (a.error) errors.push(a.error)
  const r = cleanLink(reportsUrl, 'reports folder link'); if (r.error) errors.push(r.error)
  const id = String(simproCustomerId ?? '').trim()
  if (id && !/^\d{1,12}$/.test(id)) errors.push('The Simpro customer number is digits only.')
  const s = parseSites(sites)
  if (s.bad.length) errors.push(`Site IDs are numbers. Not understood: ${s.bad.slice(0, 3).join(', ')}${s.bad.length > 3 ? '…' : ''}`)
  if (s.sites.length > MAX_SITES) errors.push(`At most ${MAX_SITES} sites.`)
  return { entry: { name: n, assetListUrl: a.value, reportsUrl: r.value, simproCustomerId: id, siteIds: s.sites }, errors }
}

/** What a saved entry still lacks, in words, for the list: [] when it is complete. */
export function missingOf(c) {
  const m = []
  if (!c.assetListUrl) m.push('asset list link')
  if (!c.reportsUrl) m.push('reports folder link')
  if (!c.simproCustomerId && !(c.siteIds || []).length) m.push('Simpro customer or sites')
  return m
}

/** Customers by name, ignoring case. */
export const sortCustomers = (list) => [...list].sort((x, y) => String(x.name).localeCompare(String(y.name), 'en', { sensitivity: 'base' }))

/** The customer that has this Simpro site, or null. */
export const customerOfSite = (list, siteId) => list.find((c) => (c.siteIds || []).includes(String(siteId))) || null
