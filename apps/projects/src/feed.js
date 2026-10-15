/* The demo tracker feed: the demo tracker's asset register (chs-equipment,
   demo.chsnz.co.nz) turned into what the project tracker needs per model —
   how many units we own, and which are out or booked out, where, and when
   they're due back. Read-only: nothing here ever writes to the demo tracker.

   The raw read (backend-firebase.js demoFeed()) is two paths of the tracker's
   Realtime Database: data/equipment (one record per asset; an asset is out
   while OnLoanTo is set and Returned isn't 'Yes') and upcomingLoans (loans
   booked ahead, listing their assets). Only the fields below are kept, and
   that trimmed copy is what the browser caches for when the feed is down.

   The tracker's Model field is free text ("BeneVision N19", "ePM 12M"), so a
   pool model matches a tracker model by name (matchModel below), plus any
   extra names typed against it in Settings. Plain functions, no Firebase or
   React, so tests/feed.test.mjs runs them under node --test. */

import { isISO } from './model.js'

const ASSET_FIELDS = ['id', 'CHSAssetNo', 'Model', 'OnLoanTo', 'Location', 'LoanStartDate', 'LoanEndDate', 'Returned', 'BatchID']
const UPCOMING_FIELDS = ['id', 'loanTo', 'location', 'startDate', 'endDate']

const list = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).filter((x) => x && typeof x === 'object')
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null && o[k] !== '').map((k) => [k, o[k]]))

/** The database read, cut down to the fields the project tracker uses. */
export function trimRaw(equipment, upcoming) {
  return {
    equipment: list(equipment).map((e) => pick(e, ASSET_FIELDS)),
    upcoming: list(upcoming).map((u) => ({
      ...pick(u, UPCOMING_FIELDS),
      items: list(u.items).map((i) => pick(i, ['id', 'CHSAssetNo'])),
    })),
  }
}

/** The tracker stores dates as YYYY-MM-DD, and older loans as DD/MM/YYYY. */
export function feedDate(s) {
  const v = String(s ?? '').trim()
  if (isISO(v)) return v
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v)
  if (!m) return ''
  const y = m[3].length === 2 ? '20' + m[3] : m[3]
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const compact = (s) => words(s).join('')

/** The names a pool model answers to: its own, plus the extra ones from Settings. */
export const aliasesOf = (p) => [p.model, ...String(p.match || '').split(',')].map(compact).filter(Boolean)

/**
 * Does the tracker's model name `name` mean this alias? It does when the name
 * ends with the alias, spaces and dashes ignored, after any brand words
 * ("BeneVision N19", "N-19"), allowing a one- or two-letter variant suffix
 * ("ePM 12M"). Not when more words follow ("N19 Battery"), and not when the
 * alias is only the start of a longer number ("A90" is not an A9).
 */
export function nameMatches(name, alias) {
  const w = words(name)
  for (let i = 0; i < w.length; i++) {
    const tail = w.slice(i).join('')
    if (tail === alias) return true
    if (tail.startsWith(alias) && /^[a-z]{1,2}$/.test(tail.slice(alias.length)) && /\d$/.test(alias)) return true
  }
  return false
}

/** The pool model this tracker model name belongs to, or null. The longest alias wins (D1 Pro over D1). */
export function matchModel(name, pool) {
  let best = null
  let bestLen = 0
  for (const p of pool) {
    for (const a of aliasesOf(p)) {
      if (a.length > bestLen && nameMatches(name, a)) { best = p.model; bestLen = a.length }
    }
  }
  return best
}

const onLoan = (e) => Boolean(String(e.OnLoanTo || '').trim()) && e.Returned !== 'Yes'

/**
 * What the feed says, per pool model.
 *   owned:     { model: units in the register }
 *   names:     { model: { tracker model name: units } } — what matched, for Settings
 *   unmatched: [{ name, count }] — tracker models no pool model claims;
 *              they are counted (owned, names, loans) under their own name
 *   loans:     one per loan and model: { key, model, qty, loanTo, location,
 *              start, due, out, assets } — `out` is false for a loan booked
 *              ahead that hasn't started yet
 */
export function summarise(raw, pool, today) {
  const owned = {}
  const names = {}
  const other = new Map()
  const modelOf = new Map() // asset id / asset no -> pool model
  const assets = list(raw?.equipment)
  for (const e of assets) {
    const name = String(e.Model || '').trim()
    if (!name) { other.set('(no model)', (other.get('(no model)') || 0) + 1); continue }
    // A model no pool entry claims still counts, under the tracker's own name
    let m = matchModel(name, pool)
    if (!m) {
      other.set(name, (other.get(name) || 0) + 1)
      m = name
    }
    owned[m] = (owned[m] || 0) + 1
    names[m] = names[m] || {}
    names[m][name] = (names[m][name] || 0) + 1
    if (e.id) modelOf.set('id:' + e.id, m)
    if (e.CHSAssetNo) modelOf.set('no:' + e.CHSAssetNo, m)
  }

  const groups = new Map()
  const add = (key, model, info, assetNo) => {
    const k = key + '|' + model
    if (!groups.has(k)) groups.set(k, { key, model, qty: 0, assets: [], ...info })
    const g = groups.get(k)
    g.qty++
    if (assetNo) g.assets.push(String(assetNo))
  }

  const batches = new Set()
  for (const e of assets) {
    if (!onLoan(e)) continue
    const model = modelOf.get('id:' + e.id) || modelOf.get('no:' + e.CHSAssetNo)
    if (!model) continue
    const start = feedDate(e.LoanStartDate)
    const due = feedDate(e.LoanEndDate)
    if (e.BatchID) batches.add(String(e.BatchID))
    const key = e.BatchID ? String(e.BatchID) : `l:${String(e.OnLoanTo).trim()}|${start}|${due}`
    add(key, model, {
      loanTo: String(e.OnLoanTo).trim(), location: String(e.Location || '').trim(),
      start, due, out: !start || start <= today,
    }, e.CHSAssetNo)
  }

  for (const u of list(raw?.upcoming)) {
    // A booked-ahead loan that has gone out is now on the assets themselves,
    // under the same id (the tracker uses it as the BatchID), so a job linked
    // to it stays linked.
    if (u.id && batches.has(String(u.id))) continue
    const start = feedDate(u.startDate)
    const due = feedDate(u.endDate)
    if (due && due < today) continue // never went out; stale
    for (const it of list(u.items)) {
      const model = modelOf.get('id:' + it.id) || modelOf.get('no:' + it.CHSAssetNo)
      if (!model) continue
      add(u.id ? String(u.id) : `l:${u.loanTo}|${start}|${due}`, model, {
        loanTo: String(u.loanTo || '').trim(), location: String(u.location || '').trim(),
        start, due, out: false,
      }, it.CHSAssetNo)
    }
  }

  const loans = [...groups.values()].sort((a, b) => (a.due || '9999').localeCompare(b.due || '9999'))
  const unmatched = [...other].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  return { owned, names, unmatched, loans, assets: assets.length }
}

/**
 * The pool as the screens should see it: every model in Settings, with the
 * feed's count of units wherever the feed found any (else the number typed in
 * Settings), followed by every other model the demo tracker has, under its
 * own name with a family guessed from it (`auto: true`). `typed` keeps the
 * Settings number and `fromFeed` says which one `total` is.
 */
export function effectivePool(pool, summary) {
  if (!summary) return pool
  const listed = new Set(pool.map((p) => p.model))
  const auto = Object.keys(summary.owned)
    .filter((m) => !listed.has(m))
    .map((m) => ({ model: m, family: guessFamily(m), kind: '', total: summary.owned[m], fromFeed: true, auto: true }))
    .sort((a, b) => a.family.localeCompare(b.family) || a.model.localeCompare(b.model, undefined, { numeric: true }))
  return [
    ...pool.map((p) => {
      const n = summary.owned[p.model]
      return n ? { ...p, total: n, typed: p.total, fromFeed: true } : { ...p, fromFeed: false }
    }),
    ...auto,
  ]
}

/**
 * Which family a demo tracker model probably belongs to, from Mindray's
 * naming: A-series anaesthesia, N/T/ePM/iMEC/uMEC/VS monitors, D and C
 * defibs and AEDs, TE/TEX/MX/M/DC ultrasound and their probes (SC6-1s,
 * L14-6Ns), SV ventilators. Only for grouping; a Settings entry overrides it.
 */
export function guessFamily(name) {
  const w = String(name || '').toUpperCase().split(/[^A-Z0-9-]+/).filter(Boolean)
  const any = (re) => w.some((x) => re.test(x))
  if (any(/^(BED|BEDS|HYBASE|TABLE)$/) || /\b(BED|TABLE)\b/i.test(name)) return 'Beds'
  if (any(/^A[1-9]\d?$/) || any(/^WATO$/)) return 'Anaesthesia'
  if (any(/^SV\d{3}$/) || /VENTILATOR/i.test(name)) return 'Ventilators'
  if (any(/^(D[1-9]\d?|C[1-9]\d?A?)$/) || /\b(AED|DEFIB)/i.test(name)) return 'Defibs'
  if (any(/^(TEX?\d+|TE-?AIR|MX\d+|M\d+|DC-?\d+|RESONA|CONSONA)$/) || any(/^[A-Z]{1,3}\d+-\d+[A-Z]*$/) || /\b(PROBE|ULTRASOUND|ROLLSTAND)\b|\bTE[\s-]?AIR\b/i.test(name)) return 'Ultrasound'
  if (any(/^(BENEFUSION|VP\d+|SP\d+)$/) || /\b(PUMP|INFUSION)\b/i.test(name)) return 'Infusion'
  if (any(/^(N\d+|T\d+|EPM\d*|IMEC\d*|UMEC\d*|VS-?\d+|V\d{3})$/) || /\b(MONITOR|TELEMETRY|TM80)\b/i.test(name)) return 'Monitors'
  return 'Other demo equipment'
}

/** "2 at Waikato Hospital (ICU), due back 06-Nov" style facts for one loan. */
export const loanPlace = (l) => [l.loanTo, l.location].filter(Boolean).join(', ')
