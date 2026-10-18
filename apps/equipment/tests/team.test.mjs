// npm test -w apps/equipment — the tracker's team from hub records (model.js teamFrom, step 5A).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { teamFrom } from '../src/model.js'

test('hub roles win, matched by email then name; people with a hub role only are added; placeholders skipped', () => {
  const old = [{ name: 'Sam Lee', email: 'sam@x.nz', role: 'am', fcmTokens: ['t'] }, { name: 'Tama Brown', email: '', role: 'am' }]
  const users = [
    { displayName: 'Samuel Lee', email: 'SAM@x.nz', trackerRole: 'service' },
    { displayName: 'Tama Brown', email: 'tama@x.nz', trackerRole: 'am' },
    { displayName: 'Kiri Moana', email: 'kiri@x.nz', trackerRole: 'service' },
    { displayName: 'New Person', email: 'new@x.nz', trackerRole: 'am', pending: true },
    { displayName: 'No Role', email: 'n@x.nz' },
  ]
  const t = teamFrom(old, users)
  assert.deepEqual(t.map((m) => [m.name, m.role, m.email]), [['Kiri Moana', 'service', 'kiri@x.nz'], ['Sam Lee', 'service', 'sam@x.nz'], ['Tama Brown', 'am', 'tama@x.nz']])
  assert.deepEqual(t.find((m) => m.name === 'Sam Lee').fcmTokens, ['t'], 'the old record kept, only its role changed')
})
