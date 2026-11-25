// npm test --prefix apps/testbench — the MAC reader's "from your phone" inbox (src/macInbox.js, MacInbox.jsx, macInbox-firebase.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { cleanReading, inboxRows, lanOf, readerLink } from '../src/macInbox.js'
import { rowsAsValues, tidyDeviceId } from '../src/macRead.js'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')

test('a reading is cleaned into the asset lists’ shapes: Device ID with dashes, MACs with colons', () => {
  const { reading, errors } = cleanReading({ deviceId: '00-0f-14-04-cc-54-95-d4', lanMac: '000f.1454.95d4', wlanMac: ' 08:9b:27:69:71:ba ', other0: 'x' })
  assert.deepEqual(errors, [])
  assert.deepEqual(reading, { deviceId: '00-0F-14-04-CC-54-95-D4', lanMac: '00:0F:14:54:95:D4', wlanMac: '08:9B:27:69:71:BA' })
})

test('one value is enough; a half-typed address is refused with a plain message; nothing at all is refused', () => {
  assert.deepEqual(cleanReading({ deviceId: '00-0F-14-04-CC-54-95-D4' }).reading, { deviceId: '00-0F-14-04-CC-54-95-D4' })
  assert.match(cleanReading({ deviceId: '00-0F-14-04-CC-54-95', lanMac: '00:0F:14:54:95:D4' }).errors[0], /Device ID isn’t a full address/)
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

test('the inbox shows Device ID, WLAN MAC, LAN MAC in screen order, and says when the LAN MAC came from the Device ID', () => {
  const rows = inboxRows({ deviceId: '00-0F-14-04-CC-54-95-D4', wlanMac: '08:9B:27:69:71:BA', lanMac: '' })
  assert.deepEqual(rows.map((r) => [r.label, r.value, !!r.derived]), [['Device ID', '00-0F-14-04-CC-54-95-D4', false], ['WLAN MAC', '08:9B:27:69:71:BA', false], ['LAN MAC', '00:0F:14:54:95:D4', true]])
  assert.equal(rowsAsValues(rows), '00:0F:14:54:95:D4\t08:9B:27:69:71:BA\t00-0F-14-04-CC-54-95-D4', 'Copy all: the values only, no labels, tab-separated for Excel: LAN MAC, WLAN MAC, Device ID')
  // no WLAN MAC: its cell is empty, so Device ID still lands in the third column
  assert.equal(rowsAsValues(inboxRows({ deviceId: '00-0F-14-04-CC-54-95-D4', lanMac: '00:0F:14:54:95:D4' })), '00:0F:14:54:95:D4\t\t00-0F-14-04-CC-54-95-D4')
  assert.equal(rowsAsValues(inboxRows({ deviceId: '00-0F-14-04-CC-54-95-D4' })), '00:0F:14:54:95:D4\t\t00-0F-14-04-CC-54-95-D4', 'the LAN MAC from the Device ID is copied too')
  assert.equal(rowsAsValues(inboxRows({ wlanMac: '08:9B:27:69:71:BA' })), '\t08:9B:27:69:71:BA\t')
  assert.ok(!/[A-Za-z ]{5,}:/.test(rowsAsValues(rows)), 'no labels')
  assert.equal(inboxRows({ lanMac: '00:0F:14:54:95:D4' })[0].derived, false)
  assert.deepEqual(inboxRows(null), [])
  assert.deepEqual(inboxRows({ deviceId: '', lanMac: '', wlanMac: '' }), [])
})

test('the phone opens the MAC reader tab', () => {
  assert.equal(readerLink('https://internal.chsnz.co.nz'), 'https://internal.chsnz.co.nz/testbench/?tab=mac')
  assert.equal(new URLSearchParams(readerLink().split('?')[1]).get('tab'), 'mac')
})

test('it is wired: every read is sent by itself, the panel shows the person’s own inbox, and the tab has both', () => {
  const reader = read('../src/MacReader.jsx')
  assert.ok(reader.includes('push(found)'), 'a read goes to the PC at once')
  assert.ok(reader.includes('setTimeout(() => push(rows), 900)'), 'a corrected field goes again')
  const section = read('../src/section.jsx')
  assert.ok(section.includes('<MacInbox user={user} />') && section.includes('<MacReader onSend={user ? sendReading : null} />'))
  const panel = read('../src/MacInbox.jsx')
  assert.ok(panel.includes('watchInbox(uid') && panel.includes('clearInbox(uid)'))
})

test('what the page writes is exactly what the rules allow, and the document is the person’s own', () => {
  const fb = read('../src/macInbox-firebase.js')
  assert.ok(fb.includes("doc(firestore(), 'macInbox', String(uid))"), 'one document per person, their user id')
  assert.ok(fb.includes('setDoc(slot(user.uid), { ...reading, by: (user.email || \'\').toLowerCase(), at: serverTimestamp() })'))
  const rules = read('../../../rules/firestore.rules')
  const block = rules.slice(rules.indexOf('match /macInbox/{uid}'), rules.indexOf('function isMacInbox()') + 900)
  for (const k of ['deviceId', 'lanMac', 'wlanMac', 'by', 'at']) assert.ok(block.includes(`'${k}'`), `${k} is in the macInbox rule`)
  assert.ok(block.includes('request.auth.uid == uid'), 'only the person')
  assert.ok(!rules.includes('deviceReadings'), 'the per-unit readings are gone')
})

test('a read is never kept anywhere but the person’s own inbox: no customer, serial or unit in it', () => {
  const fb = read('../src/macInbox-firebase.js')
  assert.ok(!/customer|serial/i.test(fb.replace(/\/\*[\s\S]*?\*\//g, '')))
})
