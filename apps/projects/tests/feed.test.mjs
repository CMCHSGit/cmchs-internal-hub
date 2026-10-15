import { test } from 'node:test'
import assert from 'node:assert/strict'
import { feedDate, nameMatches, matchModel, summarise, effectivePool, trimRaw, aliasesOf, guessFamily } from '../src/feed.js'
import {
  withDefaults, availability, bookedInWeek, overdueReturns, shortfalls, linkableLoans, entryWho, weeksFrom,
} from '../src/model.js'
import { SAMPLE_FEED } from '../src/sample.js'

const TODAY = '2026-10-15'
const pool = withDefaults({}).pool
const raw = trimRaw(SAMPLE_FEED.equipment, SAMPLE_FEED.upcoming)
const sum = summarise(raw, pool, TODAY)
const loansOf = (model) => sum.loans.filter((l) => l.model === model)

test('feed dates: ISO, and the tracker’s older DD/MM/YYYY', () => {
  assert.equal(feedDate('2026-10-30'), '2026-10-30')
  assert.equal(feedDate('3/9/2026'), '2026-09-03')
  assert.equal(feedDate('25/09/26'), '2026-09-25')
  assert.equal(feedDate(''), '')
  assert.equal(feedDate('soon'), '')
})

test('tracker model names match pool models by name, not by accident', () => {
  const n19 = aliasesOf({ model: 'N19' })[0]
  assert.ok(nameMatches('BeneVision N19', n19))
  assert.ok(nameMatches('N-19', n19))
  assert.ok(!nameMatches('N19 Battery', n19))
  assert.ok(nameMatches('ePM 12M', 'epm12'))
  assert.ok(!nameMatches('A90', 'a9'))
  assert.equal(matchModel('BeneHeart D1 Pro', pool), 'D1 Pro')
  assert.equal(matchModel('BeneHeart D30', pool), 'D30')
  assert.equal(matchModel('SC6-1s', pool), null)
  // An extra name from Settings
  assert.equal(matchModel('VS-900', pool), null)
  assert.equal(matchModel('VS-900', pool.map((p) => (p.model === 'V200' ? { ...p, match: 'VS-900, VS 8' } : p))), 'V200')
})

test('summarise: units owned per model, what matched, and what nothing claims', () => {
  assert.equal(sum.owned.A7, 3)
  assert.equal(sum.owned.N19, 3)
  assert.equal(sum.owned.ePM12, 8)
  assert.equal(sum.owned.V200, 1) // the VS-900 isn't matched
  assert.deepEqual(sum.names.ePM12, { 'ePM 12M': 8 })
  assert.deepEqual(sum.unmatched.map((u) => u.name).sort(), ['SC6-1s', 'SP5-1s', 'TEX20', 'VS-900'])
  assert.equal(sum.assets, SAMPLE_FEED.equipment.length)
})

test('summarise: loans out, overdue, and booked ahead, per model', () => {
  const [n19] = loansOf('N19')
  assert.equal(n19.qty, 1)
  assert.equal(n19.loanTo, 'Tauranga Hospital')
  assert.equal(n19.location, 'ICU')
  assert.equal(n19.due, '2026-10-30')
  assert.ok(n19.out)
  assert.deepEqual(n19.assets, ['100211'])
  const [d60] = loansOf('D60')
  assert.equal(d60.due, '2026-09-25') // from DD/MM/YYYY
  const [a7] = loansOf('A7')
  assert.equal(a7.qty, 2)
  assert.equal(a7.out, false)
  assert.equal(a7.start, '2026-11-09')
})

test('a booked-ahead loan that has gone out is counted once, under the same key', () => {
  const started = {
    equipment: raw.equipment.map((e) => (e.CHSAssetNo === '100203' || e.CHSAssetNo === '100204'
      ? { ...e, OnLoanTo: 'Hawke’s Bay Hospital', Returned: 'No', LoanStartDate: '2026-11-09', LoanEndDate: '2026-11-20', BatchID: 'demo-hb' } : e)),
    upcoming: raw.upcoming,
  }
  const a7 = summarise(started, pool, '2026-11-10').loans.filter((l) => l.model === 'A7')
  assert.equal(a7.length, 1)
  assert.equal(a7[0].key, 'demo-hb')
  assert.equal(a7[0].qty, 2)
  assert.ok(a7[0].out)
})

test('trimRaw keeps only what the tracker needs, from arrays or keyed objects', () => {
  const t = trimRaw({ 0: { id: 'x', Model: 'A9', BorrowerEmail: 'someone@example.com', NZPrice: 1 } }, null)
  assert.deepEqual(t, { equipment: [{ id: 'x', Model: 'A9' }], upcoming: [] })
})

test('effective pool: the feed’s count wins where it found units', () => {
  const eff = effectivePool(pool.map((p) => ({ ...p, total: p.model === 'A9' ? 5 : null })), sum)
  const a9 = eff.find((p) => p.model === 'A9')
  assert.equal(a9.total, 2)
  assert.equal(a9.typed, 5)
  assert.ok(a9.fromFeed)
  const bed = eff.find((p) => p.model === 'Surgical bed')
  assert.equal(bed.total, null)
  assert.equal(bed.fromFeed, false)
  assert.equal(effectivePool(pool, null), pool)
})

// ── counting loans alongside the tracker's own reservations ──
const effPool = effectivePool(pool, sum)
const job = (id, start, end, equipment, extra = {}) => ({ id, name: id, start, end, equipment, ...extra })

test('availability counts the demo tracker’s loans as well as other jobs', () => {
  const others = job('other', '2026-10-20', '2026-10-31', [{ id: 'o1', model: 'N19', qty: 1, line: 'Reserved' }])
  const mine = job('mine', '2026-10-26', '2026-11-06', [{ id: 'm1', model: 'N19', qty: 2, line: 'Requested' }])
  const a = availability([others, mine], effPool, { model: 'N19', qty: 2, job: mine, today: TODAY, loans: sum.loans })
  assert.equal(a.owned, 3)
  assert.equal(a.used, 2) // the other job's 1 + Tauranga's 1
  assert.equal(a.free, 1)
  assert.equal(a.short, 1)
  const feedEntry = a.entries.find((e) => e.feed)
  assert.equal(feedEntry.loan.loanTo, 'Tauranga Hospital')
  assert.equal(entryWho(feedEntry), 'Tauranga Hospital, ICU')
  // Without the feed, only the job counts
  assert.equal(availability([others, mine], effPool, { model: 'N19', qty: 2, job: mine, today: TODAY }).used, 1)
  // After Tauranga's due date the unit is free again
  const later = job('later', '2026-11-02', '2026-11-06', [])
  assert.equal(availability([later], effPool, { model: 'N19', qty: 1, job: later, today: TODAY, loans: sum.loans }).used, 0)
})

test('an overdue loan holds its unit every week from today until it comes back', () => {
  for (const w of weeksFrom('2026-10-12', 6)) {
    assert.equal(bookedInWeek([], 'D60', w, TODAY, sum.loans).total, 1, w)
  }
  assert.equal(bookedInWeek([], 'D60', '2026-09-21', TODAY, sum.loans).total, 1) // out on its own dates too
  const back = overdueReturns([], TODAY, sum.loans)
  assert.equal(back.length, 1)
  assert.equal(back[0].model, 'D60')
  assert.equal(back[0].days, 20)
  assert.ok(back[0].feed)
  assert.equal(back[0].job, null)
})

test('a loan booked ahead counts only for its own dates', () => {
  assert.equal(bookedInWeek([], 'A7', '2026-11-02', TODAY, sum.loans).total, 0)
  assert.equal(bookedInWeek([], 'A7', '2026-11-09', TODAY, sum.loans).total, 2)
  assert.equal(bookedInWeek([], 'A7', '2026-11-16', TODAY, sum.loans).total, 2)
  assert.equal(bookedInWeek([], 'A7', '2026-11-23', TODAY, sum.loans).total, 0)
})

test('a job line linked to a loan counts the units once, on the job', () => {
  const hb = job('hb', '2026-11-09', '2026-11-20', [{ id: 'h1', model: 'A7', qty: 3, line: 'Reserved', loan: 'demo-hb' }])
  const wk = bookedInWeek([hb], 'A7', '2026-11-09', TODAY, sum.loans)
  assert.equal(wk.total, 3) // the bigger of the job's 3 and the loan's 2, not 5
  assert.equal(wk.entries.length, 1)
  assert.equal(wk.entries[0].job.id, 'hb')
  assert.equal(wk.entries[0].loan.key, 'demo-hb')
  // Linked to an overdue loan: overdue by the tracker's date, and on Home once
  const rot = job('rot', '2026-09-01', '2026-10-31', [{ id: 'r1', model: 'D60', qty: 1, line: 'Reserved', loan: 'demo-rot' }])
  assert.ok(bookedInWeek([rot], 'D60', '2026-11-16', TODAY, sum.loans).entries[0].overdue)
  const back = overdueReturns([rot], TODAY, sum.loans)
  assert.equal(back.length, 1)
  assert.equal(back[0].job.id, 'rot')
  // Once the tracker has it back, the linked line stops counting
  const returned = summarise({ ...raw, equipment: raw.equipment.map((e) => (e.CHSAssetNo === '100241' ? { ...e, Returned: 'Yes' } : e)) }, pool, TODAY)
  assert.equal(bookedInWeek([rot], 'D60', '2026-10-12', TODAY, returned.loans).total, 0)
})

test('loans a job can link to: same model, touching its dates, not someone else’s', () => {
  const hb = job('hb', '2026-11-01', '2026-11-30', [{ id: 'h1', model: 'A7', qty: 2, line: 'Requested' }])
  assert.deepEqual(linkableLoans([hb], sum.loans, { model: 'A7', job: hb, today: TODAY }).map((l) => l.key), ['demo-hb'])
  const taken = job('taken', '2026-11-09', '2026-11-20', [{ id: 't1', model: 'A7', qty: 2, line: 'Reserved', loan: 'demo-hb' }])
  assert.deepEqual(linkableLoans([hb, taken], sum.loans, { model: 'A7', job: hb, today: TODAY }), [])
  const dec = job('dec', '2026-12-01', '2026-12-10', [])
  assert.deepEqual(linkableLoans([dec], sum.loans, { model: 'A7', job: dec, today: TODAY }), [])
})

test('shortfalls see the feed: D60 is fully held by the overdue loan plus a job', () => {
  const j = job('j', '2026-10-19', '2026-10-23', [{ id: 'x', model: 'D60', qty: 1, line: 'Reserved' }])
  const s = shortfalls([j], effPool, weeksFrom('2026-10-12', 4), TODAY, sum.loans)
  const d60 = s.find((x) => x.model === 'D60')
  assert.equal(d60.level, 'full')
  assert.equal(d60.week, '2026-10-19')
})

test('a model no pool entry claims is counted under its own name, loans and all', () => {
  // VS-900 and the ultrasound kit aren't in the default pool
  assert.equal(sum.owned['VS-900'], 1)
  assert.equal(sum.owned.TEX20, 1)
  assert.deepEqual(sum.names['SC6-1s'], { 'SC6-1s': 1 })
  const lent = summarise({ ...raw, equipment: raw.equipment.map((e) => (e.CHSAssetNo === '100393' ? { ...e, OnLoanTo: 'Dunedin Hospital', Returned: 'No', LoanStartDate: '2026-10-12', LoanEndDate: '2026-10-23', BatchID: 'b-probe' } : e)) }, pool, TODAY)
  const probe = lent.loans.find((l) => l.model === 'SC6-1s')
  assert.equal(probe.qty, 1)
  assert.equal(probe.loanTo, 'Dunedin Hospital')
  assert.equal(bookedInWeek([], 'SC6-1s', '2026-10-12', TODAY, lent.loans).total, 1)
  // Still listed for Settings, so someone can fold a spelling into a listed model
  assert.ok(sum.unmatched.some((u) => u.name === 'SC6-1s'))
})

test('the effective pool adds every other demo tracker model, grouped by a guessed family', () => {
  const eff = effectivePool(pool, sum)
  assert.deepEqual(eff.slice(0, pool.length).map((p) => p.model), pool.map((p) => p.model))
  const extra = eff.slice(pool.length)
  assert.deepEqual(extra.map((p) => p.model).sort(), ['SC6-1s', 'SP5-1s', 'TEX20', 'VS-900'])
  const tex = extra.find((p) => p.model === 'TEX20')
  assert.equal(tex.family, 'Ultrasound')
  assert.equal(tex.total, 1)
  assert.ok(tex.auto && tex.fromFeed)
  assert.equal(extra.find((p) => p.model === 'VS-900').family, 'Monitors')
})

test('families guessed from Mindray model names', () => {
  const cases = {
    'BeneVision N22': 'Monitors', 'ePM 12M': 'Monitors', 'VS-900': 'Monitors', TM80: 'Monitors',
    A9: 'Anaesthesia', 'WATO EX-65': 'Anaesthesia',
    'BeneHeart D60': 'Defibs', 'BeneHeart C2A': 'Defibs', 'D1 Pro': 'Defibs',
    TEX20: 'Ultrasound', 'TE Air': 'Ultrasound', 'SC6-1s': 'Ultrasound', 'L14-6Ns': 'Ultrasound', MX5: 'Ultrasound',
    SV300: 'Ventilators', 'HyBase 8300': 'Beds', 'BeneFusion VP5': 'Infusion', 'ECG Module': 'Other demo equipment',
  }
  for (const [name, fam] of Object.entries(cases)) assert.equal(guessFamily(name), fam, name)
})
