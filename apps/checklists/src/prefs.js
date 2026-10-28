/* Checklists — what each person had filtered and sorted on a list, kept on this device so a refresh (or coming back
   tomorrow) finds the list as they left it. Only the person clearing the filters clears them. Per list, per browser. */

export const NO_FILTER = { q: '', status: [], department: [], facility: [], version: [], missing: [], show: 'all' }
export const DEFAULT_SORT = { key: 'department', dir: 1 }
const SHOWS = ['all', 'todo', 'done', 'notfound']
const KEY = (listId) => 'cl-view:' + listId

const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 200) : [])

/** Whatever was stored (or nothing) as a filter and sort the screen can use: bad or missing parts fall back to none. */
export function normaliseView(raw, sortKeys = []) {
  const f = raw?.f || {}
  const s = raw?.sort || {}
  return {
    f: {
      q: typeof f.q === 'string' ? f.q.slice(0, 200) : '',
      status: strings(f.status), department: strings(f.department), facility: strings(f.facility), version: strings(f.version), missing: strings(f.missing),
      show: SHOWS.includes(f.show) ? f.show : 'all',
    },
    sort: { key: sortKeys.includes(s.key) ? s.key : DEFAULT_SORT.key, dir: s.dir === -1 ? -1 : 1 },
  }
}

export function loadView(listId, sortKeys) {
  try { return normaliseView(JSON.parse(localStorage.getItem(KEY(listId)) || 'null'), sortKeys) } catch { return normaliseView(null, sortKeys) }
}

export function saveView(listId, f, sort) {
  try { localStorage.setItem(KEY(listId), JSON.stringify({ f, sort })) } catch { /* private mode: it just doesn't stick */ }
}
