// npm test --prefix apps/testbench: the offline copy (tools/build-offline.mjs). One file, nothing left to fetch, every template inside,
// the page's own loader finds them, and a change to the bench that breaks a patch stops the build instead of making a broken copy.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import vm from 'node:vm'
import { buildOffline, inlineFonts, leftovers, templatePack } from '../tools/build-offline.mjs'

const BENCH = readFileSync(new URL('../bench/index.html', import.meta.url), 'utf8')
const DATE = '2026-11-25'
const built = buildOffline({ date: DATE })

test('the copy has nothing left to fetch: no fonts.css, no font files, no web addresses', () => {
  assert.deepEqual(leftovers(built), [])
  assert.ok(built.includes('data:font/woff2;base64,'), 'fonts are inline')
})

test('every template is embedded, and the page reads them through its own published-templates loader', () => {
  const { pack, count } = templatePack()
  const files = readdirSync(new URL('../templates/', import.meta.url)).filter((n) => /\.json$/i.test(n) && !/^[._~]/.test(n))
  assert.equal(count, files.length)
  const index = JSON.parse(pack['index.json'])
  assert.equal(index.templates.length, count)
  for (const e of index.templates) assert.ok(typeof pack[e.file] === 'string' && JSON.parse(pack[e.file]), `${e.file} is embedded and valid JSON`)
  // The shim is the first <script> after fonts: run it with a stub fetch and Response and ask it the way loadPublished does.
  const shim = built.match(/<script>\n\/\* Offline copy: the templates are inside this file\. \*\/([\s\S]*?)<\/script>/)
  assert.ok(shim, 'the shim is in the page')
  const seen = []
  const window = { fetch: (u) => { seen.push(u); return Promise.resolve('real') } }
  class Response { constructor(body, init) { this.body = body; this.status = init.status } }
  vm.runInNewContext(shim[1], { window, Response, Promise, decodeURIComponent, Object })
  return (async () => {
    const idx = await window.fetch('templates/index.json', { cache: 'no-store' })
    assert.equal(idx.status, 200)
    assert.equal(JSON.parse(idx.body).templates.length, count)
    const first = index.templates[0].file
    const one = await window.fetch('templates/' + encodeURIComponent(first))
    assert.equal(one.body, pack[first])
    assert.equal((await window.fetch('templates/nope.json')).status, 404)
    assert.equal(await window.fetch('https://example.com/x'), 'real', 'other requests pass straight through')
    assert.deepEqual(seen, ['https://example.com/x'])
  })()
})

test('embedded templates survive a </script> inside them', () => {
  const html = buildOffline({ date: DATE, templates: { pack: { 'index.json': '{"templates":[]}', 'x.json': '{"a":"</script><!-- b"}' }, count: 0 } })
  assert.equal(html.split('</script>').length, BENCH.split('</script>').length + 1, 'only the shim adds a closing tag')
  assert.ok(!html.includes('"</script><!-- b"'))
})

test('the loader also runs when no templates folder is connected, and the stamp is there', () => {
  assert.ok(built.includes("this.state = 'none'; this.render(); await this.loadPublished(); return; }"))
  assert.ok(built.includes(`Offline copy, built ${DATE}`))
  assert.match(built, new RegExp(`<title>[^<]*\\(offline ${DATE}\\)</title>`))
})

test('a bench change that breaks a patch stops the build', () => {
  assert.throws(() => buildOffline({ date: DATE, bench: BENCH.replace('<link rel="stylesheet" href="fonts.css">', '') }), /fonts\.css link/)
  assert.throws(() => buildOffline({ date: DATE, bench: BENCH.replace("this.state = 'none'; this.render(); return;", '') }), /no folder/)
})

test('inlineFonts swaps each font file for a data: address and leaves the rest of the CSS alone', () => {
  const css = "@font-face { src: url(fonts/A.woff2) format('woff2'); } .x { color: red }"
  const out = inlineFonts(css, () => Buffer.from('abc'))
  assert.equal(out, "@font-face { src: url(data:font/woff2;base64,YWJj) format('woff2'); } .x { color: red }")
})
