// npm test -w apps/projects — the Customers tab's folders (src/customers.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FOLDER_COLOURS, DEFAULT_SUBS, normaliseCustomer, customersOf, newCustomer, newSub, copyCustomer, customerProblems, tidyCustomer,
  withCustomer, visibleCustomers, moved, customerFor,
} from '../src/customers.js'
import { withDefaults } from '../src/model.js'

const folder = (name, extra = {}) => ({ ...newCustomer([]), name, ...extra })

test('a new folder starts with the usual sub folders and no links', () => {
  const c = newCustomer()
  assert.deepEqual(c.subs.map((s) => s.name), DEFAULT_SUBS)
  assert.ok(c.subs.every((s) => s.link === '' && s.id))
  assert.equal(c.subs[0].icon, 'sheet') // "Equipment list" wears the spreadsheet icon until changed
  assert.deepEqual(newCustomer(['A', 'B']).subs.map((s) => s.name), ['A', 'B'])
  assert.equal(new Set(newCustomer().subs.map((s) => s.id)).size, DEFAULT_SUBS.length)
})

test('stored folders are read forgivingly: odd values fall back, nothing throws', () => {
  const c = normaliseCustomer({ name: '  Waikato   Hospital ', colour: 'pink', icon: 'nope', subs: [{ name: 'Reports', icon: 'zzz' }, null], pinned: 1 })
  assert.equal(c.name, 'Waikato Hospital')
  assert.equal(c.colour, FOLDER_COLOURS[0])
  assert.equal(c.icon, 'folder')
  assert.equal(c.pinned, true)
  assert.equal(c.subs.length, 2)
  assert.equal(c.subs[0].icon, 'link')
  assert.deepEqual(customersOf({}), [])
  assert.deepEqual(customersOf({ customers: 'oops' }), [])
  assert.equal(customersOf(withDefaults(null)).length, 0)
  assert.deepEqual(withDefaults({ customerDefaults: 'oops' }).customerDefaults, ['Equipment list', 'Projects folder', 'Test reports'])
})

test('a folder needs a new name and its sub folders need names and web links', () => {
  const others = [folder('Waikato Hospital', { id: 'a' })]
  assert.deepEqual(customerProblems({ ...folder('Hutt'), subs: [] }, others), [])
  assert.match(customerProblems(folder('  '), others)[0], /name/)
  assert.match(customerProblems(folder('waikato HOSPITAL'), others)[0], /already a folder/)
  assert.deepEqual(customerProblems({ ...others[0], subs: [] }, others), []) // editing itself is fine
  const bad = { ...folder('X'), subs: [newSub('Reports'), { ...newSub(''), link: '' }, { ...newSub('Quotes'), link: 'javascript:alert(1)' }, { ...newSub('Plan'), link: 'cass.sharepoint.com/x' }] }
  const p = customerProblems(bad, [])
  assert.equal(p.length, 2)
  assert.match(p[0], /Sub folder 2 needs a name/)
  assert.match(p[1], /Quotes.*web address/)
})

test('saving adds https:// where it was left off and keeps everything else', () => {
  const c = tidyCustomer({ ...folder('X'), subs: [{ ...newSub('A'), link: ' cass.sharepoint.com/sites/x ' }, { ...newSub('B'), link: '' }] })
  assert.equal(c.subs[0].link, 'https://cass.sharepoint.com/sites/x')
  assert.equal(c.subs[1].link, '')
})

test('editing one folder leaves the others, and delete takes only that one', () => {
  const a = folder('A', { id: 'a' }), b = folder('B', { id: 'b' })
  const list = [a, b]
  assert.deepEqual(withCustomer(list, 'a', { ...a, name: 'A2' }).map((x) => x.name).sort(), ['A2', 'B'])
  assert.deepEqual(withCustomer(list, 'a', null).map((x) => x.id), ['b'])
  assert.equal(withCustomer(list, 'new', folder('C', { id: 'new' })).length, 3)
})

test('a copy keeps the structure but none of the links, and is not pinned', () => {
  const c = normaliseCustomer({ ...folder('A'), id: 'a', pinned: true, subs: [{ name: 'Reports', link: 'https://x.example/r', note: 'n' }] })
  const k = copyCustomer(c, 'A (copy)')
  assert.notEqual(k.id, c.id)
  assert.equal(k.name, 'A (copy)')
  assert.equal(k.pinned, false)
  assert.equal(k.subs[0].name, 'Reports')
  assert.equal(k.subs[0].link, '')
  assert.notEqual(k.subs[0].id, c.subs[0].id)
})

test('the list is pinned first then A to Z, and search looks at names, notes and sub folder names', () => {
  const list = [folder('Waikato', { id: '1' }), folder('auckland', { id: '2', note: 'north shore' }), folder('Zeta', { id: '3', pinned: true }), { ...folder('Hutt', { id: '4' }), subs: [newSub('Test reports')] }]
  assert.deepEqual(visibleCustomers(list).map((c) => c.name), ['Zeta', 'auckland', 'Hutt', 'Waikato'])
  assert.deepEqual(visibleCustomers(list, 'shore').map((c) => c.name), ['auckland'])
  assert.deepEqual(visibleCustomers(list, 'test REPORTS').map((c) => c.name), ['Hutt'])
  assert.deepEqual(visibleCustomers(list, 'hutt waikato').map((c) => c.name), [])
})

test('moving a sub folder up or down, and not past the ends', () => {
  assert.deepEqual(moved(['a', 'b', 'c'], 1, -1), ['b', 'a', 'c'])
  assert.deepEqual(moved(['a', 'b', 'c'], 1, 1), ['a', 'c', 'b'])
  const l = ['a', 'b']
  assert.equal(moved(l, 0, -1), l)
  assert.equal(moved(l, 1, 1), l)
})

test('a job finds its customer folder by name, ignoring case', () => {
  const list = [folder('Waikato Hospital', { id: 'w' })]
  assert.equal(customerFor(list, ' waikato hospital ')?.id, 'w')
  assert.equal(customerFor(list, 'Hutt'), null)
  assert.equal(customerFor(list, ''), null)
})
