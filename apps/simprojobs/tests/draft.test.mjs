// Run: cd apps/simprojobs && npm test
import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TEXT, cleanText, hasWork, missing, preview, toHtml } from '../src/draft.js'

test('cleanText: one kind of line break, no trailing spaces, no blank lines at the ends, capped', () => {
  assert.equal(cleanText('  \r\n\r\nline one   \r\nline two\t\r\n\r\n'), 'line one\nline two')
  assert.equal(cleanText(null), '')
  assert.equal(cleanText(undefined), '')
  assert.equal(cleanText('x'.repeat(MAX_TEXT + 500)).length, MAX_TEXT)
  assert.equal(cleanText('a\rb'), 'a\nb')
})

test('toHtml: a blank line is a paragraph, a line break is <br>, nothing typed is ever run as markup', () => {
  assert.equal(toHtml(''), '')
  assert.equal(toHtml('   \n  '), '')
  assert.equal(toHtml('Monitor will not power on'), '<p>Monitor will not power on</p>')
  assert.equal(toHtml('Fault:\nno display\n\nCustomer rang at 9'), '<p>Fault:<br>no display</p><p>Customer rang at 9</p>')
  assert.equal(toHtml('A & B <script>alert(1)</script> "q"'), '<p>A &amp; B &lt;script&gt;alert(1)&lt;/script&gt; &quot;q&quot;</p>')
  assert.equal(toHtml('x\n\n\n\ny'), '<p>x</p><p>y</p>')
})

test('missing: every required field, in form order; notes are optional', () => {
  assert.deepEqual(missing({}), ['Customer', 'Site', 'Cost centre', 'Job type', 'Charge category', 'Priority', 'Description'])
  const full = { customer: { ID: 1 }, site: { id: 2 }, costCentre: { id: 3 }, jobType: { id: 'Repair' }, chargeCategory: { id: 'Warranty' }, priority: { id: 1 }, description: 'Fault' }
  assert.deepEqual(missing(full), [])
  assert.deepEqual(missing({ ...full, description: '  \n ' }), ['Description'])
  assert.deepEqual(missing({ ...full, site: null, notes: '' }), ['Site'])
  assert.deepEqual(missing(null).length, 7)
})

test('hasWork: typed text or a chosen customer counts; the usual choices alone do not', () => {
  assert.equal(hasWork({}), false)
  assert.equal(hasWork({ costCentre: { id: 1, usual: true }, jobType: { id: 'Repair', usual: true } }), false)
  assert.equal(hasWork({ costCentre: { id: 1, usual: false } }), true)
  assert.equal(hasWork({ description: 'x' }), true)
  assert.equal(hasWork({ notes: ' \n' }), false)
  assert.equal(hasWork({ customer: { ID: 1 } }), true)
})

test('preview: lines joined, cut with an ellipsis', () => {
  assert.equal(preview('a\nb\n\nc'), 'a · b · c')
  assert.equal(preview('x'.repeat(300), 20), 'x'.repeat(20) + '…')
  assert.equal(preview(''), '')
})
