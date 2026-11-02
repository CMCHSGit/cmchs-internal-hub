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
