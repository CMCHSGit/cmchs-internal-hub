// npm test -w apps/hub — who may do what (shared/can.js, step 5A).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { can } from '../../../shared/can.js'

test('the demo tracker’s admin actions: hub admins only', () => {
  assert.equal(can({ role: 'admin' }, 'equipment.admin'), true)
  assert.equal(can({ role: 'user', team: 'Management' }, 'equipment.admin'), false)
  assert.equal(can({ role: 'user', hr: true }, 'equipment.admin'), false, 'HR is not admin')
  assert.equal(can({ role: 'admin', pending: true }, 'equipment.admin'), false, 'a placeholder never can')
  assert.equal(can(null, 'equipment.admin'), false)
})

test('test mode: admins and the testers an admin marks', () => {
  assert.equal(can({ role: 'admin' }, 'equipment.testMode'), true)
  assert.equal(can({ role: 'user', trackerTester: true }, 'equipment.testMode'), true)
  assert.equal(can({ role: 'user' }, 'equipment.testMode'), false)
  assert.equal(can({ role: 'user', trackerTester: 'yes' }, 'equipment.testMode'), false)
})

test('an action that doesn’t exist is a mistake, not a no', () => {
  assert.throws(() => can({ role: 'admin' }, 'equipment.adminn'), /no such action/)
})
