// npm test --prefix apps/testbench — the customer registry's rules (src/registry.js). Invented names and links only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanLink, linkKind, parseSites, cleanEntry, missingOf, sortCustomers, customerOfSite, MAX_LINK } from '../src/registry.js'

const LINK = 'https://example.sharepoint.com/:x:/s/example/EaAssetList'

test('a link is blank, or https with no spaces', () => {
  assert.deepEqual(cleanLink('  '), { value: '', error: '' })
  assert.equal(cleanLink(` ${LINK} `).value, LINK)
  assert.equal(cleanLink(LINK).error, '')
  assert.match(cleanLink('http://example.com/x').error, /https/)
  assert.match(cleanLink('javascript:alert(1)').error, /https/)
  assert.match(cleanLink('ftp://example.com').error, /https/)
  assert.match(cleanLink('https://example.com/a b').error, /space/)
  assert.match(cleanLink('https://example.com/' + 'x'.repeat(MAX_LINK)).error, /too long/)
  assert.match(cleanLink('nope', 'reports folder link').error, /reports folder link/)
})

test('OneDrive and SharePoint addresses are recognised, others only noted', () => {
  assert.equal(linkKind(LINK), 'online')
  assert.equal(linkKind('https://1drv.ms/x/s!abc'), 'online')
  assert.equal(linkKind('https://onedrive.live.com/edit?id=1'), 'online')
  assert.equal(linkKind('https://example.com/list.xlsx'), 'other')
  assert.equal(linkKind(''), '')
  assert.equal(linkKind('not a link'), '')
})

test('site IDs: numbers split on commas, spaces and new lines, repeats dropped', () => {
  assert.deepEqual(parseSites('2350, 2351 2352\n2350'), { sites: ['2350', '2351', '2352'], bad: [] })
  assert.deepEqual(parseSites(''), { sites: [], bad: [] })
  assert.deepEqual(parseSites('2350, abc, 12x'), { sites: ['2350'], bad: ['abc', '12x'] })
})

test('a form becomes an entry, or says what is wrong', () => {
  const ok = cleanEntry({ name: '  Example   Hospital ', assetListUrl: LINK, reportsUrl: '', simproCustomerId: ' 1042 ', sites: '2350,2351' })
  assert.deepEqual(ok.errors, [])
  assert.deepEqual(ok.entry, { name: 'Example Hospital', assetListUrl: LINK, reportsUrl: '', simproCustomerId: '1042', siteIds: ['2350', '2351'] })

  const bad = cleanEntry({ name: ' ', assetListUrl: 'http://x', reportsUrl: 'https://a b', simproCustomerId: 'ABC', sites: '2350, x' })
  assert.equal(bad.errors.length, 5)
  assert.match(bad.errors[0], /name/)

  const many = cleanEntry({ name: 'X', sites: Array.from({ length: 31 }, (_, i) => String(1000 + i)).join(',') })
  assert.match(many.errors.join(' '), /At most 30/)
})

test('what an entry still lacks', () => {
  assert.deepEqual(missingOf({ assetListUrl: LINK, reportsUrl: LINK, simproCustomerId: '1', siteIds: [] }), [])
  assert.deepEqual(missingOf({ assetListUrl: '', reportsUrl: '', simproCustomerId: '', siteIds: [] }), ['asset list link', 'reports folder link', 'Simpro customer or sites'])
  assert.deepEqual(missingOf({ assetListUrl: LINK, reportsUrl: '', siteIds: ['2350'] }), ['reports folder link'])
})

test('customers sort by name and are found by Simpro site', () => {
  const list = [{ name: 'tui Centre', siteIds: ['2501'] }, { name: 'Kauri Hospital', siteIds: ['2412', '2413'] }, { name: 'Harbourview', siteIds: [] }]
  assert.deepEqual(sortCustomers(list).map((c) => c.name), ['Harbourview', 'Kauri Hospital', 'tui Centre'])
  assert.equal(customerOfSite(list, 2413).name, 'Kauri Hospital')
  assert.equal(customerOfSite(list, '9'), null)
})
