// npm test -w apps/equipment — /demo/ (apps/demo/build.mjs): every visit goes to the new tracker, old links with their query and hash.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'

import { FORWARD_SCRIPT, OLD_LINK_KEYS, PAGE } from '../../demo/build.mjs'
import { linkTarget } from '../src/model.js'

const run = (search, hash = '') => {
  const calls = []
  vm.runInNewContext(FORWARD_SCRIPT, { URLSearchParams, location: { search, hash, replace: (u) => calls.push(u) } })
  return calls
}

test('a bare /demo/ opens the new tracker', () => {
  assert.deepEqual(run(''), ['/equipment/'])
  assert.deepEqual(run('?utm=x', '#/loans'), ['/equipment/?utm=x#/loans'])
  assert.match(PAGE, /http-equiv="refresh" content="0; url=\/equipment\/"/)
  assert.match(PAGE, /href="\/equipment\/"/)
  assert.doesNotMatch(PAGE, /retired/)
})

test('every old link still forwards with its query and hash', () => {
  for (const k of OLD_LINK_KEYS) assert.deepEqual(run(`?${k}=abc`, '#x'), [`/equipment/?${k}=abc#x`], k)
  assert.deepEqual(run('?newLoan=1&ref=r1&loanTo=A'), ['/equipment/?newLoan=1&ref=r1&loanTo=A'])
})

test('the old link names are the ones linkTarget reads', () => {
  const src = linkTarget.toString()
  for (const k of OLD_LINK_KEYS) assert.ok(src.includes(`'${k}'`), `${k} is read by linkTarget`)
  for (const k of ['newLoan', 'reassign', 'open', 'return', 'extend']) assert.ok(OLD_LINK_KEYS.includes(k), `${k} is listed`)
})
