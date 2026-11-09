/* Finished tests kept in Firestore so every engineer sees them in the Test Bench's Previous tests, not just the laptop that ran them.

   Two collections, so the list is cheap to read and a test's bulk is only fetched when it is opened:
   - `benchTests/{id}`     one small line per test: who, when, which device and template, the result.
   - `benchTestData/{id}`  the whole test as one JSON string (readings, the template as it was, details). The bench rebuilds the PDF
                           and the Ansur record (.mtr) from it on demand, so neither is stored.
   Step photos are left out (the bench strips them before saving a test), so a test is about 50-100 KB; Firestore's limit is 1 MB a document.
   This file is plain functions (the tests run them); the Firestore calls are in bench-tests-firebase.js. */

/** The most characters of JSON one test may take: Firestore stops a document at 1 MiB, and the string is stored as UTF-8. */
export const MAX_JSON = 900000

const pick = (dut, re, not) => {
  const k = Object.keys(dut || {}).find((x) => re.test(x.trim()) && !(not && not.test(x.trim())))
  return k ? String(dut[k] ?? '').trim().slice(0, 200) : ''
}

/** A set of devices tested together (the bench's "Other devices in this test") shares one test: its serial numbers are kept in the
    one `serial` field, joined by " + " (the rules allow no other field), the main device first. */
export const SERIAL_JOIN = ' + '
/** The serial numbers in a `serial` field: ["FS6-1"] for one device, every one for a set. */
export const splitSerials = (s) => String(s ?? '').split(/\s\+\s/).map((x) => x.trim()).filter(Boolean)
/** Every serial number of a test (the main device's, then the other devices'), as one `serial` field. */
export function serialsOf(run) {
  const others = Array.isArray(run && run.devices) ? run.devices.map((d) => String((d && d.serial) ?? '').trim().slice(0, 120)) : []
  return [pick((run && run.dut) || {}, /^serial/i), ...others].filter(Boolean).join(SERIAL_JOIN).slice(0, 600)
}

/** The one-line record for a test. `who` is { email, name } of the engineer sharing it. */
export function summaryOf(run, who, now = Date.now()) {
  const dut = run.dut || {}
  return {
    id: String(run.id),
    by: String(who.email || '').toLowerCase(),
    byName: String(who.name || who.email || '').slice(0, 120),
    template: String((run.template && run.template.name) || '').slice(0, 200),
    serial: serialsOf(run),
    model: pick(dut, /^model$/i),
    customer: pick(dut, /^(customer|client|hospital|site|owner)\b/i, /^customer asset/i),
    ...(run.order ? { order: String(run.order).slice(0, 40) } : {}),   // the order (job number) it was tested for, when one was chosen
    overall: ['pass', 'fail'].includes(run.overall) ? run.overall : 'incomplete',
    finished: String(run.finished || run.started || ''),
    started: String(run.started || ''),
    steps: Array.isArray(run.template && run.template.steps) ? run.template.steps.length : 0,
    savedAt: now,
  }
}

/** The test as the string kept in `benchTestData`, or null when it is too big to share (the laptop still has it). */
export function packRun(run) {
  const json = JSON.stringify(run)
  return json.length > MAX_JSON ? null : json
}

/** What the bench shows in its list for each summary (the bench has no Firestore, so it gets plain objects). */
export function forBench(docs) {
  return docs.map((d) => ({ id: d.id, by: d.by, byName: d.byName, template: d.template, serial: d.serial, model: d.model, customer: d.customer, order: d.order || '', overall: d.overall, finished: d.finished, started: d.started, steps: d.steps }))
}
