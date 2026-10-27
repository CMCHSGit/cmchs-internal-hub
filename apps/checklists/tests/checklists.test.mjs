// node --test apps/checklists/tests — reading the device export, and what the list does with it.
// Devices below are made up; the layout (tab-padded values, status text, a newest-first location log) is the
// central station's real export.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  NO_DEPARTMENT, departmentOf, exportRows, EXPORT_HEADERS, filterItems, groupByDepartment, lastSeen, parseDevices, parseStatus,
  sharedSerials, sortItems, summarise, toCsv, fileSafe, niceStamp,
} from '../src/model.js'

const HEADER = ['Device ID', 'Device Category', 'Device Model', 'Device Serial Number', 'Device Code', 'Asset Number', 'Device Name', 'Device Status', 'Location',
  'Facility', 'Department', 'Room No', 'Bed No', 'Error Information', 'IP Address', 'Wireless MAC address', 'Wired MAC address', 'Central Station IP Address',
  'Battery Healthy', 'Battery Cycle Number', 'Battery Full Capacity', 'Version', 'Version Detail Info', 'Location Detail Info', 'Alarm Detail Info']
const T = (v) => '\t' + v // the export pads every value with a tab
const row = (o) => HEADER.map((h) => T(o[h] ?? ''))
const dev = (o) => row({ 'Device Category': 'Transport Monitor', 'Device Model': 'BeneVision N1', Facility: 'NSH', Version: '02.41.00.01 273831', ...o })

const rows = [
  HEADER,
  dev({ 'Device ID': '00-0F-14-04-9B-3A-D1-9D', 'Device Serial Number': 'AA3-41084001', 'Device Name': 'N1-WHA304525', 'Device Status': 'Working', Location: 'TAHI C1', 'Location Detail Info': '2026-08-29 08:12:53  TAHI C1; 2026-08-28 23:46:18  TR-285; ' }),
  dev({ 'Device ID': '00-0F-14-04-9B-3A-5E-4D', 'Device Serial Number': 'AA3-3C082960', 'Device Name': 'N1-WHA301474', 'Device Status': 'Offline ( 2026-10-23  12:06:14 ) ', 'Location Detail Info': '2026-10-23 12:02:57  Transit 7; 2026-10-22 13:43:01  Transit 7; ' }),
  dev({ 'Device ID': '00-0F-14-04-9B-1B-33-68', 'Device Serial Number': 'AA3-05021195', 'Device Name': 'N1-WHA283495', 'Device Status': 'Shutdown ( 2026-10-26  16:46:15 ) ', Department: 'CCU', Location: 'CCU CC.3', Version: '02.39.00.01 231998' }),
  dev({ 'Device ID': '00-0F-14-04-9B-1A-F4-08', 'Device Serial Number': 'AA3-05021214', 'Device Name': 'N1-WHA283181', 'Device Status': 'Standby', Department: 'ED2', Location: 'ED2 Bed 4' }),
  dev({ 'Device ID': '00-0F-14-04-9B-47-8C-E0', 'Device Serial Number': 'AA3-05021214', 'Device Name': 'N1-WHA283182', 'Device Status': 'Working', Department: 'ED10', Location: 'ED10 Bed 1', 'Error Information': 'Error ( Battery2 Service Required ) ' }),
  dev({ 'Device ID': '00-0F-14-04-9B-1A-F4-08', 'Device Serial Number': 'AA3-05021214', 'Device Name': 'N1-WHA283181', 'Device Status': 'Working', Department: 'ED2', Location: 'ED2 Bed 5' }), // the same Device ID again
  row({}), // blank line
  dev({ 'Device Name': 'no id and no serial', 'Device Status': 'Working' }),
]

test('the status text becomes a status and the time it started', () => {
  assert.deepEqual(parseStatus('\tOffline ( 2026-10-27  11:43:00 ) '), { status: 'Offline', since: '2026-10-27 11:43' })
  assert.deepEqual(parseStatus('Shutdown ( 2026-10-26  16:46:15 )'), { status: 'Shutdown', since: '2026-10-26 16:46' })
  assert.deepEqual(parseStatus('Working'), { status: 'Working', since: '' })
  assert.deepEqual(parseStatus('standby'), { status: 'Standby', since: '' })
  assert.deepEqual(parseStatus(''), { status: 'Unknown', since: '' })
})

test('the last location is the newest entry in the location log', () => {
  assert.deepEqual(lastSeen('2026-10-23 12:02:57  Transit 7; 2026-10-22 13:43:01  Transit 7; '), { at: '2026-10-23 12:02', place: 'Transit 7' })
  assert.deepEqual(lastSeen('2026-10-24 09:45:00  EDN  N-ED ED09;'), { at: '2026-10-24 09:45', place: 'EDN N-ED ED09' })
  assert.deepEqual(lastSeen(''), { at: '', place: '' })
})

test('a department the export leaves blank is taken from the location, and marked as a guess', () => {
  assert.deepEqual(departmentOf({ department: 'CCU', location: 'CCU CC.3' }), { department: 'CCU', guessed: false })
  assert.deepEqual(departmentOf({ department: '', location: 'EDW W-ED RES02' }), { department: 'EDW', guessed: true })
  assert.deepEqual(departmentOf({ department: '', location: '', lastPlace: 'Transit 7' }), { department: 'Transit', guessed: true })
  assert.deepEqual(departmentOf({ department: '', location: '', lastPlace: '' }), { department: '', guessed: false })
})

test('the export is read by header: trimmed values, one device per Device ID', () => {
  const { devices, skipped, duplicates, error } = parseDevices(rows)
  assert.equal(error, null)
  assert.equal(devices.length, 5)
  assert.equal(skipped, 1, 'the row with no id and no serial')
  assert.equal(duplicates, 1, 'the repeated Device ID')

  const a = devices.find((d) => d.name === 'N1-WHA304525')
  assert.equal(a.id, '00-0F-14-04-9B-3A-D1-9D')
  assert.equal(a.serial, 'AA3-41084001')
  assert.equal(a.category, 'Transport Monitor')
  assert.equal(a.status, 'Working')
  assert.equal(a.department, 'TAHI')
  assert.equal(a.deptGuessed, true)
  assert.equal(a.location, 'TAHI C1')
  assert.equal(a.version, '02.41.00.01')
  assert.equal(a.versionFull, '02.41.00.01 273831')

  const off = devices.find((d) => d.name === 'N1-WHA301474')
  assert.equal(off.status, 'Offline')
  assert.equal(off.statusSince, '2026-10-23 12:06')
  assert.equal(off.location, 'Transit 7', 'with no Location, the last place it was seen')
  assert.equal(off.lastSeenAt, '2026-10-23 12:02')

  const dup = devices.filter((d) => d.name === 'N1-WHA283181')
  assert.equal(dup.length, 1)
  assert.equal(dup[0].location, 'ED2 Bed 5', 'the later row wins')
  assert.equal(devices.find((d) => d.name === 'N1-WHA283182').error, 'Battery2 Service Required')
})

test('a file with no recognisable header says so', () => {
  const out = parseDevices([['a', 'b'], ['1', '2']])
  assert.match(out.error, /No header row/)
  assert.deepEqual(out.devices, [])
})

test('other spellings of the columns are accepted, and the header need not be the first row', () => {
  const out = parseDevices([['Exported from the central station'], [], ['Serial No', 'Type', 'Status', 'Dept', 'Name'], ['S1', 'Monitor', 'Working', 'ICU', 'Bed 1']])
  assert.equal(out.error, null)
  assert.equal(out.devices[0].id, 'sn-S1')
  assert.equal(out.devices[0].department, 'ICU')
  assert.equal(out.devices[0].category, 'Monitor')
})

const items = [
  { id: 'a', name: 'N1-A', serial: 'S1', status: 'Working', department: 'TTHSU', version: '02.41.00.01', location: 'TTHSU 1', result: 'done', doneByName: 'Ann' },
  { id: 'b', name: 'N1-B', serial: 'S2', status: 'Offline', department: 'ED10', version: '02.39.00.01', location: 'ED10 2', result: '' },
  { id: 'c', name: 'N1-C', serial: 'S3', status: 'Offline', department: 'ED2', version: '02.39.00.01', location: 'ED2 1', result: 'notfound' },
  { id: 'd', name: 'N1-D', serial: 'S4', status: 'Shutdown', department: '', version: '02.39.00.01', location: '', result: '' },
  { id: 'e', name: 'N1-E', serial: 's2', status: 'Standby', department: 'TTHSU', version: '02.41.00.01', location: 'TTHSU 3', result: '', note: 'in the cupboard' },
]

test('sorting by department: numbers in order (ED2 before ED10), no department last, either way round', () => {
  assert.deepEqual(sortItems(items, 'department', 1).map((i) => i.id), ['c', 'b', 'a', 'e', 'd'])
  assert.deepEqual(sortItems(items, 'department', -1).map((i) => i.id), ['a', 'e', 'b', 'c', 'd'])
})

test('sorting by status follows the usual order, and by result puts what is left to do first', () => {
  assert.deepEqual(sortItems(items, 'status', 1).map((i) => i.status), ['Working', 'Standby', 'Offline', 'Offline', 'Shutdown'])
  assert.deepEqual(sortItems(items, 'result', 1).map((i) => i.id).slice(0, 3).sort(), ['b', 'd', 'e'])
  assert.equal(sortItems(items, 'result', 1).at(-1).id, 'a')
})

test('sorting leaves the list it was given alone', () => {
  const before = items.map((i) => i.id).join()
  sortItems(items, 'serial', -1)
  assert.equal(items.map((i) => i.id).join(), before)
})

test('filters: what is left to do, one department, no department, a search', () => {
  assert.deepEqual(filterItems(items, { show: 'todo' }).map((i) => i.id), ['b', 'd', 'e'])
  assert.deepEqual(filterItems(items, { show: 'done' }).map((i) => i.id), ['a'])
  assert.deepEqual(filterItems(items, { show: 'notfound' }).map((i) => i.id), ['c'])
  assert.deepEqual(filterItems(items, { department: 'TTHSU' }).map((i) => i.id), ['a', 'e'])
  assert.deepEqual(filterItems(items, { department: NO_DEPARTMENT }).map((i) => i.id), ['d'])
  assert.deepEqual(filterItems(items, { status: 'Offline', version: '02.39.00.01' }).map((i) => i.id), ['b', 'c'])
  assert.deepEqual(filterItems(items, { q: 'cupboard' }).map((i) => i.id), ['e'])
  assert.deepEqual(filterItems(items, { q: 'ann tthsu' }).map((i) => i.id), ['a'], 'every word must match, in any column')
  assert.equal(filterItems(items, { show: 'all' }).length, 5)
})

test('the counts: done, couldn’t find, to do, by department and by status', () => {
  const s = summarise(items)
  assert.equal(s.total, 5)
  assert.equal(s.done, 1)
  assert.equal(s.notfound, 1)
  assert.equal(s.todo, 3)
  assert.equal(s.uniqueSerials, 4, 'S2 and s2 are one serial number')
  assert.equal(s.sharedSerials, 1)
  assert.deepEqual(s.byStatus, { Working: 1, Offline: 2, Shutdown: 1, Standby: 1 })
  assert.deepEqual(s.departments.map((d) => [d.name, d.total, d.done]), [['ED2', 1, 0], ['ED10', 1, 0], ['TTHSU', 2, 1], ['', 1, 0]])
  assert.deepEqual(s.versions.map((v) => [v.name, v.count]), [['02.39.00.01', 3], ['02.41.00.01', 2]])
  assert.deepEqual([...sharedSerials(items)], ['s2'])
})

test('groups are the runs of one department in the sorted list', () => {
  const groups = groupByDepartment(sortItems(items, 'department', 1))
  assert.deepEqual(groups.map((g) => [g.department, g.items.length]), [['ED2', 1], ['ED10', 1], ['TTHSU', 2], ['', 1]])
})

test('the export has a column for each header, the result in words, and defuses formulas in the CSV', () => {
  const out = exportRows([{ ...items[0], doneAt: new Date(2026, 9, 27, 14, 5), lastSeenAt: '2026-10-27 09:15', name: '=SUM(A1)' }, items[1]])
  assert.equal(out.length, 2)
  assert.ok(out.every((r) => r.length === EXPORT_HEADERS.length))
  const col = (h) => EXPORT_HEADERS.indexOf(h)
  assert.equal(out[0][col('Result')], 'Done')
  assert.equal(out[0][col('Done by')], 'Ann')
  assert.equal(out[0][col('Done at')], '27-Oct-2026 14:05')
  assert.equal(out[0][col('Last seen')], '27-Oct-2026 09:15')
  assert.equal(out[1][col('Result')], '')
  const csv = toCsv(EXPORT_HEADERS, out)
  assert.ok(csv.startsWith('﻿"Department"'))
  assert.ok(csv.includes('"\'=SUM(A1)"'), 'a cell that starts with = is made text')
  assert.equal(csv.split('\r\n').length, 3)
  assert.equal(toCsv(['a'], [['say "hi", ok']]), '﻿"a"\r\n"say ""hi"", ok"')
})

test('dates and file names', () => {
  assert.equal(niceStamp('2026-10-27 11:43'), '27-Oct-2026 11:43')
  assert.equal(niceStamp('2026-10-27'), '27-Oct-2026')
  assert.equal(fileSafe('N1 software upgrade: North Shore / Oct'), 'N1-software-upgrade-North-Shore-Oct')
  assert.equal(fileSafe(''), 'checklist')
})
