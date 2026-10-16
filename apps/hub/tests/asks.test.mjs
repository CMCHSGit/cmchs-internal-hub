import { test } from 'node:test'
import assert from 'node:assert/strict'
import { asksSummary, askUrl } from '../src/asks.js'
import { SAMPLE_USERS, sampleAsks } from '../../asks/src/sample.js'

const NOW = Date.parse('2026-10-16T09:00:00+13:00')
const { asks } = sampleAsks(NOW)
const names = new Map(SAMPLE_USERS.map(u => [u.uid, u.name]))
const jess = { uid: 'u-jess', team: 'Sales', role: 'user' }
const visible = asks.filter(a => a.people.includes(jess.uid) || a.teams.includes(jess.team))

test('home panel: what is waiting for me, most pressing first', () => {
  const s = asksSummary(visible, jess, names, {}, NOW)
  assert.deepEqual(s.mine.map(a => a.id), ['s3', 's5'], 'the urgent overdue quote first, then the Sales team stock check')
  assert.equal(s.toPick, 2)
  assert.equal(s.onIt, 0)
  assert.equal(s.overdue, 1)
})

test('home panel: latest activity by other people, newest first, with unread marks', () => {
  const s = asksSummary(visible, jess, names, { s3: NOW }, NOW)
  assert.deepEqual(s.activity.map(x => x.text), ['Mike mentioned you', 'Mike sent you an ask'])
  assert.deepEqual(s.activity.map(x => x.unread), [true, false], 'the quote was opened after it was sent')
  assert.equal(s.unread, 1)
  const mike = { uid: 'u-mike', team: 'Engineers', role: 'user' }
  const own = asksSummary(asks.filter(a => a.people.includes('u-mike') || a.teams.includes('Engineers')), mike, names, {}, NOW)
  assert.ok(!own.activity.some(x => x.text.startsWith('Mike')), 'never your own changes')
  assert.ok(own.activity.some(x => x.text === 'Lee sent you an ask'), 'sent to your team counts as sent to you')
})

test('links open the ask in Asks', () => {
  assert.equal(askUrl('abc123'), '/asks/#/mine?ask=abc123')
})
