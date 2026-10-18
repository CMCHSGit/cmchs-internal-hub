import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canSee, canClaim, isMineToDo, myBuckets, myCount, sortAsks, companyCounts, statsOf, peopleOf,
  dueLabel, mentionAt, mentionMatches, findMentions, cleanAsk, isOverdue, eventOf,
} from '../src/model.js'
import { SAMPLE_USERS, sampleAsks } from '../src/sample.js'

const NOW = Date.parse('2026-10-16T09:00:00+13:00')
const TODAY = '2026-10-16'
const { asks } = sampleAsks(NOW)
const user = (id) => SAMPLE_USERS.find((u) => u.uid === id)
const aroha = user('u-aroha'), mike = user('u-mike'), sam = user('u-sam'), jess = user('u-jess'), lee = user('u-lee')
const byId = (id) => asks.find((a) => a.id === id)

test('who can see an ask: the people named, their teams, and admins', () => {
  const s1 = byId('s1') // Lee to the Engineers team
  assert.equal(canSee(s1, lee), true)
  assert.equal(canSee(s1, mike), true, 'on the team it was sent to')
  assert.equal(canSee(s1, jess), false, 'Sales, not involved')
  assert.equal(canSee(s1, aroha), true, 'admin')
  assert.equal(canSee(byId('s3'), sam), false, 'Mike to Jess: another engineer cannot see it')
})

test('picking up: anyone it was sent to, while nobody has it', () => {
  assert.equal(canClaim(byId('s1'), sam), true, 'through his team')
  assert.equal(canClaim(byId('s1'), jess), false)
  assert.equal(canClaim(byId('s2'), sam), false, 'Mike already has it')
  assert.equal(canClaim(byId('s4'), sam), false, 'done')
  assert.equal(isMineToDo(byId('s2'), mike), true)
  assert.equal(isMineToDo(byId('s2'), sam), false, 'Mike picked it up, so it left Sam’s list')
})

test('my page splits asks into to pick up, on it, asked and done', () => {
  const m = myBuckets(asks, mike, TODAY, NOW)
  assert.deepEqual(m.toPick.map((a) => a.id), ['s1'])
  assert.deepEqual(m.onIt.map((a) => a.id), ['s2'])
  assert.deepEqual(m.asked.map((a) => a.id), ['s3'])
  const ar = myBuckets(asks, aroha, TODAY, NOW)
  assert.deepEqual(ar.asked.map((a) => a.id), ['s5'])
  assert.deepEqual(ar.done.map((a) => a.id), ['s4'])
  assert.deepEqual(myCount(asks, jess, TODAY), { total: 2, overdue: 1, urgent: 1 }, 'the urgent quote, plus the stock check sent to Sales')
})

test('sorting: urgent, then overdue, then soonest due, done last', () => {
  const order = sortAsks(asks, TODAY).map((a) => a.id)
  assert.equal(order[0], 's3', 'urgent and overdue')
  assert.equal(order[order.length - 1], 's4', 'done')
  assert.ok(order.indexOf('s5') < order.indexOf('s1'), 'due today before due in 3 days')
})

test('company counts come from the text-free stats', () => {
  const stats = asks.map(statsOf)
  assert.equal(Object.keys(stats[0]).some((k) => /title|details|name/i.test(k)), false, 'no text in the stats')
  const c = companyCounts(stats, SAMPLE_USERS, TODAY, NOW)
  assert.deepEqual(c.totals, { outstanding: 4, open: 3, picked: 0, waiting: 1, overdue: 1, urgent: 1, doneWeek: 1 })
  const row = (uid) => c.people.find((r) => r.uid === uid)
  assert.equal(row('u-mike').onIt, 1)
  assert.equal(row('u-mike').waiting, 1)
  assert.equal(row('u-sam')?.toPick ?? 0, 0, 'Mike picked up the one sent to both of them')
  assert.equal(row('u-jess').toPick, 1)
  assert.equal(row('u-jess').overdue, 1)
  assert.equal(c.teams.find((t) => t.team === 'Engineers').toPick, 1)
  assert.equal(c.teams.find((t) => t.team === 'Sales').toPick, 1)
})

test('people involved never repeat and always include the asker', () => {
  assert.deepEqual(peopleOf({ createdBy: 'a', assignees: ['b', 'a'], owner: 'b' }, ['c']), ['a', 'b', 'c'])
})

test('due dates read naturally', () => {
  assert.equal(dueLabel('2026-10-16', TODAY), 'Due today')
  assert.equal(dueLabel('2026-10-17', TODAY), 'Due tomorrow')
  assert.equal(dueLabel('2026-10-15', TODAY), 'Overdue by 1 day')
  assert.equal(dueLabel('2026-10-13', TODAY), 'Overdue by 3 days')
  assert.match(dueLabel('2026-10-23', TODAY), /^Due /)
  assert.equal(isOverdue({ due: '2026-10-15', status: 'done' }, TODAY), false)
})

test('@mentions: suggestions while typing, and who was mentioned', () => {
  assert.deepEqual(mentionAt('Can you check @mi', 17), { start: 14, query: 'mi' })
  assert.equal(mentionAt('email me at a@b', 15), null, 'an @ inside a word is not a mention')
  assert.deepEqual(mentionMatches(SAMPLE_USERS, 'pa').map((u) => u.uid), ['u-sam'], 'matches a last name too')
  assert.deepEqual(findMentions('Thanks @Mike Tan, and @jess reid too', SAMPLE_USERS), ['u-mike', 'u-jess'])
})

test('a new ask needs a title and someone to send it to', () => {
  assert.throws(() => cleanAsk({ title: '  ', assignees: ['u-mike'] }), /what you need/)
  assert.throws(() => cleanAsk({ title: 'Test it' }), /at least one person or team/)
  const ok = cleanAsk({ title: '  Test   it ', teams: ['Engineers', 'Nope', 'Engineers'], due: 'soon', urgent: 1 })
  assert.deepEqual(ok, { title: 'Test it', details: '', assignees: [], teams: ['Engineers'], cc: [], due: '', urgent: true })
})

test('events carry who and an id', () => {
  const e = eventOf('claimed', mike)
  assert.equal(e.by, 'u-mike')
  assert.equal(e.type, 'claimed')
  assert.ok(e.id.length >= 8)
})

test('the morning summary: one line per person, nothing when there is nothing', async () => {
  const { summaryFor, aucklandOffset } = await import('../scripts/summary.mjs')
  assert.equal(summaryFor({ uid: 'u-aroha', team: 'Management' }, asks, TODAY), null)
  const j = summaryFor({ uid: 'u-jess', team: 'Sales' }, asks, TODAY)
  assert.equal(j.title, 'You have 2 open asks')
  assert.equal(j.body, '2 waiting for someone to pick up, 1 overdue, 1 urgent.')
  assert.equal(summaryFor({ uid: 'u-mike', team: 'Engineers' }, asks, TODAY).body, '1 waiting for someone to pick up, 1 you’re on.')
  assert.equal(aucklandOffset(new Date('2026-07-01T00:00:00Z')), 12)
  assert.equal(aucklandOffset(new Date('2026-12-01T00:00:00Z')), 13)
})
