// npm test -w apps/equipment — a new loan's form email, queued on the loan until it has gone, and the proxy's
// catch-up that sends what the browser never did (model.js queuedFormEmail; Code.js dueLoanEmails_).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { formEmailSent, queuedFormEmail } from '../src/model.js'

const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const grab = (name) => { const i = code.indexOf('function ' + name + '('); assert.ok(i >= 0, name); return code.slice(i, code.indexOf('\n}\n', i) + 3) }
const consts = code.match(/const LOAN_EMAIL_WAIT_MIN = \d+;\nconst LOAN_EMAIL_MAX_DAYS = \d+;/)[0]
const ctx = vm.createContext({})
vm.runInContext(consts.replace(/const /g, 'var ') + '\n' + grab('dueLoanEmails_'), ctx)

test('a new loan queues its form email: who to, the form as the browser would send it', () => {
  const form = { loanTo: 'Hutt Hospital', location: 'Ward 4', startDate: '2026-11-20', endDate: '2026-11-28', accountManager: 'Sam Lee', contactNumber: '',
    rows: [['100244', 'TV80', 'TV80 Ventilator', 'FV3', '']], notes: 'Bring the test lung', shipping: '', items: [], longTerm: false }
  const q = queuedFormEmail(form, { to: 'sam@x.nz', name: 'Sam Lee', ts: 'T', ms: 1000 })
  assert.equal(q.pending, true)
  assert.equal(q.to, 'sam@x.nz')
  assert.equal(q.queuedMs, 1000)
  assert.equal(q.endDate, '2026-11-28')
  assert.match(q.html, /CMCHS Demo/)
  assert.match(q.html, /100244/)
  assert.match(q.html, /Bring the test lung/)
  assert.equal(queuedFormEmail(form, { to: '' }), null) // no address: nothing to send
  assert.equal(queuedFormEmail({ ...form, longTerm: true }, { to: 'a@x.nz' }).endDate, '')
  assert.deepEqual(formEmailSent('tracker', 'T2'), { pending: false, sentAt: 'T2', by: 'tracker' })
})

test('the proxy sends only queued emails over 20 minutes old, under 3 days, never test loans or sent ones', () => {
  const now = 10 * 86400000
  const min = 60000
  const loan = (id, formEmail) => ({ __id: id, meta: formEmail ? { formEmail } : {} })
  const q = (ageMin, extra = {}) => ({ pending: true, to: 'a@x.nz', html: '<p>form</p>', queuedMs: now - ageMin * min, ...extra })
  const due = ctx.dueLoanEmails_([
    loan('batch_due', q(25)),
    loan('batch_young', q(5)),
    loan('batch_old', q(4 * 24 * 60)),
    loan('testbatch_1', q(25)),
    loan('batch_sent', q(25, { pending: false })),
    loan('batch_noto', q(25, { to: '' })),
    loan('batch_none', null),
  ], now).map((l) => l.__id)
  assert.deepEqual(due, ['batch_due'])
})
