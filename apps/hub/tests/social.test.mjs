// npm test -w apps/hub — reactions and comments on company news (social.js),
// and who the proxy tells and what it says (newsCommentRecipients_ /
// newsMessage_, read straight out of backend/apps-script/proxy/Code.js so the
// test checks what's deployed).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { initialsOf, reactionSummary, timeAgo } from '../src/social.js'

test('reactions: counted per kind, most used first, and which is mine', () => {
  const s = reactionSummary({ a: 'like', b: 'love', c: 'love', me: 'clap', x: 'nonsense' }, 'me')
  assert.equal(s.total, 4)
  assert.equal(s.mine, 'clap')
  assert.deepEqual(s.top.map(r => [r.id, r.count]), [['love', 2], ['like', 1], ['clap', 1]])
  assert.deepEqual(reactionSummary(undefined, 'me'), { total: 0, mine: null, top: [] })
})

test('timeAgo and initials', () => {
  const now = Date.parse('2026-10-19T12:00:00+13:00')
  assert.equal(timeAgo(now - 20e3, now), 'Just now')
  assert.equal(timeAgo(now - 5 * 60e3, now), '5m')
  assert.equal(timeAgo(now - 3 * 3600e3, now), '3h')
  assert.equal(timeAgo(now - 2 * 86400e3, now), '2d')
  assert.equal(initialsOf('Peter Lin'), 'PL')
  assert.equal(initialsOf(''), '?')
})

const code = readFileSync(new URL('../../../backend/apps-script/proxy/Code.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const grab = (name) => {
  const i = code.indexOf('function ' + name + '(')
  assert.ok(i >= 0, name + ' not found')
  return code.slice(i, code.indexOf('\n}\n', i) + 3)
}
const ctx = vm.createContext({})
vm.runInContext(grab('newsCommentRecipients_') + grab('newsMessage_'), ctx)

test('a comment tells the author and earlier commenters, never the commenter, each once', () => {
  const to = ctx.newsCommentRecipients_({ authorUid: 'pat' }, ['zed', 'bob', 'zed', 'pat'], 'bob')
  assert.deepEqual([...to].sort(), ['pat', 'zed'])
  assert.deepEqual([...ctx.newsCommentRecipients_({ authorUid: 'pat' }, ['pat'], 'pat')], [])
})

test('what the pushes say', () => {
  const post = { title: 'Labour Day, Monday 26 October', body: 'The office is closed.\nCheck the schedule.', category: 'Announcements' }
  assert.deepEqual({ ...ctx.newsMessage_('post', post, 'Peter Lin') }, { title: '📣 Labour Day, Monday 26 October', body: 'Peter: The office is closed. Check the schedule.' })
  assert.deepEqual({ ...ctx.newsMessage_('batch', post, 'Melanie Gash', { count: 8 }) }, { title: 'Team update from Melanie', body: '8 new items: Labour Day, Monday 26 October and more' })
  assert.deepEqual({ ...ctx.newsMessage_('comment', post, 'Bob', { text: 'Enjoy!' }) }, { title: 'Bob commented on “Labour Day, Monday 26 October”', body: 'Enjoy!' })
  assert.equal(ctx.newsMessage_('post', { title: 'Party', category: 'Events' }, 'Kai').body, 'Kai posted in Events')
})
