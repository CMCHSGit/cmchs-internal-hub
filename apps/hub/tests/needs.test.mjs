import { test } from 'node:test'
import assert from 'node:assert/strict'
import { needsYou } from '../src/needs.js'

test('needs you: nothing waiting gives no items, so the strip hides', () => {
  assert.deepEqual(needsYou({}), [])
  assert.deepEqual(needsYou({ badges: { equipment: 0 }, asks: { mine: [], overdue: 0, toPick: 0 } }), [])
})

test('needs you: demo loans from the tab badge, asks from the asks summary', () => {
  const items = needsYou({ badges: { equipment: 3 }, asks: { mine: [{}, {}], overdue: 0, toPick: 2 } })
  assert.deepEqual(items.map(i => i.id), ['equipment', 'asks'])
  assert.equal(items[0].text, '3 demo loans need you')
  assert.equal(items[0].link, '/equipment/#/overview')
  assert.equal(items[1].text, '2 asks waiting for you')
  assert.equal(items[1].hint, '2 to pick up')
})

test('needs you: singular wording, overdue asks first, other sections still show', () => {
  const items = needsYou({ badges: { equipment: 1, projects: 2 }, asks: { mine: [{}], overdue: 1, toPick: 0 } })
  assert.deepEqual(items.map(i => i.id), ['asks', 'equipment', 'projects'])
  assert.equal(items[0].text, '1 ask waiting for you')
  assert.equal(items[1].text, '1 demo loan needs you')
  assert.equal(items[2].link, '/projects/')
})
