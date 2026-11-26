// npm test -w apps/equipment — reading a device's network screen (src/macRead.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { lanFromDeviceId, readRows, readScreenText, rowsAsValues, tidyMac } from '../src/macRead.js'

// What the text recognition really gave for a photo of a Mindray Maintenance > Device Location screen
// (patient fields blank): noise around the lines that matter.
const PHOTO = `EA A BE
Be PA li Thar he HA TM a
R7 | Hie a \\ il | aintenance
| | Device Location | Waveform Setup 0 RG
DeviceID ~~ 00-0F-14-04-CC-54-95-D4 LL nn il
Device Name | | i EL
Facility | | | La CL
Department | | TE
| WLAN MAC  08:9B:27:69:71:BA Le E . . a
| LANMAC  00:0F:14:54:95:D4 LL ili i
] Li . Ag`

test('the Device ID, WLAN MAC and LAN MAC are found in a real photo\'s text', () => {
  const r = readScreenText(PHOTO)
  assert.deepEqual(r.deviceId, { value: '00-0F-14-04-CC-54-95-D4', fixed: false })
  assert.deepEqual(r.wlanMac, { value: '08:9B:27:69:71:BA', fixed: false })
  assert.deepEqual(r.lanMac, { value: '00:0F:14:54:95:D4', fixed: false })
  assert.deepEqual(r.others, [])
  assert.equal(r.lanMatchesDeviceId, true)
})

test('rows come in screen order and paste as the values only, one to a line, with no labels', () => {
  const rows = readRows(readScreenText(PHOTO))
  assert.deepEqual(rows.map((x) => x.label), ['Device ID', 'WLAN MAC', 'LAN MAC'])
  assert.equal(rowsAsValues(rows), '00:0F:14:54:95:D4\t08:9B:27:69:71:BA\t00-0F-14-04-CC-54-95-D4', 'LAN MAC, WLAN MAC, Device ID, tab-separated for Excel')
  // the screen with no WLAN MAC: an empty cell, so Device ID still lands in its own column
  assert.equal(rowsAsValues(readRows(readScreenText('Device ID 00-0F-14-04-CC-54-95-D4\nLAN MAC 00:0F:14:54:95:D4'))), '00:0F:14:54:95:D4\t\t00-0F-14-04-CC-54-95-D4')
  // an unlabelled MAC goes after the three
  assert.equal(rowsAsValues(readRows(readScreenText('08:9B:27:69:71:BA'))), '\t\t\t08:9B:27:69:71:BA')
})

test('look-alikes and separators are put right, and the value is marked to check', () => {
  const r = readScreenText('WLAN MAC 08:9B:27:69:7l:BA\nLAN MAC OO:0F:14:54:95;D4')
  assert.deepEqual(r.wlanMac, { value: '08:9B:27:69:71:BA', fixed: true })
  assert.deepEqual(r.lanMac, { value: '00:0F:14:54:95:D4', fixed: true })
})

test('lower case, dashes in a MAC and a Device ID without its label', () => {
  const r = readScreenText('00-0f-14-04-cc-54-95-d4\nLAN MAC 00-0f-14-54-95-d4')
  assert.equal(r.deviceId.value, '00-0F-14-04-CC-54-95-D4')
  assert.equal(r.lanMac.value, '00:0F:14:54:95:D4')
})

test('digits run together count only beside a label', () => {
  const r = readScreenText('Wireless MAC 089B27697 1BA\nLAN MAC 000F145495D4\nSerial 123456789ABC')
  assert.equal(r.lanMac.value, '00:0F:14:54:95:D4')
  assert.equal(r.wlanMac, null) // a space inside: not read
  assert.deepEqual(r.others, [])
})

test('an address with no label is kept as "other", and the same one twice only once', () => {
  const r = readScreenText('08:9B:27:69:71:BA\n08:9B:27:69:71:BA\n00:0F:14:54:95:D4')
  assert.deepEqual(r.others.map((o) => o.value), ['08:9B:27:69:71:BA', '00:0F:14:54:95:D4'])
  assert.deepEqual(readRows(r).map((x) => x.label), ['MAC 1', 'MAC 2'])
})

test('a LAN MAC that does not follow the Device ID is flagged, not changed', () => {
  const r = readScreenText('Device ID 00-0F-14-04-CC-54-95-D4\nLAN MAC 00:0F:14:54:95:D8')
  assert.equal(r.lanMac.value, '00:0F:14:54:95:D8')
  assert.equal(r.lanMatchesDeviceId, false)
  assert.equal(readScreenText('LAN MAC 00:0F:14:54:95:D8').lanMatchesDeviceId, null)
})

test('text with nothing in it finds nothing', () => {
  const r = readScreenText('Maintenance\nDevice Name\nFacility 12:30')
  assert.equal(r.deviceId, null)
  assert.equal(readRows(r).length, 0)
  assert.equal(readRows(readScreenText('')).length, 0)
  assert.equal(readRows(readScreenText(undefined)).length, 0)
})

test('the LAN MAC is the Device ID without its 4th and 5th bytes', () => {
  assert.equal(lanFromDeviceId('00-0F-14-04-CC-54-95-D4'), '00:0F:14:54:95:D4')
  assert.equal(lanFromDeviceId('00-0F-14-04-9B-3A-D1-9D'), '00:0F:14:3A:D1:9D')
  assert.equal(lanFromDeviceId('00:0F:14:54:95:D4'), '')
  assert.equal(lanFromDeviceId(''), '')
})

test('tidyMac makes typed and pasted addresses one shape', () => {
  assert.equal(tidyMac('000f.1454.95d4'), '00:0F:14:54:95:D4')
  assert.equal(tidyMac(' 00-0f-14-54-95-d4 '), '00:0F:14:54:95:D4')
  assert.equal(tidyMac('00:0F:14:54:95'), '')
  assert.equal(tidyMac(null), '')
})

test('the Test Bench has a MAC reader tab (?tab=mac), and the Demo tracker no longer has one', async () => {
  const { readFileSync } = await import('node:fs')
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const section = read('../src/section.jsx')
  assert.ok(section.includes("import MacReader from './MacReader.jsx'") && section.includes("t === 'customers' || t === 'mac'") && section.includes("tab === 'mac' && ("))
  assert.ok(!read('../../equipment/src/Scan.jsx').includes('Read a screen'), 'it is in the Test Bench, not the Demo tracker')
  // nothing is sent anywhere: the reader's files come from this site, never a CDN
  assert.ok(!/https?:\/\//.test(read('../../../shared/ocr.js').replace(/\/\*[\s\S]*?\*\//g, '')), 'shared/ocr.js names no outside address')
})
