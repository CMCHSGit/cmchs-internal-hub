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
