// npm test --prefix apps/testbench: where a shared test has got to (sent to a job, downloaded), recorded by any laptop (src/bench-status.js),
// clearing the stored record of finished tests, and the storage panel.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { MAX_JOBS, clearableIds, idByStart, isDone, statusMap, statusToWrite, storageSummary, withStatus } from '../src/bench-status.js'

const T0 = '2026-11-09T08:00:00.000Z', T1 = '2026-11-09T09:00:00.000Z', T2 = '2026-11-09T10:00:00.000Z', T3 = '2026-11-09T11:00:00.000Z', T4 = '2026-11-09T12:00:00.000Z'
const T = (id, by, started, size) => ({ id, by, started, finished: started, size })
const shared = [T('a', 'me@x.nz', T0), T('b', 'me@x.nz', T1), T('c', 'me@x.nz', T2), T('d', 'peter@x.nz', T3), T('e', 'me@x.nz', T4, 0)]
const G = (started, over) => ({ testedAt: Date.parse(started), downloadedAt: 0, sentTo: [], unsent: true, uploaded: false, ...over })

test('the status documents become a lookup, with jobs as text and no repeats', () => {
  assert.deepEqual(statusMap([{ id: 'a', sentJobs: [123, '123', ' 45 ', ''], downloadedAt: 5 }, { id: 'b' }, null]), { a: { sentJobs: ['123', '45'], downloadedAt: 5 }, b: { sentJobs: [], downloadedAt: 0 } })
  assert.deepEqual(statusMap(undefined), {})
})

test('a laptop’s files are matched to the shared test by start time', () => {
  assert.equal(idByStart(shared).get(Date.parse(T1)), 'b')
  assert.equal(idByStart([{ id: 'x' }, { id: 'y', started: 'not a date' }]).size, 0)
})

test('a test another laptop sent and downloaded shows as sent and downloaded here', () => {
  const map = statusMap([{ id: 'a', sentJobs: ['12345'], downloadedAt: 99 }])
  const mineHere = G(T0)                                    // this laptop has its files but never sent or downloaded them
  const theirs = { shared: true, sharedId: 'a', testedAt: Date.parse(T0), downloadedAt: 0, sentTo: [], unsent: true }
  const [g, s, other] = withStatus([mineHere, theirs, G(T1)], shared, map)
  assert.deepEqual([g.sentTo, g.unsent, g.downloadedAt], [['12345'], false, 99])
  assert.deepEqual([s.sentTo, s.unsent, s.downloadedAt], [['12345'], false, 99], 'a test made on demand shows it too')
  assert.deepEqual([other.sentTo, other.unsent], [[], true], 'a test with no status is left as it was')
  const [kept] = withStatus([G(T0, { sentTo: ['777'], downloadedAt: 500, unsent: false })], shared, map)
  assert.deepEqual([kept.sentTo, kept.downloadedAt], [['777', '12345'], 500], 'what this laptop knows is kept and added to')
})

test('this laptop shares only what the status does not already say', () => {
  const map = statusMap([{ id: 'b', sentJobs: ['1'], downloadedAt: 7 }])
  const out = statusToWrite([
    G(T0, { sentTo: [111], downloadedAt: 50, unsent: false }),             // new: sent and downloaded
    G(T1, { sentTo: [1], downloadedAt: 50 }),                              // the status already has both
    G(T2, { downloadedAt: 60 }),                                           // only downloaded
    G(T3, { sentTo: [9] }),                                                // matches a shared test (d) of another engineer: also recorded, anyone may
    G('2026-01-01T00:00:00.000Z', { sentTo: [5] }),                        // no shared test: nothing to say
    G(T0, { sentTo: [5], uploaded: true }), { shared: true, sharedId: 'd', testedAt: Date.parse(T3), sentTo: [9], downloadedAt: 1 },
  ], shared, map)
  assert.deepEqual(out, [{ id: 'a', jobs: ['111'], downloadedAt: 50 }, { id: 'c', jobs: [], downloadedAt: 60 }, { id: 'd', jobs: ['9'], downloadedAt: 0 }])
  const many = statusToWrite([G(T0, { sentTo: Array.from({ length: 40 }, (_, i) => i + 1) })], shared, {})
  assert.equal(many[0].jobs.length, MAX_JOBS, 'at most 20 jobs a test, as the rules allow')
})

test('only your own tests that are on a job and downloaded can be cleared, and not twice', () => {
  const map = statusMap([{ id: 'a', sentJobs: ['1'], downloadedAt: 5 }, { id: 'b', sentJobs: ['1'] }, { id: 'c', downloadedAt: 5 }, { id: 'd', sentJobs: ['1'], downloadedAt: 5 }, { id: 'e', sentJobs: ['1'], downloadedAt: 5 }])
  assert.deepEqual(clearableIds(shared, map, 'me@x.nz'), ['a'], 'a done; b not downloaded; c not sent; d is Peter’s; e is cleared already')
  assert.deepEqual(clearableIds(shared, map, ''), [], 'nobody signed in')
  assert.deepEqual(clearableIds(shared, {}, 'me@x.nz'), [], 'no status and no files here: nothing')
  // Before the status rules are published: this laptop’s own files can still say so.
  assert.deepEqual(clearableIds(shared, {}, 'me@x.nz', [G(T0, { downloadedAt: 1, sentTo: [3], unsent: false }), G(T1, { downloadedAt: 1 }), G(T3, { downloadedAt: 1, sentTo: [3], unsent: false })]), ['a'])
  assert.equal(isDone({ sentJobs: ['1'], downloadedAt: 1 }), true)
  assert.equal(isDone({ sentJobs: [], downloadedAt: 1 }), false)
  assert.equal(isDone(undefined), false)
})

test('the storage panel counts what is stored, cleared, ready, waiting and old', () => {
  const DAY = 864e5, now = Date.parse('2026-11-10T00:00:00Z')
  const list = [
    { id: 'a', by: 'me@x.nz', started: T0, finished: T0, size: 60000 }, { id: 'b', by: 'me@x.nz', started: T1, finished: T1, size: 40000 },
    { id: 'old', by: 'me@x.nz', started: '2025-01-01T00:00:00Z', finished: '2025-01-01T00:00:00Z', size: 50000 },
    { id: 'p', by: 'peter@x.nz', started: T3, finished: T3, size: 10000 }, { id: 'z', by: 'me@x.nz', started: T4, finished: T4, size: 0 },
  ]
  const s = storageSummary(list, statusMap([{ id: 'a', sentJobs: ['1'], downloadedAt: 5 }]), 'me@x.nz', now)
  assert.deepEqual(s, { stored: 4, cleared: 1, bytes: 160000, mine: 3, others: 1, ready: 1, waiting: 2, old: 1 })
  assert.ok(now - Date.parse('2025-01-01T00:00:00Z') > 365 * DAY)
  assert.deepEqual(storageSummary([], {}, 'me@x.nz'), { stored: 0, cleared: 0, bytes: 0, mine: 0, others: 0, ready: 0, waiting: 0, old: 0 })
})

test('the hub watches and shares the status, shows it in Saved reports, and the rules allow it', () => {
  const section = readFileSync(new URL('../src/section.jsx', import.meta.url), 'utf8')
  const ui = readFileSync(new URL('../src/Reports.jsx', import.meta.url), 'utf8')
  const fb = readFileSync(new URL('../src/bench-status-firebase.js', import.meta.url), 'utf8')
  assert.ok(section.includes('watchStatus(setStatus,') && section.includes('statusToWrite(localTests, testsList, status)') && section.includes('saveStatus(list, who.current.email)') && section.includes('status={status}'))
  assert.ok(section.includes('clearableIds(testsList, status, who.current.email, localTests)'), 'auto-clearing uses the shared status and this laptop’s files')
  assert.ok(ui.includes('withStatus(withOnJob(') && ui.includes('storageSummary(sharedTests, status, me)') && ui.includes('Shared test storage'))
  assert.ok(fb.includes("collection(firestore(), 'benchTestStatus')") && fb.includes("{ merge: true }") && fb.includes('updatedBy: email'))
  const rules = readFileSync(new URL('../../../rules/firestore.rules', import.meta.url), 'utf8')
  assert.match(rules, /match \/benchTestStatus\/\{id\}/)
  assert.match(rules, /hasOnly\(\['sentJobs', 'downloadedAt', 'updatedBy', 'updatedAt'\]\)/, 'the same fields the hub writes')
  const removing = readFileSync(new URL('../src/bench-tests-firebase.js', import.meta.url), 'utf8')
  assert.match(removing, /try \{ await deleteDoc\(doc\(db, 'benchTestStatus'/, 'removing a test removes its status, without failing if the rules are not published yet')
})
