// npm test -w apps/asks — the proxy's timer that tells people about asks that reached the server late
// (sweepAsks, backend/apps-script/proxy/Code.js), run in a sandbox with Apps Script's services made up.
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

const str = (v) => ({ stringValue: v })
const int = (v) => ({ integerValue: String(v) })
const arr = (...v) => ({ arrayValue: { values: v.map(str) } })
const askDoc = (id, saved, over = {}) => ({
  document: {
    name: `projects/p/databases/(default)/documents/asks/${id}`, updateTime: new Date(saved).toISOString(),
    fields: {
      title: str('Quote'), createdBy: str('jess'), assignees: arr('mike'), teams: arr(), people: arr('jess', 'mike'), status: str('open'), owner: str(''),
      event: { mapValue: { fields: { id: str(over.evId || 'abc123'), type: str('created'), by: str('jess'), atMs: int(1) } } },
    },
  },
})

function sandbox({ rows, props = {}, cached = [] }) {
  const store = { ...props }, cache = new Set(cached), pushed = []
  const ctx = vm.createContext({
    Date, JSON, Math, Object, Number, String, Array, encodeURIComponent,
    ASKS_URL: 'https://example.test/asks/',
    Logger: { log() {} },
    hubAccessToken_: () => 'tok',
    scheduleFirebaseProjectId_: () => 'p',
    loadAskUsers_: () => [{ uid: 'jess', name: 'Jess', team: 'Sales', pending: false, tokens: ['t1'], email: '' }, { uid: 'mike', name: 'Mike', team: 'Engineers', pending: false, tokens: ['t2'], email: '' }],
    askEmailOn_: () => false,
    sendAskEmail_: () => false,
    sendHubPush_: (tokens, title) => { pushed.push([tokens.join(), title]); return tokens.map(() => ({ ok: true })) },
    UrlFetchApp: { fetch: () => ({ getResponseCode: () => 200, getContentText: () => JSON.stringify(rows) }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in store ? store[k] : null), setProperty: (k, v) => { store[k] = v } }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? '1' : null), put: (k) => cache.add(k) }) },
  })
  vm.runInContext(['fsPlain_', 'fsFields_', 'askRecipients_', 'askMessage_', 'deliverAsk_', 'sweepAsks'].map(grab).join('\n'), ctx)
  return { ctx, store, cache, pushed }
}

const MIN = 60 * 1000

test('sweep: the first run only starts watching, it tells nobody about older asks', () => {
  const { ctx, store, pushed } = sandbox({ rows: [askDoc('ask1ask1', Date.now() - 10 * MIN)] })
  ctx.sweepAsks()
  assert.equal(pushed.length, 0)
  assert.ok(Number(store.ASK_SWEEP_AT) > 0)
})

test('sweep: an ask the server saved since the last look, that nobody was told about, is announced once', () => {
  const sweepAt = Date.now() - 20 * MIN
  const { ctx, store, pushed } = sandbox({ rows: [askDoc('ask1ask1', Date.now() - 10 * MIN)], props: { ASK_SWEEP_AT: String(sweepAt) } })
  ctx.sweepAsks()
  assert.deepEqual(pushed, [['t2', 'New ask from Jess']], 'the person it was sent to, not the sender')
  assert.ok(Number(store.ASK_SWEEP_AT) > sweepAt, 'the watermark moves on')
  ctx.sweepAsks() // the same ask again: it is on the record now
  assert.equal(pushed.length, 1)
})

test('sweep: not an ask the sender\'s page already announced, nor one saved moments ago, nor one from before the last look', () => {
  const sweepAt = Date.now() - 20 * MIN
  const rows = [askDoc('told0001', Date.now() - 10 * MIN, { evId: 'done01' }), askDoc('fresh001', Date.now() - 30 * 1000), askDoc('older001', Date.now() - 30 * MIN)]
  const { ctx, pushed } = sandbox({ rows, props: { ASK_SWEEP_AT: String(sweepAt) }, cached: ['ask:told0001:done01'] })
  ctx.sweepAsks()
  assert.equal(pushed.length, 0)
})

test('sweep: a read that fails leaves the watermark alone so the next run tries again', () => {
  const sweepAt = Date.now() - 20 * MIN
  const { ctx, store } = sandbox({ rows: [], props: { ASK_SWEEP_AT: String(sweepAt) } })
  ctx.UrlFetchApp.fetch = () => ({ getResponseCode: () => 500, getContentText: () => '' })
  ctx.sweepAsks()
  assert.equal(store.ASK_SWEEP_AT, String(sweepAt))
})
