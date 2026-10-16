// npm test -w apps/hub — the one search's scoring and grouping (search.js).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GROUPS, PAGES, grouped, personHits, placeHits, scoreOf, words } from '../src/search.js'

test('words: lower case, split on any space, nothing for blank', () => {
  assert.deepEqual(words('  My  Week '), ['my', 'week'])
  assert.deepEqual(words(''), [])
  assert.deepEqual(words(null), [])
})

test('scoreOf: every word must be there; the title counts more than the rest', () => {
  assert.equal(scoreOf(['week', 'leave'], 'My week', 'schedule'), 0)
  const inTitle = scoreOf(['week'], 'My week')
  const inRest = scoreOf(['week'], 'Roster', 'week view')
  assert.ok(inTitle > inRest && inRest > 0)
  // Starting a word beats being inside one; starting the title beats both.
  assert.ok(scoreOf(['call'], 'On call') > scoreOf(['all'], 'On call'))
  assert.ok(scoreOf(['team', 'week'], 'Team week') > scoreOf(['team', 'week'], 'Week of the team'))
  assert.equal(scoreOf([], 'Anything'), 0)
})

test('placeHits: pages by title or the words they are also known by', () => {
  assert.equal(placeHits('my week')[0].href, '/schedule/my')
  assert.equal(placeHits('holiday')[0].title, 'Leave calendar')
  assert.ok(placeHits('fbt').some(h => h.href === '/schedule/out-of-town'))
  assert.deepEqual(placeHits('   '), [])
})

test('placeHits: tools too, but not twice when a tool is also a page', () => {
  const tools = [
    { id: 'schedule', name: 'Staff schedule', description: 'Who is where', link: '/schedule/' },
    { id: 'maintenance', name: 'Maintenance', description: 'Planned maintenance', link: '/maintenance/' },
  ]
  const hits = placeHits('maintenance', tools)
  assert.equal(hits[0].tool.id, 'maintenance')
  // "/schedule/" is Team week's page already
  assert.ok(!placeHits('schedule', tools).some(h => h.tool?.id === 'schedule'))
})

test('every page links somewhere in the app, once', () => {
  const hrefs = PAGES.map(p => p.href)
  assert.equal(new Set(hrefs).size, hrefs.length)
  for (const h of hrefs) assert.match(h, /^\/(#\/|schedule\/|asks\/|projects\/|settings\/)/)
})

const directory = [
  { uid: 'a', name: 'Karen Smith', shortName: 'Karen', teamName: 'Admin', email: 'karen.smith@cass.co.nz', workMobile: '021 555 1234' },
  { uid: 'b', name: 'Bryan David', shortName: 'Bryan', teamName: 'Engineers', email: 'bryan.david@cass.co.nz', workMobile: '', where: 'Waikato' },
]

test('personHits: by name, team or email, linking to their profile', () => {
  assert.deepEqual(personHits(directory, 'karen').map(h => h.href), ['/#/people/a'])
  assert.deepEqual(personHits(directory, 'engineers').map(h => h.title), ['Bryan David'])
  assert.match(personHits(directory, 'bryan')[0].sub, /Today: Waikato/)
  assert.deepEqual(personHits(null, 'karen'), [])
})

test('personHits: three or more digits find a mobile number', () => {
  assert.deepEqual(personHits(directory, '5551').map(h => h.uid || h.href), ['/#/people/a'])
  assert.deepEqual(personHits(directory, '02'), [])
})

test('grouped: in the set order, best first, cut to size with a count of the rest', () => {
  const hits = [
    { key: 'j1', group: 'jobs', score: 1 },
    { key: 'p1', group: 'places', score: 2 },
    ...Array.from({ length: 9 }, (_, i) => ({ key: 'x' + i, group: 'people', score: i })),
  ]
  const g = grouped(hits)
  assert.deepEqual(g.map(x => x.id), ['places', 'people', 'jobs'])
  const people = g.find(x => x.id === 'people')
  assert.equal(people.hits.length, GROUPS.find(x => x.id === 'people').max)
  assert.equal(people.more, 9 - people.hits.length)
  assert.equal(people.hits[0].key, 'x8')
})
