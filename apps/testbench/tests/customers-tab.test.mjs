// npm test --prefix apps/testbench — the Customers tab of the Test Bench (src/newequip/Customers.jsx): the old New equipment page's customer
// picker, recorded assets and asset list moved in. A "Test this device" link there opens the bench rather than reloading the page.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { testLink } from '../src/newequip/pending.js'
import { deviceOf } from '../src/newequip/open-device.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('a test link becomes the device the bench is handed', () => {
  const href = testLink({ model: 'BeneHeart R700', serial: 'TP1-69007908', manufacturer: 'Mindray', site: '2837', asset: 'CHS-9', ward: 'ICU' }, 'Southern Cross')
  assert.deepEqual(deviceOf(href), { model: 'BeneHeart R700', serial: 'TP1-69007908', manufacturer: 'Mindray', customer: 'Southern Cross', site: '2837', asset: 'CHS-9', ward: 'ICU' })
  assert.equal(deviceOf('/testbench/'), null, 'a link with no device in it')
  assert.equal(deviceOf(''), null)
})

test('the Test Bench has a Customers tab, which the old New equipment address opens', () => {
  const section = read('../src/section.jsx')
  assert.ok(section.includes("import Customers from './newequip/Customers.jsx'"))
  assert.ok(section.includes("get('tab') === 'customers' ? 'customers'") && section.includes("tab === 'customers' && ("))
  assert.ok(section.includes('chs-bench:open-device') && section.includes('onOpenDevice='), 'a test link opens the bench in this page, so a test in progress is kept')
  const old = read('../src/newequip/section.jsx')
  assert.ok(old.includes("'/testbench/?tab=customers'") && old.includes('location.replace(CUSTOMERS_URL)'), '/new-equipment/ now only sends people there')
  assert.ok(!read('../bench/index.html').includes('/new-equipment/'), 'the bench points at the Customers tab, not the old page')
})

test('every link that starts a test goes through the bench opener', () => {
  for (const f of ['../src/newequip/AssetList.jsx', '../src/newequip/Pending.jsx']) {
    const src = read(f)
    assert.ok(src.includes('useTestLink'), f)
    assert.ok(!/location\.href\s*=\s*testLink/.test(src), `${f} must not follow a test link by reloading the page`)
  }
})
