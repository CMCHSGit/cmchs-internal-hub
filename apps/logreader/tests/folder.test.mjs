import test from 'node:test'
import assert from 'node:assert/strict'
import { findExports, itemsFromInput, itemsFromDrop } from '../src/folder.js'
import { openFiles } from '../src/load.js'

const it = (path, size = 1000) => ({ path, size, file: { name: path.split('/').pop() } })

test('folder: each archive is an export; a generic log.tar is named after its folder', () => {
  const r = findExports([
    it('Cust/7B/log_for_snA_at_2026_10_13/log.tar', 5e6), it('Cust/7B/log_for_snA_at_2026_10_13/log_dmesg.txt', 60e3),
    it('Cust/7B/log_for_snB_at_2026_10_13/log.tar', 7e6),
    it('Cust/A5/A5_2026-11-10_Service.zip', 13e6), it('Cust/A5/photo.jpeg', 1e6), it('Cust/A5/notes.docx', 1e4),
    it('Cust/Orbit/BeneheartDeviceData/BeneHeartErrorCode/Value00000000', 1e6),
  ])
  assert.deepEqual(r.exports.map(e => [e.kind, e.name]), [
    ['archive', 'log_for_snA_at_2026_10_13'], ['logs', 'Loose log files in log_for_snA_at_2026_10_13'],
    ['archive', 'log_for_snB_at_2026_10_13'],
    ['archive', 'A5_2026-11-10_Service.zip'],
  ])
  assert.equal(r.skipped, 3) // the picture, the document and the binary store
  assert.equal(r.exports[3].size, 13e6)
})

test('folder: loose logs in a folder with no archive are one export; other files are left alone', () => {
  const r = findExports([it('var/log/PrintServerLog.log'), it('var/log/PrintServerLog.log.1.lzo'), it('var/log/Audit.xdb'), it('var/log/coredump/x.core.lzo'), it('var/log/wtmp'), it('readme.md')])
  assert.equal(r.exports.length, 1)
  assert.deepEqual([r.exports[0].kind, r.exports[0].name, r.exports[0].files.length], ['logs', 'log', 2])
  assert.equal(r.skipped, 4)
})

test('folder: backslash paths, ignored folders and nothing useful', () => {
  assert.equal(findExports([it(['a', 'b', 'log.tar'].join(String.fromCharCode(92)))]).exports[0].name, 'b')
  assert.equal(findExports([it('x/node_modules/p/log.tar'), it('x/.git/a.log')]).exports.length, 0)
  assert.equal(findExports([]).exports.length, 0)
})

test('folder: a single archive picked on its own keeps its own name', () => {
  const r = findExports([it('A5_Service.zip')])
  assert.deepEqual(r.exports.map(e => e.name), ['A5_Service.zip'])
})

test('folder: items from an input use the relative path', () => {
  const f = { name: 'log.tar', size: 5, webkitRelativePath: 'Orbit/log.tar' }
  assert.deepEqual(itemsFromInput([f]).map(x => [x.path, x.size]), [['Orbit/log.tar', 5]])
})

test('folder: a dropped folder is walked, in batches, and ignored folders are not entered', async () => {
  const file = (name) => ({ isFile: true, isDirectory: false, name, file: (ok) => ok({ name, size: 10 }) })
  const dir = (name, kids, batch = 2) => ({
    isFile: false, isDirectory: true, name,
    createReader() { let i = 0; return { readEntries: (ok) => { ok(kids.slice(i, i + batch)); i += batch } } },
  })
  const tree = dir('Cust', [file('a.log'), file('b.log'), file('c.log'), dir('sub', [file('log.tar')]), dir('node_modules', [file('x.log')])])
  const dt = { items: [{ kind: 'file', webkitGetAsEntry: () => tree }] }
  const items = await itemsFromDrop(dt)
  assert.deepEqual(items.map(x => x.path).sort(), ['Cust/a.log', 'Cust/b.log', 'Cust/c.log', 'Cust/sub/log.tar'])
})

test('open: files given with their folder path open as one export named by the caller', async () => {
  const text = '11/12/26 09:22:06 INFO - hello [A.cpp:1]\n'
  const f = { name: 'PrintServerLog.log', lastModified: 0, arrayBuffer: async () => new TextEncoder().encode(text).buffer }
  const s = await openFiles([{ file: f, path: 'x/log_for_sn_at_2026_10_13_13_36_19/PrintServerLog.log', size: text.length }], () => {}, 'My export')
  assert.equal(s.source, 'My export')
  assert.equal(s.families[0].name, 'PrintServerLog')
  assert.equal(new Date(s.families[0].files[0].ref).getUTCFullYear(), 2026) // dated from the folder name
})
