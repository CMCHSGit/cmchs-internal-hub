// npm test -w apps/hub — company news (news.js), project tracker suggestions
// (suggest.js) and tool requests (requests.js): the parts with no Firestore.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildEmail, linkParts, mergeNews, mondayOf, sortNews, teamNews } from '../src/news.js'
import { andList, suggestFromProjects } from '../src/suggest.js'
import { feedbackSummary, sortRequests } from '../src/requests.js'

const item = (id, fields) => ({ id, title: id, body: '', category: 'Team news', regions: [], people: [], date: '2026-10-16', ...fields })

test('mondayOf: a Sunday belongs to the week just gone', () => {
  assert.equal(mondayOf('2026-10-16'), '2026-10-12') // Friday
  assert.equal(mondayOf('2026-10-18'), '2026-10-12') // Sunday
  assert.equal(mondayOf('2026-10-19'), '2026-10-19') // Monday
})

test('pinned first, then newest, then the order an email was posted in', () => {
  const s = sortNews([item('b', { order: 1 }), item('a', { order: 0 }), item('old', { date: '2026-10-01', pinned: true }), item('new', { date: '2026-10-20' })])
  assert.deepEqual(s.map(a => a.id), ['old', 'new', 'a', 'b'])
})

test('Firestore replaces a legacy JSON entry with the same id', () => {
  const merged = mergeNews([item('x', { title: 'From Firestore' })], [{ id: 'x', title: 'From JSON' }, { id: 'y', title: 'Only JSON' }])
  assert.equal(merged.find(a => a.id === 'x').title, 'From Firestore')
  assert.equal(merged.find(a => a.id === 'y').legacy, true)
})

test('a deleted legacy entry stays gone', () => {
  const merged = mergeNews([item('x', { deleted: true })], [{ id: 'x', title: 'From JSON' }])
  assert.deepEqual(merged, [])
})

test('teamNews shows only the newest week, split by section, with the regions in it', () => {
  const t = teamNews([
    item('old', { weekOf: '2026-10-05', section: 'been' }),
    item('b1', { weekOf: '2026-10-12', section: 'been', order: 1, regions: ['Otago'] }),
    item('b0', { weekOf: '2026-10-12', section: 'been', order: 0, regions: ['Auckland'] }),
    item('n0', { weekOf: '2026-10-12', section: 'next', regions: ['Auckland'] }),
    item('feature', { category: 'Events', weekOf: '2026-10-12' }),
  ])
  assert.equal(t.weekOf, '2026-10-12')
  assert.deepEqual(t.been.map(a => a.id), ['b0', 'b1'])
  assert.deepEqual(t.next.map(a => a.id), ['n0'])
  assert.deepEqual(t.regions, ['Auckland', 'Otago'])
  assert.equal(teamNews([item('e', { category: 'Events' })]), null)
})

test('linkParts finds web addresses, leaving trailing punctuation out', () => {
  assert.deepEqual(linkParts('Join here: https://x.org/join. Thanks'), [['Join here: ', null], ['https://x.org/join', 'https://x.org/join'], ['. Thanks', null]])
})

test('the email: features first, then the two lists; everything escaped', () => {
  const items = [
    item('n', { title: 'Kai is in Gisborne', section: 'next', order: 2 }),
    item('b', { title: 'Dev was in <Invercargill>', section: 'been', order: 1 }),
    item('f', { title: 'StepUp4ICU', body: 'Join: https://x.org/j', category: 'Events', order: 0 }),
  ]
  const { html, text } = buildEmail(items, { greeting: 'Hi All,', signoff: 'Cheers' })
  assert.ok(html.indexOf('StepUp4ICU') < html.indexOf('The week that’s been') && html.indexOf('The week that’s been') < html.indexOf('Next week'))
  assert.match(html, /Dev was in &lt;Invercargill&gt;/)
  assert.match(html, /<a href="https:\/\/x.org\/j"/)
  assert.equal(text, 'Hi All,\n\nSTEPUP4ICU\nJoin: https://x.org/j\n\nThe week that’s been:\n• Dev was in <Invercargill>\n\nNext week:\n• Kai is in Gisborne\n\nCheers\n')
})

test('the email grouped by region: one region each, "On the road" for several, next week marked', () => {
  const { text } = buildEmail([
    item('a', { title: 'A', regions: ['Otago'], section: 'been' }),
    item('b', { title: 'B', regions: ['Auckland'], section: 'next' }),
    item('c', { title: 'C', regions: ['Auckland', 'Otago'], section: 'next' }),
    item('d', { title: 'D', section: 'been' }),
  ], { groupBy: 'region', greeting: 'Hi' })
  assert.equal(text, 'Hi\n\nAuckland\n• B (next week)\n\nOtago\n• A\n\nOn the road\n• C (next week)\n\nAround the office and elsewhere\n• D\n')
})

test('project tracker suggestions: this week and next, grouped by job and activity, plus leave', () => {
  const s = suggestFromProjects({
    today: '2026-10-16',
    jobs: [
      { id: 'j1', name: 'Defib install', customer: 'Waikato Hospital', region: 'Waikato' },
      { id: 'j2', name: 'A9 upgrade', customer: 'Gisborne Hospital', region: '' },
      { id: 'gone', name: 'Archived', archived: true },
    ],
    staff: [
      { id: 's1', name: 'Sam Lee', leave: [] },
      { id: 's2', name: 'Teri Ngata', leave: [{ from: '2026-10-21', to: '2026-10-23' }] },
      { id: 's3', name: 'Kai Smith', leave: [] },
    ],
    assignments: [
      { jobId: 'j1', staffId: 's1', week: '2026-10-19', activity: 'Training' },
      { jobId: 'j1', staffId: 's2', week: '2026-10-19', activity: 'Training' },
      { jobId: 'j2', staffId: 's3', week: '2026-10-12', activity: 'Install' },
      { jobId: 'gone', staffId: 's3', week: '2026-10-12', activity: 'Install' },
      { jobId: 'j2', staffId: 's3', week: '2026-11-30', activity: 'Install' },
    ],
  })
  assert.deepEqual(s.been.map(x => x.title), ['Kai was on install for A9 upgrade at Gisborne Hospital'])
  assert.deepEqual(s.been[0].regions, ['Gisborne'])
  assert.deepEqual(s.next.map(x => x.title), ['Sam and Teri are on training for Defib install at Waikato Hospital', 'Teri has leave during the week'])
  assert.deepEqual(s.next[0].regions, ['Waikato'])
  assert.equal(andList(['A', 'B', 'C']), 'A, B and C')
})

test('requests: most +1s first, finished ones last; feedback averages, worst first', () => {
  const r = sortRequests([
    { id: 'built', status: 'built', votes: [1, 2, 3, 4] },
    { id: 'one', status: 'new', votes: [1] },
    { id: 'three', status: 'reviewing', votes: [1, 2, 3] },
  ])
  assert.deepEqual(r.map(x => x.id), ['three', 'one', 'built'])
  const f = feedbackSummary([
    { kind: 'feedback', tool: 'demo', rating: 5 }, { kind: 'feedback', tool: 'demo', rating: 4 },
    { kind: 'feedback', tool: 'hub', rating: 2 }, { kind: 'tool', tool: 'x', rating: 1 },
  ])
  assert.deepEqual(f.map(x => [x.tool, x.average, x.count]), [['hub', 2, 1], ['demo', 4.5, 2]])
})
