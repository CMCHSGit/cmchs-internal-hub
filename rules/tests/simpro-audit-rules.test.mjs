// The activity line the Apps Script proxy writes for a Simpro change (simproSyncAudit_ in
// backend/apps-script/proxy/Code.js), sent as the exact REST request the proxy builds, to the
// real rules on the emulator. Proves the proxy's line is accepted for the caller themselves
// with the server's time, and refused if it names someone else or carries a field the rules
// don't list. The proxy's own behaviour is tested in apps/hub/tests/simpro-access.test.mjs.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { initializeTestEnvironment } from '@firebase/rules-unit-testing'

const code = readFileSync(new URL('../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const grab = (name) => { const i = code.indexOf('function ' + name + '('); return code.slice(i, code.indexOf('\n}\n', i) + 3) }

// What the proxy would send for one line, captured instead of sent.
function proxyRequest(who, summary) {
  let sent
  const ctx = vm.createContext({
    scheduleFirebaseProjectId_: () => 'rules-test',
    Logger: { log() {} },
    Utilities: { getUuid: () => crypto.randomUUID() },
    UrlFetchApp: { fetch: (url, opts) => { sent = { url, opts }; return { getResponseCode: () => 200 } } },
  })
  vm.runInContext(grab('simproSyncAudit_'), ctx)
  ctx.simproSyncAudit_('unused', who, summary)
  return JSON.parse(sent.opts.payload)
}

// An unsigned token: the emulator reads its claims and applies the rules, which is how
// the proxy's own forwarded token would look to Firestore after its signature check.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const token = (uid, email = 'someone@cass.co.nz', provider = 'microsoft.com') =>
  b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ iss: 'https://securetoken.google.com/rules-test', aud: 'rules-test', user_id: uid, sub: uid,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3000, email, firebase: { identities: {}, sign_in_provider: provider } }) + '.'

async function commit(body, idToken) {
  const r = await fetch('http://127.0.0.1:8085/v1/projects/rules-test/databases/(default)/documents:commit', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken }, body: JSON.stringify(body) })
  return r.status
}

// The emulator starts with open rules; load the real ones, as the other tests do.
const env = await initializeTestEnvironment({
  projectId: 'rules-test',
  firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host: '127.0.0.1', port: 8085 },
})

let fail = 0
const check = (label, ok) => { console.log(`${ok ? '  ok ' : ' FAIL'}  ${label}`); if (!ok) fail++ }
const who = { uid: 'u1', email: 'someone@cass.co.nz', name: 'Someone' }
const line = 'Simpro: changed job 7: Stage to Complete'

check('the proxy\u2019s line is accepted for the caller themselves', await commit(proxyRequest(who, line), token('u1')) === 200)
check('the same line is refused when the token is someone else\u2019s', await commit(proxyRequest(who, line), token('u2')) === 403)
check('refused without a Microsoft sign-in', await commit(proxyRequest(who, line), token('u1', 'someone@cass.co.nz', 'password')) === 403)
check('refused for a non-company address', await commit(proxyRequest(who, line), token('u1', 'someone@example.com')) === 403)
const extra = proxyRequest(who, line); extra.writes[0].update.fields.role = { stringValue: 'admin' }
check('refused when it carries a field the rules do not list', await commit(extra, token('u1')) === 403)
const longLine = proxyRequest(who, 'x'.repeat(501))
check('refused when the line is over 500 characters', await commit(longLine, token('u1')) === 403)
const noTime = proxyRequest(who, line); delete noTime.writes[0].updateTransforms
check('refused without the server\u2019s time', await commit(noTime, token('u1')) === 403)

await env.cleanup()
console.log(`\n${fail ? fail + ' FAILED' : 'all passed'}`)
// Not process.exit: ending with fetch connections still closing trips a libuv assertion on Windows.
process.exitCode = fail ? 1 : 0
