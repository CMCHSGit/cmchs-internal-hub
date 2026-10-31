// npm test -w apps/hub — when the app may reload onto a new version (shared/updateGuard.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { shouldCheck, shouldReload, IDLE_MS, QUIET_MS } from '../../../shared/updateGuard.js'

test('reloads onto a new version when it is ready, nothing is in progress and they have paused', () => {
  assert.equal(shouldReload({ ready: true, busy: false, sinceActiveMs: IDLE_MS }), true)
  assert.equal(shouldReload({ ready: true, busy: false, sinceActiveMs: QUIET_MS }), true)
})

test('never reloads from under work in progress, however long they have been away', () => {
  assert.equal(shouldReload({ ready: true, busy: true, sinceActiveMs: 3 * 60 * 60_000 }), false)
})

test('waits for a pause rather than reloading while they are tapping', () => {
  assert.equal(shouldReload({ ready: true, busy: false, sinceActiveMs: 500 }), false)
})

test('does nothing until a new version is ready', () => {
  assert.equal(shouldReload({ ready: false, busy: false, sinceActiveMs: IDLE_MS }), false)
})

test('checks for a new version on coming back (not more than every 15 s) and after 10 idle minutes (not more than every 10)', () => {
  assert.equal(shouldCheck({ resumed: true, sinceActiveMs: 0, sinceCheckMs: 20_000 }), true)
  assert.equal(shouldCheck({ resumed: true, sinceActiveMs: 0, sinceCheckMs: 5_000 }), false)
  assert.equal(shouldCheck({ resumed: false, sinceActiveMs: IDLE_MS, sinceCheckMs: IDLE_MS }), true)
  assert.equal(shouldCheck({ resumed: false, sinceActiveMs: IDLE_MS - 1, sinceCheckMs: IDLE_MS }), false)
  assert.equal(shouldCheck({ resumed: false, sinceActiveMs: IDLE_MS, sinceCheckMs: 60_000 }), false)
})
