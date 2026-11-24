// The tracker's timestamps: NZ clock time with NZ's real offset (+12:00 in winter, +13:00 in daylight
// saving). Before 24 Nov 2026 every one was marked +12:00, so summer ones are read by their clock time.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fmtWhen, historyFor, nzNow, nzStampAt, relTime, stampMs } from '../src/model.js'

const WINTER = new Date('2026-07-15T00:00:00Z') // 12:00 NZST
const SUMMER = new Date('2026-11-24T03:26:00Z') // 16:26 NZDT: the loan form saved on 24 Nov 2026

test('nzNow: NZ clock time with the offset NZ has then, winter and summer', () => {
  assert.equal(nzNow(WINTER), '2026-07-15T12:00:00+12:00')
  assert.equal(nzNow(SUMMER), '2026-11-24T16:26:00+13:00')
  assert.equal(Date.parse(nzNow(WINTER)), WINTER.getTime())
  assert.equal(Date.parse(nzNow(SUMMER)), SUMMER.getTime())
  assert.equal(nzNow(new Date('2026-11-24T03:26:00.987Z')), '2026-11-24T16:26:00+13:00') // milliseconds dropped
})

test('nzNow: either side of the changes (27 Sep 2026 on, 5 Apr 2026 off)', () => {
  assert.equal(nzNow(new Date('2026-09-26T13:59:00Z')), '2026-09-27T01:59:00+12:00')
  assert.equal(nzNow(new Date('2026-09-26T14:00:00Z')), '2026-09-27T03:00:00+13:00')
  assert.equal(nzNow(new Date('2026-04-04T13:59:00Z')), '2026-04-05T02:59:00+13:00')
  assert.equal(nzNow(new Date('2026-04-04T14:00:00Z')), '2026-04-05T02:00:00+12:00')
})

test('nzStampAt: a picked NZ date and time gets the offset NZ had then', () => {
  assert.equal(nzStampAt('2026-07-15T09:00'), '2026-07-15T09:00:00+12:00')
  assert.equal(nzStampAt('2026-11-24T16:26'), '2026-11-24T16:26:00+13:00')
  assert.equal(nzStampAt('2026-11-24T16:26:30'), '2026-11-24T16:26:30+13:00')
  assert.equal(nzStampAt('2026-09-27T02:30'), '2026-09-27T02:30:00+12:00') // the skipped hour: as the old ones
})

test('stampMs: old summer stamps (+12:00) and new ones (+13:00) are the same moment; winter and UTC as they are', () => {
  const real = SUMMER.getTime()
  assert.equal(stampMs('2026-11-24T16:26:00+12:00'), real) // old: clock time right, offset wrong
  assert.equal(stampMs('2026-11-24T16:26:00+13:00'), real) // new
  assert.equal(stampMs('2026-11-24T16:26+12:00'), real) // no seconds
  assert.equal(stampMs('2026-07-15T12:00:00+12:00'), WINTER.getTime())
  assert.equal(stampMs('2026-11-24T03:26:00.000Z'), real)
  assert.equal(stampMs(real), real)
  assert.ok(Number.isNaN(stampMs('')))
  assert.ok(Number.isNaN(stampMs('not a time')))
})

test('fmtWhen: the NZ clock time, for old and new stamps, winter and summer', () => {
  assert.equal(fmtWhen('2026-11-24T16:26:00+12:00'), '24 Nov, 16:26') // old summer stamp
  assert.equal(fmtWhen('2026-11-24T16:26:00+13:00'), '24 Nov, 16:26') // new summer stamp
  assert.equal(fmtWhen('2026-11-24T03:26:00Z'), '24 Nov, 16:26') // UTC
  assert.equal(fmtWhen('2026-07-15T12:00:00+12:00'), '15 Jul, 12:00') // winter, old or new
  assert.equal(fmtWhen('2026-07-15T00:00:00Z'), '15 Jul, 12:00')
  assert.equal(fmtWhen(nzNow(SUMMER), { year: true }), '24 Nov 2026, 16:26') // History and its audit log
  assert.equal(fmtWhen(nzNow(WINTER), { year: true }), '15 Jul 2026, 12:00')
  assert.equal(fmtWhen('2026-11-24T03:26:00Z', { year: true }), '24 Nov 2026, 16:26')
  assert.equal(fmtWhen(''), '')
  assert.equal(fmtWhen(true), '')
})

test('relTime: an old summer stamp is not an hour in the future', () => {
  const now = Date.parse('2026-11-24T03:56:00Z') // 16:56 NZDT
  assert.equal(relTime('2026-11-24T16:26:00+12:00', now), '30m ago')
  assert.equal(relTime('2026-11-24T16:26:00+13:00', now), '30m ago')
  assert.equal(relTime('2026-07-15T12:00:00+12:00', Date.parse('2026-07-15T02:00:00Z')), '2h ago')
})

test('old and new stamps still sort by clock time as text', () => {
  const history = [
    { chsAssetNo: 'A1', ts: '2026-11-24T16:20:00+12:00', action: 'Loan' }, // old
    { chsAssetNo: 'A1', ts: '2026-11-24T16:26:00+13:00', action: 'Return' }, // new, 6 minutes later
    { chsAssetNo: 'A1', ts: '2026-07-15T12:00:00+12:00', action: 'Count' },
  ]
  assert.deepEqual(historyFor({ CHSAssetNo: 'A1' }, history).map((h) => h.action), ['Return', 'Loan', 'Count'])
})
