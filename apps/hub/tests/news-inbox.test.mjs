// npm test -w apps/hub — the emailed team update: what the Drive folder reader
// (backend/apps-script/news-inbox/Code.js, read straight from the file so the
// test checks what's pushed) picks up and saves, and what Manage offers
// (news-inbox.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { waitingEmails } from '../src/news-inbox.js'
import { splitEmail } from '../src/emailSplit.js'

const ctx = vm.createContext({})
vm.runInContext(readFileSync(new URL('../../../backend/apps-script/news-inbox/Code.js', import.meta.url), 'utf8'), ctx)

test('which files in the folder are brought in, and the subject from the file name', () => {
  assert.equal(ctx.fileKind_('Next few weeks of places to be.html', 'text/html'), 'html')
  assert.equal(ctx.fileKind_('update.HTM', 'application/octet-stream'), 'html')
  assert.equal(ctx.fileKind_('update', 'text/html'), 'html')
  assert.equal(ctx.fileKind_('update.txt', ''), 'text')
  assert.equal(ctx.fileKind_('photo.jpg', 'image/jpeg'), null)
  assert.equal(ctx.fileKind_('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), null)
  assert.equal(ctx.subjectFromName_('Next few weeks   of places to be.html'), 'Next few weeks of places to be')
  assert.equal(ctx.subjectFromName_('Update.TXT'), 'Update')
  assert.equal(ctx.subjectFromName_('.html'), '')
})

test('the HTML kept: the body, without styles, comments or pictures', () => {
  const html = '<html><head><style>p{color:red}</style></head><body><!--[if mso]>x<![endif]--><p>Hi<o:p></o:p></p>' +
    '<img src="data:image/png;base64,AAAA"><ul><li><a href="https://x.nz">Waikato</a></li></ul><script>alert(1)</script></body></html>'
  assert.equal(ctx.cleanEmailHtml_(html), '<p>Hi</p><ul><li><a href="https://x.nz">Waikato</a></li></ul>')
})

test('the saved document: status new; an HTML too big for Firestore falls back to the text', () => {
  const f = ctx.inboxFields_('Next few weeks', { html: '<body><p>Hi</p></body>', text: 'Hi' }, 1763500000000)
  assert.deepEqual(JSON.parse(JSON.stringify(f)), {
    subject: { stringValue: 'Next few weeks' }, html: { stringValue: '<p>Hi</p>' }, text: { stringValue: 'Hi' },
    receivedAtMs: { integerValue: '1763500000000' }, status: { stringValue: 'new' },
  })
  const big = ctx.inboxFields_('', { html: '<p>' + 'x'.repeat(800000) + '</p>', text: 'Hi' }, 1)
  assert.equal(big.html.stringValue, '')
  assert.equal(big.text.stringValue, 'Hi')
  assert.equal(big.subject.stringValue, '(no subject)')
})

test('Manage offers only new emails with a body, newest first', () => {
  const w = waitingEmails([
    { id: 'a', status: 'new', html: '<p>x</p>', receivedAtMs: 1 },
    { id: 'b', status: 'used', html: '<p>x</p>', receivedAtMs: 3 },
    { id: 'c', status: 'new', text: 'x', receivedAtMs: 2 },
    { id: 'd', status: 'new', html: '', text: '', receivedAtMs: 4 },
  ])
  assert.deepEqual(w.map(x => x.id), ['c', 'a'])
})

test('an emailed update with only a plain body still splits into drafts', () => {
  const text = 'Hi All,\n\nThe week that’s been\n- Jack installed monitors at Waikato Hospital\n\nNext week\n- Pat is in Christchurch\n\nThanks,'
  const d = splitEmail({ html: '', text })
  assert.ok(d.length >= 2)
  assert.ok(d.some(x => /Waikato/.test(x.title)))
})
