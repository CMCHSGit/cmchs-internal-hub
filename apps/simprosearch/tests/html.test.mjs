// Run: npm test -w apps/simprosearch
import test from 'node:test'
import assert from 'node:assert/strict'
import { decodeEntities, htmlToText, htmlToTree, safeHref, snippetAround, splitByTerm, splitByTerms } from '../src/html.js'

const tags = (tree) => JSON.stringify(tree)

test('plain formatting survives, one line per block', () => {
  const t = htmlToText('<div>Extended Warranty required:<br>Monitor A — SN:XX-1</div><div>Done 7/10</div>')
  assert.equal(t, 'Extended Warranty required:\nMonitor A — SN:XX-1\nDone 7/10')
})

test('scripts, styles and their contents are dropped', () => {
  const tree = htmlToTree('<p>hello</p><script>alert(1)</script><style>p{x:y}</style><iframe src="https://x.test"></iframe><p>bye</p>')
  assert.equal(htmlToText('<p>hello</p><script>alert(1)</script><p>bye</p>'), 'hello\nbye')
  assert.ok(!tags(tree).includes('alert'))
  assert.ok(!tags(tree).includes('script'))
  assert.ok(!tags(tree).includes('iframe'))
})

test('nested dropped tags are matched to their own close', () => {
  assert.equal(htmlToText('a<form><form>x</form>y</form>b'), 'ab')
})

test('no attribute but a safe link address is kept', () => {
  const tree = htmlToTree('<p style="x" onclick="evil()" class="c">hi <a href="https://example.test/a" onclick="x()" style="y">link</a></p>')
  const json = tags(tree)
  assert.ok(!json.includes('onclick') && !json.includes('style') && !json.includes('class'))
  assert.equal(tree[0].kids[1].href, 'https://example.test/a')
})

test('javascript:, data: and disguised schemes are not links', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', '&#106;avascript:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:x', '//evil.test', '/relative']) {
    assert.equal(safeHref(bad), '', bad)
  }
  assert.equal(safeHref('mailto:a@example.test'), 'mailto:a@example.test')
  assert.equal(safeHref('tel:+6495551234'), 'tel:+6495551234')
  assert.equal(htmlToTree('<a href="javascript:alert(1)">x</a>')[0].href, undefined)
})

test('unknown tags are unwrapped and their text stays', () => {
  assert.equal(htmlToText('<font color="red">warm</font> <custom-thing>text</custom-thing>'), 'warm text')
})

test('entities are decoded to text, never to markup', () => {
  assert.equal(decodeEntities('a &amp; b &lt;b&gt; &#39;q&#39; &#x41; &nbsp;'), "a & b <b> 'q' A  ")
  // "&lt;script&gt;" is the letters <script>, drawn as text; it is never parsed as a tag.
  const tree = htmlToTree('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
  assert.equal(tree[0].kids[0].t, 'text')
  assert.equal(tree[0].kids[0].v, '<script>alert(1)</script>')
})

test('lists, tables and headings come through', () => {
  const t = htmlToText('<h3>Parts</h3><ul><li>one</li><li>two</li></ul><table><tr><td>a</td><td>b</td></tr></table>')
  assert.equal(t, 'Parts\none\ntwo\na\tb')
})

test('plain text with line breaks keeps its lines', () => {
  const tree = htmlToTree('first line\nsecond & third')
  assert.equal(htmlToText('first line\nsecond & third'), 'first line\nsecond & third')
  assert.equal(tree.filter((n) => n.tag === 'br').length, 1)
})

test('broken, unclosed and hostile input never throws', () => {
  for (const s of ['<', '<<<>>>', '<p', '<p><b>x', '</p></div>', '<a href="x', '<!-- unterminated', '<![CDATA[x', '<p>' + '<b>'.repeat(5000) + 'x', '\u0000<p>\u0001x</p>']) {
    assert.doesNotThrow(() => htmlToTree(s), s.slice(0, 20))
    assert.doesNotThrow(() => htmlToText(s))
  }
  assert.deepEqual(htmlToTree(''), [])
  assert.deepEqual(htmlToTree(null), [])
  assert.deepEqual(htmlToTree(undefined), [])
})

test('depth and size are capped', () => {
  const deep = htmlToTree('<div>'.repeat(500) + 'x')
  let d = 0, n = deep
  while (n.length && n[0].kids) { d++; n = n[0].kids }
  assert.ok(d <= 30, 'depth ' + d)
  const wide = htmlToTree('<b>x</b>'.repeat(20000))
  assert.ok(wide.length < 20000)
})

test('splitByTerm marks every occurrence, ignoring case', () => {
  assert.deepEqual(splitByTerm('SN:df-12345 and DF-12345', 'DF-12345'), [
    { text: 'SN:', hit: false }, { text: 'df-12345', hit: true }, { text: ' and ', hit: false }, { text: 'DF-12345', hit: true },
  ])
  assert.deepEqual(splitByTerm('abc', ''), [{ text: 'abc', hit: false }])
  assert.deepEqual(splitByTerm('', 'x'), [])
})

test('splitByTerms marks several words at once, longest phrase first', () => {
  assert.deepEqual(splitByTerms('A9 at North Shore Hospital', ['north shore', 'north', 'a9']), [
    { text: 'A9', hit: true }, { text: ' at ', hit: false }, { text: 'North Shore', hit: true }, { text: ' Hospital', hit: false },
  ])
  assert.deepEqual(splitByTerms('abc', []), [{ text: 'abc', hit: false }])
})

test('snippetAround gives a short piece around the first match', () => {
  const s = snippetAround('x'.repeat(200) + ' SN:DF-12345 ' + 'y'.repeat(200), 'df-12345', 20)
  assert.equal(s.hit, 'DF-12345')
  assert.equal(s.cutStart, true)
  assert.equal(s.cutEnd, true)
  assert.ok(s.before.length <= 20 && s.after.length <= 20)
  assert.equal(snippetAround('nothing here', 'zz'), null)
  assert.equal(snippetAround('', 'zz'), null)
})
