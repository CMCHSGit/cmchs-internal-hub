// npm test -w apps/hub — who is told when a checklist is shared (checklistShareRecipients_ in
// backend/apps-script/proxy/Code.js, read straight out of it so the test checks what's deployed).
// Names are made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const i = code.indexOf('function checklistShareRecipients_(')
assert.ok(i >= 0, 'checklistShareRecipients_ not found')
const ctx = vm.createContext({})
vm.runInContext(code.slice(i, code.indexOf('\n}\n', i) + 3), ctx)
const who = (list, users) => [...ctx.checklistShareRecipients_(list, users)].sort()

const users = [
  { uid: 'owner', team: 'Engineers' }, { uid: 'ann', team: 'Engineers' }, { uid: 'ben', team: 'Sales' },
  { uid: 'cara', team: 'Application' }, { uid: 'dee', team: 'Sales', pending: true }, { uid: 'eli', team: '' },
]

test('people named, and everyone on a team it is shared with, but never the owner', () => {
  assert.deepEqual(who({ createdBy: 'owner', people: ['owner', 'cara'], teams: [] }, users), ['cara'])
  assert.deepEqual(who({ createdBy: 'owner', people: ['owner'], teams: ['Engineers'] }, users), ['ann'], 'the owner is on the team and is not told')
  assert.deepEqual(who({ createdBy: 'owner', people: ['owner', 'eli'], teams: ['Sales'] }, users), ['ben', 'eli'])
})

test('a placeholder who has not signed in yet is never told', () => {
  assert.deepEqual(who({ createdBy: 'owner', people: ['dee'], teams: ['Sales'] }, users), ['ben'])
})

test('people already told are not told again, so sharing with one more person tells only that person', () => {
  const list = { createdBy: 'owner', people: ['owner', 'ann', 'cara'], teams: [], notified: ['ann'] }
  assert.deepEqual(who(list, users), ['cara'])
  assert.deepEqual(who({ ...list, notified: ['ann', 'cara'] }, users), [])
})

test('a list shared with nobody tells nobody', () => {
  assert.deepEqual(who({ createdBy: 'owner', people: ['owner'], teams: [] }, users), [])
  assert.deepEqual(who({ createdBy: 'owner' }, users), [])
})
