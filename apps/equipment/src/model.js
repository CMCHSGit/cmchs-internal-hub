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

/** Search across what people look an item up by. Every word must match. */
export function searchEquipment(list, q) {
  const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  return list.filter((e) => {
    const hay = [e.CHSAssetNo, e.Model, e.Description, e.SerialNo, e.PartNo, e.OnLoanTo, e.Location, e.ShelfLocation, e.Notes, e.TileNo, e.OldCHS]
      .join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
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

/** A loan's account manager (old: getLoanAM, then getGroupAM's fallback). */
export function loanAM({ batchId, loanTo, endDate, accountManager }, { loanMeta = {}, loanDocs = {} } = {}) {
  if (batchId && loanMeta[batchId]?.accountManager) return loanMeta[batchId].accountManager
  if (loanTo) {
    const [enc, dec] = legacyKeys(loanTo, endDate)
    const found = loanMeta[enc]?.accountManager || loanMeta[dec]?.accountManager || loanDocs[enc]?.accountManager || loanDocs[dec]?.accountManager
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
export function loanSections({ equipment = [], upcoming = [], loanMeta = {}, loanDocs = {}, today = nzDate(), testMode = false } = {}) {
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
    g.am = loanAM(g, ctx)
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
      endDate: u.endDate || '', accountManager: u.accountManager || '', items: [], pending: u.items || [], ghosts: [] }))

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

/** "15 Oct, 17:40" (old: _fmtReadinessTs). */
export function fmtWhen(ts) {
  if (!ts || ts === true) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return String(ts).slice(0, 10)
  return d.toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
}

/** The Simpro job on a loan's form: "Job #209677", "(Closed)" once closed, or pending while it's made. */
export function jobOf(doc) {
  const sj = doc?.simproJobId
  if (!sj) return null
  if (typeof sj === 'object') return { label: 'Simpro job being made', pending: true }
  return { label: 'Job #' + sj, closed: !!doc.simproClosedAt, test: String(sj).startsWith('TEST-') }
}
