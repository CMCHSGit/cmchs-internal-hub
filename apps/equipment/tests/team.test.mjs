// npm test -w apps/equipment — the tracker's team from hub records (model.js teamFrom, step 5A).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teamFrom } from '../src/model.js'

test('the team is the hub people with a tracker role: signed in only, by display name, sorted', () => {
  const users = [
    { uid: 'a', displayName: 'Tama Brown', email: 'tama@x.nz', trackerRole: 'am' },
    { uid: 'b', displayName: 'Kiri Moana', email: 'kiri@x.nz', trackerRole: 'service' },
    { uid: 'c', displayName: 'New Person', email: 'new@x.nz', trackerRole: 'am', pending: true },
    { uid: 'd', displayName: 'No Role', email: 'n@x.nz' },
    { uid: 'e', displayName: 'Odd Role', email: 'o@x.nz', trackerRole: 'boss' },
    { uid: 'f', email: 'nameless@x.nz', trackerRole: 'am' },
  ]
  assert.deepEqual(teamFrom(users).map((m) => [m.uid, m.name, m.role, m.email]),
    [['b', 'Kiri Moana', 'service', 'kiri@x.nz'], ['f', 'nameless@x.nz', 'am', 'nameless@x.nz'], ['a', 'Tama Brown', 'am', 'tama@x.nz']])
  assert.deepEqual(teamFrom(), [])
})

test('someone who switched demo reminders off is marked notify: false; missing means on', () => {
  const t = teamFrom([
    { uid: 'a', displayName: 'Off', trackerRole: 'am', notifications: { demoReminders: false } },
    { uid: 'b', displayName: 'On', trackerRole: 'am', notifications: { scheduleReminder: false } },
  ])
  assert.equal(t.find((m) => m.name === 'Off').notify, false)
  assert.equal('notify' in t.find((m) => m.name === 'On'), false)
})
