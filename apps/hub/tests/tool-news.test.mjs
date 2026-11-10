// npm test -w apps/hub — new tools to announce (tool-news.js): which tools are
// offered, and the draft each one starts from.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { KNOWN_TOOLS, toolDraft, toolsToAnnounce } from '../src/tool-news.js'

const quote = { id: 'quote', name: 'Quote builder', description: 'Build and send quotes from Simpro jobs.', link: '/quote/', category: 'Sales', opens: 'here' }

// Not "every tool in tools.json is known": the PR that adds a tool would then
// fail, and a new tool is meant to be offered.
test('the tools that were here before are never offered', () => {
  const ids = JSON.parse(readFileSync(new URL('../../../tools.json', import.meta.url), 'utf8')).map(t => t.id)
  const old = ids.filter(id => KNOWN_TOOLS.includes(id))
  assert.ok(old.length >= 15)
  assert.deepEqual(toolsToAnnounce(old.map(id => ({ id }))), [])
})

test('a new tool is offered until a post names it or someone puts it away', () => {
  const tools = [{ id: 'schedule', name: 'Staff schedule' }, quote]
  assert.deepEqual(toolsToAnnounce(tools).map(t => t.id), ['quote'])
  assert.deepEqual(toolsToAnnounce(tools, [{ id: 'p1', title: 'New tool', toolId: 'quote' }]), [])
  assert.deepEqual(toolsToAnnounce(tools, [], ['quote']), [])
  // Another post that only mentions it doesn't count
  assert.equal(toolsToAnnounce(tools, [{ id: 'p2', title: 'Quote builder is here' }]).length, 1)
})

test('the draft: Tool updates, the name, what it does and where to find it', () => {
  const d = toolDraft(quote, { today: '2026-11-11' })
  assert.equal(d.category, 'Tool updates')
  assert.equal(d.title, 'New tool: Quote builder')
  assert.equal(d.toolId, 'quote')
  assert.equal(d.date, '2026-11-11')
  assert.equal(d.body, 'Build and send quotes from Simpro jobs.\n\nOpen it from the Sales section on the hub’s home page, or go to https://internal.chsnz.co.nz/quote/.')
})

test('a service tool points at the Service menu; another site keeps its own address', () => {
  assert.match(toolDraft(quote, { service: true }).body, /from the Service menu in the hub’s header, or go to https:\/\/internal\.chsnz\.co\.nz\/quote\/\.$/)
  const ext = toolDraft({ id: 'xero', name: 'Xero', description: 'Invoices', link: 'https://go.xero.com/', category: 'Admin' })
  assert.match(ext.body, /^Invoices\.\n\n.*or go to https:\/\/go\.xero\.com\/\.$/)
})
