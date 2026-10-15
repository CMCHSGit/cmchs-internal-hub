// npm test -w apps/hub — splitting the project team's weekly email into
// announcements (emailSplit.js). The sample has the real email's shape and
// places, with made-up names and links: this repo is public.
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { detectPeople, detectRegions, shortTitle, splitEmail, textToLines } from '../src/emailSplit.js'

// As Outlook puts it on the clipboard as plain text: Symbol-font bullets as "·"
// plus spaces, blank paragraphs as empty lines.
const EMAIL = `Hi All,

Thank you to those who have filled in the schedule, if not please click on the link Staff Schedule.xlsx

You can check the planner here: Planning resources for install_Live.xlsx (https://example.sharepoint.com/planner) .
Let me know if I’ve missed anything


Intensive Care Foundation StepUp4ICU Challenge
Week One done ✅

Theres still a few to enter their steps but so far

1st Aroha 166,533 steps (5 days recorded) 👏 !!
2nd Ben 126,622 steps (4 days)
3rd Carl 92,898 steps (7 days)

Add to your socials to drum up some donations 😊
It’s not too late to join -Click on the link below to join our team.

https://fundraise.example.org/join/team


The week that’s been:
·         Dev was in Invercargill for the Defib install Go Live week 😊
·         Eli was Prep-ing for the Waikato Defib install, Installing VS9’s and a PACU monitor in Rotorua
·         Finn and Gus with Ben’s help are installing the X-ray at Franklin Vets – Waiuku
·         Hana was in Whanganui doing PMV’s before going on leave thurs/fri
·         Ivan was doing MV’s in Palmerston North
·         Jess C and Gus were at Hamilton Zoo for a Demo
·         Kai is in Hawkes Bay upgrading the A9’s
·         Aroha and Lou were at NSH ED changing configs -and doing a lot of walking!!
·         Mia and Nia kept things running smoothly in the office with Olly on leave for a couple of days 😊
·         Carl headed to China for customer visit

·         And lots more ………

Next week:
·         Eli and Lou start training for the Waikato Defib install across the ‘T’ hospitals
·         Pat and Dev are at the New Dunedin Hospital Opening and Go Live 😊
·         Jess C is travelling the length of the country installing in Clutha Health, Demo-ing in Whangarei and presenting with Quin the new ICU Cabin setup in the boardroom
·         Gus is also on the road heading the Christchurch, Whangarei, and Wellington -maybe not in the order
·         Kai is in Gisborne doing the A9 upgrade
·         Aroha, Finn, and Patt (remotely) are doing a Vocera Upgrade at DCCM
·         Rua is installing in Taranaki and Midcentral
·         Sid, Quin, Jess C, and Tom all have leave throughout the week
·         And lots more…….

        Thanks everyone for all that you do and have a relaxing weekend 😊

Cheers
Pat, Ben, and Mel
Project Team
Cass Medical & Connected Healthcare Systems | 6C Example Ave, Manukau, Auckland 2104

Web:    www.example.co.nz    Tel:    +64 9 000 0000`

const PEOPLE = ['Aroha', 'Ben', 'Carl', 'Dev', 'Eli', 'Finn', 'Gus', 'Hana', 'Ivan', 'Kai', 'Lou', 'Mia', 'Nia', 'Olly', 'Pat', 'Quin', 'Rua', 'Sid', 'Tom']
  .map(n => ({ uid: n.toLowerCase(), names: [n] }))
  .concat([{ uid: 'jess-c', names: ['Jess C', 'Jess Chan'] }, { uid: 'jess-m', names: ['Jess M', 'Jess Moore'] }])

const drafts = splitEmail({ text: EMAIL }, { people: PEOPLE })
const been = drafts.filter(d => d.section === 'been')
const next = drafts.filter(d => d.section === 'next')

test('one announcement per bullet, filed under its section; filler and sign-off dropped', () => {
  assert.equal(been.length, 10)
  assert.equal(next.length, 8)
  assert.ok(drafts.every(d => !/lots more|Thanks everyone|Cheers|Project Team|Web:/i.test(d.title + d.body)))
  assert.ok([...been, ...next].every(d => d.category === 'Team news' && d.include))
  assert.equal(been[0].title, 'Dev was in Invercargill for the Defib install Go Live week 😊')
})

test('the intro is kept but unticked; the feature block is one Events announcement', () => {
  const [intro, feature] = drafts
  assert.equal(drafts.length, 2 + 10 + 8)
  assert.equal(intro.include, false)
  assert.match(intro.title + intro.body, /planner/)
  assert.equal(feature.title, 'Intensive Care Foundation StepUp4ICU Challenge')
  assert.equal(feature.category, 'Events')
  assert.equal(feature.include, true)
  assert.match(feature.body, /^Week One done ✅/)
  assert.match(feature.body, /1st Aroha 166,533 steps/)
  assert.match(feature.body, /https:\/\/fundraise\.example\.org\/join\/team$/)
})

test('regions come from places, hospitals and abbreviations', () => {
  const r = t => drafts.find(d => d.title.startsWith(t)).regions
  assert.deepEqual(r('Dev was in Invercargill'), ['Southland'])
  assert.deepEqual(r('Eli was Prep-ing'), ['Waikato', 'Bay of Plenty'])
  assert.deepEqual(r('Finn and Gus'), ['Auckland'])
  assert.deepEqual(r('Hana was in Whanganui'), ['Manawatū-Whanganui'])
  assert.deepEqual(r('Kai is in Hawkes Bay'), ['Hawke’s Bay'])
  assert.deepEqual(r('Aroha and Lou were at NSH'), ['Auckland'])
  assert.deepEqual(r('Mia and Nia'), ['Auckland'])
  assert.deepEqual(r('Carl headed to China'), ['Overseas'])
  assert.deepEqual(r('Pat and Dev'), ['Otago'])
  assert.deepEqual(r('Jess C is travelling'), ['Northland', 'Otago'])
  assert.deepEqual(r('Gus is also on the road'), ['Northland', 'Wellington', 'Canterbury'])
  assert.deepEqual(r('Rua is installing'), ['Taranaki', 'Manawatū-Whanganui'])
  assert.deepEqual(r('Aroha, Finn'), ['Auckland'])
  assert.deepEqual(r('Sid, Quin'), [])
})

test('people are matched by name, with the longer form winning and shared names skipped', () => {
  const p = t => drafts.find(d => d.title.startsWith(t)).people.sort()
  assert.deepEqual(p('Finn and Gus'), ['ben', 'finn', 'gus'])
  assert.deepEqual(p('Jess C and Gus'), ['gus', 'jess-c'])
  assert.deepEqual(p('Sid, Quin'), ['jess-c', 'quin', 'sid', 'tom'])
  assert.deepEqual(detectPeople('Jess is here', PEOPLE), []) // two Jesses
})

test('detectRegions ignores case, macrons and partial words', () => {
  assert.deepEqual(detectRegions('WHANGĀREI and palmy'), ['Northland', 'Manawatū-Whanganui'])
  assert.deepEqual(detectRegions('Napier'), ['Hawke’s Bay'])
  assert.deepEqual(detectRegions('Gorey and Nelsonville'), [])
})

test('plain bullets of other kinds and long bullets', () => {
  const lines = textToLines('• one\n- two\n* three\n1. four\n—— not a bullet')
  assert.deepEqual(lines.map(l => l.bullet), [true, true, true, true, false])
  const long = 'x '.repeat(100).trim()
  const d = splitEmail({ text: `Next week:\n• ${long}` })
  assert.equal(d.length, 1)
  assert.ok(d[0].title.endsWith('…'))
  assert.equal(d[0].body, long)
  assert.ok(shortTitle('a '.repeat(80)).length <= 91)
})

test('a list under some other heading is kept, as plain announcements', () => {
  const d = splitEmail({ text: 'Reminders:\n• Timesheets due Friday\n• Parking is closed Monday' })
  assert.deepEqual(d.map(x => [x.title, x.category, x.section]), [
    ['Timesheets due Friday', 'Announcements', ''], ['Parking is closed Monday', 'Announcements', ''],
  ])
})
