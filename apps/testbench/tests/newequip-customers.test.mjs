// npm test --prefix apps/testbench — the new-equipment page's customers (src/newequip/customers.js). Invented names and links only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ASSET_LIST, REPORTS, subOf, assetListHref, reportsHref, withLinks, draftFrom, formOf, customerProblems, searchCustomers } from '../src/newequip/customers.js'

const LIST = 'https://example.sharepoint.com/:x:/s/example/EaAssetList'
const FOLDER = 'https://example.sharepoint.com/:f:/s/example/Reports'
const cust = (subs) => ({ id: 'c1', name: 'Example Hospital', subs })

test('the asset list and the reports folder are the sub folders called Equipment list and Test reports, whatever the case', () => {
  const c = cust([{ id: 'a', name: 'equipment LIST', link: LIST }, { id: 'b', name: 'Test reports', link: FOLDER }, { id: 'c', name: 'Quotes', link: 'https://example.com/q' }])
  assert.equal(subOf(c, ASSET_LIST).id, 'a')
  assert.equal(assetListHref(c), LIST)
  assert.equal(reportsHref(c), FOLDER)
})

test('a missing sub folder, a blank link or something that is not a web address gives no link', () => {
  assert.equal(assetListHref(cust([])), '')
  assert.equal(assetListHref(cust([{ id: 'a', name: 'Equipment list', link: '' }])), '')
  assert.equal(reportsHref(cust([{ id: 'b', name: 'Test reports', link: 'javascript:alert(1)' }])), '')
  assert.equal(reportsHref(null), '')
})

test('setting links changes those two sub folders and nothing else, adding one that is missing', () => {
  const c = cust([{ id: 'q', name: 'Quotes', link: 'https://example.com/q' }, { id: 'a', name: 'Equipment list', link: 'https://old.example.com' }])
  const d = withLinks(c, { assetList: LIST, reports: FOLDER })
  assert.equal(d.subs.length, 3)
  assert.equal(d.subs.find((s) => s.id === 'q').link, 'https://example.com/q')
  assert.equal(d.subs.find((s) => s.id === 'a').link, LIST)
  assert.equal(reportsHref(d), FOLDER)
  assert.equal(c.subs.length, 2, 'the original is not changed')
  // a blank link adds nothing when there is no sub folder, and clears one that is there
  assert.equal(withLinks(cust([]), { assetList: '', reports: '' }).subs.length, 0)
  assert.equal(assetListHref(withLinks(d, { assetList: '', reports: FOLDER })), '')
})

test('a new customer starts with the usual sub folders and the two links', () => {
  const d = draftFrom(null, { name: '  Kauri Hospital ', assetList: LIST, reports: FOLDER })
  assert.equal(d.name, 'Kauri Hospital')
  assert.equal(assetListHref(d), LIST)
  assert.equal(reportsHref(d), FOLDER)
  assert.ok(d.subs.some((s) => s.name === 'Projects folder'), "the tracker's usual sub folders come too")
  assert.deepEqual(customerProblems(d, []), [])
  assert.deepEqual(formOf(d), { name: 'Kauri Hospital', assetList: LIST, reports: FOLDER })
})

test('searching customers: every word must be in the name, any order and case; blank gives all, by name', () => {
  const list = [{ name: 'Waikato Hospital' }, { name: 'Hutt Valley Hospital' }, { name: 'Kauri Aged Care' }]
  assert.deepEqual(searchCustomers(list, '').map((c) => c.name), ['Hutt Valley Hospital', 'Kauri Aged Care', 'Waikato Hospital'])
  assert.deepEqual(searchCustomers(list, 'hospital').map((c) => c.name), ['Hutt Valley Hospital', 'Waikato Hospital'])
  assert.deepEqual(searchCustomers(list, 'HOSP valley').map((c) => c.name), ['Hutt Valley Hospital'])
  assert.deepEqual(searchCustomers(list, 'zzz'), [])
})

test('the form says what is wrong: no name, a name already used, a link that is not a web address', () => {
  assert.match(customerProblems(draftFrom(null, { name: '', assetList: '', reports: '' }), [])[0], /name/i)
  const other = cust([])
  assert.match(customerProblems(draftFrom(null, { name: 'example hospital', assetList: '', reports: '' }), [other])[0], /already/)
  assert.match(customerProblems(draftFrom(null, { name: 'New', assetList: 'not a link', reports: '' }), []).join(' '), /https/)
  // the same customer edited keeps its own name without clashing with itself
  assert.deepEqual(customerProblems(draftFrom(other, { name: 'Example Hospital', assetList: LIST, reports: '' }), [other]), [])
})
