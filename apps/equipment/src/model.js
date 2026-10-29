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

/**
 * Search across what people look an item up by. Every word must match somewhere. Best matches first:
 * the model (exactly it first, then starting with it), then the asset number, then the serial number, then anything
 * else (description, location, who it's on loan to...); within each, by asset number.
 */
export function searchEquipment(list, q) {
  const words = String(q || '').toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (!words.length) return list
  const all = (v) => { const t = String(v ?? '').toLowerCase(); return words.every((w) => t.includes(w)) }
  const rank = (e) => {
    // Every field, as the old search (Object.values): MACs, device IDs, battery serials and the rest too.
    const hay = Object.entries(e).filter(([k, v]) => !k.startsWith('_') && (typeof v === 'string' || typeof v === 'number')).map(([, v]) => v)
      .join(' ').toLowerCase()
    if (!words.every((w) => hay.includes(w))) return -1
    if (all(e.Model)) {
      const m = String(e.Model).toLowerCase().trim()
      return m === words.join(' ') ? 0 : m.startsWith(words[0]) ? 1 : 2
    }
    if (all(e.CHSAssetNo)) return 3
    if (all(e.SerialNo)) return 4
    return 5
  }
  return list.map((e) => ({ e, r: rank(e) })).filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || String(a.e.CHSAssetNo ?? '').localeCompare(String(b.e.CHSAssetNo ?? ''), undefined, { numeric: true }))
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

/**
 * "15 Oct, 17:40" (old: _fmtReadinessTs). The old tracker's own timestamps
 * are NZ clock time marked +12:00 all year (nzNow), so in daylight saving,
 * read as a moment, they come out an hour late (the old one shows them so).
 * Those show the clock time as written; anything else is converted to NZ time.
 */
export function fmtWhen(ts) {
  if (!ts || ts === true) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?\+12:00$/.exec(String(ts))
  if (m) return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}, ${m[4]}:${m[5]}`
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

/* ── Overview: the phone's two home screens in one (old: mpRenderToday for
   account managers, mpRenderOverview for Service & Projects) ── */

// Service & Projects when the team list gives no role (old: SERVICE_TEAM_OPERATORS).
const SERVICE_TEAM = ['Peter Lin', 'Jonathan Nasrun']

/** The signed-in person's tracker team record: by name, else by email (old: matchStaffOperator). */
export function memberFor(user, managers = []) {
  if (!user) return null
  const name = (user.displayName || '').trim().toLowerCase(), email = (user.email || '').toLowerCase()
  return (name && managers.find((a) => (a.name || '').trim().toLowerCase() === name)) ||
    (email && managers.find((a) => (a.email || '').toLowerCase() === email)) || null
}

/** 'am' (account manager) or 'service' (Service & Projects) (old: amEffectiveRole). */
export const roleOf = (m) => (m && (m.role || (SERVICE_TEAM.includes(m.name) ? 'service' : 'am'))) || ''

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
export function overviewOf(sections, { equipment = [], upcoming = [], loanMeta = {}, loanDocs = {}, today = nzDate(), testMode = false } = {}) {
  const active = [...sections.needsReassign, ...sections.current, ...sections.longTerm]
  const ahead = sections.upcoming
    .filter((g) => (g.kind === 'scheduled' || (g.startDate && g.pending.length)) && (!g.startDate || g.startDate > today))
  // A booking held up only by devices on long-term loans isn't chased: that's a known, deliberate state (old: checkStuckLoansForAM).
  const blockers = (u) => (u.items || []).map((i) => equipment.find((e) => e && (e.id === i.id || e.CHSAssetNo === i.CHSAssetNo) && isOut(e) && e.OnLoanTo !== u.loanTo)).filter(Boolean)
  const stuck = upcoming.filter((u) => (testMode || !isTestBatch(u.id)) && u.startDate && u.startDate <= today)
    .filter((u) => { const b = blockers(u); return !(b.length && b.every((e) => isLoanLongTerm(e.BatchID, { loanMeta, loanDocs }))) })
  const needsTesting = ahead.filter((g) => {
    if (g.kind === 'booking') return false // nothing reserved yet, so nothing to test
    const r = loanMeta[readinessKey(g)] || {}
    return !r.tested && !r.noTestRequired
  })
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
    active, ahead, stuck, needsTesting, overdue,
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

/** A timestamp as the old tracker writes them: NZ wall-clock time marked +12:00 all year (old: nzNow, kept for now). */
export const nzNow = (d = new Date()) => d.toLocaleString('sv-SE', { timeZone: 'Pacific/Auckland' }).replace(' ', 'T') + '+12:00'

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

/** Where a loan's form is kept for a given end date: its BatchID, else the old key, which has the end date in it. */
export const loanDocKey = (g, endDate = g.endDate) => g.batchId || legacyKeys(g.loanTo, endDate)[0]

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
  return { found: true, item: e, out, clash, will, longTerm: out && isLoanLongTerm(e.BatchID, { loanMeta, loanDocs }), next: next && next.loanTo !== loanTo ? next : null }
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
  if (job != null) doc.simproJobId = job
  if (stored?.simproClosedAt) doc.simproClosedAt = stored.simproClosedAt
  return doc
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
  return `<div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;color:#1a1917">
<table style="width:100%;border-collapse:collapse;margin-bottom:10px"><tr>
<td style="font-size:26px;font-weight:700;line-height:1.1">CMCHS Demo Equipment Loan Form</td>
<td style="text-align:right;width:260px"><img src="${escHtml(logo)}" alt="Connected Healthcare Systems" height="64" style="height:64px;width:auto"></td></tr></table>
<div style="border-top:2px solid #333;border-bottom:1px solid #ccc"></div>
<table style="width:100%;border-collapse:collapse"><tr>${th('Event and/or Customer Name')}${th('Customer Address')}${th('Loan Date')}${th('Loan Ends Date' + (doc.longTerm ? ' — long term' : ''))}${th('Account Manager')}${th('Contact Number')}</tr>
<tr>${td(doc.loanTo)}${td(doc.location)}${td(oldDate(doc.startDate))}${td(doc.longTerm ? '' : oldDate(doc.endDate))}${td(doc.accountManager)}${td(doc.contactNumber)}</tr></table>
<table style="width:100%;border-collapse:collapse;margin-top:10px"><tr>${th('CHS Asset #')}${th('Model')}${th('Description')}${th('Serial/Part #')}${th('Notes/Additional Info')}${th('Data cleared on return', 'text-align:center')}</tr>${rows}</table>
<table style="width:100%;border-collapse:collapse"><tr><td style="border:1px solid #ccc;padding:2px 6px;font-size:11px;font-weight:700;width:14%;text-align:right">Notes:</td><td style="border:1px solid #ccc;padding:4px 6px;font-size:12px">${pre(doc.notes)}</td></tr>
<tr><td style="border:1px solid #ccc;padding:2px 6px;font-size:11px;font-weight:700;text-align:right">Shipping Details:</td><td style="border:1px solid #ccc;padding:4px 6px;font-size:12px">${pre(doc.shipping)}</td></tr></table>
<table style="width:100%;border-collapse:collapse"><tr>
<td style="border:1px solid #ccc;padding:8px 12px;width:28%;vertical-align:top;font-size:11px"><b>Loan authorised by:</b><br><br>Name (print):<br><br>Signature:<br><br>Date:</td>
<td style="border:1px solid #ccc;padding:8px 12px;text-align:center;font-size:12px"><b style="color:#554596">Please ensure this form accompanies<br>demo stock throughout trial and<br>is returned to Connected Healthcare</b><br><b style="color:#dc2626;font-size:11px">Check all units have current ESC</b></td>
<td style="border:1px solid #ccc;padding:8px 12px;width:28%;vertical-align:top;font-size:11px"><b>Return checked by:</b><br><br>Signed:<br><br>Name (print):<br><br>Date:</td></tr></table></div>`
}

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
  loan_created: 'Loan created', loan_deleted: 'Loan deleted', scheduled_deleted: 'Scheduled deleted', loan_extended: 'Extended', loan_edited: 'Edited',
  loan_longterm_on: 'Made long-term', loan_longterm_off: 'Returned to active', items_returned: 'Returned', item_removed: 'Item removed', items_added: 'Items added',
  orphan_recovered: 'Orphan recovered', orphan_deleted: 'Orphan deleted', items_transferred: 'Transferred', loan_reassigned: 'Moved',
  simpro_created: 'Simpro created', simpro_updated: 'Simpro updated', simpro_closed: 'Simpro closed',
  asset_added: 'Asset added', asset_edited: 'Asset edited', asset_deleted: 'Asset deleted', asset_retired: 'Asset retired',
  upcoming_loan_deleted: 'Booking cancelled', upcoming_item_removed: 'Item removed', am_removed: 'AM removed', retired_asset_deleted: 'Retired asset deleted',
  kit_deleted: 'Kit deleted', kit_accessory_removed: 'Kit accessory removed', test_report_uploaded: 'Test report uploaded', test_report_deleted: 'Test report deleted', history_deleted: 'History deleted',
}
export const AUDIT_KINDS = {
  loans: ['loan_created', 'loan_deleted', 'loan_extended', 'loan_edited', 'loan_longterm_on', 'loan_longterm_off', 'items_returned', 'item_removed', 'items_added', 'items_transferred', 'loan_reassigned', 'scheduled_deleted', 'orphan_recovered', 'orphan_deleted', 'upcoming_loan_deleted', 'upcoming_item_removed'],
  database: ['asset_added', 'asset_edited', 'asset_deleted', 'asset_retired'],
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
  const t = new Date(ts).getTime()
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

/** Rows as CSV, every cell quoted (old: exportCSV). */
export function toCsv(rows, columns) {
  const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"'
  return [columns.map(([, h]) => h).join(','), ...rows.map((r) => columns.map(([k]) => cell(r[k])).join(','))].join('\n')
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

/* Kits: a device that, when loaned, usually goes with accessories (old: kitGroups, checkKitSuggestion) */

/** The kit a device starts, with each accessory's state: free, out, already picked, or not in the list. */
export function kitFor(kits, equipment, assetNo, picked = []) {
  const no = String(assetNo || '').trim()
  const key = Object.keys(kits || {}).find((k) => (kits[k].triggers || []).map((t) => String(t).trim()).includes(no))
  if (!key) return null
  const kit = kits[key]
  const accessories = (kit.accessories || []).map((a) => {
    const e = equipment.find((x) => x && String(x.CHSAssetNo || '').trim() === String(a.assetNo || '').trim())
    const isPicked = picked.includes(e?.CHSAssetNo || a.assetNo)
    return { ...a, item: e || null, picked: isPicked, out: !!e && isOut(e), free: !!e && !isOut(e) && !isPicked }
  })
  return { key, label: kit.label || key, accessories }
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
    return { view: 'loans', params: { open: from.kind + ':' + from.key, act: 'transfer', to: to.kind + ':' + to.key, nos: blocked.filter((e) => from.items.some((x) => x.id === e.id)).map((e) => e.CHSAssetNo).join(',') } }
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
 * The tracker's team (step 5A): the old list (accountManagers), with each
 * person's role from their hub record (users.trackerRole) where it's set, and
 * anyone with a hub tracker role who isn't on the old list added. Matched by
 * email, else name. Once every role is on the hub records, the old list goes.
 */
export function teamFrom(old = [], users = []) {
  const out = old.filter(Boolean).map((a) => ({ ...a }))
  for (const u of users) {
    if (!u || u.pending || !u.trackerRole) continue
    const name = String(u.displayName || u.email || '').trim(), email = String(u.email || '').toLowerCase()
    const m = out.find((a) => (email && String(a.email || '').toLowerCase() === email) || (name && String(a.name || '').trim().toLowerCase() === name.toLowerCase()))
    if (m) { m.role = u.trackerRole; if (!m.email && u.email) m.email = u.email }
    else out.push({ name, email: u.email || '', role: u.trackerRole })
  }
  return out.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}
