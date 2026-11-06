// npm test --prefix apps/testbench — the Test Bench's Simpro upload and outbox (src/simpro-api.js, src/outbox.js),
// and a check that the bench page is the one that works inside the hub (offline fonts, hands its files up).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { SendError, attachFile, findJobs, jobLabel, listCompanies, makeCall, toBase64 } from '../src/simpro-api.js'
import { drain, enqueue, enqueueReplacing, memoryStore, retryFailed } from '../src/outbox.js'

// A fake of the hub's Simpro service: `answer(method, path, body)` gives { status, data }.
const proxy = (answer, { down = false, json } = {}) => async (_url, opt) => {
  if (down) throw new TypeError('Failed to fetch')
  const { requests, idToken } = JSON.parse(opt.body)
  assert.equal(idToken, 'tok')
  const r = requests[0]
  return { status: 200, json: async () => json ?? { success: true, results: [await answer(r.method, r.path, r.body)] } }
}
const callWith = (answer, o) => makeCall({ getToken: async () => 'tok', proxyUrl: 'https://proxy', fetchFn: proxy(answer, o) })

test('a file goes up as base64 on the job, private; the same name again is "duplicate", not a failure', async () => {
  const seen = []
  const call = callWith(async (m, p, b) => { seen.push([m, p, b]); return { status: 201, data: {} } })
  assert.equal(await attachFile(call, { companyId: 3, jobId: '123', name: 'FS6 - A9 02.11.2026.pdf', bytes: new Uint8Array([72, 105]) }), 'sent')
  assert.deepEqual(seen[0], ['POST', '/companies/3/jobs/123/attachments/files/', { Filename: 'FS6 - A9 02.11.2026.pdf', Public: false, Base64Data: 'SGk=' }])
  const dup = callWith(async () => ({ status: 422, data: { errors: [{ path: 'Filename', message: 'A file with this name already exists' }] } }))
  assert.equal(await attachFile(dup, { companyId: 3, jobId: '123', name: 'a.pdf', bytes: new Uint8Array() }), 'duplicate')
  assert.equal(toBase64(new Uint8Array(70000).fill(65)).length, Math.ceil(70000 / 3) * 4, 'big files are chunked, not apply()d whole')
})

test('what can go wrong is told apart: worth waiting for, or not', async () => {
  const run = (call) => attachFile(call, { companyId: 3, jobId: '9', name: 'a.pdf', bytes: new Uint8Array() }).catch((e) => e)
  const offline = await run(callWith(async () => ({}), { down: true }))
  assert.ok(offline instanceof SendError && offline.retry, 'no connection: try again later')
  const noJob = await run(callWith(async () => ({ status: 404, data: {} })))
  assert.equal(noJob.retry, false)
  assert.match(noJob.message, /Job 9 was not found/)
  const busy = await run(callWith(async () => ({ status: 503, data: {} })))
  assert.equal(busy.retry, true)
  const refused = await run(callWith(async () => ({}), { json: { success: false, error: 'Simpro access is not enabled for this account' } }))
  assert.equal(refused.retry, false, 'not allowed: waiting won\'t help')
  assert.match(refused.message, /not enabled/)
  const noAnswer = await run(makeCall({ getToken: async () => 'tok', proxyUrl: 'x', fetchFn: async () => ({ status: 502, json: async () => { throw new Error('html') } }) }))
  assert.equal(noAnswer.retry, true)
})

test('finding a job: a number is the job number first; words search name, description and customer', async () => {
  const log = []
  const call = callWith(async (m, p) => {
    log.push(p)
    if (p === '/companies/3/jobs/555') return { status: 200, data: { ID: 555, Customer: { CompanyName: 'Hutt Hospital' }, Site: { Name: 'ICU' }, Name: 'Monitor PVT' } }
    if (p.includes('Customer.CompanyName=')) return { status: 200, data: [{ ID: 1, Name: 'Hutt A' }, { ID: 2, Customer: { CompanyName: 'Hutt Hospital' } }] }
    if (p.includes('Description=')) return { status: 400, data: {} } // a field Simpro won't filter on
    return { status: 200, data: [{ ID: 1, Name: 'Hutt A' }] }
  })
  const byNumber = await findJobs(call, 3, '555')
  assert.deepEqual(byNumber.map((j) => j.ID), [555])
  assert.equal(log.length, 1, 'one call for a number that is a job')
  assert.equal(jobLabel(byNumber[0]), '#555 Hutt Hospital · ICU · Monitor PVT')
  const byWords = await findJobs(call, 3, 'Hutt')
  assert.deepEqual(byWords.map((j) => j.ID).sort(), [1, 2], 'a refused field doesn\'t take the others down, and a job found twice shows once')
  assert.deepEqual(await findJobs(call, 3, '  '), [])
  const allBad = callWith(async () => ({ status: 400, data: {} }))
  await assert.rejects(findJobs(allBad, 3, 'x'), /Search failed/)
  const none = callWith(async (m, p) => (/jobs\/\d+$/.test(p) ? { status: 404, data: {} } : { status: 200, data: [] }))
  assert.deepEqual(await findJobs(none, 3, '99999'), [], 'a number that is no job, and matches nothing')
})

test('companies: the do-not-use one is left out', async () => {
  const call = callWith(async () => ({ status: 200, data: [{ ID: 3, Name: 'CHS' }, { ID: 9, Name: 'DO NOT USE old' }] }))
  assert.deepEqual((await listCompanies(call)).map((c) => c.ID), [3])
})

const files = (...names) => names.map((name) => ({ name, mime: 'application/pdf', buffer: new Uint8Array([1, 2, 3]).buffer }))

test('the outbox keeps everything until Simpro has it; a lost connection stops the run and keeps the rest', async () => {
  const store = memoryStore()
  await enqueue(store, { companyId: 3, jobId: 77, jobLabel: '#77 Hutt', by: 'a@cass.co.nz', files: files('a.pdf', 'b.json', 'c.mtr') })
  const order = []
  const r = await drain(store, async (it) => {
    order.push(it.name)
    if (it.name === 'b.json') throw new SendError('No connection', true)
    return 'sent'
  })
  assert.deepEqual(order, ['a.pdf', 'b.json'], 'oldest first, and it stops at the lost connection')
  assert.deepEqual([r.sent, r.stopped], [1, 'No connection'])
  assert.deepEqual((await store.all()).map((x) => x.name).sort(), ['b.json', 'c.mtr'], 'the one that failed to send and the one not tried are still there')
  const again = await drain(store, async () => 'sent')
  assert.equal(again.sent, 2)
  assert.deepEqual(await store.all(), [])
})

test('a file Simpro will never take is marked failed and the others go; retrying puts it back', async () => {
  const store = memoryStore()
  await enqueue(store, { companyId: 3, jobId: 5, files: files('bad.pdf', 'good.pdf', 'twice.pdf') })
  const r = await drain(store, async (it) => {
    if (it.name === 'bad.pdf') throw new SendError('Job 5 was not found in Simpro', false)
    return it.name === 'twice.pdf' ? 'duplicate' : 'sent'
  })
  assert.deepEqual([r.sent, r.duplicate, r.failed], [1, 1, 1])
  const left = await store.all()
  assert.equal(left.length, 1)
  assert.deepEqual([left[0].status, left[0].error], ['failed', 'Job 5 was not found in Simpro'])
  assert.equal((await drain(store, async () => 'sent')).sent, 0, 'a failed one is not tried again by itself')
  await retryFailed(store)
  assert.equal((await drain(store, async () => 'sent')).sent, 1)
})

test('saving a report twice for a job leaves one copy waiting, the latest', async () => {
  const store = memoryStore()
  const one = { companyId: 3, jobId: 8, files: [{ name: 'r.pdf', mime: '', buffer: new Uint8Array([1]).buffer }] }
  await enqueueReplacing(store, one)
  await enqueueReplacing(store, { ...one, files: [{ name: 'r.pdf', mime: '', buffer: new Uint8Array([9, 9]).buffer }] })
  await enqueueReplacing(store, { ...one, jobId: 9 })
  const all = await store.all()
  assert.equal(all.length, 2, 'another job keeps its own')
  assert.equal(all.find((x) => x.jobId === '8').buffer.byteLength, 2)
})

test('the bench page: fonts are its own (works offline), and it hands saved files up to the hub', () => {
  const dir = new URL('../bench/', import.meta.url)
  const html = readFileSync(new URL('index.html', dir), 'utf8')
  assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(html), 'nothing loaded from Google when it opens')
  assert.ok(html.includes('href="fonts.css"'))
  const css = readFileSync(new URL('fonts.css', dir), 'utf8')
  for (const m of css.matchAll(/url\((fonts\/[^)]+)\)/g)) assert.ok(existsSync(new URL(m[1], dir)), m[1] + ' is there')
  assert.ok(/Titillium Web/.test(css) && /Source Sans 3/.test(css) && /IBM Plex Mono/.test(css))
  // Every save (PDF, results file, Ansur record) goes through Results.save; each way out of it offers the file to the hub.
  assert.equal((html.match(/offerToHub\(/g) || []).length, 5, 'defined once, called at the ways a file leaves (download, Results folder, fallback, and the chosen folder)')
  assert.ok(html.includes("type: 'chs-bench:file'") && html.includes('location.origin'), 'to the hub\'s own origin only')
  assert.ok(html.includes('window.parent === window'), 'alone, it does nothing extra')
  assert.ok(/<script>[\s\S]*PDFLib/.test(html), 'the PDF library is inside the page')
})

test('template groups: set on the template, else worked out from its name; usual groups first, "Other" last', async () => {
  const { default: vm } = await import('node:vm')
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const a = html.indexOf('const CATEGORIES'), b = html.indexOf('/** Build a clean Test Bench template')
  assert.ok(a > 0 && b > a)
  const { categoryOf, groupTemplates } = vm.runInNewContext(html.slice(a, b) + '; ({ categoryOf, groupTemplates })')
  const t = (name, desc = '', category = '') => ({ name, desc, category })
  assert.equal(categoryOf(t('Mindray A9 Anaesthetic Machine')), 'Anaesthesia')
  assert.equal(categoryOf(t('Mindray A7 Anaesthetic Machine')), 'Anaesthesia')
  assert.equal(categoryOf(t('Mindray D30/D60 Defibrillator')), 'Defibrillation')
  assert.equal(categoryOf(t('Medical power supply (isolated output), Class I')), 'Power supplies')
  assert.equal(categoryOf(t('Patient Monitor and OR Modules')), 'Monitoring')
  assert.equal(categoryOf(t('Mindray TM80 – AS/NZS 3551 PVT', 'Performance verification only.')), 'Monitoring')
  assert.equal(categoryOf(t('Computer / IT equipment – Class II', 'Laptop power supply, monitor')), 'Computers')
assert.equal(categoryOf(t('Suction unit')), 'Other')
  assert.equal(categoryOf(t('Mindray A9 Anaesthetic Machine', '', 'Theatre')), 'Theatre', 'its own group wins')
  const order = groupTemplates([t('Suction unit'), t('Patient Monitor'), t('X', '', 'Theatre'), t('A9 Anaesthetic'), t('Another monitor')]).map(([c, l]) => [c, l.length])
  assert.deepEqual(JSON.parse(JSON.stringify(order)), [['Anaesthesia', 1], ['Monitoring', 2], ['Theatre', 1], ['Other', 1]])
  // the group is kept when a template is saved or loaded
  assert.ok(html.includes('category: String(raw.category'), 'read from a template file')
  assert.ok(html.includes('HUB-MASTER'))
})

test('test another device: same template, details kept, serial number blank', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.ok(html.includes("$('#sumNew').addEventListener('click', () => this.nextDevice())"))
  const body = html.slice(html.indexOf('  nextDevice() {'), html.indexOf('  updateStartHint() {'))
  assert.ok(/this\.pick\(t\.id\)/.test(body), 'the template stays picked')
  assert.ok(/isSerial\(i\) \? ''/.test(body), 'the serial number is cleared')
  assert.ok(/run\.dut\[i\.dataset\.k\]/.test(body), 'the other details come from the test just done')
  assert.ok(/checklistAnswers\(run\)/.test(body), 'the checklist answers are kept for the next test')
})

test('test another device keeps checklist Pass and N/A answers only: not Fail, readings, measurements or skipped steps', async () => {
  const { default: vm } = await import('node:vm')
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const a = html.indexOf('function stepChecks('), b = html.indexOf('/* Model variants')
  const { checklistAnswers, applyChecklistAnswers } = vm.runInNewContext(html.slice(a, b) + '; ({ checklistAnswers, applyChecklistAnswers })', { TYPES: { check: { group: 'check' } }, JSON })
  const step = (id, type, params) => ({ id, type, title: id, params })
  const template = { steps: [step('c1', 'check', { items: ['Case', 'Lead', 'Label'], readings: [{ label: 'Battery', unit: 'V', lo: 11, hi: 14 }] }), step('e1', 'esa_pe', { hi: 0.2 }), step('c2', 'check', { items: ['Powers on'] })] }
  const row = (label, result) => ({ label, result, display: '', limit: '' })
  const last = { template, results: {
    c1: { status: 'fail', rows: [row('Case', 'pass'), row('Lead', 'fail'), row('Label', 'na'), { label: 'Battery', value: '12.5', unit: 'V', result: 'pass' }] },
    e1: { status: 'pass', rows: [row('PE', 'pass')] },
    c2: { status: 'skipped', rows: [] } } }
  const plain = (x) => JSON.parse(JSON.stringify(x))   // the page's code runs in its own realm
  const kept = checklistAnswers(last)
  assert.deepEqual(plain(Object.keys(kept)), ['c1'], 'only checklist steps, and only those with something to keep')
  assert.deepEqual(plain(Object.keys(kept.c1)), ['0', '2'], 'Pass and N/A carry; Fail and the typed reading do not')
  assert.equal(kept.c1[2].display, 'N/A')
  // and they go into the next device's test, item by item, where the wording still matches
  const next = { template: { steps: [step('c1', 'check', { items: ['Case', 'Lead (reworded)', 'Label'], readings: [] }), step('c2', 'check', { items: ['Powers on'] })] }, results: { c1: { status: 'pending', rows: [] }, c2: { status: 'pending', rows: [] } } }
  const set = []
  assert.equal(applyChecklistAnswers(next, kept, (s) => set.push(s.id)), 2)
  assert.deepEqual(plain(next.results.c1.rows.map((r) => r && r.result ? r.result : null)), ['pass', null, 'na'])
  assert.deepEqual(set, ['c1'])
  assert.ok(html.includes('App.carry = null;'), 'one test only, then forgotten')
})

test('computer templates: both load-ready, use step types the bench has, unique step ids, Class II has no earth or touch current tests', () => {
  const dir = new URL('../templates/', import.meta.url)
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  for (const [file, earthed] of [['Computer - IT equipment - Class I - Test Bench template.json', true], ['Computer - IT equipment - Class II - Test Bench template.json', false]]) {
    const f = JSON.parse(readFileSync(new URL(file, dir), 'utf8'))
    assert.equal(f.format, 'chs-test-bench-template')
    const steps = f.template.steps
    assert.equal(new Set(steps.map((s) => s.id)).size, steps.length, 'step ids are unique')
    for (const s of steps) assert.ok(html.includes(`${s.type}:`) || s.type === 'check' || s.type === 'info', `bench knows ${s.type}`)
    assert.equal(f.template.category, 'Computers')
    const types = steps.map((s) => s.type)
    assert.equal(types.includes('esa_pe'), earthed)
    assert.equal(types.includes('esa_earthl'), earthed)
    assert.equal(types.includes('esa_encl'), earthed, 'touch current is a Class I test (AS/NZS 3551 B10.1)')
    assert.ok(types.includes('esa_mains') && types.includes('esa_ins'))
  }
})

test('ESA612 connects by itself when a measurement starts, and a failed test offers Re-test instead of stopping', () => {
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  assert.match(html, /async ensure\(key = 'esa'\)/, 'Devices.ensure connects known ports, else asks once for the FTDI device')
  assert.match(html, /usbVendorId: 0x0403/, 'the port chooser only lists the USB serial (FTDI) devices')
  assert.match(html, /await Devices\.ensure\('esa'\)/, 'Start auto sequence and This test only connect first')
  assert.match(html, /failPrompt\(s, last\)/)
  assert.match(html, /value: 'retest'/, 'a Re-test button')
  assert.doesNotMatch(html, /The sequence stopped and the equipment outlet is off/, 'the old stop-and-tell dialog is gone')
})

test('a reading that has stopped moving ends the settle wait early; one still moving, or too short, does not', async () => {
  const { default: vm } = await import('node:vm')
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const a = html.indexOf('function isSteady('), b = html.indexOf('function limitText(')
  const { isSteady } = vm.runInNewContext(html.slice(a, b) + '; ({ isSteady })', { Math, Date })
  const at = (vals, step = 250, over = false) => vals.map((v, i) => ({ t: 10000 + i * step, v, over }))
  const now = (h) => h[h.length - 1].t
  const flat = at([12.1, 12.1, 12.2, 12.1, 12.1])                      // 1 s, wobble inside 2 %
  assert.equal(isSteady(flat, 'µA', now(flat)), true)
  const rising = at([5, 8, 11, 14, 17])
  assert.equal(isSteady(rising, 'µA', now(rising)), false, 'still climbing')
  const short = at([12, 12, 12], 100)
  assert.equal(isSteady(short, 'µA', now(short)), false, 'not enough time yet')
  const nearZero = at([0.01, 0.02, 0.01, 0.02, 0.01], 250)
  assert.equal(isSteady(nearZero, 'Ω', now(nearZero)), true, 'tiny movement near zero counts as steady')
  const ins = at([200, 200, 200, 200, 200])                              // 1 s is not enough for insulation
  assert.equal(isSteady(ins, 'MΩ', now(ins)), false)
  const ins2 = at([200, 200, 200, 200, 200, 200, 200], 250)
  assert.equal(isSteady(ins2, 'MΩ', now(ins2)), true)
  const open = at([2, 2, 2, 2, 2], 250, true)
  assert.equal(isSteady(open, 'Ω', now(open)), true, 'steady over-range (open circuit)')
  const mixed = at([2, 2, 1.5, 2, 2]).map((h, i) => ({ ...h, over: i !== 2 }))
  assert.equal(isSteady(mixed, 'Ω', now(mixed)), false)
  assert.match(html, /isSteady\(history, row\.unit\)/, 'the wait ends early on a steady reading')
})

// A small .xlsx written by hand (zip + the few XML parts a workbook needs), headed like the customers' equipment spreadsheets.
async function makeXlsx(sheets, extra = {}) {   // [{ name, rows, xml? }]; `extra` is more parts of the zip (path → text)
  const { deflateRawSync, crc32 } = await import('node:zlib')
  const strings = [], idx = (s) => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s) } return i }
  const col = (n) => String.fromCharCode(65 + n)
  const sheetXml = (rows) => rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => v == null ? '' : typeof v === 'number' ? `<c r="${col(j)}${i + 1}"><v>${v}</v></c>` : `<c r="${col(j)}${i + 1}" t="s"><v>${idx(v)}</v></c>`).join('')}</row>`).join('')
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    'xl/workbook.xml': `<workbook xmlns:r="x"><sheets>${sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships>${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}</Relationships>`,
  }
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = s.xml ?? `<worksheet><sheetData>${sheetXml(s.rows)}</sheetData></worksheet>` })
  Object.assign(files, extra)
  files['xl/sharedStrings.xml'] = `<sst>${strings.map((s) => `<si><t>${s.replace(/&/g, '&amp;')}</t></si>`).join('')}</sst>`
  const parts = [], central = []; let offset = 0
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text), comp = deflateRawSync(data), nm = Buffer.from(name), crc = crc32(data)
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26)
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42)
    parts.push(lh, nm, comp); central.push(ch, nm); offset += 30 + nm.length + comp.length
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16)
  const out = Buffer.concat([...parts, cd, end]); return out.buffer.slice(out.byteOffset, out.byteOffset + out.length)
}

test('a customer spreadsheet: the serial number is looked up by itself, the details are filled in, and it says whether the device was found', async () => {
  const { default: vm } = await import('node:vm')
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const a = html.indexOf('const XlsxLite = '), b = html.indexOf('const Runner = {')
  const inputs = ['Serial number', 'Manufacturer', 'Model', 'Customer', 'CHS asset #', 'Customer asset #', 'Testing engineer'].map((k) => ({ dataset: { k }, value: k === 'Testing engineer' ? 'Jonathan Nasrun' : '', focus() {} }))
  const box = { hidden: true, innerHTML: '' }
  const ctx = { Blob, Response, DecompressionStream, TextDecoder, Uint8Array, DataView, Math, Date, Set, Object, Number, String, Array, Error, RegExp, JSON, Promise,
    $$: (s) => (s === '#dutFields input' ? inputs : []), $: (s) => (s === '#sheetGaps' ? box : null), toast() {}, log: () => {}, esc: String, DB: {}, Shared: {} }
  const { XlsxLite, Sheet } = vm.runInNewContext(html.slice(a, b) + '; ({ XlsxLite, Sheet })', ctx)
  const head = ['Site ID', 'Device Type', 'Manufacturer', 'Device Model', 'Description', 'Serial Number', 'CHS Asset Number', 'Ward/Location', 'Room', 'Bed', 'Customer Asset Number']
  const buf = await makeXlsx([
    { name: 'Notes', rows: [['Read me']] },
    { name: 'NSH', rows: [['Equipment list'], head,
      ['WDH', 'Patient monitor', 'Mindray', 'BeneVision N17', 'Monitor', 'SN-1001', 'CHS-500', 'ICU', '2', '4', 'WDH-77'],
      ['WDH', 'Patient monitor', 'Mindray', 'BeneVision N12', 'Monitor', 4002, 'CHS-501', 'ED', '1', '', ''],
      ['WDH', 'Patient monitor', 'Mindray', 'BeneVision N12', 'Monitor', 'DUP-1', 'CHS-502', 'ED', '1', '', ''],
      ['WDH', 'Patient monitor', 'Mindray', 'BeneVision N12', 'Monitor', 'DUP-1', 'CHS-503', 'ED', '1', '', ''],
      [null, null, null, null, null, null, null, null, null, null, null]] },
    { name: 'NSH IT', rows: [head, ['WDH', 'Computer', null, null, 'Laptop', null, 'CHS-900', 'Records', null, null, null]] },   // an asset with no serial number yet
    { name: 'Retired Assets', rows: [head, ['WDH', 'Monitor', 'Mindray', 'Old', 'Monitor', 'SN-OLD', 'CHS-1', 'Store', null, null, null]] }])
  const sheets = await XlsxLite.read(buf)
  assert.deepEqual(JSON.parse(JSON.stringify(sheets.map((s) => s.name))), ['Notes', 'NSH', 'NSH IT', 'Retired Assets'])
  const rows = Sheet.parse(sheets)
  assert.equal(rows.length, 5, 'every sheet of devices is read; the title row, the empty row, Notes and Retired Assets are not devices')
  assert.equal(rows[1]['Serial Number'], '4002', 'a numeric serial number comes back as text')
  Object.assign(Sheet, { rows, state: 'ready', file: 'Waitemata.xlsx', customer: 'Waitemata' })
  // found: the rest is filled in and the box says so
  Sheet.onTyped({ value: ' sn-1001 ', dataset: { k: 'Serial number' } })
  assert.deepEqual(Object.fromEntries(inputs.map((i) => [i.dataset.k, i.value])), { 'Serial number': 'SN-1001', Manufacturer: 'Mindray', Model: 'BeneVision N17', Customer: 'Waitemata', 'CHS asset #': 'CHS-500', 'Customer asset #': 'WDH-77', 'Testing engineer': 'Jonathan Nasrun' }, 'every detail the sheet has, the engineer left alone')
  assert.ok(box.hidden === false && box.innerHTML.includes('sheet-alert ok') && box.innerHTML.includes('Found in the asset list') && box.innerHTML.includes('NSH, row 3'))
  // not found: said in red, nothing filled in
  inputs[0].value = 'NOPE-1'; Sheet.onTyped({ value: 'NOPE-1', dataset: { k: 'Serial number' } })
  assert.ok(box.innerHTML.includes('sheet-alert bad') && box.innerHTML.includes('Not found') && box.innerHTML.includes('NOPE-1'))
  // a number two devices have: said in red
  Sheet.onTyped({ value: 'dup-1', dataset: { k: 'Serial number' } })
  assert.ok(box.innerHTML.includes('sheet-alert bad') && box.innerHTML.includes('2 devices'))
  // an asset with no serial number yet: found by its asset number, the serial field is left empty to be filled from the device, and a serial typed then belongs to it
  inputs[0].value = 'chs-900'; Sheet.onTyped({ value: 'chs-900', dataset: { k: 'Serial number' } })
  assert.equal(inputs[0].value, '', 'the asset number typed to find it is not left as the serial number')
  assert.equal(inputs[4].value, 'CHS-900')
  inputs[0].value = 'NEW-SN'; Sheet.onTyped({ value: 'NEW-SN', dataset: { k: 'Serial number' } })
  assert.ok(box.innerHTML.includes('Found in the asset list'), 'not looked up as a different device')
  assert.match(html, /Sheet\.init\(\)/, 'read at start-up when the browser still has access')
  assert.ok(html.includes("i.addEventListener('input'") && html.includes('Sheet.onTyped(i)'), 'typing or scanning a serial number looks it up, after a pause or when the box is left')
  // the old way is gone: no Find box, no new device, no details to fill in here, nothing written to the list
  for (const gone of ['Find a device', 'id="sheetFind"', 'Add it as a new device', 'Sheet.beforeStart', 'renderGaps', 'Skip these for now']) assert.ok(!html.includes(gone), gone)
})

test('the asset list: the red (mandatory) columns it is missing for a device are said in red, with nothing to type in', async () => {
  const { default: vm } = await import('node:vm')
  const html = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
  const a = html.indexOf('const XlsxLite = '), b = html.indexOf('const Runner = {')
  const tx = (ref, t, s = 0) => `<c r="${ref}"${s ? ` s="${s}"` : ''} t="inlineStr"><is><t>${t}</t></is></c>`
  const nsh = `<worksheet><dimension ref="A1:E3"/><sheetData>
    <row r="1" spans="1:5">${tx('A1', 'Serial Number', 1)}${tx('B1', 'Device Model', 1)}${tx('C1', 'Date Installed', 1)}${tx('D1', 'CHS Asset Number', 1)}${tx('E1', 'Notes')}</row>
    <row r="2" spans="1:5">${tx('A2', 'SN1')}${tx('B2', 'N17')}<c r="C2" s="2"><v>45000</v></c>${tx('D2', 'CHS-1')}${tx('E2', 'x')}</row>
    <row r="3" spans="1:5">${tx('A3', 'SN2')}${tx('B3', 'N12')}<c r="C3" s="2"/></row>
    </sheetData></worksheet>`
  const extra = {
    'xl/styles.xml': '<styleSheet><fonts count="2"><font><sz val="11"/></font><font><color rgb="FFFF0000"/></font></fonts><cellXfs count="3"><xf numFmtId="0" fontId="0"/><xf numFmtId="0" fontId="1"/><xf numFmtId="14" fontId="0"/></cellXfs></styleSheet>',
    'docProps/untouched.txt': 'left exactly as it was' }
  const buf = await makeXlsx([{ name: 'NSH', xml: nsh }], extra)
  const inputs = ['Serial number', 'Model', 'CHS asset #'].map((k) => ({ dataset: { k }, value: '', focus() {} }))
  const box = { hidden: true, innerHTML: '' }
  const ctx = { Blob, Response, DecompressionStream, CompressionStream, TextDecoder, TextEncoder, Uint8Array, Uint32Array, DataView, Math, Date, Set, Map, Object, Number, String, Array, Error, RegExp, JSON, Promise,
    $$: (s) => (s === '#dutFields input' ? inputs : []), $: (s) => (s === '#sheetGaps' ? box : null), toast() {}, log() {}, esc: String, DB: {}, Shared: {} }
  const { XlsxLite, Sheet } = vm.runInNewContext(html.slice(a, b) + '; ({ XlsxLite, Sheet })', ctx)
  const plain = (x) => JSON.parse(JSON.stringify(x))
  const sheets = await XlsxLite.read(buf)
  assert.deepEqual(plain(sheets[0].red[0]), [true, true, true, true, false], 'the header cells with a red font')
  const rows = Sheet.parse(sheets)
  assert.deepEqual(plain(Sheet.info.NSH.red), ['Serial Number', 'Device Model', 'Date Installed', 'CHS Asset Number'])
  Object.assign(Sheet, { rows, state: 'ready', file: 'List.xlsx', customer: 'C' })
  Sheet.onTyped({ value: 'sn2', dataset: { k: 'Serial number' } })
  assert.deepEqual(plain(Sheet.missing(Sheet.cur)), ['Date Installed', 'CHS Asset Number'])
  assert.ok(box.innerHTML.includes('Found in the asset list') && box.innerHTML.includes('sheet-alert bad') && box.innerHTML.includes('Missing in the asset list:') && box.innerHTML.includes('Date Installed, CHS Asset Number'), 'what is missing, in red')
  assert.ok(!box.innerHTML.includes('<input'), 'nothing to type in here: the details are kept in the asset list itself')
  Sheet.onTyped({ value: 'sn1', dataset: { k: 'Serial number' } })
  assert.ok(box.innerHTML.includes('sheet-alert ok') && !box.innerHTML.includes('Missing in the asset list'), 'a complete device has nothing in red')
  // the zip writer is still there for other uses: one cell changed, everything else byte for byte
  const out = await XlsxLite.write(buf, [{ sheet: 'NSH', cells: [{ row: 3, col: 3, value: 'CHS-2' }] }])
  const after = await XlsxLite.read(out)
  assert.equal(after[0].rows[2][3], 'CHS-2'); assert.deepEqual(plain(after[0].rows[1]), plain(sheets[0].rows[1]))
  assert.equal(await XlsxLite.text(out, 'docProps/untouched.txt'), 'left exactly as it was')
})

test('job search looks anywhere in the name, description, notes, site and customer (a serial sits in the middle of a description), and says if the notes could not be searched', async () => {
  const paths = []
  const call = callWith(async (m, p) => {
    paths.push(p)
    if (p.includes('Notes=')) return { status: 400, data: {} }   // Simpro won't filter on notes
    if (p.includes('Description=')) return { status: 200, data: [{ ID: 7, Name: 'PVT', Description: 'Units FP5-6A036784, FP5-6A036785' }] }
    return { status: 200, data: [] }
  })
  const jobs = await findJobs(call, 3, 'FP5-6A036784')
  assert.deepEqual(jobs.map((j) => j.ID), [7])
  assert.equal(jobs.notesSearched, false, 'the picker can say Simpro wouldn\'t search the notes')
  for (const f of ['Name', 'Description', 'Notes', 'Site.Name', 'Customer.CompanyName']) assert.ok(paths.some((p) => p.includes(`${f}=%25FP5-6A036784%25`)), f + ' is searched with the text anywhere (wildcard on both ends)')
  const ok = callWith(async () => ({ status: 200, data: [] }))
  assert.equal((await findJobs(ok, 3, 'abc')).notesSearched, true)
  const ansur = readFileSync(new URL('../../ansurtopdf/simpro.js', import.meta.url), 'utf8')
  assert.ok(ansur.includes("const term = '%25' + encodeURIComponent(q) + '%25'") && ansur.includes('Notes=${term}') && ansur.includes('Site.Name=${term}'), 'the Ansur builder\'s job search does the same')
  const picker = readFileSync(new URL('../src/JobPicker.jsx', import.meta.url), 'utf8')
  assert.ok(picker.includes('jobs.notesSearched') && picker.includes('words from the description or notes'))
})
