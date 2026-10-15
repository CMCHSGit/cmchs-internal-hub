import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mondayOf, addDays, fmt, fmtY, fmtRange, overlaps, inkOn, availability, bookedInWeek, loadLevel,
  overdueReturns, shortfalls, clashes, searchJobs, highlight, filterJobs, dueForAutoArchive,
  templateFrom, weeksFrom, withDefaults, initialsOf,
} from '../src/model.js'
import { SAMPLE_JOBS, SAMPLE_ASSIGNMENTS, SAMPLE_STAFF, SAMPLE_POOL, SAMPLE_COMMENTS } from '../src/sample.js'

const TODAY = '2026-10-15'
const pool = withDefaults({}).pool.map((p) => ({ ...p, total: SAMPLE_POOL[p.model] ?? null }))

test('dates: weeks start on Monday and show NZ style', () => {
  assert.equal(mondayOf('2026-10-15'), '2026-10-12')
  assert.equal(mondayOf('2026-10-12'), '2026-10-12')
  assert.equal(mondayOf('2026-10-18'), '2026-10-12') // Sunday
  assert.equal(addDays('2026-10-30', 3), '2026-11-02')
  assert.equal(fmt('2026-10-05'), '05-Oct')
  assert.equal(fmtY('2026-10-09'), '09-Oct-2026')
  assert.equal(fmtRange('2026-11-16', '2026-12-03'), '16-Nov – 03-Dec')
  assert.equal(fmtRange('', ''), 'Dates TBC')
  assert.deepEqual(weeksFrom('2026-10-12', 3), ['2026-10-12', '2026-10-19', '2026-10-26'])
  // Across the NZ daylight saving change (27 Sep 2026)
  assert.equal(addDays('2026-09-26', 2), '2026-09-28')
})

test('overlaps is inclusive and ignores jobs without dates', () => {
  assert.ok(overlaps('2026-11-16', '2026-12-03', '2026-12-03', '2026-12-09'))
  assert.ok(!overlaps('2026-11-16', '2026-12-03', '2026-12-04', '2026-12-09'))
  assert.ok(!overlaps('', '', '2026-01-01', '2026-12-31'))
})

test('text colour on fills', () => {
  assert.equal(inkOn('#554596'), '#ffffff')
  assert.equal(inkOn('#80bd01'), '#1d1d1d')
  assert.equal(inkOn('#dbd7ed'), '#1d1d1d')
})

test('HINZ is short of ePM12: the Hutt loan and an overdue unit hold them', () => {
  const hinz = SAMPLE_JOBS.find((j) => j.id === 'sample-hinz')
  const a = availability(SAMPLE_JOBS, pool, { model: 'ePM12', qty: 2, job: hinz, today: TODAY })
  assert.equal(a.owned, 7)
  assert.equal(a.used, 7) // 6 at Hutt + 1 overdue from North Shore
  assert.equal(a.free, 0)
  assert.equal(a.short, 2)
  assert.deepEqual(a.entries.map((e) => e.job.id).sort(), ['sample-hutt', 'sample-ns'])
})

test('unknown pool size never reports a shortfall', () => {
  const hinz = SAMPLE_JOBS.find((j) => j.id === 'sample-hinz')
  const a = availability(SAMPLE_JOBS, withDefaults({}).pool, { model: 'ePM12', qty: 2, job: hinz, today: TODAY })
  assert.equal(a.owned, null)
  assert.equal(a.short, 0)
})

test('Equipment grid counts and colours', () => {
  const w = bookedInWeek(SAMPLE_JOBS, 'ePM12', '2026-11-16', TODAY)
  assert.equal(w.total, 9)
  assert.equal(loadLevel(9, 7), 'short')
  assert.equal(loadLevel(3, 3), 'full')
  assert.equal(loadLevel(1, 3), 'free')
  assert.equal(loadLevel(0, null), 'none')
  // A returned line counts for nothing
  assert.equal(bookedInWeek(SAMPLE_JOBS, 'A9', '2025-02-24', TODAY).total, 0)
})

test('overdue returns come from archived jobs too', () => {
  const o = overdueReturns(SAMPLE_JOBS, TODAY)
  assert.deepEqual(o.map((x) => [x.model, x.days]), [['ePM12', 13], ['D60', 6]])
})

test('shortfalls in the next six weeks', () => {
  const s = shortfalls(SAMPLE_JOBS, pool, weeksFrom('2026-10-12', 6), TODAY)
  const e = s.find((x) => x.model === 'ePM12')
  assert.equal(e.level, 'short') // full from 26-Oct, but short on 16-Nov is what matters
  assert.equal(e.week, '2026-11-16')
  assert.equal(e.booked, 9)
  assert.equal(s[0].model, 'ePM12') // short before full
  assert.equal(s.find((x) => x.model === 'N19').level, 'full')
})

test('clashes: double-booked and booked on leave', () => {
  const active = new Set(SAMPLE_JOBS.filter((j) => !j.archived).map((j) => j.id))
  const c = clashes(SAMPLE_ASSIGNMENTS, SAMPLE_STAFF, active)
  assert.equal(c.get('s-km|2026-11-16'), 'double')
  assert.equal(c.get('s-dw|2026-11-30'), 'leave')
  assert.equal(c.get('s-tb|2026-10-12'), undefined)
})

test('search finds the last Whanganui A9 trial and who went', () => {
  const r = searchJobs('A9 Whanganui', SAMPLE_JOBS, { comments: SAMPLE_COMMENTS, assignments: SAMPLE_ASSIGNMENTS, staff: SAMPLE_STAFF })
  assert.equal(r[0].job.id, 'sample-wa9')
  assert.ok(r[0].all)
  assert.deepEqual(r[0].people.map((p) => p.initials).sort(), ['KM', 'SL'])
  // Initials and tracking numbers are searchable
  assert.ok(searchJobs('RP', SAMPLE_JOBS, { assignments: SAMPLE_ASSIGNMENTS, staff: SAMPLE_STAFF }).some((x) => x.job.id === 'sample-waitakere'))
  assert.equal(searchJobs('4471', SAMPLE_JOBS)[0].job.id, 'sample-waitakere')
  assert.equal(searchJobs('D60s', SAMPLE_JOBS, { comments: SAMPLE_COMMENTS })[0].field, 'Comments')
})

test('highlight marks every match', () => {
  assert.deepEqual(highlight('Whanganui A9 trial', ['a9']), [{ t: 'Whanganui ', hit: false }, { t: 'A9', hit: true }, { t: ' trial', hit: false }])
})

test('saved views', () => {
  const active = SAMPLE_JOBS.filter((j) => !j.archived)
  const ctx = { today: TODAY, assignments: SAMPLE_ASSIGNMENTS, me: { name: 'Mike Tan' } }
  assert.equal(filterJobs(active, { status: 'Waiting' }, ctx).length, 2)
  assert.equal(filterJobs(active, { priority: 'High' }, ctx).length, 5)
  assert.deepEqual(filterJobs(active, { mine: true }, ctx).map((j) => j.id).sort(), ['sample-hinz', 'sample-whanganui'])
  assert.ok(filterJobs(active, { month: true }, ctx).every((j) => j.start))
  assert.deepEqual(filterJobs(active, { staff: 's-gh' }, ctx).map((j) => j.id).sort(), ['sample-hinz', 'sample-northland'])
})

test('archiving helpers', () => {
  assert.ok(dueForAutoArchive({ status: 'Complete', autoArchiveOn: '2026-10-15' }, TODAY))
  assert.ok(!dueForAutoArchive({ status: 'Complete', autoArchiveOn: '2026-10-16' }, TODAY))
  assert.ok(!dueForAutoArchive({ status: 'Support', autoArchiveOn: '2026-10-01' }, TODAY))
  const t = templateFrom(SAMPLE_JOBS.find((j) => j.id === 'sample-wa9'))
  assert.equal(t.start, '')
  assert.equal(t.notes, undefined)
  assert.equal(t.category, 'trials')
  assert.deepEqual(t.equipment.map((l) => [l.model, l.qty, l.line]), [['A9', 2, 'Requested']])
  assert.equal(initialsOf('Kiri Moana'), 'KM')
})

test('equipment still needing a demo loan form', async () => {
  const { linesNeedingLoan } = await import('../src/model.js')
  const job = {
    id: 'j', equipment: [
      { id: 'a', model: 'A7', qty: 1, line: 'Requested' },
      { id: 'b', model: 'N22', qty: 2, line: 'Reserved', loan: 'batch-1' }, // linked to a demo tracker loan
      { id: 'c', model: 'Surgical bed', qty: 1, line: 'Requested', noLoan: true }, // marked as not needing one
      { id: 'd', model: 'D30', qty: 3, line: 'Returned' },
      { id: 'e', model: 'V700', qty: 0, line: 'Requested' },
    ],
  }
  assert.deepEqual(linesNeedingLoan(job).map((l) => l.id), ['a'])
  assert.deepEqual(linesNeedingLoan({ ...job, archived: true }), [])
  assert.deepEqual(linesNeedingLoan({ id: 'x' }), [])
})
