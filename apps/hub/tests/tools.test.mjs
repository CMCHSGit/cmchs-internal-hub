// The Service menu (header drop-down, the Service page, and the phone's More entry) is a hand-kept list of tool ids in tools.js, not
// "everything filed under Service" in tools.json: a Service tool left out of it is on the site but in no menu. This is that check.
// Run: npm test -w apps/hub
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const tools = JSON.parse(readFileSync(new URL('../../../tools.json', import.meta.url), 'utf8'))
const source = readFileSync(new URL('../src/tools.js', import.meta.url), 'utf8')
const ids = [...(/SERVICE_TOOL_IDS\s*=\s*\[([^\]]*)\]/.exec(source)?.[1] || '').matchAll(/'([^']+)'/g)].map((m) => m[1])

test('the service tool list can be read from tools.js', () => {
  assert.ok(ids.length >= 8, 'found ' + ids.length)
  assert.equal(new Set(ids).size, ids.length, 'an id is listed twice')
})

test('every id in the Service menu list is a tool in tools.json', () => {
  for (const id of ids) assert.ok(tools.some((t) => t.id === id), id + ' is not in tools.json')
})

// Filed under Service in tools.json, but deliberately not in the menu: the Project tracker has its own tab in the header.
const NOT_IN_THE_MENU = ['projects']

test('every visible Service tool in tools.json is in the Service menu list', () => {
  const left = tools.filter((t) => t.category === 'Service' && t.visible !== false && !ids.includes(t.id) && !NOT_IN_THE_MENU.includes(t.id)).map((t) => t.id)
  assert.deepEqual(left, [], 'on the site but in no menu: add to SERVICE_TOOL_IDS in apps/hub/src/tools.js')
})

test('Simpro Jobs is in the Service menu, after Simpro Deep Search', () => {
  assert.ok(ids.includes('simpro-jobs'))
  assert.equal(ids.indexOf('simpro-jobs'), ids.indexOf('simpro-search') + 1)
})
