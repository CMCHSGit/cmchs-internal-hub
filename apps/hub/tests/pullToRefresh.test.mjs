import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_PX, TRIGGER_PX, canStartPull, pullOffset, pulledFarEnough } from '../../../shared/pullToRefresh.js'

test('a short drag shows nothing', () => {
  assert.equal(pullOffset(0), 0)
  assert.equal(pullOffset(8), 0)
  assert.equal(pullOffset(-50), 0)
})

test('the pull gets harder and stops at the maximum', () => {
  assert.ok(pullOffset(60) > pullOffset(30))
  assert.ok(pullOffset(60) < 50)
  assert.equal(pullOffset(2000), MAX_PX)
})

test('letting go refreshes only past the line', () => {
  assert.equal(pulledFarEnough(TRIGGER_PX - 1), false)
  assert.equal(pulledFarEnough(TRIGGER_PX), true)
  assert.equal(pulledFarEnough(pullOffset(300)), true)  // a long, deliberate pull gets there
  assert.equal(pulledFarEnough(pullOffset(80)), false)  // a lazy drag does not
})

test('a pull starts only at the very top, with one finger, with nothing in progress', () => {
  assert.equal(canStartPull({}), true)
  assert.equal(canStartPull({ pageScrollTop: 1 }), false)
  assert.equal(canStartPull({ touches: 2 }), false)
  assert.equal(canStartPull({ scrolledAncestor: true }), false)  // a list scrolled part-way keeps its own drag
  assert.equal(canStartPull({ ignoredTarget: true }), false)     // a field, a dialog, data-no-pull
  assert.equal(canStartPull({ busy: true }), false)              // unsaved work: never reload from under it
})
