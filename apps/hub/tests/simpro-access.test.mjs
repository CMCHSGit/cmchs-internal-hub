// npm test -w apps/hub — who the Apps Script proxy lets use Simpro (simproSyncVerifyAdmin_ and simproSyncProxy_ in
// backend/apps-script/proxy/Code.js, read straight out of it so the test checks what is deployed, with Google's
// services stubbed). The rule: an admin always; anyone else once Settings → People and access turns their Simpro
// access on (users/{uid}.simproAccess === true); deleting stays with admins.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const grab = (name) => {
  const i = code.indexOf('function ' + name + '(')
  assert.ok(i >= 0, name + ' not found')
  return code.slice(i, code.indexOf('\n}\n', i) + 3)
}

/** The verifier, run against a made-up user record. */
function verifier(userFields) {
  const cache = new Map()
  const ctx = vm.createContext({
    verifyScheduleIdTokenShape_: () => ({ uid: 'u1', email: 'someone@cass.co.nz', exp: Math.floor(Date.now() / 1000) + 3000 }),
    scheduleFirebaseProjectId_: () => 'test-project',
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v) }) },
    Utilities: { base64Encode: (x) => String(x), computeDigest: (_a, s) => s, DigestAlgorithm: { MD5: 'md5' } },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify({ fields: userFields }) }) },
  })
  vm.runInContext(grab('simproSyncVerifyAdmin_'), ctx)
  return (token = 't') => ctx.simproSyncVerifyAdmin_(token)
}
const str = (stringValue) => ({ stringValue })
const bool = (booleanValue) => ({ booleanValue })

test('an admin is let in', () => {
  const who = verifier({ role: str('admin') })()
  assert.equal(who.admin, true)
})

test('someone who is not an admin is let in once their Simpro access is turned on', () => {
  const who = verifier({ role: str('user'), team: str('Sales'), simproAccess: bool(true) })()
  assert.equal(who.admin, false)
  assert.equal(who.uid, 'u1')
})

test('someone with no Simpro access, or it switched off, is refused with a message that says so', () => {
  assert.throws(() => verifier({ role: str('user') })(), /does not have Simpro access/)
  assert.throws(() => verifier({ role: str('user'), simproAccess: bool(false) })(), /does not have Simpro access/)
  assert.throws(() => verifier({ role: str('user'), simproAccess: str('true') })(), /does not have Simpro access/, 'only a real true counts')
})

test('what Simpro access covers: deleting is the one thing kept for the admin role', () => {
  assert.ok(code.includes("const SIMPRO_SYNC_ADMIN_ONLY = ['delete']"))
  assert.ok(code.includes('SIMPRO_SYNC_ADMIN_ONLY.indexOf(method) !== -1 && who.admin !== true'))
})

// ── the relay itself (simproSyncProxy_): what it refuses, and the activity line it leaves ─────────────────────
// The whole Simpro section of the proxy, run with Google's services stubbed. `sent` is every call out of the proxy.
function relay({ admin = false, status = 200 } = {}) {
  const sent = { simpro: [], firestore: [], logs: [] }
  const ctx = vm.createContext({
    SIMPRO_BASE_URL: 'https://simpro.test/api/v1.0',
    respond: (o) => o,
    apiHeaders_: () => ({}),
    scheduleFirebaseProjectId_: () => 'test-project',
    Logger: { log: (m) => sent.logs.push(String(m)) },
    Utilities: { getUuid: () => 'aaaa-bbbb-cccc' },
    UrlFetchApp: {
      fetchAll: (reqs) => { sent.simpro.push(...reqs); return reqs.map(() => ({ getResponseCode: () => status, getContentText: () => '{}' })) },
      fetch: (url, opts) => { sent.firestore.push({ url, opts }); return { getResponseCode: () => 200 } },
    },
  })
  const from = code.indexOf('const FIREBASE_ISSUER_PREFIX')
  const end = code.indexOf('\n}\n', code.indexOf('function simproSyncProxy_(')) + 3
  vm.runInContext(code.slice(from, end), ctx)
  ctx.simproSyncVerifyAdmin_ = () => ({ uid: 'u1', email: 'someone@cass.co.nz', name: 'Someone', admin })
  const call = (...requests) => ctx.simproSyncProxy_({ idToken: 'tok', requests })
  return { call, sent }
}
const job = (id, body) => ({ method: 'patch', path: `/companies/0/jobs/${id}`, body })
const file = (id, body) => ({ method: 'post', path: `/companies/0/jobs/${id}/attachments/files/`, body: { Filename: 'r.pdf', Public: false, Base64Data: 'AAAA', ...body } })

test('a job update may set Stage, Status and Notes, with real values', () => {
  const { call, sent } = relay()
  for (const body of [{ Stage: 'Complete' }, { Status: 12 }, { Status: { ID: 12 } }, { Notes: 'a<br />b' }, { Notes: 'x', Stage: 'Progress', Status: 3 }]) {
    assert.equal(call(job(7, body)).success, true, JSON.stringify(body))
  }
  assert.equal(sent.simpro.length, 5)
})

test('a job update with other fields, odd values or nothing in it is refused, and nothing reaches Simpro', () => {
  const { call, sent } = relay()
  for (const body of [{}, null, { Name: 'x' }, { Stage: 'Deleted' }, { Stage: ['Complete'] }, { Status: 'Complete' }, { Status: -1 }, { Status: 1.5 }, { Status: { ID: 'x' } }, { Notes: { a: 1 } }, { Notes: 'x'.repeat(50001) }]) {
    assert.equal(call(job(7, body)).success, false, JSON.stringify(body)?.slice(0, 40))
  }
  assert.equal(sent.simpro.length, 0)
})

test('an attachment may be saved on a job but never made public', () => {
  const { call, sent } = relay()
  assert.equal(call(file(7, {})).success, true)
  assert.equal(call(file(7, { Public: undefined })).success, true, 'left out means Simpro’s own default')
  for (const Public of [true, 'true', 1]) assert.equal(call(file(7, { Public })).success, false, String(Public))
  assert.equal(sent.simpro.length, 2)
})

test('a write leaves one activity line, in words, written with the caller’s own token and the server’s time', () => {
  const { call, sent } = relay()
  call(job(7, { Stage: 'Complete', Notes: 'private text' }))
  assert.equal(sent.firestore.length, 1)
  const { url, opts } = sent.firestore[0]
  assert.equal(url, 'https://firestore.googleapis.com/v1/projects/test-project/databases/(default)/documents:commit')
  assert.equal(opts.headers.Authorization, 'Bearer tok')
  const w = JSON.parse(opts.payload).writes[0]
  assert.match(w.update.name, /^projects\/test-project\/databases\/\(default\)\/documents\/activity\/aaaabbbbcccc$/)
  assert.deepEqual(w.updateTransforms, [{ fieldPath: 'at', setToServerValue: 'REQUEST_TIME' }])
  assert.deepEqual(w.currentDocument, { exists: false })
  assert.deepEqual(Object.keys(w.update.fields).sort(), ['app', 'email', 'name', 'summary', 'uid'], 'only the fields firestore.rules allow')
  assert.equal(w.update.fields.summary.stringValue, 'Simpro: changed job 7: Stage to Complete, Notes')
  assert.ok(!JSON.stringify(w).includes('private text'), 'what was written is never in the log')
})

test('the activity line counts repeats, says what Simpro refused, and a read leaves none', () => {
  const ok = relay()
  ok.call({ method: 'get', path: '/companies/0/jobs/7' })
  assert.equal(ok.sent.firestore.length, 0)
  const asset = (n) => ({ method: 'patch', path: `/companies/0/sites/5/assets/${n}/customFields/9`, body: { Value: 'x' } })
  ok.call(asset(1), asset(2), asset(3), { method: 'post', path: '/companies/0/sites/5/assets/', body: { Name: 'x' } })
  assert.equal(JSON.parse(ok.sent.firestore[0].opts.payload).writes[0].update.fields.summary.stringValue,
    'Simpro: updated an asset custom field on site 5 (×3); added an asset to site 5')
  const refused = relay({ status: 422 })
  refused.call(job(7, { Stage: 'Complete' }))
  assert.equal(JSON.parse(refused.sent.firestore[0].opts.payload).writes[0].update.fields.summary.stringValue,
    'Simpro: changed job 7: Stage to Complete — refused by Simpro')
})

test('a failure to write the activity line is noted but never fails the Simpro work', () => {
  const { call, sent } = relay()
  const orig = sent.firestore.push.bind(sent.firestore)
  sent.firestore.push = (x) => { orig(x); throw new Error('offline') }
  const r = call(job(7, { Stage: 'Complete' }))
  assert.equal(r.success, true)
  assert.ok(sent.logs.some((l) => /activity line not written/.test(l)))
})

test('deleting still needs the admin role, and is recorded when it happens', () => {
  const del = { method: 'delete', path: '/companies/0/sites/5/assets/9' }
  assert.equal(relay({ admin: false }).call(del).success, false)
  const a = relay({ admin: true })
  assert.equal(a.call(del).success, true)
  assert.equal(JSON.parse(a.sent.firestore[0].opts.payload).writes[0].update.fields.summary.stringValue, 'Simpro: deleted an asset on site 5')
})
