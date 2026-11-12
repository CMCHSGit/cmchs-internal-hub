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
  const scope = (method, path, who = { uid: 'u1' }, body) => vm.runInContext(`simproJobsScopeError_(${J(method)}, ${J(path)}, ${J(who)}, ${J(body)})`, sandbox)
  const patchError = (body) => vm.runInContext(`simproSyncJobPatchError_(${J(body)})`, sandbox)
  const why = (method, path, body) => vm.runInContext(`simproSyncJobWriteError_(${J(method)}, ${J(path)}, ${J(body)}, 1)`, sandbox)
  const setNow = (ms) => { vm.runInContext(`Date.now = () => ${ms}`, sandbox) } // the clock the relay sees
  return { scope, why, calls, cache, setNow, patchError }
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

test('a custom field is only Job Type, Charge category or Priority, found by name in Simpro (CHS’s own names included)', () => {
  const e = env({
    jobs: { 5001: fresh() },
    fields: {
      44: 'Job Type', 45: 'Charge category - CHS', 46: 'Priority (incl callouts) - CHS', 48: ' Charge category ', 49: 'Charge Categories', 50: 'Priority',
      60: 'Customer Notes', 61: 'Job Type Extra', 62: 'Priority list', 63: 'Charge category notes', 64: 'Priority (a) (b)', 65: 'xPriority',
    },
  })
  for (const id of [44, 45, 46, 48, 49, 50]) assert.equal(e.scope('patch', JOB + '5001/customFields/' + id), '', 'field ' + id)
  for (const id of [60, 61, 62, 63, 64, 65, 999]) assert.match(e.scope('patch', JOB + '5001/customFields/' + id), /other than Job Type, Charge Category or Priority/, 'field ' + id)
})

test('a good answer is remembered briefly, so five steps are not five extra rounds of questions; a refusal never is', () => {
  const e = env({ jobs: { 5001: fresh() }, fields: { 44: 'Job Type', 45: 'Charge Category' } })
  e.scope('post', JOB + '5001/sections/')
  e.scope('post', JOB + '5001/sections/77/costCenters/')
  e.scope('patch', JOB + '5001/customFields/44')
  e.scope('patch', JOB + '5001/customFields/45')
  // The job is read once for adding to it (a section, a cost centre) and once for changing its custom fields; each field's name once.
  assert.deepEqual(e.calls, ['/companies/3/jobs/5001', '/companies/3/setup/customFields/projects/44', '/companies/3/jobs/5001', '/companies/3/setup/customFields/projects/45'])
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
  assert.match(e.scope('post', JOB, { uid: 'u1' }), /20 jobs this hour/)
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

test('the allowance resets on the hour: a steady, busy person is never locked out, a burst still is', () => {
  const hour = 3600 * 1000
  const start = Math.floor(Date.now() / hour) * hour + 10 * 60 * 1000       // ten past an hour
  const e = env()
  e.setNow(start)
  for (let i = 0; i < 20; i++) assert.equal(e.scope('post', JOB), '', 'burst ' + (i + 1))
  assert.match(e.scope('post', JOB), /already made 20 jobs this hour/)
  e.setNow(start + 49 * 60 * 1000)                                           // 59 past: still the same hour
  assert.match(e.scope('post', JOB), /this hour/)
  e.setNow(start + 51 * 60 * 1000)                                           // the next hour: a fresh 20
  assert.equal(e.scope('post', JOB), '')
  // One job every 30 minutes, for ten hours (21 jobs): never refused.
  const steady = env()
  for (let i = 0; i < 21; i++) { steady.setNow(start + i * 30 * 60 * 1000); assert.equal(steady.scope('post', JOB), '', 'job ' + (i + 1)) }
})

// ── Editing an existing job ─────────────────────────────────────────────────────────────────────────────────────────────────────
test('a custom field can be changed on a Pending, Progress or Complete job of any age, and not once it is invoiced or archived', () => {
  const old = hoursAgo(24 * 90)
  const e = env({
    jobs: { 1: { Stage: 'Pending', DateModified: old }, 2: { Stage: 'Progress', DateModified: old }, 3: { Stage: 'Complete', DateModified: old }, 4: { Stage: 'Invoiced', DateModified: old }, 5: { Stage: 'Archived', DateModified: old }, 6: { Stage: 'Weird' } },
    fields: { 44: 'Job Type' },
  })
  for (const id of [1, 2, 3]) assert.equal(e.scope('patch', JOB + id + '/customFields/44'), '', 'job ' + id)
  for (const id of [4, 5, 6]) assert.match(e.scope('patch', JOB + id + '/customFields/44'), /can no longer be changed here/, 'job ' + id)
  assert.match(e.scope('patch', JOB + '9/customFields/44'), /could not show \(404\)/)
})

test('adding a section or a cost centre is still only for a job that has just been made', () => {
  const e = env({ jobs: { 3: { Stage: 'Complete', DateModified: hoursAgo(0) }, 1: { Stage: 'Pending', DateModified: hoursAgo(24 * 90) } } })
  assert.match(e.scope('post', JOB + '3/sections/'), /no longer Pending/)
  assert.match(e.scope('post', JOB + '1/sections/77/costCenters/'), /not made or changed in the last 12 hours/)
})

test('a job’s description can only be added to the end of, on a job that is not invoiced or archived', () => {
  const html = '<p>Fault: <b>no display</b></p><table><tr><td>x</td></tr></table>'
  const e = env({ jobs: { 1: { Stage: 'Progress', Description: html }, 2: { Stage: 'Invoiced', Description: html }, 3: { Stage: 'Pending', Description: '' }, 4: { Stage: 'Pending' }, 5: { Stage: 'Complete', Description: html } } })
  const add = '<p>Customer rang back &amp; says &lt;E12&gt;</p>'
  assert.equal(e.scope('patch', JOB + '1', undefined, { Description: html + add }), '')
  assert.equal(e.scope('patch', JOB + '1', undefined, { Description: html + add, Notes: 'anything' }), '')
  assert.equal(e.scope('patch', JOB + '5', undefined, { Description: html + '<p>a</p><br><p>b</p>' }), '')   // a Complete job can still be added to
  assert.equal(e.scope('patch', JOB + '3', undefined, { Description: add }), '')                              // an empty description
  assert.equal(e.scope('patch', JOB + '4', undefined, { Description: add }), '')                              // a job with no description at all
  for (const [label, body] of [
    ['replaced', { Description: '<p>Something else entirely</p>' }], ['shortened', { Description: '<p>Fault: <b>no display</b></p>' }], ['unchanged', { Description: html }],
    ['changed at the start', { Description: 'X' + html + add }], ['changed in the middle', { Description: html.replace('no display', 'no power') + add }],
    ['link added', { Description: html + '<a href="https://example.invalid">x</a>' }], ['script added', { Description: html + '<script>alert(1)</script>' }],
    ['tags other than p and br', { Description: html + '<b>bold</b>' }], ['attributes', { Description: html + '<p class="x">a</p>' }], ['a stray >', { Description: html + 'a > b' }],
  ]) assert.notEqual(e.scope('patch', JOB + '1', undefined, body), '', label)
  assert.match(e.scope('patch', JOB + '2', undefined, { Description: html + add }), /Invoiced, so its description or title can no longer be changed here/)
  assert.match(e.scope('patch', JOB + '1', undefined, { Description: '<p>replaced</p>' }), /other than by adding to the end/)
  assert.match(e.scope('patch', JOB + '99', undefined, { Description: add }), /could not show \(404\)/)
})

test('a PATCH without a Description is not judged here, so Notes, Stage and Status work exactly as before for the other tools', () => {
  const e = env()
  for (const body of [{ Notes: 'x' }, { Stage: 'Complete' }, { Status: 66 }, { Stage: 'Complete', Status: 66 }, { Notes: '<table></table>' }]) assert.equal(e.scope('patch', JOB + '1', undefined, body), '', J(body))
  assert.deepEqual(e.calls, [])
})

test('the job PATCH now takes a Description as text, and nothing else new', () => {
  const e = env()
  assert.equal(e.patchError({ Description: '<p>x</p>' }), '')
  assert.equal(e.patchError({ Description: '<p>x</p>', Notes: 'y' }), '')
  for (const bad of [{ Description: '' }, { Description: '  ' }, { Description: 5 }, { Description: {} }, { Description: null }, { Description: 'x'.repeat(130001) }, { Name: '' }, { Name: '  ' }, { Name: '<b>x</b>' }, { Name: 'x'.repeat(101) }, { Name: 5 }, { Name: {} }, { DueDate: '2026-12-01' }, { Customer: 5 }, { Site: 5 }, { Type: 'Project' }]) {
    assert.notEqual(e.patchError(bad), '', J(bad).slice(0, 40))
  }
})

test('nothing is added to a description that already ends in an unfinished tag', () => {
  const add = '<p>more</p>'
  const e = env({ jobs: { 1: { Stage: 'Pending', Description: '<p>Old</p><' }, 2: { Stage: 'Pending', Description: '<p>Old</p><a href="x' }, 3: { Stage: 'Pending', Description: '<p>Old</p>' }, 4: { Stage: 'Pending', Description: 'a > b' }, 5: { Stage: 'Pending', Description: '<p>x</p> a < b' } } })
  assert.match(e.scope('patch', JOB + '1', undefined, { Description: '<p>Old</p><' + add }), /ends in the middle of a tag/)
  assert.match(e.scope('patch', JOB + '2', undefined, { Description: '<p>Old</p><a href="x' + add }), /ends in the middle of a tag/)
  assert.match(e.scope('patch', JOB + '5', undefined, { Description: '<p>x</p> a < b' + add }), /ends in the middle of a tag/)
  assert.equal(e.scope('patch', JOB + '3', undefined, { Description: '<p>Old</p>' + add }), '')
  assert.equal(e.scope('patch', JOB + '4', undefined, { Description: 'a > b' + add }), '')   // a ">" with no "<" after it is just text
})
