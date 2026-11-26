/* The demo tracker's rules, ported from the old tracker (chs-equipment
   index.html) so the rebuilt screens agree with it exactly while both run on
   the same data. Pure: tested in tests/model.test.mjs, against cases worked
   out from the old code. Where a rule here is the old one, its old name is
   given, so the two can be compared line by line. */

/** Today in New Zealand, YYYY-MM-DD (old: nzDate). */
export const nzDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' })

/** A loan made in test mode (old: isTestBatch). */
export const isTestBatch = (batchId) => !!batchId && batchId.indexOf('testbatch_') === 0

/** On loan now, or booked onto someone with a later start: OnLoanTo set and not returned. */
export const isOut = (e) => !!e.OnLoanTo && e.Returned !== 'Yes'

/**
 * Whether a loan is long term (old: isLoanLongTerm): loanMeta says so, or,
 * failing that, its loan form does.
 */
export function isLoanLongTerm(batchId, { loanMeta = {}, loanDocs = {} } = {}) {
  if (!batchId) return false
  const meta = loanMeta[batchId]
  if (meta && typeof meta.longTerm === 'boolean') return meta.longTerm
  return !!(loanDocs[batchId] && loanDocs[batchId].longTerm)
}

/** The soonest booking that includes this item (old: getUpcomingLoanForItem). */
export function upcomingFor(e, upcoming = [], testMode = false) {
  const matches = upcoming.filter((u) => (testMode || !isTestBatch(u.id)) &&
    (u.items || []).some((i) => i.id === e.id || i.CHSAssetNo === e.id))
  if (!matches.length) return null
  return matches.sort((a, b) => ((a.startDate || '') < (b.startDate || '') ? -1 : 1))[0]
}

export const STATUSES = [
  { key: 'available', label: 'Available', tone: 'green' },
  { key: 'booked', label: 'Booked', tone: 'purple' },
  { key: 'on-loan', label: 'On loan', tone: 'orange' },
  { key: 'overdue', label: 'Overdue', tone: 'critical' },
  { key: 'longterm', label: 'Long term', tone: 'neutral' },
]

/**
 * Where an item is (old: mpEquipmentStatus, which is what buildStatusCell()
 * and renderTable() use on the desktop too). A booking (a later start, or in
 * upcomingLoans) beats on loan; overdue is on loan past its end date; a test
 * loan is hidden unless test mode is on. `detail` is the short who / when line.
 */
export function statusOf(e, { today = nzDate(), upcoming = [], loanMeta = {}, loanDocs = {}, testMode = false } = {}) {
  const hidden = !testMode && isTestBatch(e.BatchID)
  const scheduled = !hidden && isOut(e) && !!e.LoanStartDate && e.LoanStartDate > today
  const booking = !scheduled && upcomingFor(e, upcoming, testMode)
  if (scheduled || booking) {
    const loanTo = scheduled ? e.OnLoanTo : booking.loanTo
    const startDate = scheduled ? e.LoanStartDate : booking.startDate
    return { key: 'booked', loanTo, startDate, endDate: scheduled ? e.LoanEndDate : booking.endDate }
  }
  const on = !hidden && isOut(e)
  if (on && isLoanLongTerm(e.BatchID, { loanMeta, loanDocs })) return { key: 'longterm', loanTo: e.OnLoanTo }
  if (on && e.LoanEndDate && e.LoanEndDate < today) return { key: 'overdue', loanTo: e.OnLoanTo, endDate: e.LoanEndDate }
  if (on) return { key: 'on-loan', loanTo: e.OnLoanTo, endDate: e.LoanEndDate }
  return { key: 'available' }
}

/**
 * Reconciles our about-to-be-saved equipment and history with another
 * session's fresher save (old: _mergeEquipmentAndHistory, the same rules):
 * fresh wins for a genuinely newer loan or return, ours wins if we have a
 * later start date, and history is a straight union by entry id, so nothing
 * on either side is ever dropped.
 */
export function mergeEquipmentAndHistory(ourData, fresh) {
  const freshEquip = Array.isArray(fresh.equipment) ? fresh.equipment : []
  const freshHistory = Array.isArray(fresh.history) ? fresh.history : []
  const ourEquip = Array.isArray(ourData.equipment) ? ourData.equipment : []
  const ourHistory = Array.isArray(ourData.history) ? ourData.history : []

  const ourMap = {}
  ourEquip.forEach((e) => { if (e.id) ourMap[e.id] = e })
  const merged = freshEquip.map((freshItem) => {
    const ours = ourMap[freshItem.id]
    if (!ours) return freshItem
    delete ourMap[freshItem.id]
    const freshOnLoan = freshItem.OnLoanTo && freshItem.Returned !== 'Yes'
    const ourOnLoan = ours.OnLoanTo && ours.Returned !== 'Yes'
    if (freshOnLoan && !ourOnLoan) return freshItem
    if (!freshOnLoan && ourOnLoan) return ours
    if (freshOnLoan && ourOnLoan) return (ours.LoanStartDate || '') >= (freshItem.LoanStartDate || '') ? ours : freshItem
    return ours
  })
  Object.values(ourMap).forEach((e) => merged.push(e))

  const seenIds = new Set(freshHistory.map((h) => h.id))
  const mergedHistory = [...freshHistory]
  ourHistory.forEach((h) => { if (h.id && !seenIds.has(h.id)) mergedHistory.push(h) })
  // The old tracker's sort, kept as it is: ts is a string, so this compares
  // NaN and leaves the order as merged. Matching it keeps the two identical.
  mergedHistory.sort((a, b) => (b.ts || 0) - (a.ts || 0))
  return { equipment: merged, history: mergedHistory }
}

/** loanMeta keys as Firebase allows them: . # $ [ ] / become _ (as saveBin does). */
export function safeKeys(obj = {}) {
  const out = {}
  Object.entries(obj).forEach(([k, v]) => { out[k.replace(/[.#$[\]/]/g, '_')] = v })
  return out
}

/* ── Showing things ── */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** 2026-10-16 → 16-Oct-2026 (the app's date style). Anything else as it came. */
export function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  return m ? `${Number(m[3])}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : String(s || '')
}

/** Every field an item has, in the old tracker's order (old: MF), with its label. */
export const FIELDS = [
  ['CHSAssetNo', 'CHS asset no.'], ['Model', 'Model'], ['Description', 'Description'], ['SerialNo', 'Serial no.'],
  ['PartNo', 'Part no.'], ['MfgDate', 'Manufactured'], ['PurchaseDate', 'Purchased'], ['USPrice', 'US price'],
  ['NZPrice', 'NZ price'], ['TileNo', 'Tile no.'], ['OnLoanTo', 'On loan to'], ['Location', 'Location'],
  ['LoanStartDate', 'Loan start'], ['LoanEndDate', 'Loan end'], ['Returned', 'Returned'], ['Counted', 'Counted'],
  ['Notes', 'Notes'], ['ShelfLocation', 'Shelf location'], ['DeviceID', 'Device ID'], ['LanMAC', 'LAN MAC'],
  ['WlanMAC', 'WLAN MAC'], ['OldCHS', 'Old CHS no.'], ['TileType', 'Tile type'], ['BorrowerEmail', 'Borrower email'],
  ['TileUUID', 'Tile UUID'], ['BatterySerialNo', 'Battery serial no.'],
]

/* ── Search: forgiving, and logical ──
   A word matches when it is somewhere in the text exactly (accents ignored: "whangarei" finds Whangārei),
   or when it matches with spaces and punctuation ignored ("epm12" finds "ePM 12M", "ac9 0400" finds "AC9-0400"),
   or, for a plain word, with a slip of a letter or two in the places people look
   things up by ("waikatoo", "benehart", "ultrasuond"). A word with a digit in it never gets a guess (asset and
   serial numbers, "tv80"): a wrong digit is a different device. A search finds an item only if every word matches; exact matches always come
   before close ones. */

/** Lower case with accents removed. */
const fold = (v) => String(v ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
/** Only letters and digits. */
const squash = (s) => s.replace(/[^a-z0-9]+/g, '')

/** How many slips a word is allowed: none for short words or any word with a digit; one up to 7 letters; two beyond. */
function slipsAllowed(w) {
  if (!/^[a-z]+$/.test(w) || w.length < 4) return 0
  return w.length < 8 ? 1 : 2
}

/**
 * The fewest slips (a letter wrong, missing, extra, or two swapped) with which `w` is somewhere inside `text`,
 * if that is at most `max`; else -1. (Sellers' algorithm with swaps.)
 */
function slipsInside(w, text, max) {
  const n = w.length, m = text.length
  if (!n || !m) return -1
  let prev2 = null, prev = new Array(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    const cur = new Array(m + 1)
    cur[0] = i
    for (let j = 1; j <= m; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (w[i - 1] === text[j - 1] ? 0 : 1))
      if (i > 1 && j > 1 && w[i - 1] === text[j - 2] && w[i - 2] === text[j - 1]) v = Math.min(v, prev2[j - 2] + 1)
      cur[j] = v
    }
    prev2 = prev; prev = cur
  }
  const best = Math.min(...prev.slice(1))
  return best <= max ? best : -1
}

/** A record's text ready to search: every value (`all`), and the few fields a slip is forgiven in (`near`). */
const prepare = (all, near) => ({
  hay: all.map(fold).join(' '),
  squashed: all.map((v) => squash(fold(v))).filter(Boolean),
  near: near.map((v) => squash(fold(v))).filter(Boolean),
})

/** 0 for an exact match of `w`, 1–2 for a close one, -1 for none. */
function wordMatch(w, doc) {
  if (doc.hay.includes(w)) return 0
  const sq = squash(w)
  if (!sq) return 0 // punctuation on its own says nothing
  if (doc.squashed.some((t) => t.includes(sq))) return 0
  const max = slipsAllowed(sq)
  if (!max) return -1
  let best = -1
  for (const t of doc.near) {
    const d = slipsInside(sq, t, max)
    if (d >= 0 && (best < 0 || d < best)) best = d
  }
  return best
}

/** The total slips over every word (0 = all exact), or -1 if a word isn't there at all. */
function docMatch(words, doc) {
  let total = 0
  for (const w of words) {
    const d = wordMatch(w, doc)
    if (d < 0) return -1
    total += d
  }
  return total
}

const searchWords = (q) => fold(q).trim().split(/\s+/).filter(Boolean)
const NEAR_EQUIPMENT = ['Model', 'Description', 'CHSAssetNo', 'OnLoanTo', 'Location']

/** An item's rank for these words (lower is better) and whether it needed a guess, or null if it doesn't match. */
function equipmentMatch(e, words) {
  // Every field, as the old search (Object.values): MACs, device IDs, battery serials and the rest too.
  const values = Object.entries(e).filter(([k, v]) => !k.startsWith('_') && (typeof v === 'string' || typeof v === 'number')).map(([, v]) => v)
  const slips = docMatch(words, prepare(values, NEAR_EQUIPMENT.map((k) => e[k])))
  if (slips < 0) return null
  if (slips > 0) return { r: 10 + slips, close: true }
  const has = (v) => docMatch(words, prepare([v], [])) === 0
  if (has(e.Model)) {
    const m = squash(fold(e.Model)), asked = squash(words.join(''))
    return { r: m === asked ? 0 : m.startsWith(asked) ? 1 : 2, close: false }
  }
  if (has(e.CHSAssetNo)) return { r: 3, close: false }
  if (has(e.SerialNo)) return { r: 4, close: false }
  return { r: 5, close: false }
}

const byAssetNo = (a, b) => String(a.CHSAssetNo ?? '').localeCompare(String(b.CHSAssetNo ?? ''), undefined, { numeric: true })

/**
 * Search across what people look an item up by. Every word must match somewhere (see above: accents, spacing and a
 * slip or two are forgiven). Best matches first: the model (exactly it first, then starting with it), then the asset
 * number, then the serial number, then anything else (description, location, who it's on loan to...); within each,
 * by asset number. Close matches (a guess was needed) come after every exact one, fewest slips first.
 */
export function searchEquipment(list, q) {
  const words = searchWords(q)
  if (!words.length) return list
  return list.map((e) => ({ e, m: equipmentMatch(e, words) })).filter((x) => x.m)
    .sort((a, b) => a.m.r - b.m.r || byAssetNo(a.e, b.e))
    .map((x) => x.e)
}

/** This item's history, newest first (by its string timestamp). */
export function historyFor(e, history = []) {
  return history.filter((h) => h.chsAssetNo === e.CHSAssetNo)
    .sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')))
}

/* ── Loans (old: renderLoans and its helpers) ── */

/** Starts within 3 business days in the North Island, else 5, or already has (old: isStartingSoon). */
export function isStartingSoon(today, startDate, island) {
  if (!startDate) return false
  if (startDate <= today) return true
  let businessDays = 0
  let cur = today
  while (cur < startDate) {
    const [y, m, d] = cur.split('-').map(Number)
    const next = new Date(Date.UTC(y, m - 1, d + 1))
    cur = next.toISOString().slice(0, 10)
    const dow = next.getUTCDay()
    if (dow !== 0 && dow !== 6) businessDays++
  }
  return businessDays <= (island === 'North' ? 3 : 5)
}

/**
 * How far ahead an upcoming loan counts as "starting soon" on the Loans tab: a week in the North Island, a fortnight
 * otherwise. A loan whose island isn't set is treated as South: better one too many than one missed.
 */
export const soonWindowDays = (island) => (island === 'North' ? 7 : 14)

/** An upcoming loan or booking that starts within its island's window, or should already have started. */
export function startsSoon(g, today = nzDate()) {
  return !!g.startDate && daysBetween(today, g.startDate) <= soonWindowDays(g.island)
}

/** Whole days from a to b (YYYY-MM-DD). */
export function daysBetween(a, b) {
  if (!a || !b) return 0
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000)
}

// Old loans with no BatchID keep their form and account manager under this key.
const legacyKeys = (loanTo, endDate) => [
  'loandoc_' + encodeURIComponent((loanTo || '') + '|||' + (endDate || '')),
  'loandoc_' + (loanTo || '') + '|||' + (endDate || ''),
]

/** A loanMeta key as the database can hold it (old: saveLoanMeta): . # $ [ ] / become _. */
export const metaKey = (k) => String(k || '').replace(/[.#$[\]/]/g, '_')

/** A loan's account manager (old: getLoanAM, then getGroupAM's fallback). */
export function loanAM({ batchId, loanTo, endDate, accountManager }, { loanMeta = {}, loanDocs = {} } = {}) {
  if (batchId && loanMeta[batchId]?.accountManager) return loanMeta[batchId].accountManager
  if (loanTo) {
    const [enc, dec] = legacyKeys(loanTo, endDate)
    const found = loanMeta[metaKey(enc)]?.accountManager || loanMeta[enc]?.accountManager || loanMeta[dec]?.accountManager || loanDocs[enc]?.accountManager || loanDocs[dec]?.accountManager
    if (found) return found
  }
  return accountManager || ''
}

/** A loan's form: by its BatchID, else by the old key. */
export function loanDocFor(g, loanDocs = {}) {
  if (g.batchId && loanDocs[g.batchId]) return loanDocs[g.batchId]
  const [enc, dec] = legacyKeys(g.loanTo, g.endDate)
  return loanDocs[enc] || loanDocs[dec] || null
}

/**
 * The Loans tab's sections, as the old renderLoans builds them:
 *  - items out are grouped by BatchID (old items without one: customer,
 *    location and end date); a later start date makes the loan scheduled;
 *  - a booking in upcomingLoans with the same id as a loan is that loan's
 *    pending items, not a loan of its own;
 *  - needsReassign: started loans still waiting on pending items (not long
 *    term); upcoming: the scheduled loans, then the bookings left over;
 *    current: everything else that isn't long term; longTerm.
 * Test loans are left out unless test mode is on. Each loan carries its
 * account manager, its form's island and notes, whether it's overdue or
 * starting soon, and ghosts: items since transferred to another loan.
 */
export function loanSections({ equipment = [], upcoming = [], loanMeta = {}, loanDocs = {}, today = nzDate(), testMode = false, team = [] } = {}) {
  const ctx = { loanMeta, loanDocs }
  const onLoan = equipment.filter((e) => isOut(e) && !(!testMode && isTestBatch(e.BatchID)))
  const grouped = new Map(), scheduledGrouped = new Map()
  for (const e of onLoan) {
    const scheduled = !!e.LoanStartDate && e.LoanStartDate > today
    const target = scheduled ? scheduledGrouped : grouped
    const key = e.BatchID || (e.OnLoanTo + '|||' + (e.Location || '') + '|||' + (e.LoanEndDate || ''))
    if (!target.has(key)) {
      target.set(key, { key, kind: scheduled ? 'scheduled' : 'loan', batchId: e.BatchID || '', loanTo: e.OnLoanTo, location: e.Location || '',
        startDate: e.LoanStartDate || '', endDate: e.LoanEndDate || '', items: [], pending: [], ghosts: [] })
    }
    target.get(key).items.push(e)
  }
  const finish = (g) => {
    const doc = loanDocFor(g, loanDocs)
    g.am = amName(loanAM(g, ctx), g.items[0]?.BorrowerEmail || g.email || '', team)
    g.longTerm = isLoanLongTerm(g.batchId, ctx)
    g.island = doc?.island || ''
    g.notes = doc ? (doc.notesCell || doc.notes || '') : ''
    g.doc = doc || null
    g.overdue = !g.longTerm && !!g.endDate && g.endDate < today
    g.startingSoon = isStartingSoon(today, g.startDate, g.island)
    return g
  }
  const loans = [...grouped.values()].map(finish)
  const scheduled = [...scheduledGrouped.values()].map(finish)

  // Items transferred out still show on the loan they left, marked as such.
  for (const e of equipment.filter((x) => x._transferNote && isOut(x))) {
    const tn = e._transferNote
    const from = loans.find((g) => (tn.fromBatchId && g.items[0]?.BatchID === tn.fromBatchId) ||
      (g.loanTo === tn.fromLoanTo && (g.endDate || '') === (tn.fromEndDate || '')))
    if (from && !from.ghosts.some((x) => x.id === e.id)) from.ghosts.push(e)
  }

  const merged = new Set()
  for (const g of [...loans, ...scheduled]) {
    const u = g.batchId && upcoming.find((x) => x.id === g.batchId)
    if (u) { g.pending = u.items || []; merged.add(u.id) }
  }
  const bookings = upcoming
    .filter((u) => (testMode || !isTestBatch(u.id)) && !merged.has(u.id))
    .map((u) => finish({ key: u.id, kind: 'booking', batchId: u.id, loanTo: u.loanTo || '', location: u.location || '', startDate: u.startDate || '',
      endDate: u.endDate || '', accountManager: u.accountManager || '', email: u.borrowerEmail || '', items: [], pending: u.items || [], ghosts: [] }))

  return {
    needsReassign: loans.filter((g) => g.pending.length && !g.longTerm),
    upcoming: [...scheduled, ...bookings],
    current: loans.filter((g) => !g.longTerm && !g.pending.length),
    longTerm: loans.filter((g) => g.longTerm),
  }
}

/** The Loans tab's search, account manager filter and sorts (old: renderLoans' toolbar). */
export function filterLoans(list, { q = '', am = '', overdueOnly = false, sort = 'added' } = {}, today = nzDate()) {
  const s = q.toLowerCase()
  const out = list.filter((g) => (!s || g.loanTo.toLowerCase().includes(s) || g.location.toLowerCase().includes(s)) &&
    (!am || g.am === am) && (!overdueOnly || (g.endDate && g.endDate < today)))
  const by = {
    manager: (a, b) => { const ma = (a.am || 'zzz').toLowerCase(), mb = (b.am || 'zzz').toLowerCase(); return ma !== mb ? (ma < mb ? -1 : 1) : (b.startDate || '0000').localeCompare(a.startDate || '0000') },
    recent: (a, b) => (b.startDate || '0000').localeCompare(a.startDate || '0000'),
    alpha: (a, b) => a.loanTo.localeCompare(b.loanTo),
    expiry: (a, b) => ((a.endDate || '9999') < (b.endDate || '9999') ? -1 : 1),
    start: (a, b) => ((a.startDate || '') < (b.startDate || '') ? -1 : 1),
  }[sort]
  return by ? out.sort(by) : out
}

/* ── A loan card's details (old: buildActiveLoanCard and its helpers) ── */

/** Where a loan's testing and dispatch are kept in loanMeta (old: _readinessKey). */
export function readinessKey(g) {
  if (g.batchId) return g.batchId
  return ('loandoc_' + encodeURIComponent((g.loanTo || '') + '|||' + (g.endDate || ''))).replace(/[.#$[\]/]/g, '_')
}

/**
 * The loans that have test reports, by readiness key, from testReports as the old database kept it
 * ({ key: { reportId: details } }; old: _testReportsKeys): their Test reports button is marked. A loan
 * with none left is left out (Firestore gives {} for it, the old database nothing).
 */
export function reportKeysOf(testReports) {
  return Object.entries(testReports || {}).filter(([, r]) => r && typeof r === 'object' && Object.keys(r).length).map(([k]) => k)
}

/**
 * Testing and dispatch, as the old card shows them (old: buildReadinessButtons,
 * its read-only part): "No test required", or a "Not tested" warning for a
 * loan that started in the last 7 days untested; Tested and Dispatched with
 * when, once set. The buttons that set them come with the loan actions.
 */
export function readinessOf(g, { loanMeta = {}, today = nzDate() } = {}) {
  const r = loanMeta[readinessKey(g)] || {}
  const started = !!g.startDate && g.startDate <= today
  const recent = !!g.startDate && daysBetween(g.startDate, today) <= 7
  return {
    noTestRequired: !!r.noTestRequired,
    notTested: !r.noTestRequired && started && recent && !r.tested,
    tested: r.tested ? (r.testedAt || true) : null,
    dispatched: r.dispatched ? (r.dispatchedAt || true) : null,
  }
}

/** An NZ stamp (nzNow): clock time, then +12:00 or +13:00. Old ones say +12:00 all year, so the clock time is what's right. */
const NZ_STAMP = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?\+1[23]:00$/

/**
 * "15 Oct, 17:40", or "15 Oct 2026, 17:40" with year (old: _fmtReadinessTs). NZ stamps
 * show their clock time as written: the old ones are marked +12:00 even in daylight
 * saving, so read as a moment they'd come out an hour late. Anything else (a UTC time)
 * is converted to NZ time.
 */
export function fmtWhen(ts, { year = false } = {}) {
  if (!ts || ts === true) return ''
  const m = NZ_STAMP.exec(String(ts))
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}${year ? ' ' + m[1] : ''}, ${m[4]}:${m[5]}`
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10)
  return d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), hour: '2-digit', minute: '2-digit', hour12: false })
}

/** The Simpro job on a loan's form: "Job #209677", "(Closed)" once closed, or pending while it's made. */
export function jobOf(doc) {
  const sj = doc?.simproJobId
  if (!sj) return null
  if (typeof sj === 'object') return { label: 'Simpro job being made', pending: true }
  return { label: 'Job #' + sj, closed: !!doc.simproClosedAt, test: String(sj).startsWith('TEST-') }
}

/* ── Overview: the phone's two home screens in one (old: mpRenderToday for
   account managers, mpRenderOverview for Service & Projects) ── */

/** The signed-in person's tracker team record: by name, else by email (old: matchStaffOperator). */
export function memberFor(user, managers = []) {
  if (!user) return null
  const name = (user.displayName || '').trim().toLowerCase(), email = (user.email || '').toLowerCase()
  return (name && managers.find((a) => (a.name || '').trim().toLowerCase() === name)) ||
    (email && managers.find((a) => (a.email || '').toLowerCase() === email)) || null
}

/**
 * The team member a loan's account manager is: by name, else by the email the
 * loan was made with (BorrowerEmail, a booking's borrowerEmail). Loans keep the
 * name typed or picked when they were made, which can differ from the person's
 * hub name ("Jessica Broughan" vs "Jess Broughan"); the email doesn't. The
 * proxy's reminders do the same (amFor_ in backend/apps-script/proxy/Code.js).
 */
export function teamMemberFor(name, email, team = []) {
  const n = String(name || '').trim().toLowerCase(), e = String(email || '').trim().toLowerCase()
  return (n && team.find((m) => (m.name || '').trim().toLowerCase() === n)) ||
    (e && team.find((m) => (m.email || '').trim().toLowerCase() === e)) || null
}
/** The name to show and filter a loan by: its team member's hub name when there is one, else as stored. */
export const amName = (name, email, team = []) => teamMemberFor(name, email, team)?.name || name || ''

/** 'am' (account manager) or 'service' (Service & Projects) (old: amEffectiveRole). */
export const roleOf = (m) => (m ? (m.role === 'service' ? 'service' : 'am') : '')

/**
 * Everyone's loans at a glance, from loanSections' groups:
 *   active      started loans (needs reassigning, current, long term)
 *   ahead       not started yet: scheduled loans, and bookings with a date and
 *               devices, starting after today (old: mpAllUpcoming)
 *   stuck       bookings whose start has come with devices still out on
 *               another loan: "transfers due" (old: mpStuckLoans)
 *   needsTesting  scheduled loans not yet tested or marked no test required
 *   out / dueToday / overdueOut  devices, for the utilisation bar
 *   byAM        active loans per account manager, with how many are overdue
 * Overdue is the Loans tab's (a long-term loan never is), so the numbers agree.
 */
export function overviewOf(sections, { equipment = [], upcoming = [], loanMeta = {}, loanDocs = {}, today = nzDate(), testMode = false, team = [] } = {}) {
  const active = [...sections.needsReassign, ...sections.current, ...sections.longTerm]
  const ahead = sections.upcoming
    .filter((g) => (g.kind === 'scheduled' || (g.startDate && g.pending.length)) && (!g.startDate || g.startDate > today))
  // A booking held up only by devices on long-term loans isn't chased: that's a known, deliberate state (old: checkStuckLoansForAM).
  const blockers = (u) => (u.items || []).map((i) => equipment.find((e) => e && (e.id === i.id || e.CHSAssetNo === i.CHSAssetNo) && isOut(e) && e.OnLoanTo !== u.loanTo)).filter(Boolean)
  const stuck = upcoming.filter((u) => (testMode || !isTestBatch(u.id)) && u.startDate && u.startDate <= today)
    .filter((u) => { const b = blockers(u); return !(b.length && b.every((e) => isLoanLongTerm(e.BatchID, { loanMeta, loanDocs }))) })
    .map((u) => ({ ...u, accountManager: amName(u.accountManager, u.borrowerEmail, team) }))
  const needsTesting = ahead.filter((g) => {
    if (g.kind === 'booking') return false // nothing reserved yet, so nothing to test
    const r = loanMeta[readinessKey(g)] || {}
    return !r.tested && !r.noTestRequired
  })
  // Not started yet and starting within the week (North) or fortnight (South) the Loans tab calls "Starting soon": soonest first.
  const soon = sections.upcoming.filter((g) => g.startDate && g.startDate >= today && startsSoon(g, today))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.loanTo.localeCompare(b.loanTo))
  const devices = (list) => list.reduce((n, g) => n + g.items.length, 0)
  const overdue = active.filter((g) => g.overdue)
  const dueToday = active.filter((g) => !g.overdue && g.endDate === today)
  const byAM = new Map()
  for (const g of active) {
    const am = g.am || 'Unassigned'
    const v = byAM.get(am) || { am, n: 0, overdue: 0 }
    v.n++; if (g.overdue) v.overdue++
    byAM.set(am, v)
  }
  return {
    total: equipment.filter((e) => testMode || !isTestBatch(e.BatchID)).length,
    active, ahead, soon, stuck, needsTesting, overdue,
    out: devices(active), dueTodayOut: devices(dueToday), overdueOut: devices(overdue),
    byAM: [...byAM.values()].sort((a, b) => a.am.localeCompare(b.am)),
  }
}

/** One account manager's part of it (old: mpRenderToday): their loans, what needs doing, what's coming. */
export function yoursOf(ov, name) {
  const active = ov.active.filter((g) => g.am === name)
  return {
    active,
    overdue: active.filter((g) => g.overdue),
    ahead: ov.ahead.filter((g) => g.am === name && g.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate)),
    stuck: ov.stuck.filter((u) => u.accountManager === name),
  }
}

/**
 * How many things need this person (old: mpActionRequiredCount, the tab and app-icon badge):
 * bookings waiting on a transfer and overdue loans, their own for an account manager,
 * everyone's for Service & Projects; none for someone not on the tracker's team.
 */
export function actionCount(ov, me) {
  if (!me) return 0
  if (roleOf(me) === 'service') return ov.stuck.length + ov.overdue.length
  const y = yoursOf(ov, me.name)
  return y.stuck.length + y.overdue.length
}

/* ── Changes (the loan actions). The old tracker's ways of recording them,
   kept so both trackers read each other's changes. ── */

/**
 * A timestamp: NZ wall-clock time with NZ's offset at that moment, "2026-11-24T16:26:00+13:00" in
 * daylight saving, "+12:00" otherwise. The old tracker's nzNow (and this one until 24 Nov 2026)
 * marked every one +12:00, so read stamps with stampMs or fmtWhen, never new Date(). The clock
 * time comes first, as before, so stamps still sort, and compare with a day, as text.
 */
export const nzNow = (d = new Date()) => {
  const wall = d.toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' }).replace(' ', 'T')
  const min = Math.round((Date.parse(wall + 'Z') - d.getTime()) / 60000)
  return wall + (min < 0 ? '-' : '+') + String(Math.floor(Math.abs(min) / 60)).padStart(2, '0') + ':' + String(Math.abs(min) % 60).padStart(2, '0')
}

/** A stamp for an NZ clock time ("2026-11-24T16:26", seconds optional), with the offset NZ had then: the readiness dialog's picked date and time. */
export function nzStampAt(wall) {
  const w = /T\d{2}:\d{2}$/.test(wall) ? wall + ':00' : wall
  for (const off of ['+13:00', '+12:00']) {
    const t = Date.parse(w + off)
    if (!Number.isNaN(t) && nzNow(new Date(t)) === w + off) return w + off
  }
  return w + '+12:00' // the hour that daylight saving skips
}

/**
 * When a stamp happened, in ms (NaN for none). An NZ stamp (+12:00 or +13:00) is read by its clock
 * time, since old ones say +12:00 even in daylight saving; anything else (a UTC time) as it is.
 */
export function stampMs(ts) {
  if (typeof ts === 'number') return ts
  const m = NZ_STAMP.exec(String(ts || ''))
  if (!m) return ts ? Date.parse(ts) : NaN
  return Date.parse(nzStampAt(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] || '00'}`))
}

/** A new record id, as the old tracker's uid(): starts with the time, so ids sort by when. */
export const newId = () => 'id_' + Date.now() + '_' + Math.random().toString(36).slice(2)

/**
 * Which testing and dispatch buttons a loan card offers (old: buildReadinessButtons).
 * Upcoming loans always offer them; a started loan only in its first 7 days.
 * One already set always shows, with when, so it can be undone. Skip
 * ("no test required") is offered only while nothing's decided.
 */
export function readinessButtons(g, { loanMeta = {}, today = nzDate() } = {}) {
  const r = loanMeta[readinessKey(g)] || {}
  const upcomingKind = g.kind === 'scheduled' || g.kind === 'booking'
  const open = upcomingKind || (!!g.startDate && g.startDate <= today && daysBetween(g.startDate, today) <= 7)
  return {
    noTestRequired: !!r.noTestRequired ? { on: true, at: r.noTestRequiredAt || '' } : null,
    skip: open && !r.tested && !r.noTestRequired,
    tested: !r.noTestRequired && (open || r.tested) ? { on: !!r.tested, at: r.testedAt || '' } : null,
    dispatched: open || r.dispatched ? { on: !!r.dispatched, at: r.dispatchedAt || '' } : null,
  }
}

/** A readiness entry with one field set or cleared (old: toggleReadiness / confirmReadinessDate). */
export const withReadiness = (r = {}, field, on, at) => ({ ...r, [field]: on, [field + 'At']: on ? (at || nzNow()) : '' })

/** Whether a loan offers Extend: not long term (that one is "Return to active"), and has items or a booking. */
export const canExtend = (g) => !g.longTerm && (g.kind === 'booking' || g.items.length > 0)

/** Why a new end date can't be used, or '' (old: confirmExtendLoan's checks). */
export function extendProblem(g, newDate) {
  if (!newDate) return 'Choose the new end date.'
  if (g.endDate && newDate <= g.endDate) return 'The new date must be after the current end date.'
  return ''
}

/** The equipment with this loan's devices due back on the new date. */
export const extendEquipment = (equipment, g, newDate) => {
  const ids = new Set(g.items.map((e) => e.id))
  return equipment.map((e) => (e && ids.has(e.id) ? { ...e, LoanEndDate: newDate } : e))
}

/**
 * Whether Extend changes a booking's end date too: a booking's own, or the booking a loan keeps under its BatchID
 * for the devices still waiting for it (loanSections' g.pending: "needs reassign", or a scheduled loan short of a
 * device). activateBookings gives each waiting device the booking's endDate as it starts, so a booking left on the
 * old date would start them with it. Never a long-term loan's (that one is "Return to active").
 * (Until 25-Nov-2026 only a booking's own end date was changed.)
 */
export const extendsBooking = (g) => !!g.batchId && !g.longTerm && (g.kind === 'booking' || (g.pending || []).length > 0)

/** The bookings after Extend: the one it changes (extendsBooking) on the new end date; the same list when there's none. */
export function extendedBookings(upcoming, g, newDate) {
  if (!extendsBooking(g) || !upcoming.some((u) => u.id === g.batchId)) return upcoming
  return upcoming.map((u) => (u.id === g.batchId ? { ...u, endDate: newDate } : u))
}

/** Where a loan's form is kept for a given end date: its BatchID, else the old key, which has the end date in it. */
export const loanDocKey = (g, endDate = g.endDate) => g.batchId || legacyKeys(g.loanTo, endDate)[0]

/**
 * A loan's stored form after Extend: the new end date (YYYY-MM-DD, as formDoc keeps it). The form shows its own
 * end date over the loan's (formFromDoc), and its Save puts that date on the devices, the booking and the Simpro
 * job, so a form left with the old date would undo the Extend. No form, a long-term one (no end date) or one
 * already on that date: given back as it is, so nothing is saved (store.jsx changeLoanDoc).
 * (Until 25-Nov-2026 only a form kept under the old key, which moves to the new date, got it; one under a BatchID didn't.)
 */
export function extendedForm(doc, newDate) {
  const to = toISO(newDate || '')
  if (!doc || doc.longTerm || !to || toISO(doc.endDate || '') === to) return doc
  return { ...doc, endDate: to }
}

/* ── Return, and the bookings it can start (old: confirmBatchReturn,
   activateUpcomingLoans / _tryActivateUpcomingLoan) ── */

/** A new BatchID, as the old newBatchId(): 'testbatch_' in test mode. */
export const newBatchId = (testMode = false) => (testMode ? 'testbatch_' : 'batch_') + Date.now()

/**
 * Devices back in the office: each one's loan cleared and marked returned,
 * with a Return entry in the history (newest first, as the old logHistory).
 * Also says what each was on, for the follow-ups (returnFollowUps).
 */
export function returnEquipment(equipment, history, ids, { today = nzDate(), ts = nzNow(), operator = '' } = {}) {
  const want = new Set(ids), returned = [], entries = []
  const next = equipment.map((e) => {
    if (!e || !want.has(e.id) || !isOut(e)) return e
    returned.push({ id: e.id, CHSAssetNo: e.CHSAssetNo, batchId: e.BatchID || '', loanTo: e.OnLoanTo, endDate: e.LoanEndDate || '' })
    entries.push({ operator, id: newId(), ts, chsAssetNo: e.CHSAssetNo, model: e.Model, action: 'Return', loanTo: e.OnLoanTo, location: e.Location, notes: 'Returned ' + oldDate(today) })
    return { ...e, OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', Returned: 'Yes', BatchID: '', _transferNote: null }
  })
  return { equipment: next, history: [...entries.reverse(), ...history], returned }
}

/**
 * After a return: a loan with nothing left out has its Simpro job closed and
 * its form removed; one with devices still out has the returned ones taken
 * off its form. A loan from before BatchIDs (keyed by customer and end date)
 * is only ever closed, as the old one does.
 */
export function returnFollowUps(equipmentAfter, returned) {
  const close = [], prune = [], seen = new Set()
  for (const r of returned) {
    if (r.batchId) {
      if (seen.has(r.batchId)) continue
      seen.add(r.batchId)
      const left = equipmentAfter.some((e) => e && e.BatchID === r.batchId && isOut(e))
      if (left) prune.push({ key: r.batchId, assetNos: returned.filter((x) => x.batchId === r.batchId).map((x) => x.CHSAssetNo) })
      else close.push({ key: r.batchId, loanTo: r.loanTo })
    } else if (r.loanTo && !seen.has('|' + r.loanTo)) {
      seen.add('|' + r.loanTo)
      if (!equipmentAfter.some((e) => e && e.OnLoanTo === r.loanTo && e.Returned !== 'Yes')) close.push({ key: legacyKeys(r.loanTo, r.endDate)[0], loanTo: r.loanTo })
    }
  }
  return { close, prune }
}

/**
 * Bookings whose start has come get the devices that are free now, earliest
 * booking first (old: activateUpcomingLoans). A device still out on someone
 * else's loan stays waiting (no automatic transfer); a booking whose end has
 * passed takes nothing. A device moved from another loan keeps a note, so it
 * shows on that loan as transferred out. Returns the new equipment and
 * history, the changes to make to /upcomingLoans ({ id, items } for what's
 * still waiting, { id, remove: true } once all are out, and { id, items,
 * entry } for a booking that has to be made) and audit entries.
 *
 * A device "out" on a loan that hasn't started yet, with dates that don't
 * clash, isn't really out: the booking takes it, and that loan keeps its
 * claim as a booking (deferToIncumbent), as planNewLoan does. Without this
 * such a booking waited forever, since nothing ever comes back from a loan
 * that never left (19 Oct: a 19–20 Oct booking stuck behind five devices
 * pencilled in for a 29 Oct – 9 Nov loan). `only` starts just that booking;
 * `upcoming` should still be all of them, so a loan keeping its claim is
 * added to its existing booking rather than a new one replacing it.
 */
export function activateBookings(equipment, history, upcoming, { today = nzDate(), ts = nzNow(), only = null, loanMeta = {} } = {}) {
  const eq = [...equipment], entries = [], changes = [], audits = []
  let list = [...upcoming]
  const deferred = new Set(), had = new Set(upcoming.map((u) => u.id))
  const due = upcoming.filter((u) => (!only || u.id === only) && u.startDate && u.startDate <= today).sort((a, b) => ((a.startDate || '') < (b.startDate || '') ? -1 : 1))
  for (const u of due) {
    const expired = !!u.endDate && u.endDate < today
    const waiting = []
    let took = false
    for (const item of u.items || []) {
      const idx = eq.findIndex((e) => e && (e.id === item.id || e.CHSAssetNo === item.CHSAssetNo))
      if (idx < 0) continue
      const prev = eq[idx]
      const prevLoanTo = prev.OnLoanTo || ''
      const out = !!prevLoanTo && prevLoanTo !== u.loanTo && prev.Returned !== 'Yes'
      const later = out && !!prev.LoanStartDate && prev.LoanStartDate > today && !datesOverlap(prev.LoanStartDate, prev.LoanEndDate || '', u.startDate, u.endDate || '')
      if (expired || (out && !later)) { waiting.push(item); continue }
      if (later) {
        const d = deferToIncumbent(list, loanMeta, prev, u.loanTo, u.startDate, u.endDate, { ts, operator: null })
        list = d.upcoming; entries.push(d.entry); deferred.add(d.changedId)
      }
      const moved = prevLoanTo && prevLoanTo !== u.loanTo && !later
      if (moved) {
        entries.push({ id: newId(), ts, chsAssetNo: prev.CHSAssetNo, model: prev.Model, action: 'Transfer', loanTo: u.loanTo, location: u.location,
          loanStart: u.startDate, loanEnd: u.endDate, batchId: u.id, operator: null,
          notes: `Auto-transferred from ${prevLoanTo} (${prev.Location || ''}) to ${u.loanTo} (${u.location}) — upcoming loan started ${u.startDate}` })
        audits.push(['items_transferred', `${prev.CHSAssetNo} auto-transferred from ${prevLoanTo} to ${u.loanTo} — upcoming loan started ${u.startDate}`,
          { assetNo: prev.CHSAssetNo, fromLoanTo: prevLoanTo, toLoanTo: u.loanTo, items: [prev.CHSAssetNo] }, 'System (auto)'])
      }
      if (later) {
        audits.push(['items_transferred', `${prev.CHSAssetNo} to ${u.loanTo} (starts ${oldDate(u.startDate)}) first; ${prevLoanTo}'s later loan (starts ${oldDate(prev.LoanStartDate)}) keeps it booked`,
          { assetNo: prev.CHSAssetNo, fromLoanTo: prevLoanTo, toLoanTo: u.loanTo, items: [prev.CHSAssetNo] }, 'System (auto)'])
      }
      eq[idx] ={ ...prev, OnLoanTo: u.loanTo, Location: u.location, LoanStartDate: u.startDate, LoanEndDate: u.endDate, Returned: 'No', BatchID: u.id,
        BorrowerEmail: u.borrowerEmail || '', _upcomingLoanId: null,
        _transferNote: moved ? { fromLoanTo: prevLoanTo, fromLocation: prev.Location || '', fromBatchId: prev.BatchID || '', fromEndDate: prev.LoanEndDate || '',
          toLoanTo: u.loanTo, toStartDate: u.startDate, transferredOn: today } : (prev._transferNote || null) }
      took = true
    }
    if (took) changes.push(waiting.length ? { id: u.id, items: waiting } : { id: u.id, remove: true })
  }
  for (const id of deferred) {
    const x = list.find((y) => y.id === id)
    changes.push(had.has(id) ? { id, items: x.items } : { id, items: x.items, entry: x })
  }
  // The old one logs each as it goes, newest first.
  return { equipment: eq, history: [...entries.reverse(), ...history], changes, audits }
}

/* ── Long term (old: convertLoanToLongTerm, confirmLongTermToActive) ── */

/** Why a long-term loan can't come back with this end date, or '' (old: confirmLongTermModal's checks). */
export function returnToActiveProblem(g, newDate, today = nzDate()) {
  if (!newDate) return 'Choose the new end date.'
  if (newDate < today) return 'The end date can’t be in the past.'
  if (g.startDate && newDate < g.startDate) return 'The end date can’t be before the loan started.'
  return ''
}

/** The date offered for bringing one back: its start if that's still ahead, else today. */
export const suggestedReturnDate = (g, today = nzDate()) => (g.startDate && g.startDate > today ? g.startDate : today)

/** A loan from before BatchIDs: where its form is kept (customer and end date). */
export const legacyLoanDocKey = (loanTo, endDate) => legacyKeys(loanTo, endDate)[0]

/** A date as Simpro wants it (old: _simproPush's _toISO): YYYY-MM-DD from that or DD/MM/YYYY. */
export function toISO(d) {
  if (!d) return ''
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(d)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : d
}

/** A Simpro job number that's real: not missing, not the "being made" placeholder. */
export const jobNumber = (id) => (id != null && typeof id !== 'object' && id !== 'pending' && !Number.isNaN(Number(id)) ? Number(id) : null)

/* ── Edit and delete (old: confirmReassignAM's edit branches, _performDeleteLoan,
   deleteScheduledLoanByKey, deleteUpcomingLoanPrompt) ── */

/** The demo types offered (old: demoTypeOptionsHtml): the fixed ones, the ones people added, and the current one if it's neither. */
export const DEMO_TYPES = ['Conference/Presentation', 'Clinical Trial', 'Hotswap']
export function demoTypeOptions(custom = [], current = '') {
  const known = [...DEMO_TYPES, ...custom.filter((t) => t && !DEMO_TYPES.includes(t))]
  return current && !known.includes(current) ? [...known, current] : known
}

/**
 * A loan's devices with the edited details. As the old edit, a field left
 * blank keeps what it had: only what's filled in changes.
 */
export function editEquipment(equipment, g, f) {
  const nos = new Set(g.items.map((e) => e.CHSAssetNo))
  const set = {
    ...(f.loanTo ? { OnLoanTo: f.loanTo } : {}), ...(f.location ? { Location: f.location } : {}),
    ...(f.startDate ? { LoanStartDate: f.startDate } : {}), ...(f.endDate ? { LoanEndDate: f.endDate } : {}),
    ...(f.email ? { BorrowerEmail: f.email } : {}),
  }
  return equipment.map((e) => (e && nos.has(e.CHSAssetNo) ? { ...e, ...set } : e))
}

/** A booking with the edited details, blanks keeping what it had (old: the upcoming-loan edit). */
export const editBooking = (u, f) => ({
  ...u,
  ...(f.loanTo ? { loanTo: f.loanTo } : {}), ...(f.location ? { location: f.location } : {}),
  ...(f.startDate ? { startDate: f.startDate } : {}), ...(f.endDate ? { endDate: f.endDate } : {}),
  ...(f.am ? { accountManager: f.am } : {}), ...(f.email ? { borrowerEmail: f.email } : {}),
})

/** Why the edited dates can't be saved, or ''. (The old one saved anything; an end before the start breaks every list.) */
export function editProblem(g, f) {
  const start = f.startDate || g.startDate, end = f.endDate || g.endDate
  if (start && end && end < start) return 'The end date is before the start date.'
  return ''
}

/**
 * A loan deleted by an admin: its devices cleared as if returned, each with a
 * Return entry saying so (old: _performDeleteLoan, deleteScheduledLoanByKey).
 */
export function deleteLoanEquipment(equipment, history, g, { ts = nzNow(), operator = '' } = {}) {
  const ids = new Set(g.items.map((e) => e.id)), nos = new Set(g.items.map((e) => e.CHSAssetNo))
  const note = g.kind === 'scheduled' ? 'Scheduled loan deleted by admin' : 'Loan deleted by admin'
  const entries = []
  const next = equipment.map((e) => {
    if (!e || !(ids.has(e.id) || nos.has(e.CHSAssetNo))) return e
    entries.push({ operator, id: newId(), ts, chsAssetNo: e.CHSAssetNo, model: e.Model, action: 'Return', loanTo: e.OnLoanTo, location: e.Location, notes: note })
    return { ...e, OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', Returned: 'Yes', BatchID: '', _transferNote: null }
  })
  return { equipment: next, history: [...entries.reverse(), ...history] }
}

/* ── New loan, add items, transfer (old: submitBatchLoan and its doLoan,
   _doAddItemsToLoan, _doAddItemsToUpcoming, confirmReassignAM's move
   branch, _deferToIncumbentUpcoming) ── */

export const JOB_TYPES = ['Demo', 'PMV - On site', 'PMV - Back to base', 'Repair', 'Install/EquipChk', 'AED']
export const ISLANDS = ['North', 'South']

/** An item by its asset number, however it was typed or scanned. */
export function findAsset(equipment, no) {
  const n = String(no || '').trim().toLowerCase()
  return n ? equipment.find((e) => e && e.CHSAssetNo && e.CHSAssetNo.trim().toLowerCase() === n) : undefined
}

/** Where an asset label's QR code points: this asset's record in the tracker, by its asset number. */
export const LABEL_ORIGIN = 'https://internal.chsnz.co.nz'
export const labelUrl = (assetNo) => `${LABEL_ORIGIN}/equipment/#/equipment?item=${encodeURIComponent(String(assetNo || '').trim())}`

/**
 * What a scanned code means: the asset number inside a label's link (labelUrl, in the address or its
 * #/equipment?item= part), or the code as it is (the older labels hold just the asset number).
 */
export function assetNoFromScan(raw) {
  const text = String(raw || '').trim()
  if (!/^https?:\/\//i.test(text)) return text
  try {
    const u = new URL(text)
    const hash = u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?') + 1) : ''
    return new URLSearchParams(hash).get('item') || new URLSearchParams(u.search).get('item') || text
  } catch { return text }
}

/** An item by its id or its asset number (a label's link carries the number; a loan's row links by id). */
export function findByIdOrNo(equipment, key) {
  const k = String(key || '').trim()
  return k ? equipment.find((e) => e && e.id === k) || findAsset(equipment, k) : undefined
}

/** Two loans' dates overlap (an open end overlaps everything after the start). */
export const datesOverlap = (aStart, aEnd, bStart, bEnd) => (!aEnd || aEnd >= bStart) && (!bEnd || bEnd >= aStart)

/**
 * What a waiting device is held up by, for a loan or booking `g`: null if nothing (free, or already on it);
 * { e, why: 'out' } still out on a loan that has started; { e, why: 'booked' } booked to someone whose dates
 * clash with g's; { e, why: 'later' } booked to someone from after g ends, which doesn't hold g up at all.
 */
export function heldUpBy(e, g, today = nzDate()) {
  if (!e || !isOut(e) || e.BatchID === g.batchId) return null
  if (!e.LoanStartDate || e.LoanStartDate <= today) return { e, why: 'out' }
  return { e, why: datesOverlap(e.LoanStartDate, e.LoanEndDate || '', g.startDate || '', g.endDate || '') ? 'booked' : 'later' }
}

/**
 * Other claims on device `no` whose dates overlap loan or booking `g`: the loan it is on now (if not `g`) and
 * every other booking waiting for it. One device can't be in two places, so each is a clash the tracker points
 * out: two bookings both waiting for one free device (only the earlier gets it when it starts), a booking that
 * starts before the loan holding its device is due back, a loan whose device is wanted by a booking that starts
 * before it ends. [{ kind: 'holding' | 'waiting', id, loanTo, startDate, endDate }], soonest first.
 */
export function clashesFor(no, g, { equipment = [], upcoming = [], testMode = false } = {}) {
  const key = String(no || '').trim().toLowerCase()
  if (!key || !g) return []
  const own = (id) => !!id && (id === g.batchId || id === g.key)
  const overlaps = (start, end) => datesOverlap(start || '', end || '', g.startDate || '', g.endDate || '')
  const out = []
  const e = findAsset(equipment, no)
  if (e && isOut(e) && !own(e.BatchID) && !(!e.BatchID && e.OnLoanTo === g.loanTo) && overlaps(e.LoanStartDate, e.LoanEndDate)) {
    out.push({ kind: 'holding', id: e.BatchID || '', loanTo: e.OnLoanTo, startDate: e.LoanStartDate || '', endDate: e.LoanEndDate || '' })
  }
  for (const u of upcoming) {
    if (!u || own(u.id) || (!testMode && isTestBatch(u.id))) continue
    if (!(u.items || []).some((i) => String(i.CHSAssetNo || '').trim().toLowerCase() === key)) continue
    if (overlaps(u.startDate, u.endDate)) out.push({ kind: 'waiting', id: u.id, loanTo: u.loanTo || '', startDate: u.startDate || '', endDate: u.endDate || '' })
  }
  return out.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''))
}

/** "17-Nov-2026 – 20-Nov-2026", or from a date with no end. */
export const dateRange = (start, end) => (start ? fmtDate(start) : '') + (end ? ` – ${fmtDate(end)}` : start ? ' on' : '')

/**
 * The devices a loan or booking `g` is still waiting on, grouped by the loan holding them (old: openStuckLoanReassign,
 * for every holder, not just the first): [{ key: 'loan:…', from, nos }], in the order the waiting devices are listed.
 * A device booked to someone from after `g` ends doesn't hold it up, so it isn't here.
 */
export function reassignGroups(g, all, equipment = [], today = nzDate()) {
  const groups = []
  for (const p of g.pending || []) {
    const e = equipment.find((x) => x && (x.id === p.id || x.CHSAssetNo === p.CHSAssetNo))
    const held = heldUpBy(e, g, today)
    if (!held || held.why === 'later') continue
    const from = all.find((x) => x !== g && x.kind !== 'booking' && x.items.some((i) => i.id === e.id))
    if (!from) continue
    const key = from.kind + ':' + from.key
    let grp = groups.find((x) => x.key === key)
    if (!grp) groups.push((grp = { key, from, nos: [] }))
    grp.nos.push(e.CHSAssetNo)
  }
  return groups
}

/** A holder's remaining stops as the address carries them (?queue=): '[["loan:b2","100112,100374"], …]'. */
export const encodeQueue = (groups) => (groups.length ? JSON.stringify(groups.map((x) => [x.key, x.nos.join(',')])) : undefined)
export function decodeQueue(text) {
  try {
    const q = JSON.parse(text || '[]')
    return Array.isArray(q) ? q.filter((x) => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && x[1]).map(([key, nos]) => ({ key, nos })) : []
  } catch { return [] }
}

/**
 * Where "reassign" goes for `g`, starting with its holder number `i` (the one clicked): that loan, Transfer open with
 * the devices `g` waits on from it ticked and `g` chosen; the other holders follow one by one (queue).
 */
export function reassignParams(g, groups, i = 0) {
  const first = groups[i], rest = groups.filter((_, j) => j !== i)
  return { open: first.key, act: 'transfer', to: g.kind + ':' + g.key, nos: first.nos.join(','), ...(rest.length ? { queue: encodeQueue(rest) } : {}) }
}

/**
 * The loans a transfer can go to, the best first: those of `am` (the account manager of the loan being fixed), then
 * everyone else's, each A to Z by customer (then soonest start). `mine` marks the first kind.
 */
export function transferTargets(targets, { am = '' } = {}) {
  const who = String(am || '').trim().toLowerCase()
  const mine = (x) => !!who && String(x.am || '').trim().toLowerCase() === who
  return targets.map((x) => ({ x, mine: mine(x) })).sort((a, b) =>
    (b.mine - a.mine) || String(a.x.loanTo || '').localeCompare(String(b.x.loanTo || ''), undefined, { numeric: true, sensitivity: 'base' })
      || String(a.x.startDate || '').localeCompare(String(b.x.startDate || '')))
}

/** A loan in the pickers: kind, customer, when it's due or starts, Simpro job, and its account manager unless it's `am`'s. */
export function loanLabel(x, am = '') {
  const job = jobOf(x.doc)
  const when = x.kind === 'loan' ? (x.endDate ? 'due ' + fmtDate(x.endDate) : 'no end date') : 'starts ' + fmtDate(x.startDate)
  return `${x.kind === 'booking' ? 'Booking' : x.kind === 'scheduled' ? 'Scheduled' : 'Active'}: ${x.loanTo} (${when})${job && !job.pending ? ' · ' + job.label : ''}${x.am && x.am !== am ? ' · ' + x.am : ''}`
}

/** What to tell someone after devices were added to loan `g` (store.addItems' result `r`). */
export function addedText(g, r) {
  const n = r.added.length
  return `${n} ${n === 1 ? 'item' : 'items'} added to ${g.loanTo}`
    + (r.booked?.length ? `; ${r.booked.length} still out elsewhere, booked to follow` : '')
    + (r.moved?.length ? `; taken off ${[...new Set(r.moved.map((e) => e.OnLoanTo))].join(', ')}: their loan form and Simpro job still list ${r.moved.length === 1 ? 'it' : 'them'}` : '')
    + (r.reclaimed?.length ? `; taken from bookings for ${[...new Set(r.reclaimed)].join(', ')}: make sure they’re back in time` : '')
    + '.'
}

/** A loan's slips for these words (0 exact, more is worse), or -1: customer, location, account manager and Simpro job number. */
function loanMatch(x, words) {
  const values = [x.loanTo, x.location, x.am, jobNumber(x.doc?.simproJobId)].filter((v) => v != null && v !== '')
  return docMatch(words, prepare(values, [x.loanTo, x.location, x.am].filter((v) => v != null && v !== '')))
}

/** Every word of `q` is somewhere in the loan's customer, location, account manager or Simpro job number (a slip or two forgiven). */
export function matchLoan(x, q) {
  const words = searchWords(q)
  return !words.length || loanMatch(x, words) >= 0
}

/**
 * Overview's search: the equipment (searchEquipment: asset no., model, serial and every other field) and the
 * loans (matchLoan: customer, location, account manager, job number) looked up by the same words at once.
 * Equipment is best match first; loans exact matches first, then newest start first. Close matches (a slip
 * forgiven) come last in each list, and `close` says how many of each there are (only present when there are some).
 * Nothing typed, nothing found.
 */
export function searchAll(q, { equipment = [], loans = [] } = {}) {
  const words = searchWords(q)
  if (!words.length) return { equipment: [], loans: [] }
  const eq = equipment.filter(Boolean).map((e) => ({ e, m: equipmentMatch(e, words) })).filter((x) => x.m)
    .sort((a, b) => a.m.r - b.m.r || byAssetNo(a.e, b.e))
  const ln = loans.map((g) => ({ g, slips: loanMatch(g, words) })).filter((x) => x.slips >= 0)
    .sort((a, b) => a.slips - b.slips || (b.g.startDate || '0000').localeCompare(a.g.startDate || '0000'))
  const close = { equipment: eq.filter((x) => x.m.close).length, loans: ln.filter((x) => x.slips > 0).length }
  return { equipment: eq.map((x) => x.e), loans: ln.map((x) => x.g), ...(close.equipment || close.loans ? { close } : {}) }
}

/** Why a new loan can't be made yet, or '' (old: submitBatchLoan's checks, in its order). */
export function newLoanProblem(f) {
  if (!String(f.loanTo || '').trim() || !String(f.location || '').trim()) return 'Fill in who it’s on loan to and where.'
  if (!f.startDate) return 'Choose the start date.'
  if (!f.longTerm) {
    if (!f.endDate) return 'Choose the end date.'
    if (f.endDate < f.startDate) return 'The end date is before the start date.'
  }
  if (!f.am) return 'Choose the account manager.'
  if (!f.email || !f.email.includes('@')) return 'Enter the account manager’s email.'
  if (!f.longTerm) {
    if ((f.jobType || 'Demo') === 'Demo' && !f.demoType) return 'Choose the demo type.'
    if (!f.island) return 'Choose the shipping island: it sets how much notice shipping needs.'
  }
  return ''
}

/** A loan to the same customer, place and end date already exists (old: _findExistingLoanMatch): add to that one instead. */
export function existingLoanMatch(equipment, upcoming, f, testMode = false) {
  const lt = String(f.loanTo || '').trim().toLowerCase(), loc = String(f.location || '').trim().toLowerCase()
  return equipment.some((e) => e && isOut(e) && e.OnLoanTo.trim().toLowerCase() === lt && (e.Location || '').trim().toLowerCase() === loc && e.LoanEndDate === f.endDate) ||
    upcoming.some((u) => u && (testMode || !isTestBatch(u.id)) && (u.loanTo || '').trim().toLowerCase() === lt && (u.location || '').trim().toLowerCase() === loc && u.endDate === f.endDate)
}

/**
 * What an asset number would do on a new loan or added to one, for the line
 * under it: not found, free, out on another loan (and whether the dates
 * clash), or booked next for someone.
 */
export function assetStatus(equipment, upcoming, no, { startDate = '', endDate = '', loanTo = '', testMode = false, loanMeta = {}, loanDocs = {}, today = nzDate() } = {}) {
  const e = findAsset(equipment, no)
  if (!e) return { found: false }
  const out = isOut(e) && e.OnLoanTo !== loanTo
  const clash = out && datesOverlap(e.LoanStartDate || '', e.LoanEndDate || '', startDate, endDate)
  const notStarted = out && !!e.LoanStartDate && e.LoanStartDate > today
  // What planNewLoan does with it: on the loan now; booked to follow (still out); or on it now with the later booking keeping its claim.
  const will = !out ? 'now' : notStarted && !clash ? 'reclaim' : 'follow'
  const next = upcomingFor(e, upcoming, testMode)
  // Other bookings already waiting for it on overlapping dates: this loan would clash with them.
  const waiting = clashesFor(no, { loanTo, startDate, endDate }, { equipment, upcoming, testMode }).filter((c) => c.kind === 'waiting' && c.loanTo !== loanTo)
  return { found: true, item: e, out, clash, will, longTerm: out && isLoanLongTerm(e.BatchID, { loanMeta, loanDocs }), next: next && next.loanTo !== loanTo ? next : null, waiting }
}

/**
 * A later loan claims an item that a booking not yet started had first, with
 * dates that don't clash: that booking keeps its claim as a waiting booking
 * instead of losing it (old: _deferToIncumbentUpcoming).
 */
function deferToIncumbent(upcoming, loanMeta, item, newLoanTo, newStart, newEnd, { ts, operator }) {
  const id = item.BatchID || legacyKeys(item.OnLoanTo, item.LoanEndDate || '')[0]
  let list = upcoming
  let u = list.find((x) => x.id === id)
  if (!u) {
    u = { id, loanTo: item.OnLoanTo, location: item.Location || '', startDate: item.LoanStartDate || '', endDate: item.LoanEndDate || '',
      accountManager: loanMeta[id]?.accountManager || '', borrowerEmail: item.BorrowerEmail || '', items: [] }
    list = [...list, u]
  }
  if (!(u.items || []).some((i) => i.CHSAssetNo === item.CHSAssetNo)) {
    const next = { ...u, items: [...(u.items || []), { id: item.id, CHSAssetNo: item.CHSAssetNo, Model: item.Model, SerialNo: item.SerialNo }] }
    list = list.map((x) => (x.id === id ? next : x))
  }
  const entry = { operator, id: newId(), ts, chsAssetNo: item.CHSAssetNo, model: item.Model, action: 'Converted', loanTo: item.OnLoanTo, location: item.Location, batchId: id,
    notes: `Deferred to upcoming — ${newLoanTo}'s earlier, non-overlapping booking (${oldDate(newStart)}${newEnd ? ' – ' + oldDate(newEnd) : ''}) claimed this item first.` }
  return { upcoming: list, entry, changedId: id }
}

/**
 * A new loan (old: doLoan). Each device that's free, or out on a loan whose
 * dates don't clash, goes straight on it; one still out with a clash is
 * booked on it, waiting (the loan's /upcomingLoans entry, under the same
 * BatchID). A device on a loan not started yet but with no clash keeps that
 * loan's claim as a booking. Returns the new equipment, history and
 * bookings, which bookings changed, and what went on it.
 */
export function planNewLoan({ equipment, history, upcoming, loanMeta = {} }, f, assetNos, { batchId, today = nzDate(), ts = nzNow(), operator = '' } = {}) {
  const eq = [...equipment]
  let list = [...upcoming]
  const entries = [], changed = new Set(), skipped = [], reclaimed = []
  const seen = new Set()
  const picked = assetNos.map((no) => findAsset(eq, no)).filter((e) => e && !seen.has(e.id) && seen.add(e.id))
  const direct = [], booked = []
  for (const item of picked) {
    let out = isOut(item) && item.OnLoanTo !== f.loanTo
    if (out && item.LoanStartDate && item.LoanStartDate > today && !datesOverlap(item.LoanStartDate, item.LoanEndDate || '', f.startDate, f.endDate)) out = false
    ;(out ? booked : direct).push(item)
  }
  const loaned = []
  for (const item of direct) {
    const idx = eq.findIndex((e) => e && e.id === item.id)
    const cur = eq[idx]
    if (isOut(cur) && cur.BatchID && cur.BatchID !== batchId) {
      if (datesOverlap(cur.LoanStartDate || '', cur.LoanEndDate || '', f.startDate, f.endDate)) { skipped.push(cur); continue }
      if (cur.LoanStartDate && cur.LoanStartDate > today) {
        reclaimed.push(cur.OnLoanTo)
        const d = deferToIncumbent(list, loanMeta, cur, f.loanTo, f.startDate, f.endDate, { ts, operator })
        list = d.upcoming; entries.push(d.entry); changed.add(d.changedId)
      }
    }
    eq[idx] = { ...cur, OnLoanTo: f.loanTo, Location: f.location, LoanStartDate: f.startDate, LoanEndDate: f.longTerm ? '' : f.endDate, Returned: 'No', BatchID: batchId, BorrowerEmail: f.email }
    entries.push({ operator, id: newId(), ts, chsAssetNo: cur.CHSAssetNo, model: cur.Model, action: 'Loan', loanTo: f.loanTo, location: f.location,
      loanStart: f.startDate, loanEnd: f.longTerm ? '' : f.endDate, notes: f.notes || '', batchId, _pdfKey: batchId })
    loaned.push(eq[idx])
  }
  if (booked.length) {
    list = [...list, { id: batchId, loanTo: f.loanTo, location: f.location, startDate: f.startDate || '', endDate: f.longTerm ? '' : (f.endDate || ''),
      accountManager: f.am, borrowerEmail: f.email, items: booked.map((e) => ({ id: e.id, CHSAssetNo: e.CHSAssetNo, Model: e.Model, SerialNo: e.SerialNo })) }]
    changed.add(batchId)
    for (const item of booked) {
      entries.push({ operator, id: newId(), ts, chsAssetNo: item.CHSAssetNo, model: item.Model, action: 'Loan', loanTo: f.loanTo, location: f.location,
        loanStart: f.startDate, loanEnd: f.longTerm ? '' : f.endDate, notes: (f.notes ? f.notes + ' — ' : '') + `Booked as upcoming (currently on loan to ${item.OnLoanTo})`, batchId, _pdfKey: batchId })
    }
  }
  return { equipment: eq, history: [...entries.reverse(), ...history], upcoming: list, changed: [...changed], loaned: [...loaned, ...booked], booked, skipped, reclaimed }
}

/**
 * Devices added to a loan or a booking (old: the basket's _doBasketAddToLoan,
 * which both the desktop and the phone used; a booking is added to under its
 * own id). Nothing is refused:
 *   - a free device goes straight on, its record written (so a booking's is
 *     claimed, as a scheduled loan under the booking's id);
 *   - to a loan still to come, one out elsewhere is booked to follow, on the
 *     booking under this id (made if there isn't one), unless it's on a loan
 *     not started yet whose dates don't clash, which it's taken from;
 *   - to a loan already started, one out elsewhere is moved straight onto it
 *     (`moved`, for the warning the old one gave);
 *   - one taken from a loan not started yet leaves it a booking (deferToIncumbent).
 */
export function planAddItems({ equipment, history, upcoming, loanMeta = {} }, g, assetNos, { batchId, today = nzDate(), ts = nzNow(), operator = '' } = {}) {
  const eq = [...equipment]
  let list = [...upcoming]
  const entries = [], changed = new Set(), added = [], booked = [], moved = [], reclaimed = []
  const start = g.startDate || today, end = g.endDate || ''
  const future = !!g.startDate && g.startDate > today
  const email = g.items?.[0]?.BorrowerEmail || g.email || ''
  const seen = new Set()
  for (const no of assetNos) {
    const idx = eq.findIndex((e) => e && e.CHSAssetNo && e.CHSAssetNo.trim().toLowerCase() === String(no).trim().toLowerCase())
    if (idx < 0 || seen.has(idx)) continue
    seen.add(idx)
    const cur = eq[idx]
    if (isOut(cur) && cur.BatchID === batchId) continue // already on it
    const out = isOut(cur) && cur.OnLoanTo !== g.loanTo
    const notStarted = out && !!cur.LoanStartDate && cur.LoanStartDate > today
    if (future && out && !(notStarted && !datesOverlap(cur.LoanStartDate, cur.LoanEndDate || '', start, end))) { booked.push(cur); continue }
    if (notStarted) {
      reclaimed.push(cur.OnLoanTo)
      const d = deferToIncumbent(list, loanMeta, cur, g.loanTo, start, end, { ts, operator })
      list = d.upcoming; entries.push(d.entry); changed.add(d.changedId)
    } else if (out) moved.push(cur)
    eq[idx] = { ...cur, OnLoanTo: g.loanTo, Location: g.location, LoanStartDate: start, LoanEndDate: end, Returned: 'No', BatchID: batchId, BorrowerEmail: email }
    entries.push({ operator, id: newId(), ts, chsAssetNo: cur.CHSAssetNo, model: cur.Model, action: 'Loan', loanTo: g.loanTo, location: g.location, loanStart: g.startDate, loanEnd: g.endDate, notes: 'Added to existing loan', batchId })
    added.push(eq[idx])
  }
  if (booked.length) {
    const u = list.find((x) => x.id === batchId) || list.find((x) => x.loanTo === g.loanTo && x.startDate === g.startDate && (x.endDate || '') === (g.endDate || ''))
      || { id: batchId, loanTo: g.loanTo, location: g.location, startDate: g.startDate || '', endDate: g.endDate || '', accountManager: g.am || g.accountManager || '', borrowerEmail: email, items: [] }
    const items = [...(u.items || [])]
    for (const b of booked) {
      if (!items.some((i) => i.CHSAssetNo === b.CHSAssetNo)) items.push({ id: b.id, CHSAssetNo: b.CHSAssetNo, Model: b.Model, SerialNo: b.SerialNo })
      entries.push({ operator, id: newId(), ts, chsAssetNo: b.CHSAssetNo, model: b.Model, action: 'Loan', loanTo: g.loanTo, location: g.location, loanStart: g.startDate, loanEnd: g.endDate, notes: `Booked as upcoming (currently on loan to ${b.OnLoanTo})`, batchId })
    }
    list = list.some((x) => x.id === u.id) ? list.map((x) => (x.id === u.id ? { ...u, items } : x)) : [...list, { ...u, items }]
    changed.add(u.id)
  }
  return { equipment: eq, history: [...entries.reverse(), ...history], upcoming: list, changed: [...changed], added: [...added, ...booked], booked, moved, reclaimed, skipped: [] }
}

/**
 * Devices moved from one loan to another (old: confirmReassignAM, move to an
 * existing loan). The target is a loan (it gets a BatchID if it had none) or
 * a booking (the moved ones come off its waiting list). Each gets a Transfer
 * entry and the target's details.
 */
export function planTransfer({ equipment, history }, g, nos, target, { targetBatchId, ts = nzNow(), operator = '' } = {}) {
  const move = new Set(nos)
  const moved = g.items.filter((e) => move.has(e.CHSAssetNo)), remaining = g.items.filter((e) => !move.has(e.CHSAssetNo))
  const backfill = target.kind !== 'booking' && !target.batchId ? new Set(target.items.map((e) => e.CHSAssetNo)) : new Set()
  const entries = []
  const eq = equipment.map((e) => {
    if (!e) return e
    if (backfill.has(e.CHSAssetNo)) return { ...e, BatchID: targetBatchId }
    if (!move.has(e.CHSAssetNo) || !moved.some((m) => m.id === e.id)) return e
    entries.push({ operator, id: newId(), ts, chsAssetNo: e.CHSAssetNo, model: e.Model, action: 'Transfer', loanTo: target.loanTo, location: target.location,
      loanStart: target.startDate, loanEnd: target.endDate, batchId: targetBatchId,
      notes: `Reassigned from ${g.loanTo} (${g.location || ''}) to ${target.loanTo} (${target.location})` })
    return { ...e, OnLoanTo: target.loanTo, Location: target.location, LoanStartDate: target.startDate, LoanEndDate: target.endDate, BatchID: targetBatchId }
  })
  return { equipment: eq, history: [...entries.reverse(), ...history], moved, remaining }
}

/* ── The loan form (old: generateLoanDoc, saveLoanDocChanges) ── */

/**
 * The devices a loan's form lists (old: openLoanDocForGroup): those on it,
 * then its booking's waiting ones, noted "Awaiting return from …" only when
 * still held up elsewhere; their details come from the equipment list.
 */
export function formItems(g, equipment = []) {
  const live = (i) => equipment.find((e) => e && (e.id === i.id || e.CHSAssetNo === i.CHSAssetNo)) || i
  const items = (g.items || []).map(live)
  const have = new Set(items.map((e) => String(e.CHSAssetNo || '').trim().toLowerCase()))
  for (const i of g.pending || []) {
    const e = live(i)
    const no = String(e.CHSAssetNo || '').trim().toLowerCase()
    if (!no || have.has(no)) continue
    have.add(no)
    items.push({ ...e, _pendingNote: heldUpBy(e, g) && heldUpBy(e, g).why !== 'later' ? `Awaiting return from ${e.OnLoanTo}${e.LoanEndDate ? ` (due ${oldDate(e.LoanEndDate)})` : ''}` : '' })
  }
  return items
}

/** A saved row as [asset, model, description, serial, notes] (old: _parseLoanDocRow). An old 4-column row has no model: it's looked up. */
function parseRow(r, equipment) {
  const s = (v) => String(v ?? '')
  if (r.length >= 5) return [0, 1, 2, 3, 4].map((i) => s(r[i]))
  return [s(r[0]), r.length === 4 ? s(findAsset(equipment, r[0])?.Model) : '', s(r[1]), s(r[2]), s(r[3])]
}

/**
 * A loan form's device rows: [asset, model, description, serial, notes]. Its
 * saved rows if it has them, with any device on the loan since (transferred
 * in, from a booking) added at the bottom, as the old form did; else from the
 * devices, with 3 spare.
 */
export function formRows(doc, items = [], equipment = []) {
  const row = (e) => [e.CHSAssetNo || '', e.Model || '', e.Description || e.Model || '', e.SerialNo || e.PartNo || '', e._pendingNote || '']
  const saved = Array.isArray(doc?.savedRows) ? doc.savedRows.filter((r) => Array.isArray(r) && r.some(Boolean)) : []
  if (!saved.length) return [...items.map(row), ['', '', '', '', ''], ['', '', '', '', ''], ['', '', '', '', '']]
  const rows = saved.map((r) => parseRow(r, equipment))
  const have = new Set(rows.map((r) => r[0].trim().toLowerCase()))
  return [...rows, ...items.filter((e) => e.CHSAssetNo && !have.has(e.CHSAssetNo.trim().toLowerCase())).map(row)]
}

/** Added devices go at the bottom of a form's saved rows, if it has any (old: _doAddItemsToLoan's _mergedSavedRows). */
export function rowsWithAdded(doc, added) {
  if (!Array.isArray(doc?.savedRows) || !doc.savedRows.length) return null
  return [...doc.savedRows, ...added.map((e) => [e.CHSAssetNo || '', e.Model || '', e.Description || e.Model || '', e.SerialNo || e.PartNo || '', ''])]
}

/** Rows without the ones whose asset number is in `nos` (a device that left). */
export const rowsWithout = (rows, nos) => {
  const gone = new Set([...nos].map((n) => String(n || '').trim().toLowerCase()))
  return (rows || []).filter((r) => !gone.has(String(r[0] || '').trim().toLowerCase()))
}

/**
 * The loan form saved (old: saveLoanDocChanges): the whole document, with
 * what the form doesn't show carried over from what's stored (Simpro job,
 * job and demo type, island, long term), so a save never wipes them.
 */
export function formDoc(form, stored = {}, info = {}) {
  const job = jobNumber(stored?.simproJobId) ?? (typeof stored?.simproJobId === 'string' && stored.simproJobId.startsWith('TEST-') ? stored.simproJobId : null)
  const doc = {
    loanTo: form.loanTo || info.loanTo || '', location: form.location || info.location || '',
    startDate: toISO(form.startDate) || info.startDate || '', endDate: toISO(form.endDate) || info.endDate || '',
    accountManager: form.accountManager || info.accountManager || '', contactNumber: form.contactNumber || info.contactNumber || '',
    jobType: info.jobType || stored?.jobType || '', demoType: info.demoType || stored?.demoType || '', island: info.island || stored?.island || '',
    longTerm: typeof info.longTerm === 'boolean' ? info.longTerm : !!stored?.longTerm,
    items: (form.items || []).map((e) => ({ CHSAssetNo: e.CHSAssetNo || '', Model: e.Model || '', Description: e.Description || '', SerialNo: e.SerialNo || '' })),
    savedRows: (form.rows || []).filter((r) => r.some((c) => String(c || '').trim())).map((r) => r.map((c) => String(c || '').trim())),
    notesCell: form.notes || '', authCell: form.shipping || '',
  }
  // Accessories: what the form gives, else what it had (saves that don't know about them keep them).
  const acc = cleanAccessories(form.accessories !== undefined ? form.accessories : stored?.accessories)
  if (acc.length) doc.accessories = acc
  if (job != null) doc.simproJobId = job
  if (stored?.simproClosedAt) doc.simproClosedAt = stored.simproClosedAt
  return doc
}

/**
 * What a loan form save changed, as words for the audit and activity logs (never the text itself):
 * customer, address, dates, account manager, contact number, device rows, accessories, notes, shipping details.
 * `before` is the stored form. Its device rows are compared only once it has saved rows: a new loan's first save
 * (finishing it) writes them from its devices for the first time, which isn't a change anyone made.
 */
export function formChanges(before, after) {
  const b = before || {}, a = after || {}
  const same = (x, y) => String(x ?? '').trim() === String(y ?? '').trim()
  const rowsOf = (d) => JSON.stringify((Array.isArray(d.savedRows) ? d.savedRows : []).map((r) => (r || []).map((c) => String(c ?? '').trim())).filter((r) => r.some(Boolean)))
  const out = []
  if (!same(b.loanTo, a.loanTo)) out.push('customer')
  if (!same(b.location, a.location)) out.push('address')
  if (!same(toISO(b.startDate || ''), toISO(a.startDate || '')) || !same(toISO(b.endDate || ''), toISO(a.endDate || ''))) out.push('dates')
  if (!same(b.accountManager, a.accountManager)) out.push('account manager')
  if (!same(b.contactNumber, a.contactNumber)) out.push('contact number')
  if (Array.isArray(b.savedRows) && rowsOf(b) !== rowsOf(a)) out.push('device rows')
  if (JSON.stringify(cleanAccessories(b.accessories)) !== JSON.stringify(cleanAccessories(a.accessories))) out.push('accessories')
  if (!same(b.notesCell ?? b.notes, a.notesCell ?? a.notes)) out.push('notes')
  if (!same(b.authCell, a.authCell)) out.push('shipping details')
  return out
}

/**
 * What a loan form shows when it opens (LoanForm.jsx): its stored document, else the loan's own details (`info`).
 * The same rule gives a stored document as the form would show it, for formOverStored.
 */
export function formFromDoc(doc, info = {}, items = [], equipment = [], today = '') {
  return {
    loanTo: doc?.loanTo || info.loanTo || '', location: doc?.location || info.location || '',
    startDate: doc?.startDate || info.startDate || today, endDate: info.longTerm ? '' : (doc?.endDate || info.endDate || ''),
    accountManager: doc?.accountManager || info.accountManager || '', contactNumber: doc?.contactNumber || info.contactNumber || '',
    rows: formRows(doc, items, equipment), notes: doc?.notesCell || doc?.notes || '', shipping: doc?.authCell || '', accessories: cleanAccessories(doc?.accessories),
  }
}
const FORM_FIELDS = ['loanTo', 'location', 'startDate', 'endDate', 'accountManager', 'contactNumber', 'rows', 'notes', 'shipping']
const sameValue = (a, b) => JSON.stringify(a ?? '') === JSON.stringify(b ?? '')

/**
 * A loan form saved from what it showed (`opened`: formFromDoc when it opened, or what it last saved), which may
 * be out of date, onto the document stored now (`stored`). Each field the person changed is theirs; every other
 * one is what's stored now, and accessories are merged line by line (mergeAccessories), so a save never puts
 * back what someone else changed meanwhile. The details the form doesn't show (job and demo type, island) are
 * the stored ones too. Gives { form, info } for formDoc. With nothing opened or nothing stored, as they are.
 * (24-Nov-2026: a form opened from an out-of-date copy showed no accessories; saved, it would have written
 * none over the 29 just added, and every other field back as it was.)
 */
export function formOverStored(form, opened, stored, { info = {}, equipment = [], today = '' } = {}) {
  if (!opened || !stored) return { form, info }
  const now = formFromDoc(stored, info, form.items || [], equipment, today)
  const out = { ...form }
  for (const k of FORM_FIELDS) if (sameValue(form[k], opened[k])) out[k] = now[k]
  if (form.accessories !== undefined) out.accessories = mergeAccessories(form.accessories, opened.accessories, stored.accessories)
  const keep = (k) => (stored[k] != null ? stored[k] : info[k])
  return { form: out, info: { ...info, jobType: keep('jobType'), demoType: keep('demoType'), island: keep('island') } }
}

/**
 * A loan's accessories saved from a list that may be out of date: the lines the person added, changed or took
 * off (against `opened`, the list they started from) are applied to the lines stored now (`stored`), so lines
 * someone else saved meanwhile are kept. When nothing changed meanwhile, simply theirs.
 */
export function mergeAccessories(mine, opened, stored) {
  const m = cleanAccessories(mine), o = cleanAccessories(opened), n = cleanAccessories(stored)
  if (sameValue(o, n)) return m
  const key = (a) => (a.code ? accKey(a.code) : 'name:' + a.name.toLowerCase())
  const was = new Map(o.map((a) => [key(a), a])), now = new Map(m.map((a) => [key(a), a]))
  const out = []
  for (const a of n) {
    const k = key(a)
    if (was.has(k) && !now.has(k)) continue                                    // they took it off
    out.push(now.has(k) && !sameValue(now.get(k), was.get(k)) ? now.get(k) : a) // they changed or added it, else as stored
  }
  const have = new Set(out.map(key))
  // What they added, or changed after someone else took it off.
  for (const a of m) if (!have.has(key(a)) && (!was.has(key(a)) || !sameValue(a, was.get(key(a))))) out.push(a)
  return out
}

/**
 * Devices typed into a loan form's table that aren't on the loan. The table is only the printed sheet:
 * a device is put on a loan with Add items, so one typed here is never booked, tracked or returned.
 */
export function formAssetsNotOnLoan(rows = [], items = [], equipment = []) {
  const on = new Set((items || []).map((e) => String(e?.CHSAssetNo || '').trim().toLowerCase()))
  const out = []
  for (const r of rows || []) {
    const no = String(r?.[0] || '').trim()
    if (!no || on.has(no.toLowerCase())) continue
    const e = findAsset(equipment, no)
    if (e && !out.includes(e.CHSAssetNo)) out.push(e.CHSAssetNo)
  }
  return out
}

/* ── Accessories on a loan: cuffs, sensors, lead sets… by code and quantity, kept on its form
   (loanDocs/<key>.accessories, Firestore loans/{key}.form). Optional: a loan with none shows nothing. ── */

const accKey = (code) => String(code || '').toLowerCase().replace(/[\s\-_.]/g, '')

/** A loan's accessories tidied: [{ code, name, qty, stock? }], code or name needed, qty a whole number 1–999, the same code once (quantities added). `stock`: how many of the line came out of stock (Stock tab), left out when none. */
export function cleanAccessories(list) {
  const out = [], at = new Map()
  for (const a of Array.isArray(list) ? list : []) {
    const code = String(a?.code || '').trim(), name = String(a?.name || '').trim()
    if (!code && !name) continue
    const qty = Math.min(999, Math.max(1, Math.round(Number(a?.qty) || 1)))
    const stock = Math.min(999, Math.max(0, Math.round(Number(a?.stock) || 0)))
    const k = code ? accKey(code) : 'name:' + name.toLowerCase()
    if (at.has(k)) { const x = out[at.get(k)]; x.qty = Math.min(999, x.qty + qty); if (stock) x.stock = Math.min(999, (x.stock || 0) + stock); if (!x.name && name) x.name = name; continue }
    at.set(k, out.length)
    out.push({ code, name, qty, ...(stock ? { stock } : {}) })
  }
  return out
}

/* The accessory list (Manage › Accessories): what the picker offers, kept in its own Firestore document,
   settings/equipmentAccessories { items: [{ code, name, group, models }], updatedAt, by }. Codes and names, a
   group (SpO2, NIBP…) and the monitor models each fits; never prices. */

export const ACCESSORY_LIST_MAX = 2000
export const accessoryKey = (a) => (a.code ? accKey(a.code) : 'name:' + String(a.name || '').trim().toLowerCase())
const cut = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/** One list item tidied: { code, name, group, models[] }, or null with neither code nor name. models may be "N17, ePM 12M". */
export function cleanAccessoryItem(x) {
  const code = cut(x?.code, 60), name = cut(x?.name, 200)
  if (!code && !name) return null
  const raw = Array.isArray(x?.models) ? x.models : String(x?.models ?? '').split(/[,;/|\n]+/)
  const models = [...new Set(raw.map((m) => cut(m, 40)).filter(Boolean))].slice(0, 20)
  return { code, name, group: cut(x?.group, 60), models }
}

/** The list tidied: each item once (by code, else by name; a later one wins), by group then name. */
export function cleanAccessoryList(items) {
  const by = new Map()
  for (const x of Array.isArray(items) ? items : []) { const a = cleanAccessoryItem(x); if (a) by.set(accessoryKey(a), a) }
  return [...by.values()].sort((a, b) => (a.group || '~').localeCompare(b.group || '~') || (a.name || a.code).localeCompare(b.name || b.code)).slice(0, ACCESSORY_LIST_MAX)
}

// A spreadsheet's headings, however they're written ("Part No.", "Item code", "Description", "Fits"…).
const HEAD = (h) => String(h || '').toLowerCase().replace(/[^a-z0-9#]+/g, ' ').trim()
const ACC_HEADINGS = [
  ['code', /^(code|item code|part ?(no|number|#)|part|product code|sku|cat(alogue)? ?(no|number)|order code|ref(erence)?|mindray code|accessory code)$/],
  ['name', /^(name|accessory|accessory name|item|item name|product|product name|description|item description)$/],
  ['group', /^(group|category|type|kind|section)$/],
  ['models', /^(fits|fits models?|models?|for|for models?|compatible( with)?|monitors?|devices?|used with)$/],
  ['set', /^(set|set name|accessory set|kit|kit name|package|bundle)$/],
  ['qty', /^(qty|quantity|count|how many|amount)$/],
]

/**
 * An imported sheet's rows (objects by heading, as SheetJS and PapaParse give them) as list items. A column
 * the list doesn't keep (price, stock…) is left out. A sheet with a Set column is sets as well: each row is a
 * line of its set, with its Qty (1 if none), and its item goes on the list too.
 * { items, sets, skipped: rows with neither code nor name, columns, problem? }
 */
export function accessoryListFromRows(rows) {
  const heads = [...new Set((rows || []).flatMap((r) => Object.keys(r || {})))]
  const col = {}
  for (const [field, re] of ACC_HEADINGS) {
    const hits = heads.filter((h) => re.test(HEAD(h)))
    // A sheet with both a Name and a Description: the name.
    const h = field === 'name' ? hits.find((x) => !/description/.test(HEAD(x))) || hits[0] : hits[0]
    if (h) col[field] = h
  }
  if (!col.code && !col.name) return { items: [], skipped: (rows || []).length, columns: col, problem: 'No Code or Name column found. The first row should be headings, such as Code, Name, Group, Fits.' }
  const items = [], seen = new Map(), sets = new Map()
  let skipped = 0
  for (const r of rows || []) {
    const a = cleanAccessoryItem({ code: r?.[col.code], name: r?.[col.name], group: r?.[col.group], models: r?.[col.models] })
    if (!a) { skipped++; continue }
    const k = accessoryKey(a)
    if (seen.has(k)) { const was = items[seen.get(k)]; items[seen.get(k)] = fillFrom(a, was) } else { seen.set(k, items.length); items.push(a) }
    const setName = col.set ? cut(r?.[col.set], 80) : ''
    if (setName) {
      if (!sets.has(setName.toLowerCase())) sets.set(setName.toLowerCase(), { name: setName, lines: [] })
      sets.get(setName.toLowerCase()).lines.push({ code: a.code, name: a.name, qty: col.qty ? r?.[col.qty] : 1 })
    }
  }
  return { items, sets: cleanAccessorySets([...sets.values()]), skipped, columns: col }
}

// An imported item with a blank field keeps what the list had there (a sets sheet may have codes and nothing else).
const fillFrom = (a, old) => (old ? { code: a.code || old.code, name: a.name || old.name, group: a.group || old.group, models: a.models.length ? a.models : old.models || [] } : a)

/**
 * An import put into the list: added to it (an item already there by code, or by name if it has no code, is
 * updated; a blank in the sheet keeps what it had) or replacing it. { items, added, updated, unchanged, removed }
 */
export function mergeAccessoryList(existing, incoming, { replace = false } = {}) {
  const was = new Map(cleanAccessoryList(existing).map((a) => [accessoryKey(a), a]))
  const next = replace ? new Map() : new Map(was)
  let added = 0, updated = 0, unchanged = 0
  for (const x of incoming || []) {
    let a = cleanAccessoryItem(x)
    if (!a) continue
    const k = accessoryKey(a), old = was.get(k)
    a = fillFrom(a, old)
    if (!old) added++
    else if (JSON.stringify(old) === JSON.stringify(a)) unchanged++
    else updated++
    next.set(k, a)
  }
  const removed = replace ? [...was.keys()].filter((k) => !next.has(k)).length : 0
  return { items: cleanAccessoryList([...next.values()]), added, updated, unchanged, removed }
}

/* Accessory sets (Manage › Accessories): a named set of accessories with quantities, such as "ED monitoring"
   or "Children's / SCBU", added to a loan in one tap. Kept beside the list in its document:
   sets: [{ id, name, lines: [{ code, name, qty }] }]. A line is known by its code (or its name with none). */

export const ACCESSORY_SETS_MAX = 50

/** The sets tidied: a name needed, each name once (a later one wins), lines as a loan's (cleanAccessories), by name. */
export function cleanAccessorySets(sets) {
  const by = new Map()
  for (const x of Array.isArray(sets) ? sets : []) {
    const name = cut(x?.name, 80)
    if (!name) continue
    const lines = cleanAccessories(x?.lines).slice(0, 200)
    const id = cut(x?.id, 40) || 'set_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 30)
    by.set(name.toLowerCase(), { id, name, lines })
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name)).slice(0, ACCESSORY_SETS_MAX)
}

/** A set's lines with the list's current names (a line whose item has gone from the list keeps the name it had). */
export function setLines(set, list = []) {
  const items = new Map(cleanAccessoryList(list).map((a) => [accessoryKey(a), a]))
  return cleanAccessories(set?.lines).map((l) => ({ ...l, name: items.get(accessoryKey(l))?.name || l.name }))
}

/** A set added to a loan's accessories: its lines put in, quantities added to any of the same already there. */
export const addSet = (value, set, list = []) => cleanAccessories([...(value || []), ...setLines(set, list)])

/** How big a set is, for its button: lines and pieces. */
export const setSize = (set) => { const lines = cleanAccessories(set?.lines); return { lines: lines.length, pieces: lines.reduce((n, l) => n + l.qty, 0) } }

/**
 * Sets put in: a set with the same name (case aside) as one there is replaced, the rest added.
 * { sets, added, replaced }
 */
export function mergeAccessorySets(existing, incoming) {
  const now = cleanAccessorySets(existing), names = new Set(now.map((s) => s.name.toLowerCase()))
  const fresh = cleanAccessorySets(incoming)
  return { sets: cleanAccessorySets([...now, ...fresh]), added: fresh.filter((s) => !names.has(s.name.toLowerCase())).length, replaced: fresh.filter((s) => names.has(s.name.toLowerCase())).length }
}

/**
 * What the picker offers: the accessory list (listed: true) and every code used on a loan's form, each once,
 * with how many loans used it. A code only ever used on loans keeps the name it was last given.
 * [{ code, name, models, group, uses, listed }]
 */
export function accessoryCatalogue(loanDocs = {}, list = []) {
  const by = new Map()
  for (const a of cleanAccessoryList(list)) by.set(accessoryKey(a), { ...a, uses: 0, listed: true })
  const docs = Object.values(loanDocs || {}).filter((d) => d && Array.isArray(d.accessories))
    .sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || '')))
  for (const d of docs) {
    for (const a of d.accessories) {
      if (!a || !a.code) continue
      const k = accKey(a.code), cur = by.get(k)
      if (cur) { cur.uses++; if (!cur.listed && a.name) cur.name = a.name }
      else by.set(k, { code: String(a.code).trim(), name: a.name || '', models: [], group: '', uses: 1, listed: false })
    }
  }
  return [...by.values()]
}

/**
 * The picker's list, opened: everything (or what matches what's typed: a code however it's typed, or every
 * word in its name, group or models), in sections: those that fit the monitors on the loan first, then each
 * group A–Z (Other last), then codes only used on earlier loans. [{ title, items }]
 */
export function accessoryChoices(catalogue, q = '', { models = [] } = {}) {
  const text = String(q || '').trim().toLowerCase(), words = text.split(/\s+/).filter(Boolean), key = accKey(text)
  const fits = (a) => (a.models || []).some((m) => models.some((x) => modelKey(x) === modelKey(m)))
  const match = (a) => !text || (key && accKey(a.code).includes(key)) || words.every((w) => `${a.name} ${a.group} ${(a.models || []).join(' ')}`.toLowerCase().includes(w))
  const byName = (a, b) => (a.name || a.code).localeCompare(b.name || b.code)
  const shown = catalogue.filter(match)
  const sections = []
  const fitting = shown.filter((a) => a.listed && fits(a)).sort(byName)
  if (fitting.length) sections.push({ title: `Fits the ${[...new Set(models.filter(Boolean))].join(', ')}`, items: fitting })
  const groups = new Map()
  for (const a of shown.filter((x) => x.listed && !fits(x))) { const g = a.group || 'Other'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(a) }
  for (const g of [...groups.keys()].sort((a, b) => (a === 'Other') - (b === 'Other') || a.localeCompare(b))) sections.push({ title: g, items: groups.get(g).sort(byName) })
  const earlier = shown.filter((a) => !a.listed).sort((a, b) => (b.uses || 0) - (a.uses || 0) || byName(a, b))
  if (earlier.length) sections.push({ title: 'Used on earlier loans (not in the list)', items: earlier })
  return sections
}

/**
 * The picker's matches for what was typed: a code however it's typed (dashes and spaces ignored), or every
 * word in its name. Those suiting the loan's monitors (`models`) first, then the most used.
 */
export function searchAccessories(catalogue, q, { models = [], limit = 8 } = {}) {
  const text = String(q || '').trim().toLowerCase()
  if (!text) return []
  const words = text.split(/\s+/), key = accKey(text)
  const suits = (a) => (a.models || []).some((m) => models.some((x) => String(x || '').toLowerCase() === String(m || '').toLowerCase()))
  return catalogue
    .filter((a) => (key && accKey(a.code).includes(key)) || words.every((w) => `${a.name} ${a.group}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(suits(b)) - Number(suits(a)) || (b.uses || 0) - (a.uses || 0) || a.code.localeCompare(b.code))
    .slice(0, limit)
}

/**
 * Accessories written into a loan's notes, which belong in its accessory list instead (packed, printed and
 * checked back by code and quantity): the words found, each once, as written. [] when there are none.
 */
const ACC_WORDS = /\b(cuffs?|spo2|sp02|nibp|ibp|ecg|ekg|(?:3|5|6|10|12)[- ]?leads?|lead ?sets?|leads?|cables?|sensors?|probes?|transducers?|electrodes?|pucks?|sampling lines?|water ?traps?|adaptors?|adapters?|hoses?|masks?|circuits?)\b/gi
export function accessoryWordsIn(text) {
  const seen = new Map()
  for (const m of String(text || '').matchAll(ACC_WORDS)) { const k = m[0].toLowerCase().replace(/s$/, ''); if (!seen.has(k)) seen.set(k, m[0]) }
  return [...seen.values()].slice(0, 6)
}

/** The list item a loan's accessory line is (by code, else by name), or null: a listed line is shown, not typed. */
export function listedAccessory(line, list = []) {
  const k = accessoryKey({ code: String(line?.code || '').trim(), name: line?.name })
  return cleanAccessoryList(list).find((a) => accessoryKey(a) === k) || null
}

// The group an accessory's name puts it in (the first that fits), for one going on the list by itself.
const GROUP_WORDS = [
  ['NIBP', /\b(nibp|cuffs?|bladderless)\b/i],
  ['IBP', /\b(ibp|transducers?|invasive pressure)\b/i],
  ['SpO2', /\b(spo2|sp02|oximetry|masimo|nellcor)\b/i],
  ['ECG', /\b(ecg|ekg|\d+-?leads?|lead ?wires?|leadwires?|electrodes?)\b/i],
  ['Temp', /\b(temp|temperature)\b/i],
  ['CO2', /\b(co2|etco2|capno\w*|sampling lines?|water ?traps?)\b/i],
]
/** A group for an accessory from its name (NIBP, IBP, SpO2, ECG, Temp, CO2), spelt as the list spells it; '' if none fits. */
export function accessoryGroupFor(name, list = []) {
  const hit = GROUP_WORDS.find(([, re]) => re.test(String(name || '')))
  if (!hit) return ''
  return cleanAccessoryList(list).map((a) => a.group).find((g) => g && g.toLowerCase() === hit[0].toLowerCase()) || hit[0]
}

/**
 * Accessories typed on a loan or a set (not chosen from the list), as items to put on the list so the picker
 * offers them next time. A line needs a name (a code alone says too little). One already on the list (by
 * code, else by name) isn't new, and nor is one in `before` (what was saved last time: someone may have taken
 * it off the list since, on purpose). Its group is guessed from its name. [{ code, name, group, models: [] }]
 */
export function newListItems(lines, list = [], before = []) {
  const known = new Set([...cleanAccessoryList(list), ...cleanAccessories(before).map(cleanAccessoryItem).filter(Boolean)].map(accessoryKey))
  const out = new Map()
  for (const l of cleanAccessories(lines)) {
    const a = cleanAccessoryItem({ code: l.code, name: l.name })
    if (!a?.name) continue
    const k = accessoryKey(a)
    if (known.has(k) || out.has(k)) continue
    out.set(k, { ...a, group: accessoryGroupFor(a.name, list) })
  }
  return [...out.values()]
}

/**
 * "As last time": the accessories on the newest loan whose devices include this model, for one button that
 * adds them all. null if no loan with that model had any. { loanTo, startDate, accessories }
 */
export function lastAccessoriesFor(model, loanDocs = {}, { not = '' } = {}) {
  const m = String(model || '').trim().toLowerCase()
  if (!m) return null
  let best = null
  for (const [key, d] of Object.entries(loanDocs || {})) {
    if (!d || key === not || !cleanAccessories(d.accessories).length) continue
    if (!(d.items || []).some((i) => String(i?.Model || '').trim().toLowerCase() === m)) continue
    if (!best || String(d.startDate || '') > String(best.startDate || '')) best = d
  }
  return best ? { loanTo: best.loanTo || '', startDate: best.startDate || '', accessories: cleanAccessories(best.accessories) } : null
}

/**
 * The loan form as an RTF file to open in Word (old: exportLoanRTF): the header, the device rows
 * as fixed columns, the notes, and the ESC reminder. (The old one escaped its own bold marks, so
 * its labels came out as "{\b Customer:}" text; here they're bold.) Returns { name, rtf }.
 */
export function loanFormRtf(doc) {
  const esc = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/\{/g, '\\{').replace(/\}/g, '\\}').replace(/[^\x00-\x7F]/g, (c) => '\\u' + c.charCodeAt(0) + '?')
  const b = (s) => '{\\b ' + esc(s) + '}'
  const line = (...parts) => '{\\pard ' + parts.join('') + '\\par}\n'
  const rule = '{\\pard \\brdrb\\brdrs\\brdrw10\\brdr0 \\par}\n', gap = '{\\pard\\par}\n'
  const d = (v) => oldDate(toISO(v || ''))
  const rows = (doc.rows || []).filter((r) => r.some((c) => String(c || '').trim()))
    .map((r) => [String(r[0] || '').padEnd(12), String(r[1] || '').padEnd(18), String(r[2] || '').padEnd(30), String(r[3] || '')].join('  '))
  let rtf = '{\\rtf1\\ansi\\deff0\n{\\fonttbl{\\f0 Arial;}}\n{\\f0\\fs20\n'
  rtf += '{\\pard\\fs28\\b CMCHS Demo Equipment Loan Form\\par}\n' + gap
  rtf += line(b('Customer:'), '  ', esc(doc.loanTo)) + line(b('Address:'), '  ', esc(doc.location))
  rtf += line(b('Loan Date:'), '  ', esc(d(doc.startDate)), '     ', b('Loan Ends:'), '  ', esc(doc.longTerm ? 'Long term' : d(doc.endDate)))
  rtf += line(b('Account Manager:'), '  ', esc(doc.accountManager), doc.contactNumber ? '     ' + b('Contact:') + '  ' + esc(doc.contactNumber) : '')
  rtf += gap + rule + line(b('CHS ASSET #'.padEnd(12) + '  ' + 'MODEL'.padEnd(18) + '  ' + 'DESCRIPTION'.padEnd(30) + '  SERIAL/PART #')) + rule
  for (const r of rows) rtf += line(esc(r))
  rtf += rule
  const acc = cleanAccessories(doc.accessories)
  if (acc.length) {
    rtf += gap + line(b('ACCESSORIES')) + rule + line(b('CODE'.padEnd(18) + '  ' + 'ACCESSORY'.padEnd(40) + '  QTY')) + rule
    for (const a of acc) rtf += line(esc(String(a.code).padEnd(18) + '  ' + String(a.name).padEnd(40) + '  ' + a.qty))
    rtf += rule
  }
  if (String(doc.notes || '').trim()) { rtf += gap + line(b('Notes:')); for (const n of String(doc.notes).split('\n')) rtf += line(esc(n)) }
  rtf += gap + rule + '{\\pard\\i Please ensure this form accompanies demo stock throughout trial and is returned to Connected Healthcare. Check all units have current ESC.\\par}\n}}'
  const who = String(doc.loanTo || 'loan').replace(/[^a-zA-Z0-9_\- ]/g, '').trim().replace(/\s+/g, '_') || 'loan'
  return { name: `CHS_Loan_${who}_${toISO(doc.startDate || '') || nzDate()}.rtf`, rtf }
}

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The loan form as plain HTML for the email and for printing (old: _getLoanFormHtml / printLoanDoc). */
export function loanFormHtml(doc, { logo = 'https://internal.chsnz.co.nz/brand/logo-full-colour.png' } = {}) {
  const td = (v, extra = '') => `<td style="border:1px solid #ccc;padding:2px 6px;font-size:11px;${extra}">${escHtml(v)}</td>`
  const th = (v, extra = '') => `<th style="border:1px solid #ccc;padding:2px 6px;font-size:11px;text-align:left;background:#f5f5f5;${extra}">${escHtml(v)}</th>`
  const box = '<td style="border:1px solid #ccc;text-align:center"><div style="width:12px;height:12px;border:1.5px solid #333;margin:0 auto"></div></td>'
  const rows = (doc.rows || []).map((r) => `<tr>${r.map((c) => td(c)).join('')}${box}</tr>`).join('')
  const pre = (v) => escHtml(v).replace(/\n/g, '<br>')
  const acc = cleanAccessories(doc.accessories) // optional: only a loan that has some gets the table
  return `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#1a1917">
<table style="width:100%;border-collapse:collapse;margin-bottom:10px"><tr>
<td style="font-size:26px;font-weight:700;line-height:1.1">CMCHS Demo Equipment Loan Form</td>
<td style="text-align:right;width:260px"><img src="${escHtml(logo)}" alt="Connected Healthcare Systems" height="64" style="height:64px;width:auto"></td></tr></table>
<div style="border-top:2px solid #333;border-bottom:1px solid #ccc"></div>
<table style="width:100%;border-collapse:collapse"><tr>${th('Event and/or Customer Name')}${th('Customer Address')}${th('Loan Date')}${th('Loan Ends Date' + (doc.longTerm ? ' — long term' : ''))}${th('Account Manager')}${th('Contact Number')}</tr>
<tr>${td(doc.loanTo)}${td(doc.location)}${td(oldDate(doc.startDate))}${td(doc.longTerm ? '' : oldDate(doc.endDate))}${td(doc.accountManager)}${td(doc.contactNumber)}</tr></table>
<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr>${th('CHS Asset #')}${th('Model')}${th('Description')}${th('Serial/Part #')}${th('Notes/Additional Info')}${th('Data cleared on return', 'text-align:center')}</tr>${rows}</table>
${acc.length ? `<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr>${th('Accessory code')}${th('Accessory')}${th('Qty', 'text-align:right;width:8%')}${th('Packed', 'text-align:center;width:9%')}${th('Back', 'text-align:center;width:9%')}</tr>${acc.map((x) => `<tr>${td(x.code)}${td(x.name)}${td(x.qty, 'text-align:right')}${box}${box}</tr>`).join('')}</table>` : ''}
<table style="width:100%;border-collapse:collapse"><tr><td style="border:1px solid #ccc;padding:2px 6px;font-size:11px;font-weight:700;width:14%;text-align:right">Notes:</td><td style="border:1px solid #ccc;padding:4px 6px;font-size:12px">${pre(doc.notes)}</td></tr>
<tr><td style="border:1px solid #ccc;padding:2px 6px;font-size:11px;font-weight:700;text-align:right">Shipping Details:</td><td style="border:1px solid #ccc;padding:4px 6px;font-size:12px">${pre(doc.shipping)}</td></tr></table>
<table style="width:100%;border-collapse:collapse"><tr>
<td style="border:1px solid #ccc;padding:8px 12px;width:28%;vertical-align:top;font-size:11px"><b>Loan authorised by:</b><br><br>Name (print):<br><br>Signature:<br><br>Date:</td>
<td style="border:1px solid #ccc;padding:8px 12px;text-align:center;font-size:12px"><b style="color:#554596">Please ensure this form accompanies<br>demo stock throughout trial and<br>is returned to Connected Healthcare</b><br><b style="color:#dc2626;font-size:11px">Check all units have current ESC</b></td>
<td style="border:1px solid #ccc;padding:8px 12px;width:28%;vertical-align:top;font-size:11px"><b>Return checked by:</b><br><br>Signed:<br><br>Name (print):<br><br>Date:</td></tr></table></div>`
}

/**
 * A new loan's form email, queued on its meta (loans/{key}.meta.formEmail)
 * until it has gone. The browser sends it when the loan form is finished, and
 * marks it sent (formEmailSent); if that never happens (the tab was closed,
 * EmailJS failed), the proxy's sendMissedLoanEmails sends this copy itself
 * after a while (backend/apps-script/proxy/Code.js). The form is kept as the
 * HTML the browser would have sent, so both look the same. Nothing for test
 * mode or a loan with no email address.
 */
export function queuedFormEmail(form, { to = '', name = '', ts = nzNow(), ms = Date.now() } = {}) {
  if (!to) return null
  return {
    pending: true, queuedAt: ts, queuedMs: ms, to, name, loanTo: form.loanTo || '',
    startDate: toISO(form.startDate) || '', endDate: form.longTerm ? '' : (toISO(form.endDate) || ''), longTerm: !!form.longTerm,
    html: loanFormHtml({ ...form, startDate: toISO(form.startDate), endDate: toISO(form.endDate) }),
  }
}
/** The queued email marked as gone: the form's HTML dropped, who sent it kept. */
export const formEmailSent = (by = 'tracker', ts = nzNow()) => ({ pending: false, sentAt: ts, by })

/**
 * A date as the old tracker writes it into stored text (history notes,
 * Counted, audit summaries, Simpro notes, the printed form): DD/MM/YYYY (old:
 * formatDisplayDate). The screens here show 16-Oct-2026 (fmtDate); stored
 * text keeps the old way so both trackers' records read alike, and the old
 * count overview still recognises "Counted DD/MM/YYYY".
 */
export function oldDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''))
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(s || '')
}

/* ── Counting (old: getCountCategory, submitCount, submitCountKeepLoan) ── */

/** never counted, counted here ("Counted DD/MM/YYYY": 'new'), or counted under the old spreadsheet ('old'). */
export function countCategory(e) {
  const c = String(e?.Counted || '').trim()
  if (!c || c === 'No') return 'never'
  return /^Counted\s+\d{2}\/\d{2}\/\d{4}/.test(c) ? 'new' : 'old'
}

/**
 * An item counted. As the old Count: counted and back in the office (its
 * loan cleared, as a return); or, with keepOnLoan, counted where it is.
 * A Count entry in its history either way.
 */
export function countEquipment(equipment, history, id, { keepOnLoan = false, today = nzDate(), ts = nzNow(), operator = '' } = {}) {
  const idx = equipment.findIndex((e) => e && e.id === id)
  if (idx < 0) return null
  const e = equipment[idx]
  const counted = 'Counted ' + oldDate(today)
  const was = { id: e.id, CHSAssetNo: e.CHSAssetNo, batchId: e.BatchID || '', loanTo: e.OnLoanTo || '', endDate: e.LoanEndDate || '', out: isOut(e) }
  const next = keepOnLoan ? { ...e, Counted: counted }
    : { ...e, Counted: counted, OnLoanTo: '', Location: '', LoanStartDate: '', LoanEndDate: '', Returned: 'Yes', BatchID: '', _transferNote: null }
  const entry = { operator, id: newId(), ts, chsAssetNo: e.CHSAssetNo, model: e.Model, action: 'Count', loanTo: e.OnLoanTo, location: e.Location, notes: counted + (keepOnLoan ? ' (kept on loan)' : '') }
  const eq = [...equipment]; eq[idx] = next
  return { equipment: eq, history: [entry, ...history], was }
}

/* ── Calendar, history, audit (old: renderCalendar, renderHistory, renderAuditLog) ── */

/** Days from `start`, `n` of them, as YYYY-MM-DD (UTC arithmetic on the date itself, so no time zone drift). */
export function dayList(start, n) {
  const t = Date.parse(start + 'T00:00:00Z')
  return Array.from({ length: n }, (_, i) => new Date(t + i * 86400000).toISOString().slice(0, 10))
}

/**
 * The calendar's rows (old: renderCalendar): loans and bookings that touch
 * the window, long-term ones left out (no end to draw), sorted as chosen.
 * state: overdue | active | scheduled | booking.
 */
export function calendarRows(sections, { from, to, sort = 'start-asc', today = nzDate() } = {}) {
  const rows = [...sections.needsReassign, ...sections.current, ...sections.upcoming]
    .filter((g) => !g.longTerm && (g.kind !== 'booking' || g.pending.length))
    .filter((g) => !(g.endDate && g.endDate < from) && !(g.startDate && g.startDate > to))
    .map((g) => ({ ...g, state: g.kind === 'booking' ? 'booking' : g.kind === 'scheduled' ? 'scheduled' : g.endDate && g.endDate < today ? 'overdue' : 'active' }))
  const dur = (g) => (g.startDate && g.endDate ? Math.max(0, daysBetween(g.startDate, g.endDate)) : 0)
  const by = {
    'start-asc': (a, b) => ((a.startDate || '9999') < (b.startDate || '9999') ? -1 : 1),
    'start-desc': (a, b) => ((a.startDate || '0000') > (b.startDate || '0000') ? -1 : 1),
    'end-asc': (a, b) => ((a.endDate || '9999') < (b.endDate || '9999') ? -1 : 1),
    'end-desc': (a, b) => ((a.endDate || '0000') > (b.endDate || '0000') ? -1 : 1),
    'dur-asc': (a, b) => dur(a) - dur(b), 'dur-desc': (a, b) => dur(b) - dur(a),
    'name-asc': (a, b) => (a.loanTo || '').localeCompare(b.loanTo || ''), 'name-desc': (a, b) => (b.loanTo || '').localeCompare(a.loanTo || ''),
  }[sort]
  return by ? rows.sort(by) : rows
}

/** History, searched and filtered (old: renderHistory): asset, model, customer, location, notes. */
export function filterHistory(history, { q = '', action = '' } = {}) {
  const s = q.trim().toLowerCase()
  return history.filter((h) => h && (!action || h.action === action) &&
    (!s || [h.chsAssetNo, h.model, h.loanTo, h.location, h.notes, h.operator].join(' ').toLowerCase().includes(s)))
}

/** The audit log's kinds of entry, labelled as the old one, and its three filters. */
export const AUDIT_LABELS = {
  loan_created: 'Loan created', loan_deleted: 'Loan deleted', scheduled_deleted: 'Scheduled deleted', loan_extended: 'Extended', loan_edited: 'Edited', loan_form_saved: 'Loan form saved',
  loan_longterm_on: 'Made long-term', loan_longterm_off: 'Returned to active', items_returned: 'Returned', item_removed: 'Item removed', items_added: 'Items added',
  orphan_recovered: 'Orphan recovered', orphan_deleted: 'Orphan deleted', items_transferred: 'Transferred', loan_reassigned: 'Moved',
  simpro_created: 'Simpro created', simpro_updated: 'Simpro updated', simpro_closed: 'Simpro closed',
  asset_added: 'Asset added', asset_edited: 'Asset edited', asset_deleted: 'Asset deleted', asset_retired: 'Asset retired',
  upcoming_loan_deleted: 'Booking cancelled', upcoming_item_removed: 'Item removed', am_removed: 'AM removed', am_added: 'AM added', am_role: 'AM role changed',retired_asset_deleted: 'Retired asset deleted',
  kit_deleted: 'Kit deleted', kit_accessory_removed: 'Kit accessory removed', accessory_list: 'Accessory list', loan_accessories: 'Accessories', test_report_uploaded: 'Test report uploaded', test_report_deleted: 'Test report deleted', history_deleted: 'History deleted',
}
export const AUDIT_KINDS = {
  loans: ['loan_created', 'loan_deleted', 'loan_extended', 'loan_edited', 'loan_form_saved', 'loan_accessories', 'loan_longterm_on', 'loan_longterm_off', 'items_returned', 'item_removed', 'items_added', 'items_transferred', 'loan_reassigned', 'scheduled_deleted', 'orphan_recovered', 'orphan_deleted', 'upcoming_loan_deleted', 'upcoming_item_removed'],
  database: ['asset_added', 'asset_edited', 'asset_deleted', 'asset_retired', 'accessory_list'],
  simpro: ['simpro_created', 'simpro_updated', 'simpro_closed'],
}
export function filterAudit(entries, { q = '', kind = '' } = {}) {
  const s = q.trim().toLowerCase(), types = kind ? AUDIT_KINDS[kind] : null
  // An equipment entry's asset number too (old: detail.assetNo), so searching a number finds it being added, edited, retired.
  return entries.filter((e) => e && (!types || types.includes(e.type)) &&
    (!s || [e.summary, e.operator, e.type, e.detail?.assetNo, ...(e.detail?.items || [])].join(' ').toLowerCase().includes(s)))
}

/** A loan's own changes, newest first (old: getLoanAuditHistory): by its BatchID, else its customer. The new tracker's transfers are loan_reassigned. */
const LOAN_UPDATE_TYPES = ['items_added', 'item_removed', 'items_returned', 'loan_extended', 'loan_longterm_on', 'loan_longterm_off', 'items_transferred', 'loan_reassigned', 'simpro_created', 'simpro_updated', 'simpro_closed']
export function loanUpdates(audit = [], g) {
  return audit.filter((e) => e && LOAN_UPDATE_TYPES.includes(e.type) && ((g.batchId && e.detail?.batchId === g.batchId) || e.detail?.loanTo === g.loanTo
    || (e.type === 'loan_reassigned' && (e.detail?.from === g.loanTo || e.detail?.to === g.loanTo))))
}

/** "just now", "5m ago", "3h ago", "2d ago" (old: _relativeTime). */
export function relTime(ts, now = Date.now()) {
  const t = stampMs(ts)
  if (!ts || Number.isNaN(t)) return ''
  const mins = Math.floor((now - t) / 60000)
  return mins < 1 ? 'just now' : mins < 60 ? mins + 'm ago' : mins < 1440 ? Math.floor(mins / 60) + 'h ago' : Math.floor(mins / 1440) + 'd ago'
}

/**
 * When Tile sync last saw an item's Tile ({ ago: "3h ago", at: "15 Oct, 17:40" }): worked out from
 * the Tile's own timestamp (lastTimestamp, UTC), so it stays right between daily syncs. The
 * sync's own text ("25 min ago", frozen at sync time) is only the fallback for a record with none.
 */
export function tileSeen(tile, now = Date.now()) {
  if (!tile) return { ago: '', at: '' }
  const ago = relTime(tile.lastTimestamp, now)
  return ago ? { ago, at: fmtWhen(tile.lastTimestamp) } : { ago: String(tile.lastUpdated || ''), at: '' }
}

/** Each kind of audit entry's colour, as the old badges (old: _auditBadge): made / back green, gone red, changed purple, taken off orange. */
export function auditTone(type) {
  const t = String(type || '')
  if (/^(loan_created|items_returned|simpro_created|asset_added|test_report_uploaded)$/.test(t)) return 'green'
  if (/deleted$|^am_removed$/.test(t)) return 'critical'
  if (/^(item_removed|upcoming_item_removed|orphan_recovered|kit_accessory_removed)$/.test(t)) return 'orange'
  if (/^(loan_extended|items_added|items_transferred|loan_reassigned|simpro_updated|asset_edited|asset_retired)$/.test(t)) return 'purple'
  return 'neutral'
}

/* ── Equipment records, retired items, import and export, kits, Simpro job
   health (old: saveItem, deleteItem, confirmRetire, the retired tab,
   processFile / confirmImport, exportCSV / downloadExcel, kit groups,
   findLoansMissingSimproJob) ── */

/** Every field an item can have, in the old edit form's order (old: MF). */
export const ITEM_FIELDS = ['CHSAssetNo', 'Model', 'Description', 'SerialNo', 'BatterySerialNo', 'PartNo', 'MfgDate', 'PurchaseDate', 'USPrice', 'NZPrice', 'TileNo',
  'OnLoanTo', 'Location', 'LoanStartDate', 'LoanEndDate', 'Returned', 'Counted', 'Notes', 'ShelfLocation', 'DeviceID', 'LanMAC', 'WlanMAC', 'OldCHS', 'TileType', 'TileUUID', 'BorrowerEmail']
const LOAN_FIELDS = { OnLoanTo: 'On Loan To', Location: 'Location', LoanStartDate: 'Start date', LoanEndDate: 'Due date', Returned: 'Returned' }

/** Why an item can't be saved, or ''. (The old one allowed a second item with the same asset number, which breaks every lookup.) */
export function itemProblem(equipment, obj, editingId = null) {
  const no = String(obj.CHSAssetNo || '').trim()
  if (!no) return 'The CHS asset number is needed.'
  const other = equipment.find((e) => e && e.id !== editingId && String(e.CHSAssetNo || '').trim().toLowerCase() === no.toLowerCase())
  if (other) return `${no} is already in the list (${other.Model || 'another item'}).`
  return ''
}

/** The fields of each asset on the Add assets form, in the old one's order (old: maAddSlot). */
export const ADD_FIELDS = ['CHSAssetNo', 'Model', 'Description', 'SerialNo', 'BatterySerialNo', 'PartNo', 'MfgDate', 'PurchaseDate', 'USPrice', 'NZPrice', 'ShelfLocation', 'DeviceID', 'Notes']

/**
 * Several assets added at once (old: maSaveAll): each needs an asset number
 * not already on the list (nor twice in this one). Returns { items } or { problem }.
 */
export function planAddAssets(equipment, slots, { makeId = newId } = {}) {
  const items = [], seen = new Set()
  for (const [i, slot] of (slots || []).entries()) {
    const no = String(slot.CHSAssetNo || '').trim()
    if (!no) return { problem: `Asset ${i + 1} needs its CHS asset number.` }
    const p = itemProblem(equipment, { CHSAssetNo: no })
    if (p) return { problem: p }
    if (seen.has(no.toLowerCase())) return { problem: `${no} is on this form twice.` }
    seen.add(no.toLowerCase())
    items.push({ id: makeId(), ...Object.fromEntries(ADD_FIELDS.map((f) => [f, String(slot[f] ?? '').trim()])), CHSAssetNo: no })
  }
  return items.length ? { items } : { problem: 'Add at least one asset.' }
}

/**
 * The kit the Add assets form makes from them (old: maSaveAll's kit part): a
 * new one (a name, the trigger, the rest its accessories), or the rest added to
 * an existing kit's accessories. Returns { kits, label } or { problem }.
 */
export function kitFromNewAssets(kits = {}, items, { trigger = '', existing = '', name = '', key = 'kit_' + Date.now() } = {}) {
  if (!trigger || !items.some((i) => i.CHSAssetNo === trigger)) return { problem: 'Choose the kit’s trigger device.' }
  const acc = items.filter((i) => i.CHSAssetNo !== trigger).map((i) => ({ assetNo: i.CHSAssetNo, model: i.Model || '', desc: i.Description || '' }))
  if (existing && kits[existing]) {
    const k = kits[existing], have = k.accessories || []
    return { kits: { ...kits, [existing]: { ...k, accessories: [...have, ...acc.filter((a) => !have.some((h) => h.assetNo === a.assetNo))] } }, label: k.label || existing }
  }
  if (!String(name).trim()) return { problem: 'Give the kit a name.' }
  return { kits: { ...kits, [key]: { label: String(name).trim(), triggers: [trigger], accessories: acc } }, label: String(name).trim() }
}

/**
 * An item added or edited (old: saveItem). An edit that changes its loan
 * fields leaves an Edited entry in its history saying what changed.
 */
export function saveItemEquipment(equipment, history, obj, { editingId = null, ts = nzNow(), operator = '' } = {}) {
  const clean = Object.fromEntries(ITEM_FIELDS.filter((f) => f in obj).map((f) => [f, String(obj[f] ?? '').trim()]))
  if (!editingId) return { equipment: [{ id: newId(), ...clean }, ...equipment], history, item: null }
  const idx = equipment.findIndex((e) => e && e.id === editingId)
  if (idx < 0) throw new Error('That item has gone: someone may have deleted it.')
  const prev = equipment[idx]
  const changed = Object.keys(LOAN_FIELDS).filter((f) => f in clean && (prev[f] || '') !== (clean[f] || ''))
  const next = { ...prev, ...clean }
  const eq = [...equipment]; eq[idx] = next
  const entry = changed.length ? [{ operator, id: newId(), ts, chsAssetNo: next.CHSAssetNo, model: next.Model, action: 'Edited',
    notes: changed.map((f) => `${LOAN_FIELDS[f]}: '${prev[f] || '—'}' → '${clean[f] || '—'}'`).join('; ') }] : []
  return { equipment: eq, history: [...entry, ...history], item: next }
}

export const RETIRE_REASONS = ['Sold', 'Retired / End of life', 'Lost', 'Damaged / Written off', 'Returned to manufacturer', 'Other']

/** An item out of the equipment list and onto the retired list (old: confirmRetire). */
export function retireEquipment(equipment, id, { reason = '', notes = '', today = nzDate() } = {}) {
  const item = equipment.find((e) => e && e.id === id)
  if (!item) throw new Error('That item has gone: someone may have deleted it.')
  return { equipment: equipment.filter((e) => e && e.id !== id), retired: { ...item, RetiredDate: today, RetiredReason: reason, RetiredNotes: notes } }
}

/** Retired items back into the equipment list, without their retired details (old: restoreFromRetiredSelection). */
export function restoreRetired(retired, ids) {
  const want = new Set(ids)
  const back = retired.filter((r) => want.has(r.id)).map(({ RetiredDate, RetiredReason, RetiredNotes, ...rest }) => rest)
  return { retired: retired.filter((r) => !want.has(r.id)), back }
}

/** The retired list, searched across every field and sorted (old: renderRetired). */
export function filterRetired(retired, { q = '', sort = 'RetiredDate', dir = -1 } = {}) {
  const s = q.trim().toLowerCase()
  return retired.filter((e) => e && (!s || Object.values(e).join(' ').toLowerCase().includes(s)))
    .sort((a, b) => { const av = String(a[sort] || '').toLowerCase(), bv = String(b[sort] || '').toLowerCase(); return av < bv ? -dir : av > bv ? dir : 0 })
}

/** The retired import's headings (old: processRetiredImport's retiredColMap). */
const RETIRED_IMPORT = {
  'chs asset no.': 'CHSAssetNo', 'chs asset no': 'CHSAssetNo', 'chs asset number': 'CHSAssetNo', model: 'Model', description: 'Description',
  'serial number': 'SerialNo', 'serial no.': 'SerialNo', 'serial no': 'SerialNo', 'part number': 'PartNo', 'part no.': 'PartNo',
  'nz$ price': 'NZPrice', 'nz price': 'NZPrice', 'retired date': 'RetiredDate', date: 'RetiredDate', reason: 'RetiredReason', 'retired reason': 'RetiredReason',
  'retired notes': 'RetiredNotes', notes: 'Notes', 'manufacture date': 'MfgDate', 'purchase date': 'PurchaseDate', 'us$ price': 'USPrice',
  'shelf location': 'ShelfLocation', 'tile no.': 'TileNo', 'tile no': 'TileNo', 'device id': 'DeviceID', 'lan mac': 'LanMAC', 'wlan mac': 'WlanMAC',
  'old chs #': 'OldCHS', 'tile type': 'TileType',
}

/**
 * A spreadsheet of sold / retired items (old: processRetiredImport): a row
 * needs an asset number or a model; no date means today, no reason
 * "Imported"; a known asset number is updated, a new one added at the top.
 */
export function importRetiredRows(retired, rows, { today = nzDate(), makeId = newId } = {}) {
  let list = [...retired], added = 0, updated = 0
  for (const row of rows || []) {
    const m = {}
    for (const [k, v] of Object.entries(row || {})) { const f = RETIRED_IMPORT[String(k).toLowerCase().trim()]; if (f) m[f] = v }
    if (!m.CHSAssetNo && !m.Model) continue
    m.CHSAssetNo = String(m.CHSAssetNo || '').trim()
    m.RetiredDate = m.RetiredDate || today
    m.RetiredReason = m.RetiredReason || 'Imported'
    const i = m.CHSAssetNo ? list.findIndex((e) => e && e.CHSAssetNo && e.CHSAssetNo.toLowerCase() === m.CHSAssetNo.toLowerCase()) : -1
    if (i >= 0) { list[i] = { ...list[i], ...m }; updated++ } else { list = [{ id: makeId(), ...m }, ...list]; added++ }
  }
  return { retired: list, added, updated }
}

/* Import and export (old: COL_MAP, mapRow, confirmImport, exportCSV, downloadExcel) */

export const EXPORT_COLUMNS = [['Model', 'Model'], ['Description', 'Description'], ['SerialNo', 'Serial Number'], ['MfgDate', 'Manufacture Date'], ['CHSAssetNo', 'CHS Asset Number'],
  ['TileNo', 'TILE Number'], ['OnLoanTo', 'On Loan To'], ['Location', 'Location'], ['LoanStartDate', 'Loan Start Date'], ['LoanEndDate', 'Loan End Date'], ['Returned', 'Returned'],
  ['Counted', 'Counted'], ['PartNo', 'Part Number'], ['PurchaseDate', 'Purchase date'], ['USPrice', 'US$ Price'], ['NZPrice', 'NZ$ Purchase Price'], ['ShelfLocation', 'Shelf Location'],
  ['Notes', 'Notes'], ['DeviceID', 'Device ID'], ['LanMAC', 'LAN MAC'], ['WlanMAC', 'WLAN MAC'], ['OldCHS', 'Old CHS #'], ['TileType', 'Tile Type']]
export const HISTORY_COLUMNS = [['ts', 'Date/Time'], ['chsAssetNo', 'CHS Asset No.'], ['model', 'Model'], ['action', 'Action'], ['loanTo', 'On Loan To'], ['location', 'Location'], ['loanStart', 'Loan Start'], ['loanEnd', 'Loan End'], ['notes', 'Notes']]
export const RETIRED_COLUMNS = [['CHSAssetNo', 'CHS Asset No.'], ['Model', 'Model'], ['Description', 'Description'], ['SerialNo', 'Serial Number'], ['PartNo', 'Part Number'], ['NZPrice', 'NZ$ Price'],
  ['RetiredDate', 'Retired Date'], ['RetiredReason', 'Reason'], ['RetiredNotes', 'Retired Notes'], ['Notes', 'Notes'], ['MfgDate', 'Manufacture Date'], ['PurchaseDate', 'Purchase Date'],
  ['USPrice', 'US$ Price'], ['ShelfLocation', 'Shelf Location'], ['TileNo', 'Tile No.'], ['DeviceID', 'Device ID'], ['LanMAC', 'LAN MAC'], ['WlanMAC', 'WLAN MAC'], ['OldCHS', 'Old CHS #'], ['TileType', 'Tile Type']]

/**
 * The overdue demos as a list for chasing: one row per device on a started loan that is past its end date (a long-term
 * loan has none), with its account manager and, from the team, their email. Account manager by name (those with none
 * last), then the longest overdue first, then customer and asset number.
 */
export const OVERDUE_COLUMNS = [['am', 'Account manager'], ['amEmail', 'Account manager email'], ['loanTo', 'On loan to'], ['location', 'Location'], ['contact', 'Contact number'],
  ['CHSAssetNo', 'CHS Asset No.'], ['Model', 'Model'], ['Description', 'Description'], ['SerialNo', 'Serial Number'], ['start', 'Loan start'], ['end', 'Due back'], ['daysOver', 'Days overdue']]
export function overdueRows(sections, { today = nzDate(), team = [] } = {}) {
  const emailOf = (name) => (team.find((m) => (m.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase())?.email) || ''
  const rows = []
  for (const g of [...(sections.needsReassign || []), ...(sections.current || [])]) {
    if (!g.overdue) continue
    for (const e of g.items) {
      rows.push({ am: g.am || '', amEmail: emailOf(g.am), loanTo: g.loanTo, location: g.location, contact: g.doc?.contactNumber || '',
        CHSAssetNo: e.CHSAssetNo || '', Model: e.Model || '', Description: e.Description || '', SerialNo: e.SerialNo || '',
        start: fmtDate(g.startDate), end: fmtDate(g.endDate), daysOver: daysBetween(g.endDate, today), _end: g.endDate })
    }
  }
  const byNo = (a, b) => String(a.CHSAssetNo).localeCompare(String(b.CHSAssetNo), undefined, { numeric: true })
  return rows.sort((a, b) => (!a.am - !b.am) || a.am.localeCompare(b.am) || b.daysOver - a.daysOver || a.loanTo.localeCompare(b.loanTo) || byNo(a, b))
}

/** Rows as CSV, every cell quoted (old: exportCSV). */
export function toCsv(rows, columns) {
  const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  return [columns.map(([, h]) => h).join(','), ...rows.map((r) => columns.map(([k]) => cell(r[k])).join(','))].join('\n')
}

/* ── Stock removal (Form 39, "Items removed from stock"): accessories taken for a demo or something else, read from photos of
   their bag labels. The photo is read on the device (shared/ocr.js) and readLabelText picks the part numbers out of what
   was read, checking them against the accessory list (Manage › Accessories): a photo of a rotated, shiny label comes back
   with digits missing ("200-30-09688" for 6200-30-09688), so a number is trusted when the list has it, and a near miss is
   offered as the list's own code, marked to check. A form is { id, kind: 'demo' | 'other', reason, loan: { key, label },
   date, by, job, items: [{ id, pn, desc, qty, lot, note, check, label }], recorded: { loanKey, at, applied } }. ── */

const STOCK_PN = '[0-9OoIl|]{3}[\\s]?[-–—_.][\\s]?[0-9OoIl|]{6}[\\s]?[-–—_.][\\s]?[0-9OoIl|]{2}' // Mindray's usual 040-001235-00 (O for 0, l and | for 1 are read wrongly most often)
const STOCK_STD = new RegExp(`\\b${STOCK_PN}\\b`, 'g')
const STOCK_LABEL = /\b(?:P\s?[/\\|I1l]\s?N|PN|P\.N\.?|Part\s*(?:No\.?|Number|#))\s*[:;#.\-]?\s*([^\n]{0,40})/gi
const STOCK_ODD = /^[A-Z0-9][A-Z0-9\-–—/._]{4,}$/i
const STOCK_CODE = /^\d{3,4}[-–—]\d{2,6}[-–—]\d{1,5}$/ // 040-001235-00, 0010-30-42731, 6200-30-09688
const STOCK_DATE = /^(19|20)\d{2}[-–—.]\d{2}[-–—.]\d{2}$/
const stockKey = (pn) => String(pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const NOT_TITLE = /(p\s?[/\\|]\s?n|\bmodel\b|\blot\b|\bqty\b|\bref\b|\bsn\b|made in|china|shenzhen|nanshan|bio-?\s?medical|co\.?,?\s*ltd|www\.|\.com|\.cn|steril|latex|rx only|manufactur|expir|use by|\bdate\b|caution|warning|\bce\b|barcode|\bgs1\b|\bud[i1]\b|recycle|disposal|building|\broad\b|industrial|\bpark\b|hamburg|germany|eiffel|international|holding|gmbh|electronics|\btel\b|\bfax\b|keji|\bmd\b)/i
const PRODUCT_WORDS = /\b(cables?|leads?|leadset|cuffs?|sensors?|hose|tubing|probes?|adapt[eo]rs?|electrodes?|wires?|trunk|extension|sampling|lines?|traps?|filters?|masks?|transducers?|thermometers?|temp|spo2|nibp|ecg|ibp)\b/i
const STOCK_FORMAT_NOTE = 'Different format from the usual 040-xxxxxx-00. Check against SimPro.'

// "O40-OO1235-OO" → "040-001235-00"; fixed says a look-alike was put right.
function fixStdPn(raw) {
  const digits = raw.replace(/[\s\-–—_.]/g, '')
  const fixed = digits.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1')
  return { pn: `${fixed.slice(0, 3)}-${fixed.slice(3, 9)}-${fixed.slice(9)}`, fixed: fixed !== digits }
}

/** A code with the characters a photo confuses made the same (O/0, I/L/1, B/8, S/5, Z/2), for comparing a read code with the list's. */
const fuzzKey = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9|]/g, '').replace(/O/g, '0').replace(/[IL|]/g, '1').replace(/B/g, '8').replace(/S/g, '5').replace(/Z/g, '2')

/** The edit distance between two short strings, or max + 1 once it is certain to be more. */
function within(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i])
  for (let j = 1; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return dp[a.length][b.length]
}

/**
 * A part number read from a photo, found on the accessory list. `exact`: the list has it (a look-alike character aside).
 * `near`: one list code is one character away (a missing digit, a misread one). `fragment`: what was read is part of exactly
 * one list code ("42731" for 0010-30-42731). `ambiguous`: more than one fits (`candidates`). Otherwise `none`.
 * { status, item, candidates: [the list items that fit, at most 3] }
 */
export function matchAccessory(read, list = []) {
  const k = fuzzKey(read)
  const none = { status: 'none', item: null, candidates: [] }
  if (k.length < 5) return none
  const keyed = (list || []).filter((a) => a && a.code).map((a) => ({ a, k: fuzzKey(a.code) }))
  const exact = keyed.find((x) => x.k === k)
  if (exact) return { status: 'exact', item: exact.a, candidates: [exact.a] }
  const pick = (found, status) => (found.length === 1 ? { status, item: found[0].a, candidates: [found[0].a] } : { status: 'ambiguous', item: null, candidates: found.slice(0, 3).map((x) => x.a) })
  if (k.length >= 8) { const near = keyed.filter((x) => within(k, x.k, 1) <= 1); if (near.length) return pick(near, 'near') }
  const frag = keyed.filter((x) => x.k.length > k.length && x.k.includes(k))
  return frag.length ? pick(frag, 'fragment') : none
}

/**
 * How much of a label's own wording a read holds (Mindray's name, its address, "Rx Only", "Made in China", Qty, LOT, P/N…): a photo
 * is read the way up it was taken and sideways, and the way that holds the most is the right way up.
 */
export function labelEvidence(text) {
  const t = String(text || '')
  return [/\bmindray\b/i, /bio-?\s?medical/i, /electronics/i, /made in china/i, /\brx\s*only\b/i, /\bqty\b/i, /\blot\b/, /\bp\s?\/\s?n\b/i, /shenzhen|nanshan|hamburg|germany|eiffel/i, /industrial park/i, /latex/i]
    .reduce((n, re) => n + (re.test(t) ? 1 : 0), 0)
}

/** What a label's text holds: the part numbers (with model, lot and a description built from the label) and whether the
    photo shows patient details. With the accessory list, a number is looked up there (see matchAccessory).
    { patient, items: [{ pn, read, match, item, candidates, model, lot, desc, titled, fixed, formatNote, labelled }] } */
export function readLabelText(text, list = []) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const all = lines.join('\n')
  if (/\bNHI\b|\bDOB\b|date of birth/i.test(all)) return { patient: true, items: [] } // QP33: patient details must not be in the photo

  // Every code-like run of characters, with the line it is on.
  const tokens = []
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/[A-Za-z0-9|]+(?:\s?[-–—]\s?[A-Za-z0-9|]+)*/g)) {
      const sq = m[0].replace(/[^A-Za-z0-9|]/g, '')
      if (sq.length >= 5 && sq.length <= 16 && (sq.match(/\d/g) || []).length >= 3) tokens.push({ raw: m[0], line: i })
    }
  })

  const found = [] // { pn, read, line, match, item, candidates, fixed, odd, labelled }
  const seen = new Set()
  const take = (c) => { const k = c.item ? stockKey(c.item.code) : stockKey(c.pn); if (!k || seen.has(k)) return; seen.add(k); found.push(c) }

  // 1. What the accessory list has: exact, then a character out, then a piece of a code (a piece only when nothing better).
  const rank = { exact: 3, near: 2, fragment: 1 }
  const hits = new Map()
  for (const t of tokens) {
    const m = list.length ? matchAccessory(t.raw, list) : { status: 'none' }
    if (!rank[m.status]) continue
    const k = stockKey(m.item.code), was = hits.get(k)
    if (!was || rank[m.status] > rank[was.match]) hits.set(k, { pn: m.item.code, read: t.raw.trim(), line: t.line, match: m.status, item: m.item, candidates: [m.item], fixed: false, odd: false, labelled: false })
  }
  const best = Math.max(0, ...[...hits.values()].map((h) => rank[h.match]))
  for (const h of hits.values()) if (rank[h.match] === best || (best === 3 && rank[h.match] === 2)) take(h)

  // 2. Nothing on the list: the number beside P/N, then any number in the shape of Mindray's.
  if (!found.length) {
    lines.forEach((line, i) => {
      for (const m of line.matchAll(STOCK_LABEL)) {
        const rest = m[1]
        const std = new RegExp(STOCK_PN).exec(rest)
        if (std) { const f = fixStdPn(std[0]); take({ pn: f.pn, read: std[0], line: i, match: 'none', item: null, candidates: [], fixed: f.fixed, odd: false, labelled: true }); continue }
        const tok = (rest.match(/^[^\s]+/) || [''])[0].replace(/[,;]+$/, '')
        if (STOCK_ODD.test(tok) && /\d/.test(tok)) take({ pn: tok.toUpperCase(), read: tok, line: i, match: 'none', item: null, candidates: [], fixed: false, odd: !STOCK_CODE.test(tok), labelled: true })
      }
    })
    lines.forEach((line, i) => {
      for (const m of line.matchAll(STOCK_STD)) { const f = fixStdPn(m[0]); take({ pn: f.pn, read: m[0], line: i, match: 'none', item: null, candidates: [], fixed: f.fixed, odd: false, labelled: false }) }
    })
    for (const t of tokens) {
      const raw = t.raw.replace(/\s/g, '')
      if (STOCK_CODE.test(raw) && !STOCK_DATE.test(raw)) take({ pn: raw, read: t.raw.trim(), line: t.line, match: 'none', item: null, candidates: [], fixed: false, odd: false, labelled: false })
    }
  }

  found.sort((a, b) => a.line - b.line)
  const items = found.map((c, n) => {
    // The lines that belong to this label: half way to the neighbouring part numbers, at most five either side.
    // One part number: the whole text is its label (a photo is read twice over, so its lines are not in one order).
    const from = found.length === 1 ? 0 : Math.max(n ? Math.ceil((found[n - 1].line + c.line) / 2) : 0, c.line - 5)
    const to = found.length === 1 ? lines.length - 1 : Math.min(n < found.length - 1 ? Math.floor((c.line + found[n + 1].line) / 2) : lines.length - 1, c.line + 5)
    const near = lines.slice(from, to + 1)
    const nearText = near.join('\n')
    const model = (/\bModel\s*(?:No\.?)?\s*[:;#.]?\s*([A-Z0-9][A-Z0-9\-/.]{2,})/i.exec(nearText) || [])[1]
      || (near.find((l) => /^(?:[A-Z]{1,4}\d{2,5}[A-Z]?|\d{3,4}[A-Z])$/.test(l)) || '')
    const lot = (/\b(?:LOT|BATCH)\s*(?:No\.?)?\s*[:;#.]?\s*([A-Z0-9][A-Z0-9\-]{2,})/i.exec(nearText) || [])[1] || (near.find((l) => /^\d{9,10}$/.test(l)) || '')
    const title = near
      .map((l) => l.replace(/^\W*mindray\b[\s:,\-]*/i, '').replace(/^(?:\S{1,2}\s+)+/, '').replace(/(?:\s+\S{1,2})+$/, '').trim()) // and the stray marks the Chinese lines beside it leave
      .filter((l) => l.length >= 6 && l.length <= 70 && !NOT_TITLE.test(l) && (l.match(/[A-Za-z]/g) || []).length / l.length >= 0.6 && PRODUCT_WORDS.test(l)
        && l.split(/\s+/).filter((w) => /^[A-Za-z]{1,2}$/.test(w) || /[^A-Za-z0-9()/.,&\-]/.test(w)).length <= 1) // not a line of noise
      .sort((a, b) => b.length - a.length)[0] || ''
    const desc = ['Mindray', title || 'accessory'].join(' ') + (model ? ` (${model.toUpperCase()})` : '')
    return { pn: c.pn, read: c.read, match: c.match, item: c.item, candidates: c.candidates, model: model.toUpperCase(), lot: lot.toUpperCase(), desc, titled: !!title, fixed: c.fixed, formatNote: c.odd ? STOCK_FORMAT_NOTE : '', labelled: c.labelled }
  })
  return { patient: false, items }
}

/** A read item as a form's row. A number the list has is described by the list (its own name, nothing to check); a near
    miss becomes the list's code, marked to check; one the list hasn't got is kept as read, marked to check. */
export function stockItemFrom(read, qty, list = [], id = '') {
  const notes = []
  let pn = read.pn, desc = read.desc
  const found = read.match && read.match !== 'none' ? null : read.pn ? matchAccessory(read.pn, list) : null
  const m = found ? { match: found.status, item: found.item } : { match: read.match || 'none', item: read.item || null }
  if (m.match === 'exact' && m.item) { pn = m.item.code; desc = m.item.name || read.desc }
  else if ((m.match === 'near' || m.match === 'fragment') && m.item) {
    pn = m.item.code; desc = m.item.name || read.desc
    notes.push(`Read as “${read.read || read.pn}”. The closest accessory-list item is ${m.item.code}: check it against the label.`)
  } else {
    if (list.length) notes.push('Not on the accessory list (Manage › Accessories). Check the part number against the label.')
    if (read.fixed) notes.push('A look-alike character was put right in the part number: check it against the label.')
    if (!read.labelled && read.pn) notes.push('No P/N line was found beside this number: check it is the part number.')
    if (read.formatNote) notes.push(read.formatNote)
    if (!read.titled) notes.push('The description wasn’t on the label’s text: check it.')
  }
  return { id, pn, desc, qty: Math.min(999, Math.max(1, Math.round(Number(qty) || 1))), lot: read.lot || '', label: read.titled ? read.desc : '', note: notes.join(' '), check: notes.length > 0 }
}

/**
 * Photo results put on a form: a part number not there yet is added; one already there with a different lot (or this
 * lot read for the first time) is more of the same, so its quantity goes up; one already there with the same lot, or
 * no lot read either time, might be the same bag again, so it is returned in `ask` for the person to decide.
 * { items, added: [pn], bumped: [{ pn, qty }], ask: [{ pn, qty, lot, total }] }
 */
export function addStockItems(items, reads, qty, list = [], newId = () => Math.random().toString(36).slice(2, 10)) {
  const out = items.map((i) => ({ ...i })), added = [], bumped = [], ask = []
  for (const r of reads || []) {
    const row = stockItemFrom(r, qty, list, newId())
    const at = out.find((i) => row.pn && stockKey(i.pn) === stockKey(row.pn))
    if (!at) { out.push(row); added.push(row.pn); continue }
    const add = Math.min(999, Math.max(1, Math.round(Number(qty) || 1)))
    if (r.lot && at.lot && r.lot.toLowerCase() !== at.lot.toLowerCase()) { at.qty = Math.min(999, at.qty + add); bumped.push({ pn: at.pn, qty: at.qty }) }
    else if (r.lot && !at.lot) { at.lot = r.lot; ask.push({ pn: at.pn, qty: add, lot: r.lot, total: at.qty + add }) }
    else ask.push({ pn: at.pn, qty: add, lot: r.lot || at.lot || '', total: at.qty + add })
  }
  return { items: out, added, bumped, ask }
}

/** The reason as written on the form: "Demo – Whanganui Hospital" for a demo (the loan, once chosen), else what was typed.
    (A form kept before there was a kind: a reason typed is "other", none is a demo.) */
export const isStockDemo = (form) => (form?.kind ? form.kind === 'demo' : !String(form?.reason || '').trim())
export function stockReasonText(form) {
  if (!isStockDemo(form)) return String(form?.reason || '').trim()
  return form?.loan?.label ? `Demo – ${form.loan.label}` : 'Demo'
}

export const STOCK_COLUMNS = [['date', 'Date taken'], ['pn', 'Item’s part number'], ['desc', 'Item description'], ['qty', 'Quantity taken'], ['reason', 'Reason for taking'], ['job', 'SimPro Job Number'], ['by', 'Taken by']]

/** The form as rows for the sheet or the paper form: one row an item, the shared fields repeated. */
export function stockRows(form) {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(form?.date || '') // dd-mmm-yyyy
  const date = d ? `${d[3]}-${MONTHS[Number(d[2]) - 1]}-${d[1]}` : String(form?.date || '')
  const reason = stockReasonText(form)
  return (form?.items || []).filter((i) => String(i.pn || '').trim() || String(i.desc || '').trim())
    .map((i) => ({ date, pn: String(i.pn || '').trim(), desc: String(i.desc || '').trim(), qty: Math.max(1, Math.round(Number(i.qty) || 1)), reason, job: form.job || '', by: form.by || '' }))
}

/** What stops a form being handed in, as short sentences (empty when it is complete). */
export function stockProblems(form, list = []) {
  const rows = stockRows(form), out = []
  const demo = isStockDemo(form)
  if (!rows.length) out.push('No items yet.')
  if (demo && !form?.loan?.key) out.push('Choose the loan this demo is for.')
  if (!demo && !String(form?.reason || '').trim()) out.push('Say what they are being taken for.')
  if (!String(form?.by || '').trim()) out.push('Add who took them.')
  if (!String(form?.job || '').trim()) out.push('The SimPro job number is still blank.')
  const off = (form?.items || []).filter((i) => String(i.pn || '').trim() && list.length && matchAccessory(i.pn, list).status !== 'exact').length
  if (off) out.push(`${off} part number${off === 1 ? ' isn’t' : 's aren’t'} on the accessory list.`)
  if ((form?.items || []).some((i) => i.check)) out.push('Some items are marked to check.')
  return out
}

/**
 * The loans a demo's stock can be recorded on: every loan and booking, the ones that match what was typed (matchLoan),
 * current first, then those starting soonest. [{ key, label, g }] (at most `limit`)
 */
export function stockLoanChoices(sections, q = '', { limit = 8 } = {}) {
  const order = ['needsReassign', 'current', 'upcoming', 'longTerm']
  const all = order.flatMap((sec, n) => (sections?.[sec] || []).map((g) => ({ g, n })))
  return all.filter(({ g }) => matchLoan(g, q))
    .sort((a, b) => a.n - b.n || String(a.g.startDate || '9999').localeCompare(String(b.g.startDate || '9999')))
    .slice(0, limit).map(({ g }) => ({ key: g.key, label: g.loanTo || 'a loan', g }))
}

/**
 * Stock taken for a demo recorded on its loan's accessories: each accessory taken has `stock` on the loan's line, how many
 * of that line came out of stock. One already on the loan keeps its Qty (raised to the stock taken if that is more); one not
 * on the loan is added with both. `applied` is what an earlier recording of this form put there ({ code key: how many }), so
 * recording again after a change moves the number by the difference and never counts twice. A part number the accessory list
 * hasn't got, and the loan's lines don't have, is left out (`problems`): it may be a misread.
 * { lines, changes: [{ code, name, taken, added, before: { qty, stock } | null, after: { qty, stock } }], problems: [{ code }], applied }
 */
export function stockOnLoan(accessories, items, { applied = {}, list = [] } = {}) {
  const lines = cleanAccessories(accessories)
  const at = new Map(lines.map((a, i) => [accKey(a.code) || 'name:' + a.name.toLowerCase(), i]))
  const want = new Map()
  for (const i of items || []) {
    const code = String(i?.pn || '').trim()
    if (!code) continue
    const k = accKey(code), w = want.get(k) || { code, name: String(i.desc || '').trim(), qty: 0 }
    w.qty += Math.min(999, Math.max(1, Math.round(Number(i.qty) || 1)))
    want.set(k, w)
  }
  const changes = [], problems = [], next = {}
  for (const k of new Set([...want.keys(), ...Object.keys(applied || {})])) {
    const w = want.get(k), was = Number(applied?.[k]) || 0, taken = w ? w.qty : 0
    const delta = taken - was
    const idx = at.get(k)
    const listed = w ? listedAccessory({ code: w.code }, list) : null
    if (taken) next[k] = taken
    if (idx == null) {
      if (!w || !taken) continue
      if (!listed) { problems.push({ code: w.code }); delete next[k]; continue }
      lines.push({ code: listed.code || w.code, name: listed.name || w.name, qty: taken, stock: taken })
      at.set(k, lines.length - 1)
      changes.push({ code: listed.code || w.code, name: listed.name || w.name, taken, added: true, before: null, after: { qty: taken, stock: taken } })
      continue
    }
    if (!delta) continue
    const line = lines[idx], before = { qty: line.qty, stock: line.stock || 0 }
    const stock = Math.min(999, Math.max(0, before.stock + delta))
    if (stock) { line.stock = stock; line.qty = Math.max(line.qty, stock) } else delete line.stock
    changes.push({ code: line.code, name: line.name, taken, added: false, before, after: { qty: line.qty, stock } })
  }
  return { lines, changes, problems, applied: next }
}

const COL_MAP = {
  model: 'Model', description: 'Description', 'serial number': 'SerialNo', 'serial no': 'SerialNo', serial: 'SerialNo',
  'battery serial number': 'BatterySerialNo', 'battery serial no': 'BatterySerialNo', 'battery serial': 'BatterySerialNo',
  'manufacture date': 'MfgDate', 'manufacturing date': 'MfgDate', 'mfg date': 'MfgDate',
  'chs asset number': 'CHSAssetNo', 'chs asset no': 'CHSAssetNo', 'chs asset': 'CHSAssetNo', 'asset number': 'CHSAssetNo', 'asset no': 'CHSAssetNo',
  'tile number': 'TileNo', 'tile no': 'TileNo', tile: 'TileNo', 'on loan to': 'OnLoanTo', 'loaned to': 'OnLoanTo', location: 'Location',
  'loan start date': 'LoanStartDate', 'loan start': 'LoanStartDate', 'loan end date': 'LoanEndDate', 'loan end': 'LoanEndDate',
  returned: 'Returned', counted: 'Counted', 'part number': 'PartNo', 'part no': 'PartNo', 'purchase date': 'PurchaseDate',
  'us$ price': 'USPrice', 'us price': 'USPrice', 'usd price': 'USPrice', 'us$': 'USPrice',
  'nz$ purchase price': 'NZPrice', 'nz$ price': 'NZPrice', 'nz price': 'NZPrice', 'nzd price': 'NZPrice', 'nz$': 'NZPrice',
  'shelf location': 'ShelfLocation', notes: 'Notes', 'device id': 'DeviceID', deviceid: 'DeviceID', 'lan mac': 'LanMAC', 'lan mac address': 'LanMAC',
  'wlan mac': 'WlanMAC', 'wlan mac address': 'WlanMAC', 'wifi mac': 'WlanMAC', 'old chs #': 'OldCHS', 'old chs': 'OldCHS', 'old chs number': 'OldCHS', 'tile type': 'TileType',
}
/** A spreadsheet date as YYYY-MM-DD: already that, DD/MM/YYYY, or an Excel day number (old: normaliseDate). */
export function importDate(v) {
  const s = String(v ?? '').trim()
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  const n = Number(s)
  if (/^\d{4,6}$/.test(s) && n >= 1000 && n <= 99999) {
    const d = new Date(Date.UTC(1900, 0, n - 1))
    if (n >= 60) d.setUTCDate(d.getUTCDate() - 1)
    return d.toISOString().slice(0, 10)
  }
  return s
}
/** A spreadsheet row as an item's fields, by its column names (old: mapRow). */
export function importRow(row) {
  const out = {}
  for (const [k, v] of Object.entries(row || {})) {
    const f = COL_MAP[String(k).toLowerCase().trim()]
    if (f) out[f] = ['MfgDate', 'PurchaseDate', 'LoanStartDate', 'LoanEndDate'].includes(f) ? importDate(v) : v
  }
  return out
}
/** Imported rows applied (old: confirmImport): a known asset number is updated, a new one added. */
export function applyImport(equipment, rows) {
  const eq = [...equipment]
  let added = 0, updated = 0
  for (const row of rows) {
    const m = importRow(row)
    if (!m.CHSAssetNo) continue
    m.CHSAssetNo = String(m.CHSAssetNo).trim()
    const idx = eq.findIndex((e) => e && String(e.CHSAssetNo || '').toLowerCase() === m.CHSAssetNo.toLowerCase())
    if (idx >= 0) { eq[idx] = { ...eq[idx], ...m }; updated++ } else { eq.unshift({ id: newId(), BatterySerialNo: '—', ...m }); added++ }
  }
  return { equipment: eq, added, updated }
}

/* Kits: a device that, when loaned, usually goes with accessories (old: kitGroups, checkKitSuggestion).
   Offered by model, not by unit: any device of a trigger's model starts the kit, and each accessory is
   offered as its model, with every unit of that model to choose from, so another one can go when the
   kit's own is out (three EP30s, each with its own ES30 and charger; two A9s sharing the vaporisers). */

/** A model as kits compare it: case, spaces and dashes ignored ('SP5-1S' is 'SP5-1s'). */
export const modelKey = (m) => String(m || '').toLowerCase().replace(/[\s\-_.]/g, '')
const assetKey = (no) => String(no || '').trim().toLowerCase()

/** Every device of a model in the equipment list. */
export const unitsOfModel = (equipment, model) => {
  const k = modelKey(model)
  return k ? (equipment || []).filter((e) => e && e.CHSAssetNo && modelKey(e.Model) === k) : []
}

/**
 * The kit a device starts and what it offers, by model. The kit whose trigger devices include this one;
 * failing that, every kit whose trigger is the same model (an EP30 in no kit gets what the EP30 kits
 * have). Each accessory model says how many go with each trigger (`qty`), how many are still wanted on
 * this loan (`need`: one set per trigger of that model picked, less those of the model already picked),
 * and every unit of the model not yet picked, with what it would do on this loan's dates (`ctx`, as
 * assetStatus): 'free' (goes now), 'clash' (free, but another booking is waiting for it on these dates)
 * or 'out' (on loan or booked over these dates). `pick` is what is ticked to start with: the kit's own
 * units that are free, and only for the device's own kit; any other unit is the person's choice.
 * Returns null when the device starts no kit.
 */
export function kitFor(kits, equipment, assetNo, picked = [], ctx = {}) {
  const device = findAsset(equipment, assetNo)
  const no = assetKey(device?.CHSAssetNo || assetNo)
  const all = Object.entries(kits || {}).filter(([, k]) => k && typeof k === 'object')
  const own = all.find(([, k]) => (k.triggers || []).some((t) => assetKey(t) === no))
  const model = modelKey(device?.Model)
  const triggerModel = (t) => modelKey(findAsset(equipment, t)?.Model)
  const found = own ? [own] : model ? all.filter(([, k]) => (k.triggers || []).some((t) => triggerModel(t) === model)) : []
  if (!found.length) return null
  const pickedKeys = new Set(picked.map(assetKey))
  const pickedItems = picked.map((p) => findAsset(equipment, p)).filter(Boolean)
  const triggersPicked = Math.max(1, model ? pickedItems.filter((e) => modelKey(e.Model) === model).length : 1)

  // The accessories, model by model: the most of a model any one of these kits has is how many go with each trigger.
  const groups = new Map()
  for (const [, k] of found) {
    const inKit = new Map()
    for (const a of k.accessories || []) {
      const item = findAsset(equipment, a.assetNo)
      const name = item?.Model || a.model || ''
      const key = modelKey(name) || 'asset:' + assetKey(a.assetNo)
      if (key === model) continue // another of the trigger itself isn't an accessory of it
      const g = inKit.get(key) || { key, model: name || String(a.assetNo || ''), qty: 0, own: [] }
      g.qty++
      if (item) g.own.push(item.CHSAssetNo)
      inKit.set(key, g)
    }
    for (const g of inKit.values()) {
      const have = groups.get(g.key)
      if (!have) groups.set(g.key, { ...g, own: own ? g.own : [] })
      else have.qty = Math.max(have.qty, g.qty)
    }
  }

  const rank = { free: 0, clash: 1, out: 2 }
  const models = [...groups.values()].map((g) => {
    const units = (g.key.startsWith('asset:') ? [] : unitsOfModel(equipment, g.model))
      .filter((e) => assetKey(e.CHSAssetNo) !== no)
    const already = units.filter((e) => pickedKeys.has(assetKey(e.CHSAssetNo))).length
    const offered = units.filter((e) => !pickedKeys.has(assetKey(e.CHSAssetNo))).map((e) => {
      const st = assetStatus(equipment, ctx.upcoming || [], e.CHSAssetNo, ctx)
      const status = st.will === 'follow' ? 'out' : st.waiting?.length ? 'clash' : 'free'
      return { no: e.CHSAssetNo, item: e, status, own: g.own.includes(e.CHSAssetNo), will: st.will, next: st.next || null, waiting: st.waiting || [] }
    }).sort((a, b) => rank[a.status] - rank[b.status] || Number(b.own) - Number(a.own) || String(a.no).localeCompare(String(b.no), undefined, { numeric: true }))
    const need = Math.max(0, g.qty * triggersPicked - already)
    const pick = offered.filter((u) => u.own && u.status === 'free').slice(0, need).map((u) => u.no)
    return { key: g.key, model: g.model, qty: g.qty, need, units: offered, pick }
  })
  const [key, kit] = found[0]
  return { key, label: found.length === 1 ? kit.label || key : device?.Model || kit.label || key, own: !!own, models }
}

/* Simpro job health (old: findLoansMissingSimproJob, _isPreWindDownLoan) */

/** Loans out with no Simpro job: only ones started before job creation was switched off, unless it's on. */
export function loansMissingJobs(sections, loanDocs = {}, cfg = {}, today = nzDate(), equipment = []) {
  const before = (key, start) => {
    if (cfg.createJobs || !cfg.windDownFrom) return true
    const m = /^(?:test)?batch_(\d{10,})$/.exec(key || '')
    if (m) return new Date(Number(m[1])).toLocaleDateString('en-CA', { timeZone: 'Pacific/Auckland' }) < cfg.windDownFrom
    return !start || start < cfg.windDownFrom
  }
  // Bookings with no loan yet too, their devices from the equipment list (old: the "Upcoming" rows); soonest start first.
  const live = (i) => equipment.find((e) => e && (e.id === i.id || e.CHSAssetNo === i.CHSAssetNo)) || i
  return [...sections.needsReassign, ...sections.current, ...sections.upcoming]
    .filter((g) => g.loanTo && g.loanTo.trim() && !g.longTerm)
    .map((g) => ({ ...g, docKey: loanDocKey(g), ...(g.kind === 'booking' ? { items: (g.pending || []).map(live) } : {}) }))
    .filter((g) => !loanDocs[g.docKey]?.simproJobId && before(g.docKey, g.startDate))
    .map((g) => ({ ...g, type: g.kind === 'booking' ? 'Upcoming' : g.startDate && g.startDate > today ? 'Scheduled' : 'Active' }))
    .sort((a, b) => ((a.startDate || '') < (b.startDate || '') ? -1 : 1))
}

/* ── Links in (old: handleReturnLink, openLoanFromProjectTracker, openStuckLoanReassign) ── */

/** A loan's return / extend token, as the old one makes them for its emails: base64 of "customer|||endDate". */
export const loanToken = (loanTo, endDate) => btoa(encodeURIComponent(loanTo + '|||' + (endDate || ''))).replace(/=/g, '')

/**
 * Where an address from outside lands, from its query (old links, kept
 * working): ?tab=…; ?newLoan=1&ref=…&loanTo=…&location=…&start=…&end=…&notes=…
 * (the project tracker); ?return= / ?extend= (a loan's token: that loan, its
 * Return or Extend open); ?reassign=<booking> (a booking waiting on devices:
 * the loan they're on, Transfer open with them ticked and the booking chosen);
 * ?open=<BatchID> (a reminder about one loan: that loan, open).
 * Returns { view, params, note } or null for nothing to do.
 */
export function linkTarget(search, sections, upcoming = [], equipment = []) {
  const p = new URLSearchParams(search || '')
  const all = [...sections.needsReassign, ...sections.current, ...sections.longTerm, ...sections.upcoming]
  const tabs = { loans: 'loans', database: 'equipment', scan: 'scan', calendar: 'calendar', history: 'history', retired: 'manage', import: 'manage', settings: 'manage' }
  if (p.get('newLoan') === '1') {
    const params = { ref: p.get('ref') || '', loanTo: p.get('loanTo') || '', location: p.get('location') || '', start: p.get('start') || '', end: p.get('end') || '', notes: p.get('notes') || '' }
    return { view: 'new', params: Object.fromEntries(Object.entries(params).filter(([, v]) => v)) }
  }
  const reassign = p.get('reassign')
  if (reassign) {
    const u = upcoming.find((x) => x.id === reassign)
    if (!u) return { view: 'loans', params: {}, note: 'That booking has gone: it may already be sorted.' }
    const blocked = (u.items || []).map((i) => equipment.find((e) => e && (e.id === i.id || e.CHSAssetNo === i.CHSAssetNo))).filter((e) => e && isOut(e) && e.OnLoanTo !== u.loanTo)
    const from = blocked.length && all.find((g) => g.kind !== 'booking' && g.items.some((e) => e.id === blocked[0].id))
    const to = all.find((g) => g.batchId === u.id)
    if (!from || !to) return { view: 'loans', params: to ? { open: to.kind + ':' + to.key } : {}, note: `Nothing is holding up ${u.loanTo}’s booking any more.` }
    // Other loans holding devices it waits on follow, one after another (queue).
    const rest = reassignGroups(to, all, equipment).filter((x) => x.key !== from.kind + ':' + from.key)
    return { view: 'loans', params: { open: from.kind + ':' + from.key, act: 'transfer', to: to.kind + ':' + to.key, nos: blocked.filter((e) => from.items.some((x) => x.id === e.id)).map((e) => e.CHSAssetNo).join(','), ...(rest.length ? { queue: encodeQueue(rest) } : {}) } }
  }
  const open = p.get('open')
  if (open) {
    const g = all.find((x) => x.batchId === open || x.key === open)
    return g ? { view: 'loans', params: { open: g.kind + ':' + g.key } } : { view: 'loans', params: {}, note: 'That loan isn’t out any more: it may already be back.' }
  }
  const token = p.get('return') || p.get('extend')
  if (token) {
    let loanTo = '', endDate = ''
    try { [loanTo, endDate] = decodeURIComponent(atob(token)).split('|||') } catch { return { view: 'loans', params: {}, note: 'That link couldn’t be read.' } }
    const loans = all.filter((g) => g.kind === 'loan' && g.loanTo === loanTo)
    const g = loans.find((x) => (x.endDate || '') === (endDate || '')) || loans[0]
    if (!g) return { view: 'loans', params: {}, note: `${loanTo}’s loan isn’t out any more: it may already be back.` }
    return { view: 'loans', params: { open: g.kind + ':' + g.key, act: p.get('return') ? 'return' : (g.longTerm ? '' : 'extend') } }
  }
  const tab = p.get('tab')
  if (tab) return { view: tabs[tab] || 'overview', params: tab === 'retired' ? { part: 'retired' } : tab === 'settings' ? { part: 'kits' } : {} }
  return null
}

/**
 * The tracker's team (step 5A): the hub's people who have a tracker role
 * (users.trackerRole, 'am' or 'service', set in Settings, People and access),
 * signed in or not. A person is { uid, name, email, role, notify? }; the name
 * is their hub display name (else email), which is what a loan's account
 * manager holds. `notify: false` when they switched demo reminders off.
 */
export function teamFrom(users = []) {
  return users
    .filter((u) => u && !u.pending && (u.trackerRole === 'am' || u.trackerRole === 'service'))
    .map((u) => {
      const m = { uid: u.uid, name: String(u.displayName || u.email || '').trim(), email: u.email || '', role: u.trackerRole }
      if (u.notifications?.demoReminders === false) m.notify = false
      return m
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}
