// node --test apps/asks/tests — an ask can attach a checklist (apps/checklists).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanAsk } from '../src/model.js'

test('cleanAsk keeps an attached checklist as its id and name, and nothing else', () => {
  const f = cleanAsk({ title: 'x', assignees: ['u-mike'], checklist: { id: 'abc123', name: ' N1 upgrade ', extra: 1 } })
  assert.deepEqual(f.checklist, { id: 'abc123', name: 'N1 upgrade' })
})

test('an ask with no checklist gets no checklist field, so it needs nothing new of the rules', () => {
  assert.equal('checklist' in cleanAsk({ title: 'x', assignees: ['u-mike'] }), false)
  assert.equal('checklist' in cleanAsk({ title: 'x', assignees: ['u-mike'], checklist: null }), false)
  assert.equal('checklist' in cleanAsk({ title: 'x', assignees: ['u-mike'], checklist: { id: '', name: 'n' } }), false)
})

test('a long checklist name is cut to what the rules allow', () => {
  const f = cleanAsk({ title: 'x', assignees: ['u-mike'], checklist: { id: 'a'.repeat(80), name: 'n'.repeat(300) } })
  assert.equal(f.checklist.id.length, 40)
  assert.equal(f.checklist.name.length, 120)
})
