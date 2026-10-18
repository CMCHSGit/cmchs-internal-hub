// npm test -w apps/asks — copying people in (cc): who sees it, what's theirs,
// and who the proxy tells (askRecipients_ / askMessage_, read straight out of
// backend/apps-script/proxy/Code.js so the test checks what's deployed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { activityOf, canClaim, canSee, cleanAsk, isCopied, isMineToDo, myBuckets, peopleOf } from '../src/model.js'
import { SAMPLE_USERS, sampleAsks } from '../src/sample.js'

const NOW = Date.parse('2026-10-16T09:00:00+13:00')
const { asks } = sampleAsks(NOW)
const user = (id) => SAMPLE_USERS.find((u) => u.uid === id)
const lee = user('u-lee'), mike = user('u-mike')
const s2 = asks.find((a) => a.id === 's2') // Jess -> Mike and Sam, Lee copied in

test('copied in: sees it, it is not theirs to do, it shows under Kept in the loop', () => {
  assert.equal(canSee(s2, lee), true)
  assert.equal(isCopied(s2, lee), true)
  assert.equal(isMineToDo(s2, lee), false)
  assert.equal(canClaim({ ...s2, owner: '', status: 'open' }, lee), false)
  assert.deepEqual(myBuckets(asks, lee, '2026-10-16', NOW).cc.map((a) => a.id), ['s2'])
  assert.equal(isCopied(s2, mike), false, 'sent it, so not "copied"')
})

test('cleanAsk: cc without repeats or anyone it is sent to; peopleOf includes cc', () => {
  const f = cleanAsk({ title: 'x', assignees: ['u-mike'], cc: ['u-lee', 'u-lee', 'u-mike'] })
  assert.deepEqual(f.cc, ['u-lee'])
  assert.deepEqual(peopleOf({ createdBy: 'u-jess', assignees: ['u-mike'], cc: ['u-lee'] }), ['u-jess', 'u-mike', 'u-lee'])
  assert.deepEqual(cleanAsk({ title: 'x', teams: ['Sales'] }).cc, [])
})

test('activity: "copied you in" when raised or when added later', () => {
  const nameOf = (uid) => user(uid)?.name
  const made = { ...s2, event: { id: 'e', type: 'created', by: 'u-jess', atMs: NOW - 1000 } }
  assert.equal(activityOf(made, lee, nameOf, NOW).text, 'Jess copied you in')
  const added = { ...s2, event: { id: 'e', type: 'added', by: 'u-jess', atMs: NOW - 1000, to: [], teams: [], cc: ['u-lee'] } }
  assert.equal(activityOf(added, lee, nameOf, NOW).text, 'Jess copied you in')
})

// The proxy's two pure functions, run as Apps Script would (no globals they need).
const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
/** A top-level function's source: from its name to the first closing brace at the start of a line. */
const grab = (name) => {
  const i = code.indexOf('function ' + name + '(')
  assert.ok(i >= 0, name + ' not found')
  return code.slice(i, code.indexOf('\n}\n', i) + 3)
}
const ctx = vm.createContext({})
vm.runInContext(grab('askRecipients_') + grab('askMessage_'), ctx)
const users = [{ uid: 'jess', team: 'Sales' }, { uid: 'mike', team: 'Engineers' }, { uid: 'lee', team: 'Application' }]
const ask = { title: 'Quote', createdBy: 'jess', assignees: ['mike'], teams: [], cc: ['lee'], people: ['jess', 'mike', 'lee'], owner: '' }
const to = (ev, a = ask) => [...ctx.askRecipients_(a, ev, users, null)].sort()

test('proxy: copied-in people hear when it is raised, when copied in later, and when it is done; not the rest', () => {
  assert.deepEqual(to({ type: 'created', by: 'jess' }), ['lee', 'mike'])
  assert.deepEqual(to({ type: 'added', by: 'jess', to: [], teams: [], cc: ['lee'] }), ['lee'])
  assert.deepEqual(to({ type: 'added', by: 'jess', to: ['mike'], teams: [] }), ['mike'], 'already copied in: not told again')
  assert.deepEqual(to({ type: 'done', by: 'mike' }, { ...ask, owner: 'mike' }), ['jess', 'lee'])
  assert.deepEqual(to({ type: 'claimed', by: 'mike' }), ['jess'])
  assert.deepEqual(to({ type: 'created', by: 'jess' }, { ...ask, cc: undefined }), ['mike'], 'older asks without cc')
})

test('proxy: a copied-in person is told it is for their information', () => {
  assert.equal(ctx.askMessage_(ask, { type: 'created' }, 'Jess Reid', 'lee', null).title, 'Jess copied you in on an ask')
  assert.equal(ctx.askMessage_(ask, { type: 'created' }, 'Jess Reid', 'mike', null).title, 'New ask from Jess')
  assert.equal(ctx.askMessage_(ask, { type: 'done' }, 'Mike Tan', 'lee', null).title, 'Done: Quote')
})
