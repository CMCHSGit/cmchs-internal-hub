/* The demo tracker's data as Firestore documents (step 5B, STEP-5-PLAN.md),
   and back again. Pure: tested in tests/fs-shape.test.mjs. NOT USED YET:
   db-firestore.js uses it, and nothing uses that until the cutover.

   The tracker's rules (model.js) work on the shapes the Realtime Database
   has: equipment[] and history[] (newest first), loanMeta{} and loanDocs{}
   (by loan key), upcoming[] (the bookings), retired[], kits{}, the demo types
   and simproConfig. Here those become one document per item, entry, loan and
   kit, and come back exactly as they were, so model.js runs unchanged:

   - equipment/{id}, equipmentHistory/{id}, retiredEquipment/{id}: the item or
     entry as it is, plus _pos, which keeps the list's order (a new one goes
     before the first, as the old lists add them). _pos never leaves here.
   - loans/{key}: what loanMeta, loanDocs and upcomingLoans had under that key,
     kept whole as meta, form and booking (they overlap: loanMeta's long term
     wins over the form's, as isLoanLongTerm has it). Beside them, worked out
     from those and the items, the fields the proxy, the backup and the project
     tracker's feed read: status, loanTo, location, dates, accountManager,
     longTerm, simproJobId, assetNos (out on it) and waitingFor (booked, still
     out elsewhere). status is as of the last change: a scheduled loan whose
     start has come stays 'scheduled' until something changes, so compare
     startDate with today where it matters. A loan whose meta, form and
     booking are all gone isn't deleted (only an admin may): it is 'closed',
     with what it had kept under last.
   - equipmentKits/{key}, settings/equipment ({ simproConfig, demoTypes }).

   Firestore can't hold an array directly inside an array (the loan form's
   savedRows is rows of cells), so an inner array is kept as { _a: [...] }. */

export const COLLECTIONS = { equipment: 'equipment', history: 'equipmentHistory', retired: 'retiredEquipment', loans: 'loans', kits: 'equipmentKits' }
export const SETTINGS_DOC = ['settings', 'equipment']

/* ── Arrays in arrays ── */
export function pack(v, inArray = false) {
  if (Array.isArray(v)) { const a = v.map((x) => pack(x, true)); return inArray ? { _a: a } : a }
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).map(([k, x]) => [k, pack(x)]))
  return v === undefined ? null : v
}
export function unpack(v) {
  if (Array.isArray(v)) return v.map((x) => (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).length === 1 && Array.isArray(x._a) ? unpack(x._a) : unpack(x)))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, unpack(x)]))
  return v
}

/** The same value, whatever order its keys are in (for telling what changed). */
export function same(a, b) { return stable(a) === stable(b) }
function stable(v) {
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']'
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}'
  return JSON.stringify(v === undefined ? null : v)
}

/* ── Lists in order ── */
const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).filter((x) => x && typeof x === 'object')

/**
 * Each entry's place: kept where it had one (prev: id → _pos), else between
 * its neighbours that have one (before the first, after the last).
 */
export function positions(entries, prev = new Map()) {
  const ids = entries.map((e) => e.id)
  const out = new Map()
  const known = ids.map((id) => (prev.has(id) ? prev.get(id) : null))
  for (let i = 0; i < ids.length; i++) {
    if (known[i] != null) { out.set(ids[i], known[i]); continue }
    let j = i; while (j < ids.length && known[j] == null) j++   // the run of new ones, i..j-1
    const lo = i > 0 ? out.get(ids[i - 1]) : null
    const hi = j < ids.length ? known[j] : null
    const n = j - i
    for (let k = 0; k < n; k++) {
      const p = lo == null && hi == null ? k
        : lo == null ? hi - (n - k)
        : hi == null ? lo + k + 1
        : lo + ((hi - lo) * (k + 1)) / (n + 1)
      out.set(ids[i + k], p)
    }
    i = j - 1
  }
  return out
}
const byPos = (docs) => [...docs.values()].sort((a, b) => (a._pos ?? 0) - (b._pos ?? 0)).map(({ _pos, ...rest }) => rest)

/* ── Loans ── */
const outOn = (e) => !!e.OnLoanTo && e.Returned !== 'Yes'
// A loan from before BatchIDs is keyed by customer and end date, in any of the
// ways model.js looks one up (legacyKeys, readinessKey).
const legacyKeys = (loanTo, endDate) => {
  const enc = 'loandoc_' + encodeURIComponent((loanTo || '') + '|||' + (endDate || ''))
  return [enc, 'loandoc_' + (loanTo || '') + '|||' + (endDate || ''), enc.replace(/[.#$[\]/]/g, '_')]
}

/** The fields worked out for a loan's document, from what it keeps and the items out on it. */
export function loanSummary(key, { meta, form, booking }, items, today) {
  const first = items[0] || {}
  const pick = (f, bf = f) => first[f] || booking?.[bf] || form?.[bf] || ''
  const longTerm = typeof meta?.longTerm === 'boolean' ? meta.longTerm : !!form?.longTerm
  const status = items.length ? (items.every((e) => e.LoanStartDate && e.LoanStartDate > today) ? 'scheduled' : 'active')
    : booking ? 'booked' : 'closed'
  const job = form?.simproJobId ?? null
  return {
    status,
    loanTo: pick('OnLoanTo', 'loanTo'), location: pick('Location', 'location'),
    startDate: pick('LoanStartDate', 'startDate'), endDate: items.length ? (first.LoanEndDate || '') : (booking?.endDate || form?.endDate || ''),
    accountManager: meta?.accountManager || form?.accountManager || booking?.accountManager || '',
    longTerm,
    simproJobId: job, simproClosedAt: form?.simproClosedAt || null,
    assetNos: items.map((e) => e.CHSAssetNo || '').filter(Boolean),
    waitingFor: booking ? list(booking.items).map((i) => ({ id: i.id || '', CHSAssetNo: i.CHSAssetNo || '', Model: i.Model || '', SerialNo: i.SerialNo || '' })) : [],
  }
}

/* ── The whole tracker, both ways ── */

/**
 * The tracker's state as documents: { equipment, history, retired, loans,
 * kits } (each a Map id → document) and settings. prev is the documents as
 * they are now (for each list's _pos, and what a gone loan had kept).
 */
export function toDocs(s, { prev = null, today = '' } = {}) {
  const posOf = (m) => new Map([...(m || new Map()).entries()].map(([id, d]) => [id, d._pos]))
  const ordered = (arr, prevMap) => {
    const entries = list(arr)
    const pos = positions(entries, posOf(prevMap))
    return new Map(entries.map((e) => [e.id, pack({ ...e, _pos: pos.get(e.id) })]))
  }
  const equipment = ordered(s.equipment, prev?.equipment)
  const history = ordered(s.history, prev?.history)
  const retired = ordered(s.retired, prev?.retired)

  const loanMeta = s.loanMeta || {}, loanDocs = s.loanDocs || {}
  const upcoming = new Map(list(s.upcoming).map((u) => [u.id, u]))
  const outByKey = new Map()
  for (const e of list(s.equipment).filter(outOn)) {
    for (const k of e.BatchID ? [e.BatchID] : new Set(legacyKeys(e.OnLoanTo, e.LoanEndDate))) {
      if (!outByKey.has(k)) outByKey.set(k, [])
      outByKey.get(k).push(e)
    }
  }
  const loans = new Map()
  const keys = new Set([...Object.keys(loanMeta), ...Object.keys(loanDocs), ...upcoming.keys()])
  // Every loan with items out has a document, stored things or not: by its
  // BatchID, or an old one by the key its form would have.
  for (const e of list(s.equipment).filter(outOn)) {
    const ks = e.BatchID ? [e.BatchID] : legacyKeys(e.OnLoanTo, e.LoanEndDate)
    if (!ks.some((k) => keys.has(k))) keys.add(ks[0])
  }
  for (const key of keys) {
    const kept = { meta: loanMeta[key] || null, form: loanDocs[key] || null, booking: upcoming.get(key) || null }
    const doc = { ...loanSummary(key, kept, outByKey.get(key) || [], today) }
    if (kept.meta) doc.meta = kept.meta
    if (kept.form) doc.form = kept.form
    if (kept.booking) doc.booking = kept.booking
    loans.set(key, pack(doc))
  }
  // Loans gone from all three: kept, closed, with what they had.
  for (const [key, was] of prev?.loans || []) {
    if (keys.has(key)) continue
    const { meta, form, booking, ...rest } = was
    const last = Object.fromEntries(Object.entries({ meta, form, booking }).filter(([, v]) => v))
    loans.set(key, { ...rest, status: 'closed', last: Object.keys(last).length ? last : (was.last || null) })
  }

  const kits = new Map(Object.entries(s.kits && typeof s.kits === 'object' ? s.kits : {}).filter(([, k]) => k && typeof k === 'object').map(([k, v]) => [k, pack(v)]))
  const settings = pack({ simproConfig: s.simproConfig || {}, demoTypes: Array.isArray(s.demoTypes) ? s.demoTypes : [] })
  return { equipment, history, retired, loans, kits, settings }
}

/** Documents back into the tracker's state, in the Realtime Database's shapes. */
export function fromDocs(d) {
  const loanMeta = {}, loanDocs = {}, upcoming = []
  for (const key of [...(d.loans || new Map()).keys()].sort()) {
    const l = unpack(d.loans.get(key))
    if (l.meta) loanMeta[key] = l.meta
    if (l.form) loanDocs[key] = l.form
    if (l.booking) upcoming.push(l.booking)
  }
  const un = (m) => byPos(new Map([...(m || new Map()).entries()].map(([k, v]) => [k, unpack(v)])))
  const settings = unpack(d.settings || {})
  return {
    equipment: un(d.equipment), history: un(d.history), retired: un(d.retired),
    loanMeta, loanDocs, upcoming,
    kits: Object.fromEntries([...(d.kits || new Map()).entries()].map(([k, v]) => [k, unpack(v)])),
    simproConfig: settings.simproConfig || {}, demoTypes: settings.demoTypes || [],
  }
}

/**
 * The writes that turn one set of documents into another: [{ col, id, data }]
 * with data null for a delete. Settings is { col: 'settings', id: 'equipment' }.
 */
export function diffDocs(before, after) {
  const out = []
  for (const [name, col] of Object.entries(COLLECTIONS)) {
    const a = before[name] || new Map(), b = after[name] || new Map()
    for (const [id, doc] of b) if (!a.has(id) || !same(a.get(id), doc)) out.push({ col, id, data: doc })
    for (const id of a.keys()) if (!b.has(id)) out.push({ col, id, data: null })
  }
  if (after.settings && !same(before.settings || null, after.settings)) out.push({ col: SETTINGS_DOC[0], id: SETTINGS_DOC[1], data: after.settings })
  return out
}

/** Why a set of writes can't be made, or '': a history entry is only ever added (the rules refuse a change). */
export function writesProblem(writes, before) {
  const bad = writes.find((w) => w.col === COLLECTIONS.history && w.data && before.history?.has(w.id))
  return bad ? 'A history entry can’t be changed once written.' : ''
}

/* ── Test reports: base64 in chunks ── */
export const CHUNK = 900000
export const CHUNKS_PER_WRITE = 4
export const chunksOf = (dataUrl) => { const out = []; for (let i = 0; i < dataUrl.length; i += CHUNK) out.push(dataUrl.slice(i, i + CHUNK)); return out.length ? out : [''] }
