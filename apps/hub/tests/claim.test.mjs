// npm test -w apps/hub — matching a new sign-in to the entry an admin made for them
// (placeholderFor_ in backend/apps-script/proxy/Code.js, read straight out of it so the
// test checks what's deployed). Names are made up.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const grab = (name) => {
  const i = code.indexOf('function ' + name + '(')
  assert.ok(i >= 0, name + ' not found')
  return code.slice(i, code.indexOf('\n}\n', i) + 3)
}
const line = code.slice(code.indexOf('const NICKNAMES_'), code.indexOf('\n', code.indexOf('const NICKNAMES_')))
const ctx = vm.createContext({})
vm.runInContext(line + '\n' + grab('nameParts_') + grab('firstNamesAlike_') + grab('placeholderFor_'), ctx)
const find = (person, list) => ctx.placeholderFor_(person, list)?.id ?? null

const entries = [
  { id: 'p-jess-b', displayName: 'Jess Broughan' },
  { id: 'p-jess-c', displayName: 'Jess Chalklen' },
  { id: 'p-mike', displayName: 'Mike Rivers' },
  { id: 'p-sam', displayName: 'Sam' },
]

test('the same last name and a first name that shortens to it: Jessica is Jess', () => {
  assert.equal(find({ displayName: 'Jessica Broughan' }, entries), 'p-jess-b')
  assert.equal(find({ displayName: 'Jessica Chalklen' }, entries), 'p-jess-c')
})

test('nicknames and punctuation', () => {
  assert.equal(find({ displayName: 'Michael Rivers' }, entries), 'p-mike')
  assert.equal(find({ displayName: 'Jessica Broughan-' }, entries), 'p-jess-b')
  assert.equal(find({ displayName: 'JESSICA BROUGHAN' }, entries), 'p-jess-b')
})

test('a different last name, or only a first name, is never a match', () => {
  assert.equal(find({ displayName: 'Jessica Smith' }, entries), null)
  assert.equal(find({ displayName: 'Jessica' }, entries), null)
  assert.equal(find({ displayName: 'Sam Jones' }, entries), null, 'an entry with only a first name is the browser\'s job (unique first name), not a guess here')
  assert.equal(find({ displayName: 'Jo Broughan' }, entries), null, 'two letters is too short to be a shortening')
  assert.equal(find({ displayName: 'Jasmine Broughan' }, entries), null)
})

test('two entries that fit are left alone for an admin', () => {
  const two = [...entries, { id: 'p-jessica-b', displayName: 'Jessica Broughan' }]
  assert.equal(find({ displayName: 'Jess Broughan' }, two), null)
})

test('an exact work email wins, even when the names differ', () => {
  const withEmail = [{ id: 'p-x', displayName: 'Robert Quinn', email: 'bob.quinn@cass.co.nz' }, ...entries]
  assert.equal(find({ displayName: 'Bobby Q', email: 'Bob.Quinn@cass.co.nz' }, withEmail), 'p-x')
})
