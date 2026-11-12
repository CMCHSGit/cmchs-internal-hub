// How far the Simpro relay's job writes reach (backend/apps-script/proxy/Code.js, loaded as it is, with Simpro, the cache and the key
// replaced by stand-ins): only a job that has just been made, only two custom fields, a ceiling per person, and only plain markup.
// Run: cd apps/simprojobs && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8')
const J = JSON.stringify
const JOB = '/companies/3/jobs/'
const GOOD = { Type: 'Service', Customer: 12, Site: 34, Description: '<p>Fault</p>' }

/** `jobs`: id -> the job as Simpro shows it; `fields`: id -> a job custom field's name in Simpro. */
function env({ jobs = {}, fields = {} } = {}) {
  const calls = []
  const cache = new Map()
  const answer = (code, body) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body) })
  const sandbox = vm.createContext({
    console, Logger: { log() {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-key' }) },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => { cache.set(k, v) } }) },
    UrlFetchApp: {
      fetch(url) {
        const p = url.replace(/^.*\/api\/v1\.0/, '')
        calls.push(p)
        let m
        if ((m = p.match(/^\/companies\/\d+\/jobs\/(\d+)$/))) return jobs[m[1]] ? answer(200, jobs[m[1]]) : answer(404, {})
        if ((m = p.match(/^\/companies\/\d+\/setup\/customFields\/projects\/(\d+)$/))) return fields[m[1]] ? answer(200, { ID: +m[1], Name: fields[m[1]] }) : answer(404, {})
        return answer(404, {})
      },
    },
  })
  vm.runInContext(source, sandbox)
  const scope = (method, path, who = { uid: 'u1' }) => vm.runInContext(`simproJobsScopeError_(${J(method)}, ${J(path)}, ${J(who)})`, sandbox)
  const why = (method, path, body) => vm.runInContext(`simproSyncJobWriteError_(${J(method)}, ${J(path)}, ${J(body)}, 1)`, sandbox)
  return { scope, why, calls, cache }
}
const hoursAgo = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString()
const fresh = () => ({ Stage: 'Pending', DateModified: new Date().toISOString() })

test('writes to a job are only for a job that has just been made: Pending and touched recently', () => {
  const e = env({
    jobs: {
      5001: fresh(), 6001: { Stage: 'Progress', DateModified: hoursAgo(0) }, 6002: { Stage: 'Complete', DateModified: hoursAgo(0) }, 6003: { Stage: 'Invoiced', DateModified: hoursAgo(0) },
      6004: { Stage: 'Pending', DateModified: hoursAgo(13) }, 6005: { Stage: 'Pending' }, 6006: { Stage: 'Pending', DateModified: 'not a date' }, 6007: { Stage: 'Pending', DateModified: hoursAgo(11) },
    },
  })
  assert.equal(e.scope('post', JOB + '5001/sections/'), '')
  assert.equal(e.scope('post', JOB + '6007/sections/77/costCenters/'), '') // 11 hours: still a new job
  assert.match(e.scope('post', JOB + '6001/sections/'), /no longer Pending/)
  assert.match(e.scope('post', JOB + '6002/sections/77/costCenters/'), /no longer Pending/)
  assert.match(e.scope('post', JOB + '6003/sections/'), /no longer Pending/)
  assert.match(e.scope('post', JOB + '6004/sections/'), /not made or changed in the last 12 hours/)
  assert.match(e.scope('post', JOB + '6005/sections/'), /not made or changed/) // no date: refused, never assumed
  assert.match(e.scope('post', JOB + '6006/sections/'), /not made or changed/)
  assert.match(e.scope('post', JOB + '9999/sections/'), /could not show \(404\)/)
})

test('a custom field is only Job Type or Charge Category, found by name in Simpro', () => {
  const e = env({ jobs: { 5001: fresh() }, fields: { 44: 'Job Type', 45: ' Charge category ', 46: 'Customer Notes', 47: 'Job Type Extra', 48: 'Charge Categories' } })
  assert.equal(e.scope('patch', JOB + '5001/customFields/44'), '')
  assert.equal(e.scope('patch', JOB + '5001/customFields/45'), '')
  assert.equal(e.scope('patch', JOB + '5001/customFields/48'), '')
  assert.match(e.scope('patch', JOB + '5001/customFields/46'), /other than Job Type or Charge Category/)
  assert.match(e.scope('patch', JOB + '5001/customFields/47'), /other than Job Type or Charge Category/)
  assert.match(e.scope('patch', JOB + '5001/customFields/999'), /other than Job Type or Charge Category/) // Simpro has no such field
})

test('a good answer is remembered briefly, so five steps are not five extra rounds of questions; a refusal never is', () => {
  const e = env({ jobs: { 5001: fresh() }, fields: { 44: 'Job Type', 45: 'Charge Category' } })
  e.scope('post', JOB + '5001/sections/')
  e.scope('post', JOB + '5001/sections/77/costCenters/')
  e.scope('patch', JOB + '5001/customFields/44')
  e.scope('patch', JOB + '5001/customFields/45')
  assert.deepEqual(e.calls, ['/companies/3/jobs/5001', '/companies/3/setup/customFields/projects/44', '/companies/3/setup/customFields/projects/45'])
  const cold = env({ jobs: { 6001: { Stage: 'Complete', DateModified: hoursAgo(0) } } })
  cold.scope('post', JOB + '6001/sections/')
  cold.scope('post', JOB + '6001/sections/')
  assert.equal(cold.calls.length, 2)
})

test('what is not one of these writes is not judged, and costs Simpro nothing', () => {
  const e = env()
  for (const [method, path] of [
    ['get', JOB + '5001/sections/'], ['post', JOB + '5001/sections/77/costCenters/9/assets/'], ['post', JOB + '5001/attachments/files/'],
    ['patch', JOB + '5001'], ['patch', '/companies/3/sites/7/assets/9/customFields/3'], ['post', '/companies/3/sites/7/assets/'],
  ]) assert.equal(e.scope(method, path), '', method + ' ' + path)
  assert.deepEqual(e.calls, [])
})

test('one person can make 20 jobs an hour; the 21st is refused, and others are not affected', () => {
  const e = env()
  for (let i = 0; i < 20; i++) assert.equal(e.scope('post', JOB, { uid: 'u1' }), '', 'job ' + (i + 1))
  assert.match(e.scope('post', JOB, { uid: 'u1' }), /20 jobs in the last hour/)
  assert.equal(e.scope('post', JOB, { uid: 'u2' }), '')
  assert.equal(e.scope('post', JOB, { email: 'someone@example.invalid' }), '')
  assert.equal(e.calls.length, 0) // counting needs no call to Simpro
})

test('a description or note carries only the paragraph and line-break tags the page writes', () => {
  const e = env()
  for (const ok of ['<p>Fault</p>', '<p>a<br>b</p><p>c</p>', '<p>&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;q&quot;</p>', 'plain text', '<br>']) {
    assert.equal(e.why('post', JOB, { ...GOOD, Description: ok, Notes: ok }), '', ok)
  }
  for (const bad of [
    '<script>alert(1)</script>', '<a href="https://example.invalid">x</a>', '<img src=x onerror=alert(1)>', '<p class="x">a</p>', '<P>a</P>', '<br/>', '<br />', '<p>a</p><b>bold</b>',
    '<style>p{}</style>', 'a > b', 'a < b', '<p>a</p><iframe src=x></iframe>', '<p onclick="x">a</p>', '<!-- c -->', '<p',
  ]) {
    assert.match(e.why('post', JOB, { ...GOOD, Description: bad }), /markup other than paragraphs/, 'description: ' + bad)
    assert.match(e.why('post', JOB, { ...GOOD, Notes: bad }), /markup other than paragraphs/, 'notes: ' + bad)
  }
})

test('a new job starts as Pending and nothing else', () => {
  const e = env()
  assert.equal(e.why('post', JOB, { ...GOOD, Stage: 'Pending' }), '')
  for (const stage of ['Progress', 'Complete', 'Archived', 'Invoiced', 'pending', '', null, 1]) assert.notEqual(e.why('post', JOB, { ...GOOD, Stage: stage }), '', J(stage))
})
