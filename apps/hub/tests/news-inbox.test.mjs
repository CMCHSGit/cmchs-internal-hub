// npm test -w apps/hub — the emailed team update: what the Gmail reader
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
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url')
const decode = (d) => Buffer.from(d, 'base64url').toString('utf8')

test('the Gmail search: delivered to the address, not yet brought in, recent', () => {
  assert.equal(ctx.newsInboxQuery_(' hub+hubnews@gmail.com ', 14), 'deliveredto:hub+hubnews@gmail.com -label:hub-imported newer_than:14d')
})

test('only senders on the list, by address or whole domain', () => {
  assert.equal(ctx.senderAddress_('Pat Poster <Pat@Cass.co.nz>'), 'pat@cass.co.nz')
  assert.equal(ctx.senderAddress_('pat@cass.co.nz'), 'pat@cass.co.nz')
  assert.equal(ctx.senderAllowed_('pat@cass.co.nz', 'pat@cass.co.nz, kai@cass.co.nz'), true)
  assert.equal(ctx.senderAllowed_('zed@cass.co.nz', 'pat@cass.co.nz, kai@cass.co.nz'), false)
  assert.equal(ctx.senderAllowed_('zed@chsnz.co.nz', '@cass.co.nz;@chsnz.co.nz'), true)
  assert.equal(ctx.senderAllowed_('x@notcass.co.nz', '@cass.co.nz'), false)
  assert.equal(ctx.senderAllowed_('evil@cass.co.nz.example.com', '@cass.co.nz'), false)
  assert.equal(ctx.senderAllowed_('', '@cass.co.nz'), false)
  assert.equal(ctx.senderAllowed_('pat@cass.co.nz', ''), false)
})

test('mail that fails Gmail’s sender check is never brought in', () => {
  assert.equal(ctx.failsDmarc_('mx.google.com; dkim=pass; spf=pass; dmarc=pass (p=NONE)'), false)
  assert.equal(ctx.failsDmarc_('mx.google.com; spf=softfail; dmarc=fail (p=QUARANTINE)'), true)
  assert.equal(ctx.failsDmarc_(''), false)
})

test('the HTML and plain bodies, from the nested parts Outlook sends, never an attachment', () => {
  const payload = {
    mimeType: 'multipart/mixed',
    parts: [
      { mimeType: 'multipart/alternative', parts: [
        { mimeType: 'text/plain', body: { data: b64('Hi All, plain') } },
        { mimeType: 'text/html', body: { data: b64('<html><body><p>Hi All – ā</p></body></html>') } },
      ] },
      { mimeType: 'text/html', filename: 'old.html', body: { data: b64('<p>attached</p>') } },
    ],
  }
  const b = ctx.bodiesOf_(payload, decode)
  assert.equal(b.text, 'Hi All, plain')
  assert.equal(b.html, '<html><body><p>Hi All – ā</p></body></html>')
  assert.deepEqual({ ...ctx.bodiesOf_({ mimeType: 'text/plain', body: { data: b64('only text') } }, decode) }, { html: '', text: 'only text' })
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
