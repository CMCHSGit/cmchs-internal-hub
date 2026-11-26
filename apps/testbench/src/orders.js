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

/** The form's rows ([{ model, qty }], as typed) -> { expected: { D30: 15 }, bad: [models with no usable quantity] }. A blank row is ignored; a model twice adds up. */
export function rowsToExpected(rows) {
  const expected = {}, bad = []
  for (const r of rows || []) {
    const model = String(r.model ?? '').trim(), raw = String(r.qty ?? '').trim()
    if (!model && !raw) continue
    const n = Number(raw)
    if (!model) { bad.push('a row with no model'); continue }
    if (!raw || !Number.isInteger(n) || n < 1 || n > 5000) { bad.push(model); continue }
    expected[model] = (expected[model] || 0) + n
  }
  return { expected, bad }
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

/** The Simpro job stages that mean the job is finished, so its order closes by itself. */
export const DONE_STAGES = ['Complete', 'Archived']
/**
 * Whether this Simpro job (as getJob returns it) closes this open order: it is the order's job number, its stage is Complete or Archived,
 * and its customer agrees with the order's (a job of that number in another Simpro company is not this order's job). `jobCustomer` is
 * simpro-api's customerOf(job).
 */
export function jobClosesOrder(order, job, jobCustomer = '') {
  if (!order || order.status === 'closed' || !job) return false
  if (String(job.ID ?? '') !== jobNumber(order.number)) return false
  if (!DONE_STAGES.includes(job.Stage)) return false
  if (!norm(jobCustomer) || !norm(order.customer)) return true
  return sameCustomer(order.customer, jobCustomer) || norm(order.jobLabel).includes(norm(jobCustomer))
}

/* ---- Reading the devices off a Simpro job's title -------------------------------------------------------------------------------
   Test-and-add jobs are titled by hand ("Test and add assets - 16x VS9", "test and add asset 2X N19 2X N1 4x VS9", "Test and add
   asset D60 & 3X AED"), so picking the job can fill in the models and how many of each. This is a best guess for people to check:
   a title that lists nothing readable gives no rows. */
const FILLER = new Set(['assets', 'asset', 'assests', 'added', 'into', 'simpro', 'to', 'customer', 'please', 'demo', 'only', 'mindray', 'benevision', 'and', 'the', 'a', 'for'])
const WITH_CODE = new Set(['monitor', 'monitors', 'unit', 'units', 'device', 'devices'])   // dropped only when a model code is there ("N22 monitors" = N22)
const CODE = /^[A-Za-z]{1,5}-?\d{1,4}[A-Za-z]{0,2}$/   // D30, VS9, EPM12, ePM12, TM80, R700, VS-600, C1A
const CAPS = /^[a-z]?[A-Z]{2,6}$/                      // AED, BISX, EPM, ePM
const isCode = (t) => CODE.test(t) || CAPS.test(t)
const CHATTER = /\b(please|put|notes?|order|warranty|invoic\w*|need|them)\b/i   // an instruction to staff, not a device
const isSerial = (t) => (t.match(/\d/g) || []).length >= 6

/** Words of one piece of a title -> the model(s) it names, or []. `counted`: it has a quantity in front of it. */
function modelsIn(text, counted) {
  if (CHATTER.test(text)) return []
  let toks = text.replace(/\([^)]*\)/g, ' ').split(/\s+/).map((t) => t.replace(/^[.,:;"']+|[.,:;"']+$/g, '')).filter((t) => t && !isSerial(t))
  toks = toks.flatMap((t) => (t.includes('-') && t.split('-').every((p) => CODE.test(p)) ? t.split('-') : [t]))
  toks = toks.map((t) => (/\ds$/i.test(t) && CODE.test(t.slice(0, -1)) ? t.slice(0, -1) : t))   // VS9s, R700s
  for (let i = 0; i + 1 < toks.length; i++) if (CAPS.test(toks[i]) && /^\d{1,4}$/.test(toks[i + 1])) toks.splice(i, 2, toks[i] + ' ' + toks[i + 1])   // EPM 15
  toks = toks.filter((t) => !FILLER.has(t.toLowerCase()))
  const isModel = (t) => isCode(t) || /^[a-z]?[A-Z]{2,6} \d{1,4}$/.test(t)
  if (toks.some(isModel)) toks = toks.filter((t) => !WITH_CODE.has(t.toLowerCase()))
  const lead = toks.findIndex((t) => !isModel(t))
  if (lead !== 0 && toks.length) return lead < 0 ? toks : toks.slice(0, lead)   // "N15 N1": each is its own model; "D30 battery charger" is a D30
  return toks.length && (counted || toks.some(isModel)) ? [toks.join(' ')] : []   // other words with a count (or a code in them) are one model; the rest is chatter
}

/**
 * "Test and add assets 6x N22 6XN1 6X secondary monitor" -> [{ model: 'N22', qty: 6 }, { model: 'N1', qty: 6 }, { model: 'secondary monitor', qty: 6 }].
 * Quantities in front ("3X", "3 x", "21 xVS9") or behind ("ePM12 X4"); a model with none counts as 1; pieces split at , ; & + and " - ";
 * serial numbers, the words "test and add asset" and chatter without a model (names, instructions) are left out.
 */
export function devicesFromTitle(title) {
  const text = String(title ?? '').replace(/<[^>]*>/g, ' ').replace(/\btest(?:ed)?\s+(?:and|&)\s+add(?:ed)?\b/gi, ' - ')
  const out = new Map()
  const add = (model, qty, counted) => {   // "PM-60, PM60 Main Unit" is one device: the same model with no quantity again adds nothing
    const k = norm(model).replace(/ /g, ''); if (!k) return
    const e = out.get(k)
    if (!e) out.set(k, { model, qty, counted })
    else if (counted) { e.qty = e.counted ? e.qty + qty : qty; e.counted = true }
  }
  const pieces = []
  for (const part of text.split(/\s+[-–—]\s*|\s*[-–—]\s+|[,;&+\n]|\s+and\s+/i)) {
    const cuts = [...part.matchAll(/(?<![A-Za-z0-9])(\d+)\s*[x×]\s*(?=[A-Za-z0-9])/gi)]
    if (!cuts.length) {
      let t = part.trim()
      for (let w; (w = t.match(/^(\S+)\s+(.*)$/)) && FILLER.has(w[1].toLowerCase());) t = w[2]   // "asset 8 vs9": the 8 is a quantity
      const lead = t.match(/^(\d{1,3})\s+(?=[A-Za-z])(.*)$/), trail = t.match(/^(.*?\S)\s+[x×]\s*(\d{1,4})$/i)
      pieces.push(lead ? { qty: +lead[1], text: lead[2] } : trail ? { qty: +trail[2], text: trail[1] } : { qty: null, text: part })
      continue
    }
    pieces.push({ qty: null, text: part.slice(0, cuts[0].index) })
    cuts.forEach((m, i) => pieces.push({ qty: +m[1], text: part.slice(m.index + m[0].length, i + 1 < cuts.length ? cuts[i + 1].index : undefined) }))
  }
  for (let i = 1; i < pieces.length; i++) if (/^\d+$/.test(pieces[i].text.trim()) && pieces[i - 1].qty == null && pieces[i - 1].text.trim()) {   // "EPM 15 x 4": the 15 is part of the name
    pieces[i - 1] = { qty: +pieces[i].text, text: `${pieces[i - 1].text.trim()} ${pieces[i].qty}` }; pieces.splice(i, 1)
  }
  for (const p of pieces) for (const m of modelsIn(p.text, p.qty != null)) add(m, p.qty && p.qty > 0 && p.qty <= 5000 ? p.qty : 1, p.qty != null)
  if (!out.size) {   // nothing with a code or count: a short plain name is still the device ("docking mount")
    const rest = text.replace(/\([^)]*\)/g, ' ').replace(/\s+[-–—]\s*|\s*[-–—]\s+/g, ' ').split(/\s+/).filter((t) => t && !isSerial(t) && !FILLER.has(t.toLowerCase()))
    if (rest.length && rest.length <= 4 && !CHATTER.test(rest.join(' '))) add(rest.join(' '), 1, false)
  }
  return [...out.values()].map(({ model, qty }) => ({ model, qty }))
}
