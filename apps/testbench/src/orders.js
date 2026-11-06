/* Orders: a job (or a customer's batch) with how many of each device model are to be tested, e.g. 15 D30 and 2 D60, so that at the end
   of testing every device is accounted for. Any engineer can test devices for an order from any laptop: a finished test counts toward
   an order when it was started against that order, or when its customer matches the order's customer (and it is not for another order).

   The tests are the shared finished tests (bench-tests.js: serial, model, customer, result, who, when), so nothing about a test is
   copied into the order: this file only decides which tests belong to which order and how far along it is. Plain functions (the tests
   run them); the Firestore calls are in orders-firebase.js. */

/** Lower case, letters and digits only, one space between words. */
export const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Same customer: the same name, or one name inside the other ("Waikato" in "Waikato District Health Board"), from four letters up. */
export function sameCustomer(a, b) {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  return x === y || (Math.min(x.length, y.length) >= 4 && (x.includes(y) || y.includes(x)))
}

/** An order's job number as people type it ("#209676", "Job 209676") -> "209676". */
export const jobNumber = (s) => { const m = String(s ?? '').match(/\d{3,}/); return m ? m[0] : String(s ?? '').trim() }

/** "15 D30, 2 D60" -> { D30: 15, D60: 2 }. Also "D30 x15", "D30: 15", one per line. Entries it can't read are returned in `bad`. */
export function parseExpected(text) {
  const out = {}, bad = []
  for (const part of String(text ?? '').split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    let m = part.match(/^(\d+)\s*[x×]?\s*(.+)$/i), n, model
    if (m) { n = +m[1]; model = m[2] } else if ((m = part.match(/^(.+?)\s*(?:[:x×=]|\s)\s*(\d+)$/i))) { model = m[1]; n = +m[2] } else { bad.push(part); continue }
    model = model.trim().replace(/^[x×]\s*/i, '')
    if (!model || !(n > 0) || n > 5000) { bad.push(part); continue }
    out[model] = (out[model] || 0) + n
  }
  return { expected: out, bad }
}

/** { D30: 15, D60: 2 } -> "15 × D30, 2 × D60" */
export const expectedText = (expected) => Object.entries(expected || {}).map(([m, n]) => `${n} × ${m}`).join(', ')
export const expectedTotal = (expected) => Object.values(expected || {}).reduce((a, n) => a + (+n || 0), 0)

/** Does this finished test count toward the order? A test started against an order counts only for that one; otherwise the customer
    decides, and only tests finished on or after the order's start date (an earlier job for the same customer isn't this order). */
export function belongs(order, t) {
  if (t.order) return jobNumber(t.order) === jobNumber(order.number)
  if (!sameCustomer(t.customer, order.customer)) return false
  return !order.since || String(t.finished || '').slice(0, 10) >= order.since
}

/** The order's expected model that a tested model is, e.g. "BeneHeart D30" and "D30, MR6502 Paddles" are "D30": the longest expected name found as whole words. */
export function modelKey(order, model) {
  const nm = ` ${norm(model)} `
  return Object.keys(order.expected || {}).sort((a, b) => norm(b).length - norm(a).length).find((k) => norm(k) && nm.includes(` ${norm(k)} `)) || null
}

/**
 * How far along an order is, from the shared finished tests.
 * A device is a serial number: its latest finished test counts (a rerun replaces the earlier one). A device whose test finished
 * incomplete is not tested yet. Returns { rows: [{ model, need, tested, passed, failed, missing, extra, devices }], other, incomplete,
 * need, tested, passed, failed, missing, complete, devices }.
 */
export function progress(order, tests) {
  const latest = new Map()
  for (const t of [...tests].filter((x) => belongs(order, x)).sort((a, b) => String(a.finished).localeCompare(String(b.finished)))) latest.set(norm(t.serial) || `id:${t.id}`, t)
  const devices = [...latest.values()].sort((a, b) => String(b.finished).localeCompare(String(a.finished)))
  const rows = Object.entries(order.expected || {}).map(([model, need]) => ({ model, need: +need || 0, tested: 0, passed: 0, failed: 0, missing: 0, extra: 0, devices: [] }))
  const other = []; const incomplete = []
  for (const d of devices) {
    if (d.overall !== 'pass' && d.overall !== 'fail') { incomplete.push(d); continue }
    const key = modelKey(order, d.model), row = rows.find((r) => r.model === key)
    if (!row) { other.push(d); continue }
    row.devices.push(d); row.tested++
    if (d.overall === 'pass') row.passed++; else row.failed++
  }
  for (const r of rows) { r.missing = Math.max(0, r.need - r.tested); r.extra = Math.max(0, r.tested - r.need) }
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0)
  return {
    rows, other, incomplete, devices,
    need: sum('need'), tested: sum('tested'), passed: sum('passed'), failed: sum('failed'), missing: sum('missing'),
    complete: rows.length > 0 && rows.every((r) => r.missing === 0),
  }
}

/** One line for the bench's Order selector and the tab's badge: "12 of 17 tested". */
export function summaryLine(order, tests) { const p = progress(order, tests); return `${p.tested} of ${p.need} tested${p.missing ? `, ${p.missing} to go` : ''}` }

/** The open orders the bench offers for a customer: those whose customer matches (all open ones when none is typed). */
export function ordersForCustomer(orders, customer) {
  const open = orders.filter((o) => o.status !== 'closed')
  return customer && norm(customer) ? open.filter((o) => sameCustomer(o.customer, customer)) : open
}

/** What is saved for an order, cleaned: known fields only, short strings, counts as whole numbers. */
export function cleanOrder(o, who, now = Date.now()) {
  const s = (v, n = 200) => String(v ?? '').trim().slice(0, n)
  const expected = {}
  for (const [m, n] of Object.entries(o.expected || {})) { const k = s(m, 80), c = Math.floor(+n); if (k && c > 0 && c <= 5000) expected[k] = c }
  return {
    number: jobNumber(s(o.number, 40)), jobLabel: s(o.jobLabel), customer: s(o.customer), expected,
    since: /^\d{4}-\d{2}-\d{2}$/.test(o.since || '') ? o.since : new Date(now).toISOString().slice(0, 10),
    note: s(o.note, 500), status: o.status === 'closed' ? 'closed' : 'open',
    createdBy: s(o.createdBy || who.email, 120).toLowerCase(), createdByName: s(o.createdByName || who.name || who.email, 120),
    createdAt: +o.createdAt || now, updatedAt: now, ...(o.status === 'closed' ? { closedAt: +o.closedAt || now, closedBy: s(o.closedBy || who.email, 120).toLowerCase() } : {}),
  }
}

/** Why an order can't be saved yet, or ''. */
export function orderProblem(o) {
  if (!jobNumber(o.number)) return 'Enter the job number.'
  if (!String(o.customer || '').trim()) return 'Enter the customer.'
  if (!expectedTotal(o.expected)) return 'Enter how many of each model are to be tested, e.g. 15 D30, 2 D60.'
  return ''
}
