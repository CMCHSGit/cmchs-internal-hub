// Word guides into articles (apps/knowledge/src/docx.js). Run: node --test apps/knowledge/tests/docx.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { articlesFromDocx, buildArticles, docxText, parseXml, titleFromFile } from '../src/docx.js'
import { buildRecord, queryWords, richBlocks, searchRecords } from '../src/model.js'

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:mc="x"'
const doc = (body) => `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`
const p = (text, { style, num, bold } = {}) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${num ? `<w:numPr><w:ilvl w:val="${num[1]}"/><w:numId w:val="${num[0]}"/></w:numPr>` : ''}</w:pPr><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`
const picture = '<w:p><w:r><w:drawing><a:graphic><a:graphicData><a:blip r:embed="rId9"/></a:graphicData></a:graphic></w:drawing></w:r></w:p>'
const numbering = `<w:numbering ${W}>
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl><w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="lowerLetter"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
  <w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>
</w:numbering>`

test('the XML reader keeps names, attributes, text and entities', () => {
  const root = parseXml('<?xml version="1.0"?><a x="1 &amp; 2"><b/><c>fish &amp; chips &#65;</c><!-- no --></a>')
  const a = root.c[0]
  assert.equal(a.a.x, '1 & 2')
  assert.equal(a.c.length, 2)
  assert.equal(a.c[1].c[0].t, 'fish & chips A')
})

test('steps keep their numbers, sub-steps their letters, and a restarted list starts again at 1', () => {
  const xml = doc(
    p('First', { num: [1, 0] }) + p('Open the menu', { num: [1, 1] }) + p('Pick Service', { num: [1, 1] }) + p('Second', { num: [1, 0] }) + p('Back to level one', { num: [1, 1] })
    + p('A bullet', { num: [2, 0] }) + p('A new list', { num: [3, 0] }),
  )
  const { text } = docxText({ document: xml, numbering })
  assert.equal(text, ['1. First', '  a. Open the menu', '  b. Pick Service', '2. Second', '  a. Back to level one', '- A bullet', '1. A new list'].join('\n'))
})

test('headings and bold become **bold**; a link adds its address after its words', () => {
  const rels = '<Relationships><Relationship Id="rId5" Type="x" Target="https://example.com/doc" TargetMode="External"/><Relationship Id="rId6" Type="x" Target="media/image1.png"/></Relationships>'
  const link = '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="rId5"><w:r><w:t>the guide</w:t></w:r></w:hyperlink></w:p>'
  const same = '<w:p><w:hyperlink r:id="rId5"><w:r><w:t>https://example.com/doc</w:t></w:r></w:hyperlink></w:p>'
  const { text } = docxText({ document: doc(p('Big title', { style: 'Heading1' }) + p('Warning', { bold: true }) + link + same), rels })
  assert.equal(text, '**Big title**\n**Warning**\nSee the guide (https://example.com/doc)\nhttps://example.com/doc')
})

test('tables are a row a line; pictures leave a marker and are counted, shapes are not pictures', () => {
  const row = (...cells) => `<w:tr>${cells.map((c) => `<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`
  const shape = '<w:p><w:r><mc:AlternateContent><mc:Choice><w:drawing><a:graphic><a:graphicData><wps:wsp/></a:graphicData></a:graphic></w:drawing></mc:Choice><mc:Fallback><w:pict/></mc:Fallback></mc:AlternateContent></w:r></w:p>'
  const twoPics = '<w:p><w:r><w:t>Both: </w:t></w:r><w:r><w:drawing><a:blip/></w:drawing></w:r><w:r><w:drawing><a:blip/></w:drawing></w:r></w:p>'
  const r = docxText({ document: doc(`<w:tbl>${row('Part', 'Name')}${row('AB-1', 'Cable')}</w:tbl>` + picture + shape + twoPics) })
  assert.equal(r.text, 'Part | Name\nAB-1 | Cable\n\n[Picture]\n\nBoth: [2 pictures]') // the empty paragraph holding only a shape is a blank line
  assert.equal(r.pictures, 3)
})

test('deleted text in tracked changes is left out', () => {
  const del = '<w:p><w:r><w:t>Kept</w:t></w:r><w:del><w:r><w:delText>Gone</w:delText></w:r></w:del></w:p>'
  assert.equal(docxText({ document: doc(del) }).text, 'Kept')
})

test('an article takes its title from the file name, drops a repeated heading, and keeps the source', () => {
  const xml = doc(p('A9 Vaporizer Calibration', { style: 'Heading1' }) + p('Warm up first') + picture)
  const { articles, pictures } = articlesFromDocx({ document: xml }, '- A9 Vaporizer Calibration.docx')
  assert.equal(articles.length, 1)
  assert.equal(articles[0].title, 'A9 Vaporizer Calibration')
  assert.equal(articles[0].text, 'Warm up first\n[Picture]')
  assert.equal(pictures, 1)
  const [rec] = buildArticles(articles, { category: 'Mindray', where: 'https://example.com/folder' })
  assert.match(rec.body, /Source file: - A9 Vaporizer Calibration\.docx\nPictures and the original Word file: https:\/\/example\.com\/folder$/)
  assert.equal(rec.category, 'Mindray')
  assert.equal(titleFromFile('Installing Windows 2019 LTSC on Dell OptiPlex_v2.docx'), 'Installing Windows 2019 LTSC on Dell OptiPlex v2')
})

test('the same file always makes the same id, so importing it again replaces the article', () => {
  const xml = doc(p('Some steps for the thing to do'))
  const a = articlesFromDocx({ document: xml }, 'Setting up RIS 6.3.3(MMH).docx').articles[0].id
  const b = articlesFromDocx({ document: doc(p('Changed steps for the thing to do')) }, 'Setting up RIS 6.3.3(MMH).docx').articles[0].id
  assert.equal(a, b)
  assert.match(a, /^w-settingupris633mmh$/)
})

test('a file with only pictures, or nothing, makes no article and says why', () => {
  assert.match(articlesFromDocx({ document: doc(picture + picture) }, 'Quick Guide.docx').problem, /only pictures/)
  assert.match(articlesFromDocx({ document: doc('') }, 'Empty.docx').problem, /no text/)
})

test('a very long document is cut at its headings into parts that fit', () => {
  const section = (n) => p(`Section ${n}`, { style: 'Heading2' }) + Array.from({ length: 30 }, (_, i) => p(`Step ${i} of section ${n}: ${'detail '.repeat(25)}`)).join('')
  const { articles } = articlesFromDocx({ document: doc(Array.from({ length: 8 }, (_, i) => section(i)).join('')) }, 'Big SOP.docx')
  assert.ok(articles.length >= 2)
  assert.deepEqual(articles.map((a) => a.id), articles.map((_, i) => (i ? `w-bigsop-${i + 1}` : 'w-bigsop')))
  assert.match(articles[1].title, /^Big SOP \(part 2 of \d+\)$/)
  for (const a of articles) { assert.ok(a.text.length <= 18000); assert.match(a.text, /^\*\*Section \d\*\*/) } // each part starts at a heading
})

test('a long guide stays searchable to its end, and [Picture] is not a word to find', () => {
  const filler = Array.from({ length: 300 }, (_, i) => `the quick brown fox jumps over the lazy dog step ${i % 50}`).join('\n')
  const rec = buildRecord('article', { title: 'Long', body: filler + '\n[Picture]\nAt the very end: replace the zebrafish gasket' })
  assert.ok(rec.search.includes('zebrafish'))
  assert.ok(!rec.search.includes('picture'))
  assert.ok(rec.search.length <= 9000)
  assert.equal(searchRecords('article', [rec], 'zebrafish gasket').length, 1)
  assert.deepEqual(queryWords('picture'), ['picture'])
  assert.equal(searchRecords('article', [rec], 'picture').length, 0)
})

test('richBlocks reads numbered and lettered steps, with their depth', () => {
  const b = richBlocks('1. First\n  a. Sub step\n10. Tenth\n- bullet\n  - deeper\nI. think so\nPlain.')
  assert.deepEqual(b.map((x) => [x.type, x.level, x.marker]), [['li', 0, '1.'], ['li', 1, 'a.'], ['li', 0, '10.'], ['li', 0, null], ['li', 1, null], ['p', undefined, undefined], ['p', undefined, undefined]])
})
