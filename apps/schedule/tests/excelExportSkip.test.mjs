import test from 'node:test'
import assert from 'node:assert/strict'
import { workbookUnchanged, stateAfter, RECHECK_MINUTES } from '../scripts/excelExportSkip.mjs'

const stat = { mtimeMs: 1000, size: 50 }
const now = 10 * 60 * 1000
const fresh = { mtimeMs: 1000, size: 50, checkedAt: now - 60 * 1000, appSeenAt: now - 60 * 1000, retry: false }

test('the same workbook, a recent pass, nothing to retry: skip', () => {
  assert.equal(workbookUnchanged({ state: fresh, stat, now }), true)
})
test('a changed workbook is never skipped', () => {
  assert.equal(workbookUnchanged({ state: fresh, stat: { mtimeMs: 2000, size: 50 }, now }), false)
  assert.equal(workbookUnchanged({ state: fresh, stat: { mtimeMs: 1000, size: 51 }, now }), false)
})
test('a pass that must be retried (locked, failed) is run again', () => {
  assert.equal(workbookUnchanged({ state: { ...fresh, retry: true }, stat, now }), false)
})
test('after the recheck time it looks again, whatever else', () => {
  const old = { ...fresh, checkedAt: now - RECHECK_MINUTES * 60 * 1000 }
  assert.equal(workbookUnchanged({ state: old, stat, now }), false)
  assert.equal(workbookUnchanged({ state: old, stat, now, recheckMinutes: 60 }), true)
})
test('--force, no state, or a state with no time is never skipped', () => {
  assert.equal(workbookUnchanged({ state: fresh, stat, now, force: true }), false)
  assert.equal(workbookUnchanged({ state: null, stat, now }), false)
  assert.equal(workbookUnchanged({ state: {}, stat, now }), false)
  assert.equal(workbookUnchanged({ state: { mtimeMs: 1000, size: 50 }, stat, now }), false)
})
test('what is remembered: the workbook after the pass, the pass start, and whether to retry', () => {
  assert.deepEqual(stateAfter({ stat, passStart: 7, status: 'done' }), { mtimeMs: 1000, size: 50, checkedAt: 7, appSeenAt: 7, retry: false })
  assert.equal(stateAfter({ stat, passStart: 7, status: 'nothing' }).retry, false)
  assert.equal(stateAfter({ stat, passStart: 7, status: 'partial' }).retry, false)
  assert.equal(stateAfter({ stat, passStart: 7, status: 'locked' }).retry, true)
  assert.equal(stateAfter({ stat, passStart: 7, status: 'error' }).retry, true)
})
