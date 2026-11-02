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
  assert.equal((html.match(/offerToHub\(/g) || []).length, 4, 'defined once, called at the three ways a file leaves')
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
})

test('computer templates: both load-ready, use step types the bench has, unique step ids, Class II has no earth tests', () => {
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
    assert.ok(types.includes('esa_mains') && types.includes('esa_ins') && types.includes('esa_encl'))
  }
})
