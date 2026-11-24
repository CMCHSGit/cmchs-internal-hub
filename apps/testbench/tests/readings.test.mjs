// npm test --prefix apps/testbench — a unit's Device ID and MACs read on a phone and sent to the PC (src/newequip/readings.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { cleanReading, lanOf, phoneLink, readingId, readingsBySerial, targetFromSearch } from '../src/newequip/readings.js'
import { tidyDeviceId } from '../src/macRead.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const customer = { id: 'c9', name: 'Waitematā DHB' }
const unit = { serial: 'EX3-000519', asset: 'CHS-9', model: 'BeneHeart R700', ward: 'ICU' }

test('a reading is cleaned into the asset lists’ shapes: Device ID with dashes, MACs with colons', () => {
  const { reading, errors } = cleanReading({ deviceId: '00-0f-14-04-cc-54-95-d4', lanMac: '000f.1454.95d4', wlanMac: ' 08:9b:27:69:71:ba ', other0: 'x' })
  assert.deepEqual(errors, [])
  assert.deepEqual(reading, { deviceId: '00-0F-14-04-CC-54-95-D4', lanMac: '00:0F:14:54:95:D4', wlanMac: '08:9B:27:69:71:BA' })
})

test('one value is enough; a half-typed address is refused with a plain message; nothing at all is refused', () => {
  assert.deepEqual(cleanReading({ deviceId: '00-0F-14-04-CC-54-95-D4' }).reading, { deviceId: '00-0F-14-04-CC-54-95-D4' })
  const bad = cleanReading({ deviceId: '00-0F-14-04-CC-54-95', lanMac: '00:0F:14:54:95:D4' })
  assert.match(bad.errors[0], /Device ID isn’t a full address/)
  assert.match(cleanReading({}).errors[0], /nothing to send/)
  assert.match(cleanReading({ lanMac: 'see photo' }).errors[0], /LAN MAC isn’t a full address/)
})

test('a Device ID is eight bytes, a MAC six: one is never taken for the other', () => {
  assert.equal(tidyDeviceId('00:0F:14:54:95:D4'), '')
  assert.equal(tidyDeviceId('000f1404cc5495d4'), '00-0F-14-04-CC-54-95-D4')
  assert.match(cleanReading({ lanMac: '00-0F-14-04-CC-54-95-D4' }).errors[0], /LAN MAC/)
})

test('the LAN MAC shown is the one read, else the one the Device ID gives (the asset lists’ rule)', () => {
  assert.equal(lanOf({ deviceId: '00-0F-14-04-CC-54-95-D4' }), '00:0F:14:54:95:D4')
  assert.equal(lanOf({ deviceId: '00-0F-14-04-CC-54-95-D4', lanMac: '00:0F:14:AA:BB:CC' }), '00:0F:14:AA:BB:CC')
  assert.equal(lanOf({ wlanMac: '08:9B:27:69:71:BA' }), '')
  assert.equal(lanOf(null), '')
})

test('one reading per unit: the same customer and serial give the same id, whatever the case, and an id holds no slash or space', () => {
  assert.equal(readingId('c9', 'ex3-000519'), readingId('c9', ' EX3-000519 '))
  assert.notEqual(readingId('c9', 'A'), readingId('c8', 'A'))
  assert.ok(!/[\/\s#?\[\]]/.test(readingId('c9', 'A/B 1#2')))
})

test('the phone link says which unit it is for, and reads back the same', () => {
  const link = phoneLink(customer, unit, 'https://internal.chsnz.co.nz')
  assert.ok(link.startsWith('https://internal.chsnz.co.nz/testbench/?tab=mac&'))
  const t = targetFromSearch(link.slice(link.indexOf('?')))
  assert.deepEqual(t, { customerId: 'c9', customerName: 'Waitematā DHB', serial: 'EX3-000519', asset: 'CHS-9', model: 'BeneHeart R700' })
  assert.equal(targetFromSearch('?tab=mac'), null, 'a MAC reader with no unit is just the reader')
  assert.equal(targetFromSearch('?tab=mac&cust=c9'), null, 'a customer alone is not a unit')
  assert.equal(targetFromSearch('?cust=c9&serial=S1'), null, 'only the MAC reader tab')
  assert.equal(targetFromSearch(''), null)
})

test('a unit with only a description (no model) still names itself on the phone', () => {
  assert.equal(targetFromSearch(phoneLink(customer, { serial: 'S1', description: 'Monitor' }).split('?')[1] && '?' + phoneLink(customer, { serial: 'S1', description: 'Monitor' }).split('?')[1]).model, 'Monitor')
})

test('watched readings are found by serial, ignoring case and spaces', () => {
  const m = readingsBySerial([{ serial: 'ex3-000519 ', deviceId: '00-0F-14-04-CC-54-95-D4' }, { serial: 'B2', lanMac: '00:0F:14:54:95:D4' }])
  assert.equal(m.get('EX3-000519').deviceId, '00-0F-14-04-CC-54-95-D4')
  assert.ok(m.has('B2') && !m.has('b2'))
})

test('the phone link and the reading rows are wired in: a unit’s row, a pending row, the tab, and the send', () => {
  assert.ok(read('../src/newequip/AssetList.jsx').includes('<ReadingCell reading={reading} customer={customer} u={u} />'))
  assert.ok(read('../src/newequip/AssetList.jsx').includes('watchReadings(customer.id'))
  assert.ok(read('../src/newequip/Pending.jsx').includes('<ReadingCell reading={readings?.get('))
  const section = read('../src/section.jsx')
  assert.ok(section.includes('targetFromSearch(location.search)') && section.includes('<MacReader target={macTarget} onSend='))
  assert.ok(read('../src/newequip/readings-firebase.js').includes("'deviceReadings'"))
  // the document the page writes is exactly what the rules allow
  const rules = read('../../../rules/firestore.rules')
  for (const k of ['customerId', 'serial', 'deviceId', 'lanMac', 'wlanMac', 'by', 'at']) assert.ok(rules.includes(`'${k}'`), `${k} is in the deviceReadings rule`)
  const fb = read('../src/newequip/readings-firebase.js')
  assert.ok(/customerId: String\(customerId\), serial: String\(serial\)\.trim\(\), \.\.\.reading, by, at: serverTimestamp\(\)/.test(fb))
})
