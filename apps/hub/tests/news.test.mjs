// npm test -w apps/hub — company news (news.js), project tracker suggestions
// (suggest.js) and tool requests (requests.js): the parts with no Firestore.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { buildEmail, findSimilar, linkParts, matchPostedWeek, mergeNews, mondayOf, photoCountOf, postedWeek, sortNews, teamNews } from '../src/news.js'
import { splitEmail } from '../src/emailSplit.js'
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

test('findSimilar spots a repeat of a recent post, not a near-miss or an old one', () => {
  const list = [
    item('step', { title: 'Intensive Care Foundation StepUp4ICU Challenge', category: 'Events', date: '2026-10-09' }),
    item('a9', { title: 'Mindray A9 training, Wednesday 14 October', date: '2026-10-02' }),
    item('old', { title: 'Hamilton Zoo install', date: '2026-06-01' }),
  ]
  const today = '2026-10-16'
  assert.equal(findSimilar({ title: 'StepUp4ICU Challenge – week two' }, list, today)?.id, 'step')
  assert.equal(findSimilar({ title: 'StepUp4ICU' }, list, today)?.id, 'step')
  assert.equal(findSimilar({ title: 'A9 upgrades in Hawkes Bay' }, list, today), null)
  assert.equal(findSimilar({ title: 'Install at Hamilton Zoo' }, list, today), null)
  assert.equal(findSimilar({ title: 'StepUp4ICU' }, [{ ...list[0], deleted: true }], today), null)
})

test('findSimilar: this week’s “week that’s been” never updates last week’s “next week”', () => {
  const today = '2026-11-26'
  const lastWeek = [item('n1', { title: 'Pat in Christchurch for the Burwood demo', category: 'Team news', section: 'next', date: '2026-11-19' })]
  // The same work, now done: a new post in this week's been, not an update
  assert.equal(findSimilar({ title: 'Pat did the Burwood demo in Christchurch', section: 'been' }, lastWeek, today), null)
  assert.equal(findSimilar({ title: 'Pat in Christchurch for the Burwood demo', section: 'next' }, lastWeek, today), null)
  // Nor does a feature block take over a weekly bullet
  assert.equal(findSimilar({ title: 'Burwood demo in Christchurch with Pat' }, lastWeek, today), null)
  // A running feature is still spotted
  const feature = [item('s', { title: 'StepUp4ICU Challenge', category: 'Events', date: '2026-11-19' })]
  assert.equal(findSimilar({ title: 'StepUp4ICU Challenge week three' }, feature, today)?.id, 's')
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

test('the email takes one photo or several per post; older posts count their one photo', () => {
  const { html } = buildEmail([item('f', { category: 'Events' }), item('g', { category: 'Events' })], { photos: { f: ['data:image/jpeg;base64,QQ==', 'data:image/jpeg;base64,Qg=='], g: 'data:image/jpeg;base64,Qw==' } })
  assert.equal(html.match(/<img /g).length, 3)
  assert.equal(photoCountOf({ hasPhoto: true }), 1)
  assert.equal(photoCountOf({ hasPhoto: true, photoCount: 4 }), 4)
  assert.equal(photoCountOf({}), 0)
})

test('the email only takes real JPEG photos: anything else is left out, never put in the HTML', () => {
  const bad = 'data:image/jpeg;base64,AAAA" onerror="alert(1)'
  const { html } = buildEmail([item('f', { category: 'Events' })], { photos: { f: [bad, 'javascript:alert(1)', 'data:image/jpeg;base64,QUJD'] } })
  assert.equal(html.match(/<img /g).length, 1)
  assert.doesNotMatch(html, /onerror|javascript:/)
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

// ── A team update whose week is already posted (matchPostedWeek) ──────────

const EMAIL = [
  'Hi All,',
  '',
  'The week that’s been:',
  '• Jack installed the new monitors at Waikato Hospital',
  '• Theresa ran training at Middlemore',
  '',
  'Next week:',
  '• Pat is in Christchurch for the Burwood demo',
  '',
  'Thanks,',
].join('\n')

// What posting EMAIL made: the drafts as records, in order, one week.
const postedFrom = (text, fields = {}) => splitEmail({ text }).map((d, i) => item(`p${i}`, {
  title: d.title, body: d.body, section: d.section, date: '2026-11-26', weekOf: '2026-11-23', order: i, batchId: 'email-2026-11-26-abcde', ...fields,
}))

test('postedWeek: only that week’s Team news bullets, in posted order', () => {
  const list = [
    item('b', { section: 'next', weekOf: '2026-11-23', order: 1 }),
    item('a', { section: 'been', weekOf: '2026-11-23', order: 0 }),
    item('lastWeek', { section: 'been', weekOf: '2026-11-16' }),
    item('noSection', { section: '', weekOf: '2026-11-23' }),
    item('event', { category: 'Events', section: 'been', weekOf: '2026-11-23' }),
    item('gone', { section: 'been', weekOf: '2026-11-23', deleted: true }),
    item('byDate', { section: 'next', date: '2026-11-27' }), // no weekOf: from its date
  ]
  assert.deepEqual(postedWeek(list, '2026-11-23').map(a => a.id), ['a', 'byDate', 'b'])
  assert.deepEqual(postedWeek(list, '2026-11-30'), [])
})

test('the same email again: every bullet is already posted, word for word, and starts unticked', () => {
  const posted = postedFrom(EMAIL)
  const { drafts, missing } = matchPostedWeek(splitEmail({ text: EMAIL }), posted)
  assert.equal(drafts.length, 3)
  assert.ok(drafts.every(d => d.same && d.weekMatch && !d.include && !d.updating))
  assert.deepEqual(drafts.map(d => d.match.id), ['p0', 'p1', 'p2'])
  assert.deepEqual(missing, [])
})

test('a corrected email: a reworded bullet pairs with its post, a new one is ticked, a dropped one is left alone', () => {
  const posted = postedFrom(EMAIL)
  const again = EMAIL
    .replace('Jack installed the new monitors at Waikato Hospital', 'Jack installed the new A9 monitors at Waikato Hospital ICU')
    .replace('• Theresa ran training at Middlemore\n', '')
    .replace('• Pat is in Christchurch for the Burwood demo', '• Pat is in Christchurch for the Burwood demo\n• Sam is at the Wellington expo')
  const { drafts, missing } = matchPostedWeek(splitEmail({ text: again }), posted)
  const [jack, pat, sam] = drafts
  assert.equal(jack.match.id, 'p0'); assert.equal(jack.same, false); assert.equal(jack.include, false)
  assert.equal(pat.match.id, 'p2'); assert.equal(pat.same, true)
  assert.equal(sam.match, undefined); assert.equal(sam.include, true)
  assert.deepEqual(missing.map(a => a.id), ['p1']) // Theresa's stays posted
})

test('week matching stays within a section, and leaves features and their own match alone', () => {
  const posted = postedFrom(EMAIL)
  // The same words under Next week don't pair with The week that's been's post
  const moved = [{ title: 'Jack installed the new monitors at Waikato Hospital', body: '', category: 'Team news', section: 'next', include: true }]
  assert.equal(matchPostedWeek(moved, posted).drafts[0].match, undefined)
  const feature = { title: 'StepUp4ICU Challenge', body: '', category: 'Events', section: '', include: false, match: { id: 'step' } }
  assert.deepEqual(matchPostedWeek([feature], posted).drafts[0], feature)
})

test('picking another week clears the old pairs before pairing again', () => {
  const posted = postedFrom(EMAIL)
  const first = matchPostedWeek(splitEmail({ text: EMAIL }), posted).drafts
  const { drafts } = matchPostedWeek(first, []) // a week with nothing posted
  assert.ok(drafts.every(d => d.include && !d.match && !d.same && !d.weekMatch))
})
