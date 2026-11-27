// npm test -w apps/hub — which part of a deploy changed (scripts/build-info.mjs writes build-info.json,
// shared/buildInfo.js compares two of them). A made-up manifest stands in for Vite's: the same fields, fewer files.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { buildInfo, closure } from '../../../scripts/build-info.mjs'
import { compareBuildInfo, mattersHere, readBuildInfo, sectionFiles } from '../../../shared/buildInfo.js'
import { SECTION_SOURCES } from '../src/section-sources.js'

// main (the shell) loads react; section a and b share a chunk; c stands alone and loads a chunk on demand.
const manifest = () => ({
  'index.html': { file: 'assets/main-1.js', name: 'main', isEntry: true, imports: ['react'], css: ['assets/main-1.css'] },
  react: { file: 'assets/react-1.js', imports: [] },
  'a.jsx': { file: 'assets/section-a-1.js', name: 'section-a', isEntry: true, imports: ['react', 'ab'], css: ['assets/section-a-1.css'] },
  'b.jsx': { file: 'assets/section-b-1.js', name: 'section-b', isEntry: true, imports: ['react', 'ab'] },
  ab: { file: 'assets/ab-1.js', imports: ['react'], css: ['assets/ab-1.css'] },
  'c.jsx': { file: 'assets/section-c-1.js', name: 'section-c', isEntry: true, imports: ['react'], dynamicImports: ['c-lazy'] },
  'c-lazy': { file: 'assets/c-lazy-1.js', imports: ['react'] },
})
const SECTIONS = { a: 'a.jsx', b: 'b.jsx', c: 'c.jsx' }
const build = (m, shell = 'sw1', extra) => buildInfo({ manifest: m, sections: SECTIONS, mainKey: 'index.html', entryKeys: ['index.html'], shell, extra })
const changed = (before, after) => compareBuildInfo(build(before), after)

test('nothing changed: same file, nothing reported', () => {
  const a = build(manifest())
  const b = build(manifest())
  assert.deepEqual(a, b)
  assert.deepEqual(compareBuildInfo(a, b), { known: true, shell: false, sections: [] })
})

test('one section changed: only that section differs, and the shell is untouched', () => {
  const m = manifest()
  m['c.jsx'].file = 'assets/section-c-2.js'
  const before = build(manifest())
  const after = build(m)
  assert.deepEqual(compareBuildInfo(before, after), { known: true, shell: false, sections: ['c'] })
  assert.equal(after.sections.a.hash, before.sections.a.hash)
  assert.equal(after.sections.b.hash, before.sections.b.hash)
  assert.equal(after.shell, before.shell)
  assert.equal(after.entry, before.entry)
})

test('a section\'s own lazy chunk or stylesheet counts as that section', () => {
  const lazy = manifest(); lazy['c-lazy'].file = 'assets/c-lazy-2.js'
  assert.deepEqual(changed(manifest(), build(lazy)).sections, ['c'])
  const css = manifest(); css['a.jsx'].css = ['assets/section-a-2.css']
  assert.deepEqual(changed(manifest(), build(css)).sections, ['a'])
})

test('a chunk two sections share marks both of them, and not the third', () => {
  const m = manifest()
  m.ab.file = 'assets/ab-2.js'
  const result = changed(manifest(), build(m))
  assert.deepEqual(result, { known: true, shell: false, sections: ['a', 'b'] })
})

test('the shell changed: the shell differs, and a chunk it loads does not mark any section', () => {
  const m = manifest()
  m.react.file = 'assets/react-2.js'      // loaded by the shell and by every section
  m['index.html'].file = 'assets/main-2.js'
  const before = build(manifest(), 'sw1')
  const after = build(m, 'sw2')
  const result = compareBuildInfo(before, after)
  assert.equal(result.shell, true)
  assert.deepEqual(result.sections, [], 'what the shell already loads is not part of a section')
  assert.notEqual(after.entry, before.entry)
})

test('files outside the manifest can belong to one section', () => {
  const before = build(manifest(), 'sw1', { c: 'bench-app:1' })
  const after = build(manifest(), 'sw1', { c: 'bench-app:2' })
  assert.deepEqual(compareBuildInfo(before, after).sections, ['c'])
})

test('what the page needs to start a section: its own stylesheets and the chunks it imports, not the shell\'s', () => {
  const info = build(manifest())
  assert.deepEqual(info.sections.a, {
    hash: info.sections.a.hash,
    js: 'assets/section-a-1.js',
    css: ['assets/ab-1.css', 'assets/section-a-1.css'],
    preload: ['assets/ab-1.js'],
  })
  assert.deepEqual(info.sections.c.preload, [])
  assert.deepEqual(sectionFiles(info, 'a'), {
    js: '/assets/section-a-1.js', css: ['/assets/ab-1.css', '/assets/section-a-1.css'], preload: ['/assets/ab-1.js'],
  })
  assert.equal(sectionFiles(info, 'nope'), null)
})

test('a section no build knows is reported as changed, one that is gone is ignored', () => {
  const before = build(manifest())
  const after = structuredClone(before)
  after.sections.d = { hash: 'x', js: 'assets/section-d-1.js', css: [], preload: [] }
  delete after.sections.a
  assert.deepEqual(compareBuildInfo(before, after).sections, ['d'])
})

test('nothing can be said without both files (offline, or never fetched)', () => {
  const info = build(manifest())
  assert.deepEqual(compareBuildInfo(null, info), { known: false, shell: false, sections: [] })
  assert.deepEqual(compareBuildInfo(info, null), { known: false, shell: false, sections: [] })
})

test('a deploy matters to this page when the shell changed or its own section did', () => {
  assert.equal(mattersHere({ shellChanged: true, stale: new Set(), section: 'schedule' }), true)
  assert.equal(mattersHere({ shellChanged: false, stale: new Set(['testbench']), section: 'schedule' }), false)
  assert.equal(mattersHere({ shellChanged: false, stale: new Set(['testbench']), section: 'testbench' }), true)
  assert.equal(mattersHere({ shellChanged: false, stale: ['testbench'], section: 'testbench' }), true)
  assert.equal(mattersHere({ shellChanged: false, stale: new Set(['testbench']), section: 'hub' }), false)
  assert.equal(mattersHere({ shellChanged: false, stale: new Set(['testbench']), section: undefined }), false)
})

test('only a build-info file is taken for one', () => {
  const info = build(manifest())
  assert.equal(readBuildInfo(info), info)
  for (const bad of [null, 'x', {}, { v: 2, shell: 's', sections: {} }, { v: 1, sections: {} }, { v: 1, shell: 's' }, { v: 1, shell: '', sections: {} }]) {
    assert.equal(readBuildInfo(bad), null)
  }
})

test('closure follows imports and, if asked, lazy imports; a missing key is skipped', () => {
  const m = manifest()
  assert.deepEqual([...closure(m, ['c.jsx'], { dynamic: false })].sort(), ['assets/react-1.js', 'assets/section-c-1.js'])
  assert.deepEqual([...closure(m, ['c.jsx'])].sort(), ['assets/c-lazy-1.js', 'assets/react-1.js', 'assets/section-c-1.js'])
  assert.deepEqual([...closure(m, ['gone'])], [])
})

// The section list is kept in three places (section-sources.js, router.js, App.jsx); a new section missing from one
// would work in `npm run dev` and fail in the built site.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

test('every section in the router has a source file, and App.jsx loads each by id', () => {
  const routerIds = [...read('../src/router.js').matchAll(/\{ id: '([\w-]+)', prefix: '\/[\w-]+\/' \}/g)].map((m) => m[1]).sort()
  assert.ok(routerIds.length >= 20, 'found the sections in router.js')
  const known = Object.keys(SECTION_SOURCES).sort()
  assert.deepEqual(known, routerIds, 'SECTION_SOURCES and router.js SECTIONS list the same sections')
  for (const [id, file] of Object.entries(SECTION_SOURCES)) {
    assert.ok(existsSync(fileURLToPath(new URL('../../../' + file, import.meta.url))), `${id}: ${file} exists`)
  }
  const app = read('../src/App.jsx')
  const loaded = [...app.matchAll(/lazy\(\(\) => loadSection\('([\w-]+)'\)\)/g)].map((m) => m[1]).sort()
  assert.deepEqual(loaded, known, 'App.jsx lazy-loads every section by id')
  assert.ok(!/import\('\.\.\/\.\.\/[\w-]+\/src\/(newequip\/)?section\.jsx'\)/.test(app), 'App.jsx never names a section file: it would put its hash in the shell')
})
