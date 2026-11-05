/* Reading a customer's asset list straight from its OneDrive or SharePoint sharing link, through Microsoft Graph, as the person who is
   signed in: they can read only what they can already open. READ ONLY: nothing here writes, renames or shares anything. No Firebase
   and no React here (the token comes in as a function), so the tests run it with a made-up fetch. */

export const GRAPH = 'https://graph.microsoft.com/v1.0'
export const SCOPE = 'Files.Read.All' // delegated: read the files the signed-in person can read
export const MAX_BYTES = 25 * 1024 * 1024

/** A failed read. `code`: 'token' (sign in or allow again), 'denied', 'notfound', 'notbook', 'toobig', 'network' or 'other'. */
export class GraphError extends Error {
  constructor(code, message) { super(message); this.name = 'GraphError'; this.code = code }
}

/** The id Graph's shares API wants for a sharing link: "u!" and the link in URL-safe base64 with no padding. */
export function shareId(url) {
  const bytes = new TextEncoder().encode(String(url).trim())
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return 'u!' + btoa(s).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-')
}

const WORKBOOK = /\.(xlsx|xlsm)$/i

/**
 * The workbook at a sharing link: { buffer, name, modified, size }. `getToken()` gives a Graph access token (or throws a GraphError).
 * Asks Graph for the file's details, then downloads it from the short-lived address Graph gives; with none, from the content address.
 */
export async function fetchWorkbook(url, getToken, fetchFn = fetch) {
  const token = await getToken()
  const auth = { Authorization: 'Bearer ' + token }
  const id = shareId(url)
  const call = async (u, init) => {
    let r
    try { r = await fetchFn(u, init) } catch (e) { throw new GraphError('network', 'No connection to Microsoft (' + (e?.message || e) + ')') }
    return r
  }
  const refuse = (r) => {
    if (r.status === 401) return new GraphError('token', 'Microsoft needs you to allow access to your files again.')
    if (r.status === 403) return new GraphError('denied', 'This account isn’t allowed to read that file. The permission may have been declined, or the file isn’t shared with you.')
    if (r.status === 404 || r.status === 400) return new GraphError('notfound', 'Microsoft can’t find a file at that link. Check the customer’s asset list link.')
    return new GraphError('other', `Microsoft answered ${r.status}.`)
  }

  const meta = await call(`${GRAPH}/shares/${id}/driveItem?$select=name,size,lastModifiedDateTime,file,@microsoft.graph.downloadUrl`, { headers: auth })
  if (!meta.ok) throw refuse(meta)
  const item = await meta.json().catch(() => null)
  if (!item || !item.file) throw new GraphError('notbook', 'That link isn’t a file. It needs to be the asset list workbook itself.')
  const name = String(item.name || '')
  if (!WORKBOOK.test(name)) throw new GraphError('notbook', `“${name || 'That file'}” isn’t an Excel workbook (.xlsx).`)
  if (item.size > MAX_BYTES) throw new GraphError('toobig', 'That workbook is bigger than 25 MB.')

  const direct = item['@microsoft.graph.downloadUrl']
  const file = direct ? await call(direct) : await call(`${GRAPH}/shares/${id}/driveItem/content`, { headers: auth })
  if (!file.ok) throw refuse(file)
  const buffer = await file.arrayBuffer()
  return { buffer, name, modified: item.lastModifiedDateTime || '', size: buffer.byteLength }
}
